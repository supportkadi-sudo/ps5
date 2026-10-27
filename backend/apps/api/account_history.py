"""Display metadata for account history; monetary totals stay in account projections."""

from datetime import timedelta
from apps.api.projections import account_row


def account_history_row(account, actor, now):
    row = account_row(account, actor, now)
    micros = sum(
        max(0, ((s.stopped_at or now) - s.started_at) // timedelta(microseconds=1))
        for s in account.segments.all()
    )
    row["history"] = dict(
        boothName=account.booth.name,
        console=account.console,
        cashierName=account.shift.cashier.get_full_name()
        or account.shift.cashier.username,
        elapsedMinutes=micros // 60_000_000,
        goodsAmount=sum(
            l.quantity * l.unit_price for l in account.lines.all() if not l.removed
        ),
        paymentMethods=list(
            dict.fromkeys(
                p.method.name
                for p in account.payments.select_related("method").order_by(
                    "created_at", "id"
                )
            )
        ),
    )
    return row
