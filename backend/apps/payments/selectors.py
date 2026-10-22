from datetime import timedelta
from django.db.models import Q
from apps.accounts.models import Account
from apps.accounts.calculations import amounts
from apps.payments.models import Transfer
from apps.shifts.models import Shift


def visible_transfers(actor, now):
    transfers = Transfer.objects.select_related("payment").order_by("received_at", "id")
    if actor.role in ("owner", "manager"):
        return transfers
    linked = Q(payment__shift__cashier=actor, payment__account__shift__cashier=actor)
    shift = Shift.objects.filter(cashier=actor, closed_at__isnull=True).first()
    if shift is None:
        return transfers.filter(linked)
    maximum_due = max(
        (
            amounts(a, now)["due"]
            for a in Account.objects.filter(shift=shift, status="awaiting_payment")
        ),
        default=0,
    )
    # Amount/time matching only limits visibility. It never supplies payment evidence.
    candidates = Q(
        payment__isnull=True,
        received_at__gte=shift.opened_at,
        received_at__lte=now,
        amount__gt=0,
        amount__lte=maximum_due,
    )
    bank_events = Q(
        payment__isnull=True,
        business_event_id__isnull=False,
        received_at__gte=shift.opened_at - timedelta(minutes=2),
        received_at__lte=now,
    )
    return transfers.filter(linked | candidates | bank_events)
