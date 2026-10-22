from django.conf import settings
from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Transfer(Entity):
    source = models.CharField(max_length=100)
    source_event_id = models.CharField(max_length=200)
    amount = models.PositiveBigIntegerField()
    received_at = models.DateTimeField()
    status = models.CharField(max_length=20, default="unverified")
    evidence_reference = models.CharField(max_length=300, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["-received_at", "-id"], name="transfer_hist_idx")
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__lte=MAX_MONEY) & models.Q(amount__gt=0),
                name="payments_transfer_amount_cap",
            ),
            models.UniqueConstraint(
                fields=["source", "source_event_id"], name="unique_source_event"
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=["unverified", "ambiguous", "verified_source"]
                ),
                name="valid_transfer_evidence",
            ),
        ]


class Payment(Entity):
    account = models.ForeignKey(
        "accounts.Account", on_delete=models.PROTECT, related_name="payments"
    )
    shift = models.ForeignKey(
        "shifts.Shift", on_delete=models.PROTECT, related_name="payments"
    )
    method = models.ForeignKey("catalog.PaymentMethod", on_delete=models.PROTECT)
    method_kind = models.CharField(max_length=10)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    amount = models.PositiveBigIntegerField()
    transfer = models.OneToOneField(
        Transfer, null=True, on_delete=models.PROTECT, related_name="payment"
    )
    created_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["-created_at", "-id"], name="payment_hist_idx"),
            models.Index(
                fields=["shift", "-created_at", "-id"], name="payment_shift_hist_idx"
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__lte=MAX_MONEY) & models.Q(amount__gt=0),
                name="payments_payment_amount_cap",
            ),
        ]


class Refund(Entity):
    account = models.OneToOneField(
        "accounts.Account", on_delete=models.PROTECT, related_name="refund"
    )
    shift = models.ForeignKey(
        "shifts.Shift", on_delete=models.PROTECT, related_name="refunds"
    )
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField()
    restock_goods = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["-created_at", "-id"], name="refund_hist_idx")]


class PaymentReversal(Entity):
    refund = models.ForeignKey(
        Refund, on_delete=models.PROTECT, related_name="reversals"
    )
    payment = models.OneToOneField(
        Payment, on_delete=models.PROTECT, related_name="reversal"
    )
    amount = models.PositiveBigIntegerField()
    method_kind = models.CharField(max_length=10)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__lte=MAX_MONEY) & models.Q(amount__gt=0),
                name="payments_paymentreversal_amount_cap",
            ),
        ]
