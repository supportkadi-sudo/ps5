from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    version = models.PositiveBigIntegerField(default=1)
    role = models.CharField(
        max_length=10,
        choices=[(x, x) for x in ("owner", "manager", "cashier")],
        default="cashier",
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=["owner", "manager", "cashier"]),
                name="valid_user_role",
            )
        ]


class LoginBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    window_started = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
