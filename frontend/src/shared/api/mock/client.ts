import { CommandRejected, CommandConflict } from "../errors";
import { assertSchema, assertPeriod } from "../validation";
import { snapshot } from "./audit";
import type { ClubApi, Command, Workspace, User } from "../types";
import { seed } from "./seed";
import { recalculate, reportFor } from "./calculations";
import { accountCommand } from "./accounts";
import { managementCommand } from "./management";
export type CommandRecords = Record<
  string,
  { body: string; result: Workspace }
>;
export class MockApi implements ClubApi {
  private userId: string | null = null;
  private get user(): User | null {
    return this.state.users.find((u) => u.id === this.userId) ?? null;
  }
  private state: Workspace;
  private records: CommandRecords;
  constructor(
    initialState = seed(),
    private persist?: (w: Workspace, records: CommandRecords) => void,
    records: CommandRecords = {},
  ) {
    this.state = structuredClone(initialState);
    this.records = structuredClone(records);
  }
  async login(username: string, password: string) {
    if (password !== "demo") throw Error("Демо-пароль: demo");
    const user = this.state.users.find((u) => u.id === username);
    if (!user) throw Error("Пользователь не найден");
    this.userId = user.id;
    return structuredClone(user);
  }
  async logout() {
    this.userId = null;
  }
  async load() {
    if (!this.user) throw Error("Войдите в систему");
    return this.visible(recalculate(structuredClone(this.state)));
  }
  async getReport(from: string, to: string) {
    if (!this.user || this.user.role === "cashier")
      throw Error("Недостаточно прав");
    assertPeriod(from, to);
    return reportFor(recalculate(structuredClone(this.state)), from, to);
  }
  private visible(w: Workspace) {
    if (this.user?.role === "cashier") {
      const ids = w.shifts
        .filter((s) => s.cashierId === this.user!.id)
        .map((s) => s.id);
      w.accounts = w.accounts.filter((a) => ids.includes(a.shiftId));
      w.shifts = w.shifts.filter((s) => ids.includes(s.id));
      w.expenses = w.expenses.filter((e) => ids.includes(e.shiftId));
      w.products = w.products.map((p) => ({ ...p, defaultCost: 0 }));
      w.batches = w.batches.map((b) => ({ ...b, unitCost: 0 }));
      w.accounts = w.accounts.map((a) => ({
        ...a,
        lines: a.lines.map((l) => ({ ...l, cost: 0, allocations: [] })),
      }));
      w.audit = w.audit.filter(
        (e) =>
          e.actorId === this.user!.id ||
          w.accounts.some((a) => a.id === e.entityId),
      );
      w.audit = w.audit.map((e) => ({
        ...e,
        before: "Подробные значения доступны управляющему",
        after: "Подробные значения доступны управляющему",
      }));
      w.report = {
        productSales: [],
        revenue: 0,
        costOfGoods: 0,
        grossProfit: 0,
        expenses: 0,
        netResult: 0,
        cashDifference: 0,
        paymentsByMethod: {},
        revenueByMethod: {},
      };
    }
    return w;
  }
  async execute(command: Command) {
    const c = structuredClone(command);
    assertSchema(c.name, c.data);
    if (!this.user) throw Error("Войдите в систему");
    const body = JSON.stringify(c),
      key = this.user.id + ":" + c.key,
      old = this.records[key];
    if (old) {
      if (old.body !== body)
        throw new CommandConflict("Ключ уже использован для другой операции");
      return this.visible(structuredClone(old.result));
    }
    const now = new Date().toISOString(),
      next = recalculate(structuredClone(this.state), Date.parse(now));
    const before = structuredClone(next);
    let entityId: string;
    try {
      entityId =
        accountCommand(next, this.user, c, now) ??
        managementCommand(next, this.user, c, now);
    } catch (e) {
      if (e instanceof Error && !(e instanceof CommandConflict))
        throw new CommandRejected(e.message);
      throw e;
    }
    recalculate(next, Date.parse(now));
    const batchIds =
      next.accounts
        .find((a) => a.id === entityId)
        ?.lines.flatMap((l) => l.allocations.map((x) => x.batchId)) ?? [];
    next.audit.push({
      id: crypto.randomUUID(),
      actorId: this.user.id,
      actorName: this.user.name,
      at: now,
      entityId,
      action: c.name,
      reason: "reason" in c.data ? String(c.data.reason) : "",
      before: snapshot(before, entityId, batchIds),
      after: snapshot(next, entityId, batchIds),
    });
    const records = {
      ...this.records,
      [key]: { body, result: structuredClone(next) },
    };
    this.persist?.(structuredClone(next), structuredClone(records));
    this.state = next;
    this.records = records;
    return this.visible(structuredClone(next));
  }
}
