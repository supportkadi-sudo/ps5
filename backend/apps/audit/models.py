from django.conf import settings
from django.db import models
from apps.core.models import Entity


class AuditEvent(Entity):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    at = models.DateTimeField(auto_now_add=True)
    entity_id = models.CharField(max_length=100)
    action = models.CharField(max_length=100)
    reason = models.TextField(blank=True)
    before = models.JSONField()
    after = models.JSONField()

    class Meta:
        indexes = [models.Index(fields=["-at", "-id"], name="audit_hist_idx")]
