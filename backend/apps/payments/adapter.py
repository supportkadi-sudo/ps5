"""Notification ingress boundary; deliberately no live Telegram or verification adapter."""

from django.db import transaction
from apps.payments.models import Transfer
from apps.core.rules import require, money


@transaction.atomic
def record_notification(*, source, event_id, amount, received_at):
    money(amount)
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
