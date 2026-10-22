"""Suggestions never mutate money. Confirmation recomputes the global match."""

from datetime import timedelta
from django.utils import timezone
from apps.payments.models import TransferExpectation
from apps.accounts.calculations import amounts
from apps.core.rules import require
from apps.catalog.models import PaymentMethod
from apps.payments.provenance import connected


def expect_transfer(actor, shift, account, data, now):
    require(account.status == "awaiting_payment", "Precheck required")
    require(0 < data["amount"] <= amounts(account, now)["due"], "Invalid expected part")
    method = PaymentMethod.objects.select_for_update().get(pk=data["methodId"])
    require(
        method.enabled
        and method.kind == "p2p"
        and method.p2p_source in ("uzcard", "humo")
        and len(method.card_last4) == 4
        and connected(method.p2p_source),
        "P2P source/card not connected",
    )
    TransferExpectation.objects.update_or_create(
        account=account,
        defaults=dict(
            consumed_at=None,
            method=method,
            amount=data["amount"],
            source=method.p2p_source,
            card_last4=method.card_last4,
            created_at=now,
            expires_at=now + timedelta(minutes=30),
        ),
    )


def match_transfer(transfer, now=None):
    now = now or timezone.now()
    if hasattr(transfer, "payment"):
        return "accepted", []
    if (
        not connected(transfer.source)
        or transfer.status != "verified_source"
        or not transfer.business_event_id
        or not transfer.card_last4
        or transfer.amount != int(transfer.amount)
    ):
        return "manual_review", []
    if transfer.received_at > now + timedelta(minutes=1):
        return "manual_review", []
    # Bank timestamps have minute precision; permit up to two minutes before the request.
    expectations = TransferExpectation.objects.select_related(
        "account", "method"
    ).filter(
        account__status="awaiting_payment",
        consumed_at__isnull=True,
        source=transfer.source,
        card_last4=transfer.card_last4,
        created_at__lte=transfer.received_at + timedelta(minutes=2),
        expires_at__gte=transfer.received_at,
        account__created_at__lte=transfer.received_at + timedelta(minutes=1),
    )
    candidates = [
        e
        for e in expectations
        if e.expires_at >= now
        and e.amount == transfer.amount
        and e.method.enabled
        and e.method.kind == "p2p"
        and e.method.p2p_source == e.source
        and e.method.card_last4 == e.card_last4
        and amounts(e.account, now)["due"] >= e.amount
    ]
    if len(candidates) == 1:
        return "found", candidates
    if len(candidates) > 1:
        return "manual_review", candidates
    return ("manual_review" if expectations.exists() else "unmatched"), []


def transfer_dto(t, actor, now=None):
    status, candidates = match_transfer(t, now)
    # No foreign account IDs in cashier read models.
    visible = [
        e
        for e in candidates
        if actor.role in ("owner", "manager") or e.account.shift.cashier_id == actor.pk
    ]
    candidate = visible[0] if len(candidates) == len(visible) == 1 else None
    return dict(
        id=str(t.pk),
        amount=format(t.amount, ".2f"),
        receivedAt=t.received_at.isoformat(),
        source=t.source,
        status=t.status,
        accountId=str(t.payment.account_id) if hasattr(t, "payment") else "",
        cardLast4=t.card_last4,
        processingStatus=status,
        candidateAccountId=str(candidate.account_id) if candidate else "",
        candidateMethodId=str(candidate.method_id) if candidate else "",
    )
