import secrets
import string

from django.db import models


def generate_room_code():
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(6))


class GameRoom(models.Model):
    meta = models.JSONField(default=dict)
    code = models.CharField(max_length=6, unique=True, db_index=True)
    seed = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, default="open")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.code


class RoomPilot(models.Model):
    room = models.ForeignKey(GameRoom, related_name="pilots", on_delete=models.CASCADE)
    player_id = models.CharField(max_length=36, unique=True, db_index=True)
    name = models.CharField(max_length=24, default="방랑자")
    avatar = models.JSONField(default=dict)
    state = models.JSONField(default=dict)
    is_host = models.BooleanField(default=False)
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name}@{self.room.code}"
