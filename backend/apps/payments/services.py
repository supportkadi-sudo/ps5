from apps.catalog.models import PaymentMethod
from apps.payments.models import Payment, Transfer
from apps.accounts.calculations import amounts
from apps.core.rules import require
from apps.shifts.services import expected


def accept(actor, shift, account, data, now):
    require(account.status == "awaiting_payment", "Precheck required before payment")
    require(data["confirmedByCashier"] is True, "Cashier confirmation required")
    require(
        0 < data["amount"] <= amounts(account, now)["due"], "Payment exceeds amount due"
    )
    method = PaymentMethod.objects.select_for_update().get(pk=data["methodId"])
    require(method.enabled, "Payment method disabled")
    transfer = None
    if method.kind == "p2p":
        require(data["transferId"], "Source evidence required")
        transfer = Transfer.objects.select_for_update().get(pk=data["transferId"])
        require(
            transfer.status == "verified_source" and transfer.evidence_reference,
            "Transfer is not verified by a trusted source",
        )
        require(
            transfer.amount == data["amount"]
            and not Payment.objects.filter(transfer=transfer).exists(),
            "Transfer amount mismatch or already linked",
        )
    else:
        require(not data["transferId"], "Only P2P payments link transfers")
    payment = Payment.objects.create(
        account=account,
        shift=shift,
        method=method,
        method_kind=method.kind,
        actor=actor,
        amount=data["amount"],
        transfer=transfer,
        created_at=now,
    )
    expected(shift)
    return payment
