import { CommandConflict } from "../errors";
import type { Workspace, User, Command, Account } from "../types";
import { editable, integer, reason } from "./calculations";
export function accountCommand(
  w: Workspace,
  user: User,
  c: Command,
  now: string,
): string | undefined {
  const shift = w.shifts.find((s) => !s.closedAt && s.cashierId === user.id);
  if (c.name === "CreateAccount") {
    if (!shift) throw Error("Сначала откройте свою смену");
    const b = w.booths.find((b) => b.id === c.data.boothId && b.enabled);
    if (!b) throw Error("Кабинка недоступна");
    if (
      w.accounts.some(
        (a) =>
          a.boothId === b.id && !["closed", "cancelled"].includes(a.status),
      )
    )
      throw Error("Кабинка уже занята");
    const t = w.tariffs.find((t) => t.id === c.data.tariffId);
    if (!t || !["PS3", "PS4", "PS5"].includes(t.consoleCode ?? ""))
      throw Error("Выберите тариф");
    const a: Account = {
      id: crypto.randomUUID(),
      boothId: b.id,
      tariffId: t.id,
      console: t.consoleCode!,
      shiftId: shift.id,
      customerName: c.data.customerName,
      customerPhone: c.data.customerPhone,
      status: "playing",
      version: 1,
      hourlyRate: t.hourlyRate,
      createdAt: now,
      closedAt: "",
      segments: [{ startedAt: now, stoppedAt: "" }],
      lines: [],
      payments: [],
      gameAmount: 0,
      total: 0,
      paid: 0,
      due: 0,
    };
    w.accounts.push(a);
    return a.id;
  }
  if (
    ![
      "StartTimer",
      "Precheck",
      "ResumeTimer",
      "CloseAccount",
      "AddLine",
      "RemoveLine",
      "AcceptPayment",
    ].includes(c.name)
  )
    return undefined;
  const a = w.accounts.find((a) => a.id === c.entityId);
  if (!a) throw Error("Счёт не найден");
  if (!shift) throw Error("Откройте свою смену");
  if (user.role === "cashier" && a.shiftId !== shift.id)
    throw Error("Нет доступа к чужой смене");
  if (c.data.expectedVersion !== a.version)
    throw new CommandConflict("Конфликт версии. Обновите данные");
  editable(a);
  if (c.name === "StartTimer" || c.name === "ResumeTimer") {
    if (a.status !== (c.name === "StartTimer" ? "draft" : "awaiting_payment"))
      throw Error("Недопустимый переход");
    a.segments.push({ startedAt: now, stoppedAt: "" });
    a.status = "playing";
  } else if (c.name === "Precheck") {
    if (!["playing", "draft"].includes(a.status))
      throw Error("Предчек уже сформирован");
    for (const s of a.segments) if (!s.stoppedAt) s.stoppedAt = now;
    a.status = "awaiting_payment";
  } else if (c.name === "CloseAccount") {
    if (a.status !== "awaiting_payment" || a.due !== 0)
      throw Error("Нужен предчек и полная подтверждённая оплата");
    a.status = "closed";
    a.closedAt = now;
  } else if (c.name === "AddLine") {
    if (a.paid)
      throw Error("После частичной оплаты изменение товаров недоступно");
    integer(c.data.quantity, true);
    const p = w.products.find((p) => p.id === c.data.productId && p.enabled);
    if (!p) throw Error("Товар недоступен");
    const batches = w.batches
      .filter((b) => b.productId === p.id && b.remaining > 0)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    if (batches.reduce((n, b) => n + b.remaining, 0) < c.data.quantity)
      throw Error("Недостаточно товара на складе");
    let left = c.data.quantity,
      cost = 0;
    const allocations = [];
    for (const b of batches) {
      const quantity = Math.min(left, b.remaining);
      if (!quantity) break;
      b.remaining -= quantity;
      left -= quantity;
      cost += quantity * b.unitCost;
      allocations.push({ batchId: b.id, quantity, unitCost: b.unitCost });
    }
    a.lines.push({
      id: crypto.randomUUID(),
      productId: p.id,
      name: p.name,
      quantity: c.data.quantity,
      unitPrice: p.salePrice,
      cost,
      allocations,
      removed: false,
      removalReason: "",
    });
  } else if (c.name === "RemoveLine") {
    if (a.paid) throw Error("После частичной оплаты нужен отдельный возврат");
    reason(c.data.reason);
    const l = a.lines.find((l) => l.id === c.data.lineId && !l.removed);
    if (!l) throw Error("Позиция уже удалена");
    for (const allocation of l.allocations)
      w.batches.find((b) => b.id === allocation.batchId)!.remaining +=
        allocation.quantity;
    l.removed = true;
    l.removalReason = c.data.reason;
  } else if (c.name === "AcceptPayment") {
    if (a.status !== "awaiting_payment")
      throw Error("Сначала сформируйте предчек");
    integer(c.data.amount, true);
    if (c.data.amount > a.due) throw Error("Сумма превышает остаток к оплате");
    if (!c.data.confirmedByCashier) throw Error("Подтвердите получение оплаты");
    const m = w.methods.find((m) => m.id === c.data.methodId && m.enabled);
    if (!m) throw Error("Способ оплаты недоступен");
    if (m.kind === "p2p") {
      const t = w.transfers.find((t) => t.id === c.data.transferId);
      if (
        !t ||
        t.status !== "verified_fixture" ||
        t.accountId ||
        t.amount !== c.data.amount
      )
        throw Error("Нет достоверного свободного перевода на эту сумму");
      t.accountId = a.id;
    } else if (c.data.transferId)
      throw Error("Перевод допустим только для P2P");
    a.payments.push({
      id: crypto.randomUUID(),
      accountId: a.id,
      shiftId: shift.id,
      methodId: m.id,
      amount: c.data.amount,
      transferId: c.data.transferId,
      createdAt: now,
      actorId: user.id,
    });
  }
  a.version++;
  return a.id;
}
