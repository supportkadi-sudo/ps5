from apps.core.rules import money


def method_totals(shift):
    received, spent, returned = {}, {}, {}
    for p in shift.payments.all():
        key = str(p.method_id)
        received[key] = money(received.get(key, 0) + p.amount)
    for e in shift.expenses.all():
        key = str(e.method_id)
        spent[key] = money(spent.get(key, 0) + e.amount)
    for refund in shift.refunds.all():
        for r in refund.reversals.select_related("payment"):
            key = str(r.payment.method_id)
            returned[key] = money(returned.get(key, 0) + r.amount)
    return dict(
        paymentsByMethod=received, expensesByMethod=spent, refundsByMethod=returned
    )
