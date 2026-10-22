import uuid
from django.conf import settings
from django.db import models

MAX_MONEY = 9_007_199_254_740_991


class Entity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class CommandReceipt(Entity):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    key = models.UUIDField()
    endpoint = models.CharField(max_length=300)
    request_hash = models.CharField(max_length=64)
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["actor", "key"], name="unique_actor_command"
            )
        ]
