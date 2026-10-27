from django.db import models
from apps.core.models import Entity, MAX_MONEY


class Tariff(Entity):
    name = models.CharField(max_length=100)
    hourly_rate = models.PositiveBigIntegerField()
    console_code = models.CharField(max_length=3, unique=True, null=True, blank=True)

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


class ReviewLink(Entity):
    name = models.CharField(max_length=150)
    url = models.URLField(max_length=1000)
    enabled = models.BooleanField(default=True)
    version = models.PositiveBigIntegerField(default=1)
