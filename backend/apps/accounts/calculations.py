from datetime import timedelta
from apps.core.rules import money


# Combine segments before rounding minutes: repeated pauses cannot erase time.
def amounts(account, now):
    micros = sum(
        max(0, ((s.stopped_at or now) - s.started_at) // timedelta(microseconds=1))
        for s in account.segments.all()
    )
    minutes = (micros + 60_000_000 - 1) // 60_000_000
    goods = sum(l.quantity * l.unit_price for l in account.lines.all() if not l.removed)
    numerator = minutes * account.hourly_rate + goods * 60
    total = money(((numerator + 15_000) // 30_000) * 500)
    paid = money(sum(p.amount for p in account.payments.all()))
    return {
        "gameAmount": money(minutes * account.hourly_rate // 60),
        "total": account.final_total if account.final_total is not None else total,
        "paid": paid,
        "due": max(0, total - paid),
    }
