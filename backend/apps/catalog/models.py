from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Product(Entity):
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=100)
    sale_price = models.PositiveBigIntegerField()
    default_cost = models.PositiveBigIntegerField()
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    sale_price__lte=MAX_MONEY, default_cost__lte=MAX_MONEY
                ),
                name="product_safe_money",
            )
        ]


class PaymentMethod(Entity):
    p2p_source = models.CharField(max_length=10, blank=True)
    card_last4 = models.CharField(max_length=4, blank=True)
    name = models.CharField(max_length=100)
    kind = models.CharField(
        max_length=10, choices=[(x, x) for x in ("cash", "p2p", "other")]
    )
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(kind__in=["cash", "p2p", "other"]),
                name="valid_method_kind",
            )
        ]
