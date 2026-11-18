import json
from django.test import TestCase
from django.urls import reverse
from .models import GameRoom,RoomPilot

class GameTests(TestCase):
    def post(self,url,data):
        return self.client.post(url,data=json.dumps(data),content_type="application/json")
    def room(self,mode="duel"):
        host=self.post(reverse("create_room"),{"name":"host","mode":mode,"state":{"hp":100,"x":0,"y":9,"z":2}}).json()
        code=host["room"]["roomCode"]
        guest=self.post(reverse("join_room"),{"name":"guest","roomCode":code,"state":{"hp":100,"x":0,"y":9,"z":12}}).json()
        return host,guest,code
    def ready(self,code):
        r=GameRoom.objects.get(code=code);r.meta["started"]=1
        for p in r.meta["duel"].values():p["shieldUntil"]=0
        r.save()
    def sync(self,code,p,events,after=0):
        return self.post(reverse("sync_room",args=[code]),{"playerId":p["playerId"],"state":{"hp":9999,"x":0,"y":9,"z":2},"events":events,"afterRevision":after}).json()
    def test_lobby_has_working_input_and_modes(self):
        response=self.client.get(reverse("index"))
        for text in ('id="roomCode3"','id="createDuel"','id="createRoom"','쉬움','보통','어려움','id="joinForm"'):
            self.assertContains(response,text)
        self.assertEqual(response["Cache-Control"],"no-store")
    def test_modes_and_capacity(self):
        host,guest,code=self.room()
        self.assertEqual(guest["room"]["mode"],"duel")
        third=self.post(reverse("join_room"),{"roomCode":code})
        self.assertEqual(third.status_code,409)
        self.assertEqual(third.json()["error"],"room_full")
    def test_damage_is_server_owned_and_duplicate_is_ignored(self):
        host,guest,code=self.room();self.ready(code)
        event={"seq":1,"kind":"damage","target":guest["playerId"],"life":0,"effect":"rifle","damage":1000}
        first=self.sync(code,host,[event])
        second=self.sync(code,host,[event])
        for payload in (first,second):
            s=next(p["state"] for p in payload["room"]["pilots"] if p["playerId"]==guest["playerId"])
            self.assertEqual(s["hp"],52)
        self.assertEqual(len(second["room"]["events"]),1)
    def test_guest_damage_death_respawn_stale_hit(self):
        host,guest,code=self.room();self.ready(code)
        event={"seq":1,"kind":"damage","target":host["playerId"],"life":0,"effect":"sniper","damage":100}
        self.sync(code,guest,[event])
        r=GameRoom.objects.get(code=code)
        self.assertEqual(r.meta["duel"][guest["playerId"]]["score"],1)
        r.meta["duel"][host["playerId"]]["respawnAt"]=1;r.save()
        result=self.sync(code,host,[])
        state=next(p["state"] for p in result["room"]["pilots"] if p["playerId"]==host["playerId"])
        self.assertEqual((state["hp"],state["life"]),(100,1))
        self.sync(code,guest,[dict(event,seq=2)])
        r.refresh_from_db();self.assertEqual(r.meta["duel"][host["playerId"]]["hp"],100)
    def test_five_kills_finishes_match(self):
        host,guest,code=self.room();self.ready(code)
        for i in range(5):
            r=GameRoom.objects.get(code=code);s=r.meta["duel"][guest["playerId"]];s.update(hp=100,life=i,shieldUntil=0,respawnAt=0);r.save()
            p=RoomPilot.objects.get(player_id=host["playerId"]);p.state["cooldowns"]={};p.save()
            self.sync(code,host,[{"seq":i+1,"kind":"damage","effect":"sniper","target":guest["playerId"],"life":i,"damage":100}])
        r.refresh_from_db();self.assertEqual(r.meta["winner"],host["playerId"])
    def test_fx_both_directions_and_delta(self):
        host,guest,code=self.room("combat")
        for p in (host,guest):
            self.sync(code,p,[{"seq":1,"kind":"fx","effect":"laser","origin":{"x":0,"y":9,"z":0},"dir":{"x":0,"y":0,"z":1}}])
        snap=self.sync(code,host,[])
        self.assertEqual(len(snap["room"]["events"]),2)
        self.assertEqual({e["owner"] for e in snap["room"]["events"]},{host["playerId"],guest["playerId"]})
        delta=self.sync(code,host,[],after=2)
        self.assertEqual(delta["room"]["events"],[])
    def test_host_leave_blocks_new_join(self):
        host,guest,code=self.room()
        self.post(reverse("leave_room",args=[code]),{"playerId":host["playerId"]})
        r=self.post(reverse("join_room"),{"roomCode":code})
        self.assertEqual(r.json()["error"],"host_left")
    def test_unknown_code_and_bad_json(self):
        r=self.post(reverse("join_room"),{"roomCode":"BAD"})
        self.assertEqual(r.status_code,400)
        r=self.client.post(reverse("join_room"),data="bad json",content_type="application/json")
        self.assertEqual(r.status_code,400)

    def test_laser_slow_is_authoritative_and_not_replayed(self):
        host,guest,code=self.room();self.ready(code)
        event={"seq":1,"kind":"damage","target":guest["playerId"],"life":0,"effect":"laser","damage":60}
        first=self.sync(code,host,[event])
        state=next(p["state"] for p in first["room"]["pilots"] if p["playerId"]==guest["playerId"])
        self.assertEqual(state["hp"],40)
        self.assertAlmostEqual(state["slowUntil"]-first["room"]["serverTime"],2,delta=.2)
        deadline=state["slowUntil"]
        again=self.sync(code,host,[event])
        self.assertEqual(next(p["state"]["slowUntil"] for p in again["room"]["pilots"] if p["playerId"]==guest["playerId"]),deadline)

    def test_shielded_laser_cannot_slow(self):
        from django.utils import timezone
        host,guest,code=self.room();self.ready(code)
        room=GameRoom.objects.get(code=code)
        room.meta["duel"][guest["playerId"]]["shieldUntil"]=timezone.now().timestamp()+10
        room.save()
        result=self.sync(code,host,[{"seq":1,"kind":"damage","target":guest["playerId"],"life":0,"effect":"laser","damage":60}])
        state=next(p["state"] for p in result["room"]["pilots"] if p["playerId"]==guest["playerId"])
        self.assertEqual((state["hp"],state["slowUntil"]),(100,0))

    def test_slow_expires_and_respawn_clears_status(self):
        from datetime import timedelta
        from unittest.mock import patch
        from django.utils import timezone
        host,guest,code=self.room();self.ready(code)
        self.sync(code,guest,[{"seq":1,"kind":"damage","target":host["playerId"],"life":0,"effect":"laser","damage":60}])
        with patch("game.views.timezone.now",return_value=timezone.now()+timedelta(seconds=3)):
            result=self.sync(code,host,[])
            state=next(p["state"] for p in result["room"]["pilots"] if p["playerId"]==host["playerId"])
            self.assertLess(state["slowUntil"],result["room"]["serverTime"])
        room=GameRoom.objects.get(code=code)
        room.meta["duel"][host["playerId"]].update(hp=0,respawnAt=1)
        room.save()
        result=self.sync(code,host,[])
        state=next(p["state"] for p in result["room"]["pilots"] if p["playerId"]==host["playerId"])
        self.assertEqual((state["hp"],state["slowUntil"]),(100,0))

    def test_shared_entry_is_once_and_resets_duel_countdown(self):
        host,guest,code=self.room()
        first=self.sync(code,guest,[{"seq":1,"kind":"entry"}])
        at=first["room"]["entryAt"]
        self.assertGreater(at,first["room"]["serverTime"])
        self.assertAlmostEqual(first["room"]["started"]-at,3.2,places=3)
        for pilot in first["room"]["pilots"]:
            self.assertAlmostEqual(pilot["state"]["shieldUntil"]-at,4.4,places=3)
        again=self.sync(code,host,[{"seq":1,"kind":"entry"}])
        self.assertEqual(again["room"]["entryAt"],at)
        self.assertEqual(len([e for e in again["room"]["events"] if e["kind"]=="entry"]),1)

    def test_home_position_and_objectives_are_shared(self):
        host,guest,code=self.room("combat")
        state={"hp":100,"playing":False,"entry":{"phase":"walk","x":59,"z":-125,"yaw":1,"jump":0},
               "mission":{"capture":True,"progress":3,"required":6}}
        snap=self.post(reverse("sync_room",args=[code]),{"playerId":host["playerId"],"state":state}).json()
        s=next(p["state"] for p in snap["room"]["pilots"] if p["isHost"])
        self.assertEqual(s["entry"]["z"],-125)
        self.assertEqual(s["mission"]["progress"],3)

    def test_boss_warning_is_host_only_and_shared(self):
        host,guest,code=self.room("combat")
        event={"seq":1,"kind":"pressure","point":{"x":0,"y":7,"z":20},"radius":4.2,"delay":1.8,"damage":20}
        self.assertEqual(self.sync(code,guest,[event])["room"]["events"],[])
        ev=self.sync(code,host,[event])["room"]["events"][0]
        self.assertEqual((ev["radius"],ev["delay"]),(4.2,1.8))
