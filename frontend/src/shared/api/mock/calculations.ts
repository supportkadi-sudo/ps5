import type { Workspace, Account } from "../types";
export function recalculate(w: Workspace, now = Date.now()) {
  for (const a of w.accounts) {
    const seconds = a.segments.reduce(
      (n, s) =>
        n +
        Math.max(
          0,
          Math.floor(
            ((s.stoppedAt ? Date.parse(s.stoppedAt) : now) -
              Date.parse(s.startedAt)) /
              1000,
          ),
        ),
      0,
    );
    const gameNumerator = BigInt(seconds) * BigInt(a.hourlyRate);
    const goods = a.lines
      .filter((l) => !l.removed)
      .reduce((n, l) => n + BigInt(l.unitPrice) * BigInt(l.quantity), 0n);
    a.gameAmount = Number(gameNumerator / 3600n);
    a.total = Number(
      ((gameNumerator + goods * 3600n + 900000n) / 1800000n) * 500n,
    );
    a.paid = a.payments.reduce((n, p) => n + p.amount, 0);
    a.due = a.total - a.paid;
    for (const value of [a.total, a.paid, ...a.lines.map((l) => l.cost)])
      integer(value);
  }
  for (const s of w.shifts) {
    s.expectedCash =
      s.openingCash +
      w.accounts
        .flatMap((a) => a.payments)
        .filter(
          (p) =>
            p.shiftId === s.id &&
            w.methods.find((m) => m.id === p.methodId)?.kind === "cash",
        )
        .reduce((n, p) => n + p.amount, 0) -
      w.expenses
        .filter(
          (e) =>
            e.shiftId === s.id &&
            w.methods.find((m) => m.id === e.methodId)?.kind === "cash",
        )
        .reduce((n, e) => n + e.amount, 0);
    s.difference = s.closedAt ? s.actualCash - s.expectedCash : 0;
    if (
      !Number.isSafeInteger(s.expectedCash) ||
      !Number.isSafeInteger(s.difference)
    )
      throw Error("Сумма выходит за допустимый диапазон");
  }
  w.report = reportFor(w);
  w.serverTime = new Date(now).toISOString();
  return w;
}
export function editable(a: Account) {
  if (a.status === "closed" || a.status === "cancelled")
    throw Error("Счёт завершён");
}
export function integer(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    throw Error("Введите целое неотрицательное число в допустимом диапазоне");
}
export function reason(value: string) {
  if (!value.trim()) throw Error("Укажите причину");
}

export function reportFor(w: Workspace, from = "", to = "") {
  const within = (stamp: string) => {
    const d = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(stamp));
    return (!from || d >= from) && (!to || d <= to);
  };
  const closed = w.accounts.filter(
    (a) => a.status === "closed" && within(a.closedAt),
  );
  const revenue = closed.reduce((n, a) => n + a.total, 0),
    costOfGoods = closed
      .flatMap((a) => a.lines)
      .filter((l) => !l.removed)
      .reduce((n, l) => n + l.cost, 0),
    expenses = w.expenses
      .filter((e) => within(e.createdAt))
      .reduce((n, e) => n + e.amount, 0);
  const revenueByMethod: Record<string, number> = {};
  for (const p of closed.flatMap((a) => a.payments))
    revenueByMethod[p.methodId] = (revenueByMethod[p.methodId] ?? 0) + p.amount;
  const paymentsByMethod: Record<string, number> = {};
  for (const p of w.accounts
    .flatMap((a) => a.payments)
    .filter((p) => within(p.createdAt)))
    paymentsByMethod[p.methodId] =
      (paymentsByMethod[p.methodId] ?? 0) + p.amount;
  for (const value of [
    revenue,
    costOfGoods,
    expenses,
    ...Object.values(paymentsByMethod),
  ])
    integer(value);
  if (!Number.isSafeInteger(revenue - costOfGoods - expenses))
    throw Error("Сумма выходит за допустимый диапазон");
  return {
    revenue,
    costOfGoods,
    grossProfit: revenue - costOfGoods,
    expenses,
    netResult: revenue - costOfGoods - expenses,
    cashDifference: w.shifts
      .filter((s) => s.closedAt && within(s.closedAt))
      .reduce((n, s) => n + s.difference, 0),
    paymentsByMethod,
    revenueByMethod,
  };
}
