from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Batch(Entity):
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)
    received_at = models.DateTimeField()
    quantity = models.PositiveIntegerField()
    remaining = models.PositiveIntegerField()
    unit_cost = models.PositiveBigIntegerField()

    class Meta:
        indexes = [models.Index(fields=["-received_at", "-id"], name="batch_hist_idx")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(unit_cost__lte=MAX_MONEY),
                name="inventory_batch_unit_cost_cap",
            ),
            models.CheckConstraint(
                condition=models.Q(remaining__lte=models.F("quantity")),
                name="batch_remaining_bounded",
            ),
        ]


class Allocation(Entity):
    line = models.ForeignKey(
        "accounts.Line", on_delete=models.PROTECT, related_name="allocations"
    )
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_cost = models.PositiveBigIntegerField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(unit_cost__lte=MAX_MONEY),
                name="inventory_allocation_unit_cost_cap",
            ),
        ]


class StockMovement(Entity):
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    line = models.ForeignKey("accounts.Line", null=True, on_delete=models.PROTECT)
    delta = models.IntegerField()
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
