from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Tariff(Entity):
    name = models.CharField(max_length=100)
    hourly_rate = models.PositiveBigIntegerField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(hourly_rate__lte=MAX_MONEY), name="tariff_safe_money"
            )
        ]


class Booth(Entity):
    name = models.CharField(max_length=100)
    console = models.CharField(max_length=50)
    tariff = models.ForeignKey(Tariff, on_delete=models.PROTECT)
    enabled = models.BooleanField(default=True)
