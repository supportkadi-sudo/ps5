import json
from django.utils import timezone
from apps.accounts.models import Account
from apps.accounts.calculations import amounts
from apps.shifts.models import Shift, Expense
from apps.shifts.services import expected
from apps.club.models import Booth, Tariff
from apps.catalog.models import Product, PaymentMethod
from apps.inventory.models import Batch
from apps.payments.selectors import visible_transfers
from apps.audit.models import AuditEvent
from apps.reports.services import report
from apps.access.services import user_dto
from apps.club.reviews import review_dto
from apps.club.models import ReviewLink


def timestamp(value):
    return value.isoformat() if value else ""


def rows(queryset, fields):
    result = []
    for obj in queryset:
        row = {}
        for public, private in fields.items():
            value = getattr(obj, private)
            if public == "id" or public.endswith("Id"):
                value = str(value) if value is not None else ""
            if public.endswith("At"):
                value = timestamp(value)
            row[public] = value
        result.append(row)
    return result


PAYMENT_FIELDS = dict(
    id="id",
    accountId="account_id",
    shiftId="shift_id",
    methodId="method_id",
    amount="amount",
    transferId="transfer_id",
    createdAt="created_at",
    actorId="actor_id",
)


def account_row(a, actor, now):
    privileged = actor.role != "cashier"
    row = rows(
        [a],
        dict(
            id="id",
            boothId="booth_id",
            shiftId="shift_id",
            customerName="customer_name",
            customerPhone="customer_phone",
            status="status",
            version="version",
            hourlyRate="hourly_rate",
            createdAt="created_at",
            closedAt="closed_at",
        ),
    )[0]
    row.update(amounts(a, now))
    row["segments"] = rows(
        a.segments.all().order_by("started_at", "id"),
        dict(startedAt="started_at", stoppedAt="stopped_at"),
    )
    row["lines"] = []
    for line in a.lines.all().order_by("id"):
        item = rows(
            [line],
            dict(
                id="id",
                productId="product_id",
                name="name",
                quantity="quantity",
                unitPrice="unit_price",
                cost="cost",
                removed="removed",
                removalReason="removal_reason",
            ),
        )[0]
        item["allocations"] = (
            rows(
                line.allocations.all(),
                dict(batchId="batch_id", quantity="quantity", unitCost="unit_cost"),
            )
            if privileged
            else []
        )
        if not privileged:
            item["cost"] = 0
        row["lines"].append(item)
    row["payments"] = rows(
        a.payments.all().order_by("created_at", "id"), PAYMENT_FIELDS
    )
    return row


def empty_report():
    return dict(
        revenue=0,
        costOfGoods=0,
        grossProfit=0,
        expenses=0,
        netResult=0,
        cashDifference=0,
        paymentsByMethod={},
        revenueByMethod={},
        productSales=[],
    )


def workspace(actor):
    privileged = actor.role != "cashier"
    now = timezone.now()
    shifts = Shift.objects.all().order_by("opened_at", "id")
    accounts = Account.objects.all().order_by("created_at", "id")
    expenses = Expense.objects.all().order_by("created_at", "id")
    if not privileged:
        shifts = shifts.filter(cashier=actor)
        accounts = accounts.filter(shift__cashier=actor)
        expenses = expenses.filter(shift__cashier=actor)
    shift_rows = []
    for shift in shifts:
        row = rows(
            [shift],
            dict(
                id="id",
                cashierId="cashier_id",
                openedAt="opened_at",
                closedAt="closed_at",
                openingCash="opening_cash",
                actualCash="actual_cash",
                reason="reason",
            ),
        )[0]
        row["expectedCash"] = (
            shift.expected_cash if shift.closed_at else expected(shift)
        )
        row["actualCash"] = shift.actual_cash if shift.actual_cash is not None else 0
        row["difference"] = (
            row["actualCash"] - row["expectedCash"] if shift.closed_at else 0
        )
        shift_rows.append(row)
    products = rows(
        Product.objects.all().order_by("id"),
        dict(
            id="id",
            name="name",
            category="category",
            salePrice="sale_price",
            defaultCost="default_cost",
            enabled="enabled",
        ),
    )
    if not privileged:
        for product in products:
            product["defaultCost"] = 0
    transfers = []
    for transfer in visible_transfers(actor, now):
        row = rows(
            [transfer],
            dict(
                id="id",
                amount="amount",
                receivedAt="received_at",
                source="source",
                status="status",
            ),
        )[0]
        row["accountId"] = (
            str(transfer.payment.account_id) if hasattr(transfer, "payment") else ""
        )
        transfers.append(row)
    audit_rows = []
    if privileged:
        for event in AuditEvent.objects.select_related("actor").order_by("at", "id"):
            audit_rows.append(
                dict(
                    id=str(event.pk),
                    actorId=str(event.actor_id),
                    actorName=event.actor.username,
                    at=timestamp(event.at),
                    entityId=event.entity_id,
                    action=event.action,
                    reason=event.reason,
                    before=json.dumps(event.before, ensure_ascii=False),
                    after=json.dumps(event.after, ensure_ascii=False),
                )
            )
    return dict(
        serverTime=timestamp(now),
        users=[user_dto(actor)],
        booths=rows(
            Booth.objects.all().order_by("id"),
            dict(
                id="id",
                name="name",
                console="console",
                tariffId="tariff_id",
                enabled="enabled",
            ),
        ),
        tariffs=rows(
            Tariff.objects.all().order_by("id"),
            dict(id="id", name="name", hourlyRate="hourly_rate"),
        ),
        products=products,
        batches=rows(
            Batch.objects.all().order_by("received_at", "id"),
            dict(
                id="id",
                productId="product_id",
                receivedAt="received_at",
                quantity="quantity",
                remaining="remaining",
                unitCost="unit_cost",
            ),
        )
        if privileged
        else [],
        accounts=[account_row(a, actor, now) for a in accounts],
        methods=rows(
            PaymentMethod.objects.all().order_by("id"),
            dict(id="id", name="name", kind="kind", enabled="enabled"),
        ),
        transfers=transfers,
        shifts=shift_rows,
        expenses=rows(
            expenses,
            dict(
                id="id",
                shiftId="shift_id",
                amount="amount",
                category="category",
                methodId="method_id",
                reason="reason",
                createdAt="created_at",
                actorId="actor_id",
            ),
        ),
        audit=audit_rows,
        reviews=[
            review_dto(r)
            for r in ReviewLink.objects.filter(enabled=True).order_by("id")
        ],
        report=report() if privileged else empty_report(),
    )
