from apps.accounts.models import Account
from apps.payments.models import Payment, Refund
from apps.shifts.models import Shift, Expense


def accounts_for(actor):
    qs = Account.objects.all()
    return qs.filter(shift__cashier=actor) if actor.role == "cashier" else qs


def shifts_for(actor):
    qs = Shift.objects.all()
    return qs.filter(cashier=actor) if actor.role == "cashier" else qs


def payments_for(actor):
    qs = Payment.objects.all()
    return qs.filter(shift__cashier=actor) if actor.role == "cashier" else qs


def expenses_for(actor):
    qs = Expense.objects.all()
    return qs.filter(shift__cashier=actor) if actor.role == "cashier" else qs


def refunds_for(actor):
    qs = Refund.objects.all()
    return qs.filter(shift__cashier=actor) if actor.role == "cashier" else qs
