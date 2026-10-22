from apps.catalog.models import Product
from apps.accounts.models import Line
from apps.inventory.models import Batch, Allocation, StockMovement
from apps.core.rules import require, money, snapshot


# Caller holds shift/account; product locks serialize receipts, reserves and returns.
def add_line(account, data):
    product = Product.objects.select_for_update().get(pk=data["productId"])
    require(product.enabled, "Product disabled")
    batches = list(
        Batch.objects.select_for_update()
        .filter(product=product, remaining__gt=0)
        .order_by("received_at", "id")
    )
    require(sum(b.remaining for b in batches) >= data["quantity"], "Insufficient stock")
    before = [snapshot(b) for b in batches]
    remaining = data["quantity"]
    allocations = []
    cost = 0
    for batch in batches:
        take = min(remaining, batch.remaining)
        if not take:
            break
        allocations.append((batch, take))
        cost += take * batch.unit_cost
        remaining -= take
    line = Line.objects.create(
        account=account,
        product=product,
        name=product.name,
        quantity=data["quantity"],
        unit_price=product.sale_price,
        cost=money(cost),
    )
    money(line.quantity * line.unit_price)
    for batch, take in allocations:
        batch.remaining -= take
        batch.save(update_fields=["remaining"])
        Allocation.objects.create(
            line=line, batch=batch, quantity=take, unit_cost=batch.unit_cost
        )
        StockMovement.objects.create(
            batch=batch, line=line, delta=-take, reason="reserve"
        )
    return {"batches": before}, {
        "line": snapshot(line),
        "batches": [snapshot(b) for b in batches],
    }


def remove_line(account, data):
    line = account.lines.get(pk=data["lineId"])
    require(not line.removed, "Line already removed")
    require(data["reason"].strip(), "Removal reason required")
    Product.objects.select_for_update().get(pk=line.product_id)
    allocations = list(line.allocations.select_related("batch").order_by("batch_id"))
    before = {
        "line": snapshot(line),
        "batches": [snapshot(a.batch) for a in allocations],
    }
    for allocation in allocations:
        batch = Batch.objects.select_for_update().get(pk=allocation.batch_id)
        batch.remaining += allocation.quantity
        batch.save(update_fields=["remaining"])
        allocation.batch = batch
        StockMovement.objects.create(
            batch=batch, line=line, delta=allocation.quantity, reason=data["reason"]
        )
    line.removed = True
    line.removal_reason = data["reason"]
    line.save(update_fields=["removed", "removal_reason"])
    return before, {
        "line": snapshot(line),
        "batches": [snapshot(a.batch) for a in allocations],
    }
