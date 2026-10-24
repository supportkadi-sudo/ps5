import json
from uuid import UUID
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from rest_framework.views import APIView
from apps.api.views import CommandView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.utils import timezone
from apps.api.reads import consistent_read
from apps.api.pagination import page
from apps.api.scopes import (
    accounts_for,
    payments_for,
    expenses_for,
    refunds_for,
    shifts_for,
)
from apps.api.projections import rows, account_row, PAYMENT_FIELDS, shift_row
from apps.api.account_history import account_history_row
from apps.audit.models import AuditEvent
from apps.core.rules import management, money
from apps.inventory.models import Batch
from apps.payments.selectors import visible_transfers
from apps.payments.matching import transfer_dto

EXPENSE_FIELDS = dict(
    id="id",
    shiftId="shift_id",
    amount="amount",
    category="category",
    methodId="method_id",
    reason="reason",
    createdAt="created_at",
    actorId="actor_id",
)
BATCH_FIELDS = dict(
    id="id",
    productId="product_id",
    receivedAt="received_at",
    quantity="quantity",
    remaining="remaining",
    unitCost="unit_cost",
)


def audit_row(event):
    return dict(
        id=str(event.pk),
        actorId=str(event.actor_id),
        actorName=event.actor.username,
        at=event.at.isoformat(),
        entityId=event.entity_id,
        action=event.action,
        reason=event.reason,
        before=json.dumps(event.before, ensure_ascii=False),
        after=json.dumps(event.after, ensure_ascii=False),
    )


def refund_row(refund):
    reversals = list(refund.reversals.select_related("payment").order_by("id"))
    return dict(
        id=str(refund.pk),
        accountId=str(refund.account_id),
        shiftId=str(refund.shift_id),
        actorId=str(refund.actor_id),
        reason=refund.reason,
        restockGoods=refund.restock_goods,
        createdAt=refund.created_at.isoformat(),
        amount=money(sum(r.amount for r in reversals)),
        reversals=[
            dict(
                paymentId=str(r.payment_id),
                methodId=str(r.payment.method_id),
                amount=r.amount,
            )
            for r in reversals
        ],
    )


class HistoryView(CommandView):
    resource = None

    def post(self, request):
        if self.operation is None:
            from rest_framework.exceptions import MethodNotAllowed

            raise MethodNotAllowed("POST")
        return super().post(request)

    def get(self, request):
        actor = request.user
        now = timezone.now()
        with consistent_read():
            if self.resource == "accounts":
                qs, field, project, allowed = (
                    accounts_for(actor).select_related("booth", "shift__cashier"),
                    "created_at",
                    lambda a: account_history_row(a, actor, now),
                    {"shiftId": "shift_id", "status": "status", "boothId": "booth_id"},
                )
            elif self.resource == "shifts":
                qs, field, project, allowed = (
                    shifts_for(actor),
                    "opened_at",
                    shift_row,
                    {},
                )
            elif self.resource == "payments":
                qs, field, project, allowed = (
                    payments_for(actor),
                    "created_at",
                    lambda p: rows([p], PAYMENT_FIELDS)[0],
                    {"shiftId": "shift_id", "accountId": "account_id"},
                )
            elif self.resource == "expenses":
                qs, field, project, allowed = (
                    expenses_for(actor),
                    "created_at",
                    lambda e: rows([e], EXPENSE_FIELDS)[0],
                    {"shiftId": "shift_id"},
                )
            elif self.resource == "refunds":
                qs, field, project, allowed = (
                    refunds_for(actor),
                    "created_at",
                    refund_row,
                    {"shiftId": "shift_id", "accountId": "account_id"},
                )
            elif self.resource == "audit":
                management(actor)
                qs, field, project, allowed = (
                    AuditEvent.objects.select_related("actor"),
                    "at",
                    audit_row,
                    {"entityId": "entity_id"},
                )
            elif self.resource == "batches":
                management(actor)
                qs, field, project, allowed = (
                    Batch.objects.all(),
                    "received_at",
                    lambda b: rows([b], BATCH_FIELDS)[0],
                    {"productId": "product_id"},
                )
            elif self.resource == "transfers":
                qs, field, project, allowed = (
                    visible_transfers(actor, now),
                    "received_at",
                    lambda t: transfer_dto(t, actor, now),
                    {},
                )
            else:
                raise ValidationError("Unknown history resource")
            date_keys = {"from", "to"} if self.resource == "accounts" else set()
            if (
                set(request.query_params)
                - set(allowed)
                - date_keys
                - {"limit", "cursor"}
            ):
                raise ValidationError("Unknown history query parameter")
            filters = {
                key: request.query_params[key]
                for key in allowed
                if key in request.query_params
            }
            for key, value in filters.items():
                if key in ("shiftId", "accountId", "productId", "boothId"):
                    try:
                        UUID(value)
                    except ValueError:
                        raise ValidationError("Invalid identifier filter")
                if key == "status" and value not in (
                    "draft",
                    "playing",
                    "awaiting_payment",
                    "closed",
                    "cancelled",
                ):
                    raise ValidationError("Invalid account status")
            qs = qs.filter(**{allowed[key]: value for key, value in filters.items()})
            # Filter before pagination; bind the period to the signed cursor scope.
            dates = {}
            for key in date_keys:
                if key not in request.query_params:
                    continue
                raw = request.query_params[key]
                try:
                    value = date.fromisoformat(raw)
                    if value.isoformat() != raw or value.year == 9999:
                        raise ValueError()
                except ValueError:
                    raise ValidationError("Invalid history date; expected YYYY-MM-DD")
                dates[key] = value
                filters[key] = raw
            if "from" in dates and "to" in dates and dates["from"] > dates["to"]:
                raise ValidationError("History start is after end")
            for key, value in dates.items():
                boundary = value + timedelta(days=1) if key == "to" else value
                at = datetime.combine(
                    boundary, time.min, tzinfo=ZoneInfo("Asia/Tashkent")
                )
                lookup = "created_at__lt" if key == "to" else "created_at__gte"
                qs = qs.filter(**{lookup: at})
            return Response(
                page(
                    qs,
                    field,
                    actor,
                    self.resource,
                    request.query_params,
                    filters,
                    project,
                )
            )


class AccountDetailView(APIView):
    def get(self, request, id):
        with consistent_read():
            account = accounts_for(request.user).get(pk=id)
            return Response(account_row(account, request.user, timezone.now()))
