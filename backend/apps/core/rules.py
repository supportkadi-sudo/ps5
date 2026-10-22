from django.forms.models import model_to_dict
from django.core.serializers.json import DjangoJSONEncoder
import json
from rest_framework.exceptions import APIException, PermissionDenied
from apps.core.models import MAX_MONEY


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "Command conflicts with current state"


def require(condition, message):
    if not condition:
        raise Conflict(message)


def management(actor):
    if actor.role not in ("owner", "manager"):
        raise PermissionDenied("Management role required")


def owns(actor, shift):
    if actor.role == "cashier" and shift.cashier_id != actor.pk:
        raise PermissionDenied("This shift belongs to another employee")


def money(value):
    require(0 <= value <= MAX_MONEY, "Amount outside supported UZS range")
    return value


def snapshot(obj):
    if obj is None:
        return {}
    data = model_to_dict(obj)
    data["id"] = str(obj.pk)
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def audit(actor, obj, action, before, reason="", after=None):
    from apps.audit.models import AuditEvent

    AuditEvent.objects.create(
        actor=actor,
        entity_id=str(obj.pk),
        action=action,
        reason=reason,
        before=before,
        after=snapshot(obj) if after is None else after,
    )
