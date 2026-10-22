from django.utils import timezone
from apps.core.rules import management, require, snapshot, audit
from apps.shifts.services import current, expected
from apps.accounts.models import Account
from apps.catalog.models import Product
from apps.inventory.models import Batch, StockMovement
from apps.payments.models import Refund, PaymentReversal


def refund_account(actor, entity_id, data):
    management(actor)
    shift = current(actor)
    account = Account.objects.select_for_update().get(pk=entity_id)
    require(account.version == data["expectedVersion"], "Stale account version")
    require(account.status == "closed", "Only closed accounts can be refunded")
    require(data["reason"].strip(), "Refund reason required")
    before = {"account": snapshot(account), "batches": []}
    refund = Refund.objects.create(
        account=account,
        shift=shift,
        actor=actor,
        reason=data["reason"],
        restock_goods=data["restockGoods"],
        created_at=timezone.now(),
    )
    for payment in account.payments.all():
        PaymentReversal.objects.create(
            refund=refund,
            payment=payment,
            amount=payment.amount,
            method_kind=payment.method_kind,
        )
    batches_after = []
    if data["restockGoods"]:
        lines = list(account.lines.filter(removed=False).order_by("product_id", "id"))
        for product_id in sorted({l.product_id for l in lines}):
            Product.objects.select_for_update().get(pk=product_id)
        for line in lines:
            for allocation in line.allocations.order_by("batch_id"):
                batch = Batch.objects.select_for_update().get(pk=allocation.batch_id)
                before["batches"].append(snapshot(batch))
                batch.remaining += allocation.quantity
                batch.save(update_fields=["remaining"])
                StockMovement.objects.create(
                    batch=batch,
                    line=line,
                    delta=allocation.quantity,
                    reason=data["reason"],
                )
                batches_after.append(snapshot(batch))
    account.status = "cancelled"
    account.version += 1
    account.save(update_fields=["status", "version"])
    expected(shift)
    audit(
        actor,
        account,
        "RefundAccount",
        before,
        data["reason"],
        after={
            "account": snapshot(account),
            "refund": snapshot(refund),
            "batches": batches_after,
        },
    )
    return account
