import hashlib
import math
from django.conf import settings
from django.db import transaction, connection
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import Throttled
from apps.access.models import LoginBucket


@transaction.atomic
def reserve(username, address):
    now = timezone.now()
    keys = sorted(
        salted_hmac("club-login", value).hexdigest()
        for value in ("user:" + username.casefold(), "ip:" + address)
    )
    tokens = []
    for key in keys:
        lock = int.from_bytes(
            hashlib.sha256(key.encode()).digest()[:8], "big", signed=True
        )
        with connection.cursor() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", [lock])
        bucket, _ = LoginBucket.objects.get_or_create(
            key=key, defaults={"window_started": now}
        )
        if (
            now - bucket.window_started
        ).total_seconds() >= settings.LOGIN_RATE_WINDOW_SECONDS:
            bucket.window_started = now
            bucket.attempts = 0
        if bucket.attempts >= settings.LOGIN_RATE_LIMIT:
            wait = (
                settings.LOGIN_RATE_WINDOW_SECONDS
                - (now - bucket.window_started).total_seconds()
            )
            raise Throttled(wait=max(1, math.ceil(wait)))
        bucket.attempts += 1
        bucket.save()
        tokens.append((key, bucket.window_started))
    return tokens


def release_success(tokens):
    for key, window in tokens:
        LoginBucket.objects.filter(
            key=key, window_started=window, attempts__gt=0
        ).update(attempts=F("attempts") - 1)
