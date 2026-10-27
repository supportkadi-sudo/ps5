"""Artificial browser-test owner. Never run against a club database."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model

if not settings.DATABASES["default"]["NAME"].endswith("_e2e"):
    raise SystemExit("Refusing: dedicated *_e2e database required")
user, created = get_user_model().objects.get_or_create(
    username="e2e-owner", defaults={"role": "owner"}
)
if created:
    user.set_password("Isolated-E2E-Password-786!")
    user.save()

from apps.club.models import Tariff
Tariff.objects.get_or_create(console_code="PS5", defaults={"name": "PS5", "hourly_rate": 60000})
