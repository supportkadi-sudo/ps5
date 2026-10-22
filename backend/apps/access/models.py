from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
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
