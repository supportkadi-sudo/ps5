from datetime import date
from rest_framework.exceptions import ValidationError
from apps.accounts.models import Account
from apps.shifts.models import Expense, Shift
from apps.payments.models import Payment, PaymentReversal
from apps.core.rules import money


def period(from_date, to_date):
    try:
        start, end = date.fromisoformat(from_date), date.fromisoformat(to_date)
        if start.isoformat() != from_date or end.isoformat() != to_date or start > end:
            raise ValueError()
        return start, end
    except (ValueError, TypeError):
        raise ValidationError("Valid ordered ISO dates required")


def report(start=None, end=None):
    def within(queryset, field):
        return (
            queryset.filter(**{field + "__date__range": (start, end)})
            if start
            else queryset
        )

    result = dict(
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
    products = {}
    # Recognition uses closing date; refunds are separate period compensation.
    for account in within(Account.objects.filter(closed_at__isnull=False), "closed_at"):
        result["revenue"] += account.final_total
        for payment in account.payments.all():
            key = str(payment.method_id)
            result["revenueByMethod"][key] = (
                result["revenueByMethod"].get(key, 0) + payment.amount
            )
        for line in account.lines.filter(removed=False):
            result["costOfGoods"] += line.cost
            key = (str(line.product_id), line.name)
            row = products.setdefault(
                key,
                dict(
                    productId=key[0], name=key[1], quantity=0, revenue=0, costOfGoods=0
                ),
            )
            row["quantity"] += line.quantity
            row["revenue"] += line.quantity * line.unit_price
            row["costOfGoods"] += line.cost
    # ProductSales remains gross sales; refunds are not silently removed from history.
    for reversal in within(
        PaymentReversal.objects.select_related("payment"), "refund__created_at"
    ):
        result["revenue"] -= reversal.amount
        key = str(reversal.payment.method_id)
        result["revenueByMethod"][key] = (
            result["revenueByMethod"].get(key, 0) - reversal.amount
        )
    from apps.payments.models import Refund

    for refund in within(Refund.objects.select_related("account"), "created_at"):
        if refund.restock_goods:
            result["costOfGoods"] -= sum(
                l.cost for l in refund.account.lines.filter(removed=False)
            )
    for payment in within(Payment.objects.all(), "created_at"):
        key = str(payment.method_id)
        result["paymentsByMethod"][key] = (
            result["paymentsByMethod"].get(key, 0) + payment.amount
        )
    for reversal in within(
        PaymentReversal.objects.select_related("payment"), "refund__created_at"
    ):
        key = str(reversal.payment.method_id)
        result["paymentsByMethod"][key] = (
            result["paymentsByMethod"].get(key, 0) - reversal.amount
        )
    result["expenses"] = sum(
        e.amount for e in within(Expense.objects.all(), "created_at")
    )
    result["cashDifference"] = sum(
        s.actual_cash - s.expected_cash
        for s in within(Shift.objects.filter(closed_at__isnull=False), "closed_at")
    )
    result["grossProfit"] = result["revenue"] - result["costOfGoods"]
    result["netResult"] = result["grossProfit"] - result["expenses"]
    result["productSales"] = list(products.values())
    for key in (
        "revenue",
        "costOfGoods",
        "grossProfit",
        "expenses",
        "netResult",
        "cashDifference",
    ):
        money(abs(result[key]))
    for field in ("paymentsByMethod", "revenueByMethod"):
        for value in result[field].values():
            money(abs(value))
    for row in result["productSales"]:
        for key in ("quantity", "revenue", "costOfGoods"):
            money(row[key])
    return result
