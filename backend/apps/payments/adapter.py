"""Legacy unverified boundary. Authenticated Business ingress lives in ingress.py."""

from django.db import transaction
from datetime import datetime
from django.utils import timezone
from apps.payments.models import Transfer
from apps.core.rules import require, money


@transaction.atomic
def record_notification(*, source, event_id, amount, received_at):
    money(amount)
    require(amount > 0, "Notification amount must be positive")
    require(
        isinstance(source, str)
        and 0 < len(source.strip()) <= 100
        and isinstance(event_id, str)
        and 0 < len(event_id.strip()) <= 200,
        "Invalid source event identity",
    )
    require(
        isinstance(received_at, datetime) and timezone.is_aware(received_at),
        "Aware source timestamp required",
    )
    event, created = Transfer.objects.get_or_create(
        source=source,
        source_event_id=event_id,
        defaults={"amount": amount, "received_at": received_at, "status": "unverified"},
    )
    require(
        created or (event.amount == amount and event.received_at == received_at),
        "Source event payload changed",
    )
    return event
