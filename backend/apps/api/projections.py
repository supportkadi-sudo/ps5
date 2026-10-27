from apps.accounts.calculations import amounts


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
            tariffId="tariff_id",
            console="console",
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
    if (
        a.status == "awaiting_payment"
        and hasattr(a, "transfer_expectation")
        and a.transfer_expectation.consumed_at is None
    ):
        e = a.transfer_expectation
        row["expectedTransfer"] = dict(
            amount=e.amount,
            source=e.source,
            cardLast4=e.card_last4,
            methodId=str(e.method_id),
            expiresAt=e.expires_at.isoformat(),
        )
    row["payments"] = rows(
        a.payments.all().order_by("created_at", "id"), PAYMENT_FIELDS
    )
    if hasattr(a, "refund"):
        from apps.api.history import refund_row

        row["refund"] = refund_row(a.refund)
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


def shift_row(shift):
    from apps.shifts.services import expected
    from apps.shifts.summaries import method_totals

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
    row["expectedCash"] = shift.expected_cash if shift.closed_at else expected(shift)
    row["actualCash"] = shift.actual_cash if shift.actual_cash is not None else 0
    row["difference"] = (
        row["actualCash"] - row["expectedCash"] if shift.closed_at else 0
    )
    row.update(method_totals(shift))
    return row
