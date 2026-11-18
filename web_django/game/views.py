import json
import math
import secrets
import threading
from datetime import timedelta
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from .models import GameRoom, RoomPilot, generate_room_code

_room_lock = threading.RLock()

def index(request):
    response = render(request, "game/index.html")
    response["Cache-Control"] = "no-store"
    return response

def _load_json(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except (ValueError, UnicodeDecodeError):
        return {}

def number(value, default=0, low=-10000, high=10000):
    try:
        n = float(value)
        return max(low, min(high, n)) if math.isfinite(n) else default
    except (ValueError, TypeError):
        return default

def _prune_room(room):
    room.pilots.filter(last_seen__lt=timezone.now()-timedelta(seconds=30)).delete()

def _advance_duel(room):
    meta = room.meta
    now = timezone.now().timestamp()
    if meta.get("mode") != "duel":
        return
    players = meta.setdefault("duel", {})
    active = list(room.pilots.all())
    if len(active) == 2 and not meta.get("started"):
        meta["started"] = now + 3
        for p in active:
            players[p.player_id] = {"hp":100, "score":0, "life":0, "respawnAt":0, "shieldUntil":now+4.2, "slowUntil":0}
    for p in active:
        s = players.get(p.player_id)
        if s and s["hp"] <= 0 and 0 < s["respawnAt"] <= now and not meta.get("winner"):
            s.update(hp=100, life=s["life"]+1, respawnAt=0, shieldUntil=now+1.2, slowUntil=0)

def _room_snapshot(room, after=0):
    pilots = []
    for p in room.pilots.order_by("-is_host", "id"):
        state = dict(p.state or {})
        if room.meta.get("mode") == "duel":
            state.update(room.meta.get("duel", {}).get(p.player_id, {"hp":100,"score":0,"life":0}))
        pilots.append({"playerId":p.player_id,"name":p.name,"state":state,"isHost":p.is_host,"lastSeen":p.last_seen.isoformat()})
    return {"roomCode":room.code,"seed":room.seed,"status":room.status,
            "mode":room.meta.get("mode","combat"),"started":room.meta.get("started",0),"entryAt":room.meta.get("entryAt",0),
            "winner":room.meta.get("winner",""),"serverTime":timezone.now().timestamp(),
            "events":[e for e in room.meta.get("events",[]) if e.get("revision",0)>after],"pilots":pilots}

def _reply(room, after=0, **extra):
    response = JsonResponse({"ok":True,"room":_room_snapshot(room,after),**extra})
    response["Cache-Control"] = "no-store"
    return response

def _state(data, old=None):
    old = old or {}
    src = data if isinstance(data,dict) else {}
    s = {k:number(src.get(k), old.get(k,0)) for k in ("x","y","z","yaw","pitch","hp","wave","dash","teamScore","slow")}
    s["weapon"] = src.get("weapon") if src.get("weapon") in ("rifle","sniper") else "rifle"
    s["playing"] = bool(src.get("playing"))
    s["mission"] = src.get("mission") if isinstance(src.get("mission"),dict) else None
    e=src.get("entry")
    s["entry"] = ({**{k:number(e.get(k),0,-1000,1000) for k in ("x","z","feet","jump","yaw","walk")},"phase":"walk" if e.get("phase")=="walk" else "dive"} if isinstance(e,dict) else None)
    s["netSeq"] = old.get("netSeq",0)
    s["cooldowns"] = old.get("cooldowns",{})
    for key in ("enemies","barrels"):
        value = src.get(key, [])
        s[key] = value[:32] if isinstance(value,list) else []
    return s

@csrf_exempt
@require_POST
def api_create_room(request):
    data = _load_json(request)
    mode = data.get("mode","combat")
    if mode not in ("combat","duel"):
        return JsonResponse({"ok":False,"error":"invalid_mode"},status=400)
    with _room_lock, transaction.atomic():
        code = generate_room_code()
        while GameRoom.objects.filter(code=code).exists(): code = generate_room_code()
        room = GameRoom.objects.create(code=code,seed=secrets.randbelow(2_000_000_000),meta={"mode":mode,"events":[],"revision":0})
        pilot = RoomPilot.objects.create(room=room,player_id=secrets.token_hex(16),name=str(data.get("name") or "플레이어")[:20],state=_state(data.get("state")),is_host=True)
        return _reply(room,playerId=pilot.player_id,isHost=True)

@csrf_exempt
@require_POST
def api_join_room(request):
    data = _load_json(request)
    code = str(data.get("roomCode") or "").strip().upper()
    if len(code)!=6: return JsonResponse({"ok":False,"error":"invalid_room_code"},status=400)
    with _room_lock, transaction.atomic():
        try: room = GameRoom.objects.get(code=code)
        except GameRoom.DoesNotExist: return JsonResponse({"ok":False,"error":"room_not_found"},status=404)
        _prune_room(room)
        if room.status=="closed" or not room.pilots.filter(is_host=True).exists():
            return JsonResponse({"ok":False,"error":"host_left"},status=409)
        if room.pilots.count() >= (2 if room.meta.get("mode")=="duel" else 4):
            return JsonResponse({"ok":False,"error":"room_full"},status=409)
        if room.meta.get("winner"): return JsonResponse({"ok":False,"error":"match_finished"},status=409)
        pilot = RoomPilot.objects.create(room=room,player_id=secrets.token_hex(16),name=str(data.get("name") or "친구")[:20],state=_state(data.get("state")))
        _advance_duel(room)
        room.save(update_fields=["meta","updated_at"])
        return _reply(room,playerId=pilot.player_id,isHost=False)

def _event(room, pilot, raw):
    if not isinstance(raw,dict): return
    seq = int(number(raw.get("seq"),0,0,1e12))
    if seq <= pilot.state.get("netSeq",0): return
    pilot.state["netSeq"] = seq
    kind = raw.get("kind")
    if kind not in ("fx","damage","enemyShot","barrel","kill","pressure","entry"): return
    if kind in ("enemyShot","kill","pressure") and not pilot.is_host: return
    event = {k:raw[k] for k in ("kind","effect","origin","dir","point","range","weapon","wave","index","damage","target","life","head","velocity","radius","delay") if k in raw}
    event.update(owner=pilot.player_id,id=str(pilot.player_id)+":"+str(seq))
    meta=room.meta
    if kind=="entry":
        if meta.get("entryAt") or room.pilots.count()<2: return
        now=timezone.now().timestamp()
        meta["entryAt"]=now+.35
        if meta.get("mode")=="duel":
            meta["started"]=meta["entryAt"]+3.2
            for state in meta.get("duel",{}).values():
                state["shieldUntil"]=meta["started"]+1.2
    if kind=="damage" and meta.get("mode")=="duel":
        now=timezone.now().timestamp()
        me=meta.get("duel",{}).get(pilot.player_id)
        other=meta.get("duel",{}).get(str(raw.get("target")))
        effect=raw.get("effect","rifle")
        cap, delay={"rifle":(48,.075),"sniper":(100,.9),"laser":(60,4.8),"poop":(100,8),"melee":(55,.4),"paper":(90,1)}.get(effect,(0,1))
        cooldown=pilot.state.setdefault("cooldowns",{})
        if (not me or not other or raw.get("target")==pilot.player_id or meta.get("winner") or
            now<meta.get("started",now+1) or me["hp"]<=0 or other["hp"]<=0 or
            int(number(raw.get("life")))!=other["life"] or now<other.get("shieldUntil",0) or
            now-cooldown.get(effect,0)<delay): return
        cooldown[effect]=now
        damage=number(raw.get("damage"),0,0,cap)
        other["hp"]=max(0,other["hp"]-damage)
        if effect=="laser" and damage>0 and other["hp"]>0:
            other["slowUntil"]=now+2
        if other["hp"]<=0:
            other["respawnAt"]=now+3
            me["score"]+=1
            if me["score"]>=5: meta["winner"]=pilot.player_id
    elif kind=="fx" and raw.get("effect")=="dash" and meta.get("mode")=="duel":
        now=timezone.now().timestamp()
        me=meta.get("duel",{}).get(pilot.player_id)
        cooldown=pilot.state.setdefault("cooldowns",{})
        if me and now-cooldown.get("dash",0)>=2.4:
            me["shieldUntil"]=max(me.get("shieldUntil",0),now+.2)
            cooldown["dash"]=now
    meta["revision"]=meta.get("revision",0)+1
    event["revision"]=meta["revision"]
    meta.setdefault("events",[]).append(event)
    meta["events"]=meta["events"][-192:]

@csrf_exempt
@require_POST
def api_sync_room(request, code):
    data=_load_json(request)
    with _room_lock, transaction.atomic():
        try: room=GameRoom.objects.get(code=code.upper())
        except GameRoom.DoesNotExist: return JsonResponse({"ok":False,"error":"room_not_found"},status=404)
        _prune_room(room)
        try: pilot=room.pilots.get(player_id=data.get("playerId"))
        except RoomPilot.DoesNotExist: return JsonResponse({"ok":False,"error":"player_not_found"},status=404)
        _advance_duel(room)
        if not room.pilots.filter(is_host=True).exists(): room.status="closed"
        pilot.state=_state(data.get("state"),pilot.state)
        events=data.get("events",[])
        if isinstance(events,list):
            for event in events[:64]: _event(room,pilot,event)
        pilot.save(update_fields=["state","last_seen"])
        room.save(update_fields=["meta","status","updated_at"])
        return _reply(room,after=int(number(data.get("afterRevision"),0,0,1e12)))

@require_GET
def api_snapshot_room(request, code):
    with _room_lock, transaction.atomic():
        try: room=GameRoom.objects.get(code=code.upper())
        except GameRoom.DoesNotExist: return JsonResponse({"ok":False,"error":"room_not_found"},status=404)
        _prune_room(room); _advance_duel(room)
        room.save(update_fields=["meta","updated_at"])
        return _reply(room)

@csrf_exempt
@require_POST
def api_leave_room(request, code):
    data=_load_json(request)
    with _room_lock, transaction.atomic():
        p=RoomPilot.objects.filter(room__code=code,player_id=data.get("playerId")).first()
        if p:
            if p.is_host:
                p.room.status="closed"; p.room.save(update_fields=["status"])
            p.delete()
    return JsonResponse({"ok":True})
