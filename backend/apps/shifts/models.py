from django.conf import settings
from django.db import models
from apps.core.models import Entity


class Shift(Entity):
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    opened_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True)
    opening_cash = models.PositiveBigIntegerField()
    actual_cash = models.PositiveBigIntegerField(null=True)
    expected_cash = models.BigIntegerField(null=True)
    reason = models.TextField(blank=True)
    # One physical drawer, one open shift throughout the club.
    drawer = models.PositiveSmallIntegerField(default=1, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["drawer"],
                condition=models.Q(closed_at__isnull=True),
                name="one_open_drawer",
            )
        ]


class Expense(Entity):
    shift = models.ForeignKey(
        Shift, null=True, on_delete=models.PROTECT, related_name="expenses"
    )
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    amount = models.PositiveBigIntegerField()
    category = models.CharField(max_length=100)
    method = models.ForeignKey("catalog.PaymentMethod", on_delete=models.PROTECT)
    method_kind = models.CharField(max_length=10)
    reason = models.TextField()
    created_at = models.DateTimeField()
