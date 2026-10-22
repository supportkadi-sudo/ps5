import json
from django.utils import timezone
from django.db.models import Q, Sum
from apps.api.scopes import accounts_for, shifts_for, expenses_for
from apps.api.projections import rows, account_row, empty_report, timestamp, shift_row
from apps.club.models import Booth, Tariff
from apps.catalog.models import Product, PaymentMethod
from apps.inventory.models import Batch
from apps.payments.selectors import visible_transfers
from apps.audit.models import AuditEvent
from apps.reports.services import report
from apps.access.services import user_dto
from apps.club.reviews import review_dto
from apps.club.models import ReviewLink


def workspace(actor):
    privileged = actor.role != "cashier"
    now = timezone.now()
    shifts = shifts_for(actor).order_by("-opened_at", "-id")[:20]
    scoped_accounts = accounts_for(actor)
    recent_closed = list(
        scoped_accounts.filter(status__in=["closed", "cancelled"])
        .order_by("-created_at", "-id")
        .values_list("pk", flat=True)[:50]
    )
    accounts = scoped_accounts.filter(
        Q(status__in=["draft", "playing", "awaiting_payment"]) | Q(pk__in=recent_closed)
    ).order_by("created_at", "id")
    expenses = expenses_for(actor).order_by("-created_at", "-id")[:50]
    shift_rows = [shift_row(shift) for shift in shifts]
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
    stock = {
        str(row["product_id"]): row["stock"]
        for row in Batch.objects.values("product_id").annotate(stock=Sum("remaining"))
    }
    from apps.core.rules import money

    for product in products:
        product["availableStock"] = money(stock.get(product["id"], 0))
    if not privileged:
        for product in products:
            product["defaultCost"] = 0
    transfers = []
    for transfer in visible_transfers(actor, now).reverse()[:100]:
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
        for event in AuditEvent.objects.select_related("actor").order_by("-at", "-id")[
            :50
        ]:
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
            Batch.objects.all().order_by("-received_at", "-id")[:100],
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
        report=report(timezone.localdate(), timezone.localdate())
        if privileged
        else empty_report(),
    )
