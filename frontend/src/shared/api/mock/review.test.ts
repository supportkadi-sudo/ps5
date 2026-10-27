import { it, expect, vi, afterEach } from "vitest";
import { MockApi } from "./client";
import type { Command, CommandName, Schema } from "../types";
afterEach(() => vi.useRealTimers());
async function setup() {
  const api = new MockApi();
  await api.login("owner", "demo");
  const send = <K extends CommandName>(
    name: K,
    data: Schema[K],
    entityId?: string,
  ) =>
    api.execute({ name, data, entityId, key: crypto.randomUUID() } as Command);
  await send("OpenShift", { openingCash: 0 });
  const w = await send("CreateAccount", {
    boothId: "b1",
    tariffId: "ps5",
    customerName: "",
    customerPhone: "",
  });
  return { api, send, id: w.accounts[0].id };
}
it("audits newly touched FIFO batches before allocation and exact restoration", async () => {
  const { send, id } = await setup();
  let w = await send(
    "AddLine",
    { expectedVersion: 1, productId: "cola", quantity: 26 },
    id,
  );
  let e = w.audit.at(-1)!;
  expect(
    JSON.parse(e.before).batches.map((b: { remaining: number }) => b.remaining),
  ).toEqual([24, 24]);
  expect(
    JSON.parse(e.after).batches.map((b: { remaining: number }) => b.remaining),
  ).toEqual([0, 22]);
  const allocations = w.accounts[0].lines[0].allocations;
  w = await send(
    "RemoveLine",
    { expectedVersion: 2, lineId: w.accounts[0].lines[0].id, reason: "Замена" },
    id,
  );
  e = w.audit.at(-1)!;
  expect(JSON.parse(e.before).account.lines[0].allocations).toEqual(
    allocations,
  );
  expect(JSON.parse(e.after).account.lines[0].allocations).toEqual(allocations);
  expect(
    JSON.parse(e.after).batches.map((b: { remaining: number }) => b.remaining),
  ).toEqual([24, 24]);
});
it("precheck snapshots accrued timer charges at the command timestamp", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  const { send, id } = await setup();
  vi.setSystemTime(new Date("2026-10-22T11:00:00Z"));
  const w = await send("Precheck", { expectedVersion: 1 }, id);
  const e = w.audit.at(-1)!;
  const before = JSON.parse(e.before).account,
    after = JSON.parse(e.after).account;
  expect(before.gameAmount).toBe(60000);
  expect(before.total).toBe(after.total);
  expect(before.gameAmount).toBe(after.gameAmount);
  expect(before.status).toBe("playing");
  expect(after.segments[0].stoppedAt).toBe(e.at);
});
it("report aggregates closed product sales by period", async () => {
  const { api, send, id } = await setup();
  await send(
    "AddLine",
    { expectedVersion: 1, productId: "cola", quantity: 2 },
    id,
  );
  let w = await send("Precheck", { expectedVersion: 2 }, id);
  await send(
    "AcceptPayment",
    {
      expectedVersion: 3,
      methodId: "cash",
      amount: w.accounts[0].due,
      transferId: "",
      confirmedByCashier: true,
    },
    id,
  );
  await send("CloseAccount", { expectedVersion: 4 }, id);
  const r = await api.getReport("2020-01-01", "2099-12-31");
  expect(r.productSales).toEqual([
    {
      productId: "cola",
      name: "Coca-Cola · 1 л",
      quantity: 2,
      revenue: 36000,
      costOfGoods: 20000,
    },
  ]);
  expect(
    (await api.getReport("2020-01-01", "2020-01-02")).productSales,
  ).toEqual([]);
});
