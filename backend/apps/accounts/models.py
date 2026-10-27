from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Account(Entity):
    booth = models.ForeignKey("club.Booth", on_delete=models.PROTECT)
    tariff = models.ForeignKey("club.Tariff", on_delete=models.PROTECT, null=True)
    console = models.CharField(max_length=100, blank=True)
    shift = models.ForeignKey("shifts.Shift", on_delete=models.PROTECT)
    customer_name = models.CharField(max_length=150, blank=True)
    customer_phone = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=20, default="draft")
    version = models.PositiveBigIntegerField(default=1)
    hourly_rate = models.PositiveBigIntegerField()
    created_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True)
    final_total = models.PositiveBigIntegerField(null=True)

    class Meta:
        indexes = [
            models.Index(fields=["-created_at", "-id"], name="acct_hist_idx"),
            models.Index(
                fields=["shift", "-created_at", "-id"], name="acct_shift_hist_idx"
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(hourly_rate__lte=MAX_MONEY),
                name="accounts_account_hourly_rate_cap",
            ),
            models.CheckConstraint(
                condition=models.Q(final_total__lte=MAX_MONEY),
                name="accounts_account_final_total_cap",
            ),
            models.UniqueConstraint(
                fields=["booth"],
                condition=models.Q(status__in=["draft", "playing", "awaiting_payment"]),
                name="one_active_booth",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=[
                        "draft",
                        "playing",
                        "awaiting_payment",
                        "closed",
                        "cancelled",
                    ]
                ),
                name="valid_account_status",
            ),
        ]


class Segment(Entity):
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="segments"
    )
    started_at = models.DateTimeField()
    stopped_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account"],
                condition=models.Q(stopped_at__isnull=True),
                name="one_running_segment",
            ),
            models.CheckConstraint(
                condition=models.Q(stopped_at__isnull=True)
                | models.Q(stopped_at__gte=models.F("started_at")),
                name="segment_time_order",
            ),
        ]


class Line(Entity):
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="lines")
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    quantity = models.PositiveIntegerField()
    unit_price = models.PositiveBigIntegerField()
    cost = models.PositiveBigIntegerField()
    removed = models.BooleanField(default=False)
    removal_reason = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(unit_price__lte=MAX_MONEY),
                name="accounts_line_unit_price_cap",
            ),
            models.CheckConstraint(
                condition=models.Q(cost__lte=MAX_MONEY), name="accounts_line_cost_cap"
            ),
        ]
