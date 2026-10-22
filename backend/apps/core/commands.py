import hashlib
import json
from uuid import UUID
from django.db import transaction, connection
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError
from apps.core.models import CommandReceipt
from apps.core.rules import require
from apps.api.contract import validate
from apps.accounts import services as accounts
from apps.shifts import services as shifts
from apps.catalog import services as catalog

ACCOUNT_COMMANDS = {
    "StartTimer",
    "Precheck",
    "ResumeTimer",
    "CloseAccount",
    "AddLine",
    "RemoveLine",
    "AcceptPayment",
}


@transaction.atomic
def execute(actor, key, operation, entity_id, data):
    try:
        command_key = UUID(key)
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("UUID Idempotency-Key required")
    endpoint = operation + ":" + entity_id
    digest = hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    # Transaction-scoped advisory lock includes absent receipts. Hash collision only
    # serializes unrelated requests; uniqueness remains authoritative in the table.
    lock = int.from_bytes(
        hashlib.sha256(f"{actor.pk}:{command_key}".encode()).digest()[:8],
        "big",
        signed=True,
    )
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock])
    # Role and active state refreshed from DB on each request, never trusted from UI.
    actor = get_user_model().objects.get(pk=actor.pk, is_active=True)
    receipt = CommandReceipt.objects.filter(actor=actor, key=command_key).first()
    if receipt:
        require(
            receipt.request_hash == digest and receipt.endpoint == endpoint,
            "Idempotency key reused with different command",
        )
        return receipt.response
    validate(operation, data)
    if operation == "CreateAccount":
        obj = accounts.create(actor, data)
    elif operation in ACCOUNT_COMMANDS:
        obj = accounts.change(actor, entity_id, operation, data)
    elif operation == "RefundAccount":
        from apps.payments.refunds import refund_account

        obj = refund_account(actor, entity_id, data)
    elif operation == "OpenShift":
        obj = shifts.open_shift(actor, data)
    elif operation == "CloseShift":
        obj = shifts.close_shift(actor, entity_id, data)
    elif operation == "AddExpense":
        obj = shifts.add_expense(actor, data)
    elif operation in catalog.CONFIG:
        obj = catalog.configure(actor, operation, data)
    elif operation == "ReceiveBatch":
        obj = catalog.receive(actor, data)
    elif operation == "AdjustStock":
        obj = catalog.adjust(actor, data)
    else:
        raise ValidationError("Operation not implemented by backend")
    # Small durable acknowledgement avoids replaying stale workspace or disclosing
    # old privileged snapshots after a role change. Client reloads the read model.
    result = {
        "entityId": str(obj.pk),
        "operation": operation,
        "version": getattr(obj, "version", 0),
    }
    CommandReceipt.objects.create(
        actor=actor,
        key=command_key,
        endpoint=endpoint,
        request_hash=digest,
        response=result,
    )
    return result
