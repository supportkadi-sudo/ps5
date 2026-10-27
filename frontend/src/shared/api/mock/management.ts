import type { Workspace, User, Command } from "../types";
import { integer, reason } from "./calculations";
export function managementCommand(
  w: Workspace,
  u: User,
  c: Command,
  now: string,
): string {
  const active = w.shifts.find((s) => !s.closedAt && s.cashierId === u.id);
  if (c.name === "OpenShift") {
    if (w.shifts.some((s) => !s.closedAt))
      throw Error("Касса уже открыта другим кассиром");
    integer(c.data.openingCash);
    const id = crypto.randomUUID();
    w.shifts.push({
      id,
      cashierId: u.id,
      openedAt: now,
      closedAt: "",
      openingCash: c.data.openingCash,
      actualCash: 0,
      expectedCash: c.data.openingCash,
      difference: 0,
      reason: "",
    });
    for (const a of w.accounts.filter(
      (a) => !["closed", "cancelled"].includes(a.status),
    )) {
      const previousShift = a.shiftId;
      a.shiftId = id;
      a.version++;
      w.audit.push({
        id: crypto.randomUUID(),
        entityId: a.id,
        actorId: u.id,
        actorName: u.name,
        at: now,
        action: "Передача счёта в новую смену",
        reason: "Смена кассира",
        before: previousShift,
        after: id,
      });
    }
    return id;
  }
  if (c.name === "CloseShift") {
    if (!active || active.id !== c.entityId)
      throw Error("Нет своей открытой смены");
    integer(c.data.actualCash);
    if (c.data.actualCash !== active.expectedCash) reason(c.data.reason);
    active.closedAt = now;
    active.actualCash = c.data.actualCash;
    active.reason = c.data.reason;
    return active.id;
  }
  if (c.name === "AddExpense") {
    const club = c.data.scope === "club";
    if (club && u.role === "cashier") throw Error("Недостаточно прав");
    if (!club && !active) throw Error("Откройте свою смену");
    integer(c.data.amount, true);
    reason(c.data.reason);
    reason(c.data.category);
    if (!w.methods.find((m) => m.id === c.data.methodId && m.enabled))
      throw Error("Способ оплаты недоступен");
    const id = crypto.randomUUID();
    w.expenses.push({
      id,
      shiftId: club ? "" : active!.id,
      amount: c.data.amount,
      category: c.data.category,
      methodId: c.data.methodId,
      reason: c.data.reason,
      createdAt: now,
      actorId: u.id,
    });
    return id;
  }
  if (u.role === "cashier") throw Error("Недостаточно прав");
  function save<T extends { id: string }>(list: T[], item: T) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i < 0) list.push(item);
    else list[i] = item;
    return item.id;
  }
  switch (c.name) {
    case "SaveProduct":
      integer(c.data.product.salePrice);
      integer(c.data.product.defaultCost);
      reason(c.data.product.name);
      return save(w.products, c.data.product);
    case "ReceiveBatch": {
      integer(c.data.quantity, true);
      integer(c.data.unitCost);
      if (!w.products.some((p) => p.id === c.data.productId))
        throw Error("Товар не найден");
      const id = crypto.randomUUID();
      w.batches.push({
        id,
        productId: c.data.productId,
        quantity: c.data.quantity,
        unitCost: c.data.unitCost,
        receivedAt: now,
        remaining: c.data.quantity,
      });
      return id;
    }
    case "AdjustStock": {
      reason(c.data.reason);
      integer(c.data.remaining);
      const b = w.batches.find((b) => b.id === c.data.batchId);
      if (!b) throw Error("Партия не найдена");
      if (c.data.remaining > b.remaining)
        throw Error("Увеличение остатка оформите поступлением");
      b.remaining = c.data.remaining;
      return b.id;
    }
    case "SaveTariff":
      integer(c.data.tariff.hourlyRate, true);
      reason(c.data.tariff.name);
      return save(w.tariffs, {
        ...c.data.tariff,
        consoleCode:
          w.tariffs.find((t) => t.id === c.data.tariff.id)?.consoleCode ?? null,
      });
    case "SaveBooth":
      reason(c.data.booth.name);
      if (!w.tariffs.some((t) => t.id === c.data.booth.tariffId))
        throw Error("Тариф не найден");
      return save(w.booths, c.data.booth);
    case "SaveMethod":
      reason(c.data.method.name);
      if (
        w.methods.some(
          (m) => m.id === c.data.method.id && m.kind !== c.data.method.kind,
        )
      )
        throw Error("Тип существующего метода менять нельзя: создайте новый");
      return save(w.methods, c.data.method);
    case "SaveReview": {
      const url = new URL(c.data.review.url);
      if (url.protocol !== "https:") throw Error("Нужна HTTPS ссылка");
      reason(c.data.review.name);
      return save(w.reviews, c.data.review);
    }
    case "SaveUser":
      if (u.role !== "owner") throw Error("Только владелец управляет ролями");
      if (c.data.user.id === u.id && c.data.user.role !== "owner")
        throw Error("Нельзя понизить свою роль");
      return save(w.users, c.data.user);
    default:
      throw Error("Неизвестная команда");
  }
}
