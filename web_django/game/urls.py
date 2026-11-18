from django.urls import path

from .views import (
    api_create_room,
    api_leave_room,
    api_join_room,
    api_snapshot_room,
    api_sync_room,
    index,
)


urlpatterns = [
    path("api/rooms/<str:code>/leave", api_leave_room, name="leave_room"),
    path("", index, name="index"),
    path("api/rooms/create", api_create_room, name="create_room"),
    path("api/rooms/join", api_join_room, name="join_room"),
    path("api/rooms/<str:code>/sync", api_sync_room, name="sync_room"),
    path("api/rooms/<str:code>/snapshot", api_snapshot_room, name="snapshot_room"),
]
