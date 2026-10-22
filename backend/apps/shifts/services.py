from django.db.models import Sum
from django.utils import timezone
from apps.shifts.models import Shift, Expense
from apps.accounts.models import Account
from apps.catalog.models import PaymentMethod
from apps.core.rules import require, owns, management, audit, snapshot, money


def current(actor):
    shift = Shift.objects.select_for_update().filter(closed_at__isnull=True).first()
    require(shift is not None, "Open a shift first")
    owns(actor, shift)
    return shift


def expected(shift):
    payments = (
        shift.payments.filter(method_kind="cash").aggregate(n=Sum("amount"))["n"] or 0
    )
    expenses = (
        shift.expenses.filter(method_kind="cash").aggregate(n=Sum("amount"))["n"] or 0
    )
    reversals = sum(
        r.amount
        for refund in shift.refunds.all()
        for r in refund.reversals.filter(method_kind="cash")
    )
    value = shift.opening_cash + payments - expenses - reversals
    money(abs(value))
    return value


def open_shift(actor, data):
    require(
        not Shift.objects.filter(closed_at__isnull=True).exists(), "Drawer already open"
    )
    shift = Shift.objects.create(
        cashier=actor, opened_at=timezone.now(), opening_cash=data["openingCash"]
    )
    audit(actor, shift, "OpenShift", {})
    for account in (
        Account.objects.select_for_update()
        .exclude(status__in=["closed", "cancelled"])
        .order_by("id")
    ):
        before = snapshot(account)
        account.shift = shift
        account.version += 1
        account.save(update_fields=["shift", "version"])
        audit(actor, account, "Handover", before)
    return shift


def close_shift(actor, entity_id, data):
    shift = current(actor)
    require(str(shift.pk) == entity_id, "Not the open shift")
    before = snapshot(shift)
    shift.expected_cash = expected(shift)
    require(
        shift.expected_cash == data["actualCash"] or data["reason"].strip(),
        "Discrepancy reason required",
    )
    shift.actual_cash = data["actualCash"]
    shift.reason = data["reason"]
    shift.closed_at = timezone.now()
    shift.save()
    audit(actor, shift, "CloseShift", before, shift.reason)
    return shift


def add_expense(actor, data):
    require(
        data["reason"].strip() and data["category"].strip(),
        "Expense category and reason required",
    )
    require(data["amount"] > 0, "Expense must be positive")
    shift = current(actor) if data["scope"] == "shift" else None
    if shift is None:
        management(actor)
    method = PaymentMethod.objects.select_for_update().get(pk=data["methodId"])
    require(method.enabled, "Payment method disabled")
    expense = Expense.objects.create(
        shift=shift,
        actor=actor,
        amount=data["amount"],
        category=data["category"],
        reason=data["reason"],
        method=method,
        method_kind=method.kind,
        created_at=timezone.now(),
    )
    if shift:
        expected(shift)
    audit(actor, expense, "AddExpense", {}, data["reason"])
    return expense
