from django.utils import timezone
from apps.accounts.models import Account, Segment
from apps.club.models import Booth
from apps.shifts.services import current
from apps.inventory.services import add_line, remove_line
from apps.core.rules import require, audit, snapshot
from apps.accounts.calculations import amounts


def create(actor, data):
    shift = current(actor)
    booth = (
        Booth.objects.select_for_update()
        .select_related("tariff")
        .get(pk=data["boothId"])
    )
    require(booth.enabled, "Booth disabled")
    require(
        not Account.objects.filter(
            booth=booth, status__in=["draft", "playing", "awaiting_payment"]
        ).exists(),
        "Booth occupied",
    )
    account = Account.objects.create(
        booth=booth,
        shift=shift,
        hourly_rate=booth.tariff.hourly_rate,
        customer_name=data["customerName"],
        customer_phone=data["customerPhone"],
        created_at=timezone.now(),
    )
    audit(actor, account, "CreateAccount", {})
    return account


def change(actor, entity_id, operation, data):
    shift = current(
        actor
    )  # Global lock order: drawer -> account -> product -> batch/transfer.
    account = Account.objects.select_for_update().get(pk=entity_id)
    require(account.shift_id == shift.pk, "Account is not assigned to current shift")
    require(account.version == data["expectedVersion"], "Stale account version")
    require(account.status not in ("closed", "cancelled"), "Account history is closed")
    now = timezone.now()
    before = {**snapshot(account), **amounts(account, now)}
    extra_before, extra_after = {}, {}
    if operation in ("StartTimer", "ResumeTimer"):
        require(
            account.status
            == ("draft" if operation == "StartTimer" else "awaiting_payment"),
            "Invalid timer transition",
        )
        Segment.objects.create(account=account, started_at=now)
        account.status = "playing"
    elif operation == "Precheck":
        require(
            account.status in ("draft", "playing"), "Precheck requires draft or playing"
        )
        account.segments.filter(stopped_at__isnull=True).update(stopped_at=now)
        account.status = "awaiting_payment"
    elif operation in ("AddLine", "RemoveLine"):
        require(
            not account.payments.exists(),
            "Goods edits after payment require a compensating return",
        )
        extra_before, extra_after = (
            add_line if operation == "AddLine" else remove_line
        )(account, data)
    elif operation == "ExpectTransfer":
        from apps.payments.matching import expect_transfer

        extra_before = {
            "expectedTransfer": snapshot(account.transfer_expectation)
            if hasattr(account, "transfer_expectation")
            else {}
        }
        expect_transfer(actor, shift, account, data, now)
        extra_after = {"expectedTransfer": data}
    elif operation == "AcceptPayment":
        from apps.payments.services import accept

        payment = accept(actor, shift, account, data, now)
        extra_after = {"payment": snapshot(payment)}
    elif operation == "CloseAccount":
        total = amounts(account, now)
        require(
            account.status == "awaiting_payment" and total["paid"] == total["total"],
            "Full payment and precheck required",
        )
        account.status = "closed"
        account.closed_at = now
        account.final_total = total["total"]
    else:
        require(False, "Unsupported account operation")
    account.version += 1
    account.save()
    after = {**snapshot(account), **amounts(account, now), **extra_after}
    audit(
        actor,
        account,
        operation,
        {**before, **extra_before},
        data.get("reason", ""),
        after=after,
    )
    return account
