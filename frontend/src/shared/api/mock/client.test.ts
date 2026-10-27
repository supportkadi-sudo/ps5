import { describe, it, expect } from "vitest";
import { MockApi } from "./client";
import { seed } from "./seed";
import { recalculate } from "./calculations";
import type { CommandName, Schema, Command } from "../types";
async function setup(role = "owner") {
  const api = new MockApi();
  await api.login(role, "demo");
  const send = <K extends CommandName>(
    name: K,
    data: Schema[K],
    entityId?: string,
    key = crypto.randomUUID(),
  ) => api.execute({ name, data, entityId, key } as Command);
  await send("OpenShift", { openingCash: 100000 });
  const w = await send("CreateAccount", {
    boothId: "b1",
    tariffId: "ps5",
    customerName: "",
    customerPhone: "",
  });
  return { api, send, id: w.accounts[0].id };
}
describe("Mock API contract and money flows", () => {
  it("requires login and valid credentials", async () => {
    const api = new MockApi();
    await expect(api.load()).rejects.toThrow("Войдите");
    await expect(api.login("owner", "wrong")).rejects.toThrow("пароль");
  });
  it("starts timer on opening; uses precheck, split methods, explicit final close", async () => {
    const { api, send, id } = await setup();
    let a = (await api.load()).accounts[0];
    expect(a.status).toBe("playing");
    expect(a.segments).toHaveLength(1);
    let w = await send(
      "AddLine",
      { productId: "cola", quantity: 2, expectedVersion: a.version },
      id,
    );
    a = w.accounts[0];
    expect(a.status).toBe("playing");
    await expect(
      send(
        "AcceptPayment",
        {
          methodId: "cash",
          amount: 1000,
          transferId: "",
          confirmedByCashier: true,
          expectedVersion: a.version,
        },
        id,
      ),
    ).rejects.toThrow("предчек");
    w = await send("Precheck", { expectedVersion: a.version }, id);
    a = w.accounts[0];
    await expect(
      send("CloseAccount", { expectedVersion: a.version }, id),
    ).rejects.toThrow("полная");
    w = await send(
      "AcceptPayment",
      {
        methodId: "p2p",
        amount: 20000,
        transferId: "t1",
        confirmedByCashier: true,
        expectedVersion: a.version,
      },
      id,
    );
    a = w.accounts[0];
    expect(a.status).toBe("awaiting_payment");
    w = await send(
      "AcceptPayment",
      {
        methodId: "cash",
        amount: a.due,
        transferId: "",
        confirmedByCashier: true,
        expectedVersion: a.version,
      },
      id,
    );
    a = w.accounts[0];
    expect(a.due).toBe(0);
    expect(a.status).toBe("awaiting_payment");
    w = await send("CloseAccount", { expectedVersion: a.version }, id);
    expect(w.accounts[0].status).toBe("closed");
    expect(w.report.revenue).toBe(w.accounts[0].total);
    expect(w.report.costOfGoods).toBe(20000);
    expect(w.shifts[0].expectedCash).toBe(100000 + w.accounts[0].total - 20000);
  });
  it("allocates oldest lots and restores exact allocations, retaining reason/history", async () => {
    const { send, id, api } = await setup();
    let a = (await api.load()).accounts[0];
    let w = await send(
      "AddLine",
      { productId: "cola", quantity: 25, expectedVersion: a.version },
      id,
    );
    a = w.accounts[0];
    expect(a.lines[0].cost).toBe(251000);
    expect(a.lines[0].allocations.map((x) => x.quantity)).toEqual([24, 1]);
    expect(w.batches[0].remaining).toBe(0);
    await expect(
      send(
        "RemoveLine",
        { lineId: a.lines[0].id, reason: " ", expectedVersion: a.version },
        id,
      ),
    ).rejects.toThrow("причину");
    w = await send(
      "RemoveLine",
      {
        lineId: a.lines[0].id,
        reason: "Гость передумал",
        expectedVersion: a.version,
      },
      id,
    );
    expect(w.batches[0].remaining).toBe(24);
    expect(w.batches[1].remaining).toBe(24);
    expect(w.accounts[0].lines[0].removed).toBe(true);
    expect(w.audit.at(-1)?.reason).toBe("Гость передумал");
  });
  it("replays exact command once; rejects key reuse and stale versions", async () => {
    const { send, id, api } = await setup();
    const a = (await api.load()).accounts[0],
      key = crypto.randomUUID(),
      data = { productId: "cola", quantity: 1, expectedVersion: a.version };
    const w = await send("AddLine", data, id, key);
    const replay = await send("AddLine", data, id, key);
    expect(replay).toEqual(w);
    expect((await api.load()).accounts[0].lines).toHaveLength(1);
    await expect(
      send("AddLine", { ...data, quantity: 2 }, id, key),
    ).rejects.toThrow("Ключ");
    await expect(send("AddLine", data, id)).rejects.toThrow("версии");
  });
  it("rolls back insufficient stock and disallows duplicate booth occupancy", async () => {
    const { send, id, api } = await setup();
    const a = (await api.load()).accounts[0];
    await expect(
      send(
        "AddLine",
        { productId: "cola", quantity: 49, expectedVersion: a.version },
        id,
      ),
    ).rejects.toThrow("Недостаточно");
    expect((await api.load()).batches[0].remaining).toBe(24);
    await expect(
      send("CreateAccount", {
        boothId: "b1",
        tariffId: "ps5",
        customerName: "",
        customerPhone: "",
      }),
    ).rejects.toThrow("занята");
  });
  it("rejects unverified and ambiguous P2P, and overpayment", async () => {
    const { send, id, api } = await setup();
    let a = (await api.load()).accounts[0];
    let w = await send(
      "AddLine",
      { productId: "cola", quantity: 4, expectedVersion: a.version },
      id,
    );
    a = w.accounts[0];
    w = await send("Precheck", { expectedVersion: a.version }, id);
    a = w.accounts[0];
    for (const transferId of ["t2", "t3"])
      await expect(
        send(
          "AcceptPayment",
          {
            methodId: "p2p",
            amount: 20000,
            transferId,
            confirmedByCashier: true,
            expectedVersion: a.version,
          },
          id,
        ),
      ).rejects.toThrow("достоверного");
    await expect(
      send(
        "AcceptPayment",
        {
          methodId: "cash",
          amount: 999999,
          transferId: "",
          confirmedByCashier: true,
          expectedVersion: a.version,
        },
        id,
      ),
    ).rejects.toThrow("превышает");
    expect((await api.load()).accounts[0].payments).toHaveLength(0);
  });
  it("cashier cannot change costs/settings or see cost allocations", async () => {
    const { send, api } = await setup("cashier");
    const w = await api.load();
    expect(w.products.every((p) => p.defaultCost === 0)).toBe(true);
    expect(w.batches.every((p) => p.unitCost === 0)).toBe(true);
    await expect(
      send("SaveTariff", {
        tariff: { id: "ps5", name: "cheap", hourlyRate: 1 },
      }),
    ).rejects.toThrow("прав");
  });
  it("cash expense, reasoned shift discrepancy and handover preserve active timer", async () => {
    const { send, id, api } = await setup();
    let w = await api.load();
    w = await send("AddExpense", {
      scope: "shift",
      amount: 10000,
      category: "Прочие",
      methodId: "cash",
      reason: "Вода",
    });
    expect(w.shifts[0].expectedCash).toBe(90000);
    await expect(
      send("CloseShift", { actualCash: 89000, reason: "" }, w.shifts[0].id),
    ).rejects.toThrow("причину");
    w = await send(
      "CloseShift",
      { actualCash: 89000, reason: "Недостача" },
      w.shifts[0].id,
    );
    expect(w.shifts[0].difference).toBe(-1000);
    await api.login("cashier", "demo");
    w = await send("OpenShift", { openingCash: 89000 });
    expect(w.accounts[0].status).toBe("playing");
    expect(w.accounts[0].shiftId).toBe(w.shifts[0].id);
    expect(
      w.audit.some((e) => e.action === "Передача счёта в новую смену"),
    ).toBe(true);
  });
  it("rounds total once, midpoint up, using actual timer segments and tariff snapshot", async () => {
    const { api, send, id } = await setup();
    let w = await api.load();
    const a = w.accounts[0];
    a.segments = [
      { startedAt: "2026-10-22T10:00:00Z", stoppedAt: "2026-10-22T11:20:00Z" },
    ];
    recalculate(w);
    expect(a.total).toBe(80000);
    a.segments = [];
    a.lines = [
      {
        id: "l",
        productId: "cola",
        name: "sample",
        quantity: 1,
        unitPrice: 250,
        cost: 0,
        allocations: [],
        removed: false,
        removalReason: "",
      },
    ];
    recalculate(w);
    expect(a.total).toBe(500);
    const updated = await send("SaveTariff", {
      tariff: { id: "ps5", name: "New", hourlyRate: 90000 },
    });
    expect(updated.accounts[0].hourlyRate).toBe(60000);
  });
  it("does not recursively embed audit history inside snapshots", async () => {
    const { send, id, api } = await setup();
    for (let i = 0; i < 10; i++) {
      const a = (await api.load()).accounts[0];
      await send(
        "AddLine",
        { productId: "water", quantity: 1, expectedVersion: a.version },
        id,
      );
    }
    const w = await api.load();
    expect(JSON.parse(w.audit.at(-1)!.after).audit).toBeUndefined();
  });
});

describe("period reports and data visibility", () => {
  it("reports club expenses without an open shift and prevents cashier doing so", async () => {
    const api = new MockApi();
    await api.login("owner", "demo");
    await api.execute({
      name: "AddExpense",
      key: crypto.randomUUID(),
      data: {
        scope: "club",
        amount: 50000,
        category: "Аренда",
        methodId: "cash",
        reason: "Владелец оплатил вне кассы",
      },
    });
    const r = await api.getReport("2000-01-01", "2100-01-01");
    expect(r.expenses).toBe(50000);
    expect(r.netResult).toBe(-50000);
    expect((await api.getReport("2000-01-01", "2000-01-02")).expenses).toBe(0);
    await api.login("cashier", "demo");
    await expect(api.getReport("2000-01-01", "2100-01-01")).rejects.toThrow(
      "прав",
    );
    await expect(
      api.execute({
        name: "AddExpense",
        key: crypto.randomUUID(),
        data: {
          scope: "club",
          amount: 1,
          category: "x",
          methodId: "cash",
          reason: "x",
        },
      }),
    ).rejects.toThrow("прав");
  });
  it("redacts management snapshots from cashier bill audit", async () => {
    const { api, send, id } = await setup("cashier");
    const a = (await api.load()).accounts[0];
    const w = await send(
      "AddLine",
      { productId: "cola", quantity: 1, expectedVersion: a.version },
      id,
    );
    expect(w.audit.every((e) => !e.after.includes("unitCost"))).toBe(true);
  });
});

describe("payment retries", () => {
  it("accepts payment once and prevents sharing a transfer between bills", async () => {
    const { api, send, id } = await setup();
    let a = (await api.load()).accounts[0];
    let w = await send(
      "AddLine",
      { productId: "cola", quantity: 2, expectedVersion: a.version },
      id,
    );
    w = await send("Precheck", { expectedVersion: w.accounts[0].version }, id);
    a = w.accounts[0];
    const key = crypto.randomUUID(),
      data = {
        methodId: "p2p",
        amount: 20000,
        transferId: "t1",
        confirmedByCashier: true as const,
        expectedVersion: a.version,
      };
    await send("AcceptPayment", data, id, key);
    await send("AcceptPayment", data, id, key);
    expect((await api.load()).accounts[0].payments).toHaveLength(1);
    w = await send("CreateAccount", {
      boothId: "b2",
      tariffId: "ps5",
      customerName: "",
      customerPhone: "",
    });
    const id2 = w.accounts[1].id;
    w = await send(
      "AddLine",
      { productId: "cola", quantity: 2, expectedVersion: 1 },
      id2,
    );
    w = await send("Precheck", { expectedVersion: w.accounts[1].version }, id2);
    await expect(
      send(
        "AcceptPayment",
        { ...data, expectedVersion: w.accounts[1].version },
        id2,
      ),
    ).rejects.toThrow("достоверного");
  });
});
