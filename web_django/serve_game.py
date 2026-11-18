
"""Local/share server. Run from the D-drive project folder."""
import os
import secrets
from pathlib import Path
project=Path(__file__).resolve().parent
os.chdir(project)
os.environ.setdefault("DJANGO_SETTINGS_MODULE","neuralrush.settings")
os.environ.setdefault("DJANGO_DEBUG","0")
os.environ.setdefault("DJANGO_SECRET_KEY",secrets.token_urlsafe(48))
from waitress import serve
if __name__ == "__main__":
    import django
    django.setup()
    from django.core.management import call_command
    call_command("collectstatic", interactive=False, verbosity=0)
    from neuralrush.wsgi import application
    serve(application,host="127.0.0.1",port=int(os.environ.get("PORT","8000")),threads=8,
          max_request_body_size=262144,channel_timeout=30)
