import { describe, it, expect } from "vitest";
import { MockApi } from "./client";
import type { Command, CommandName, Schema } from "../types";
function sender(api: MockApi) {
  return <K extends CommandName>(name: K, data: Schema[K], entityId?: string) =>
    api.execute({ name, data, entityId, key: crypto.randomUUID() } as Command);
}
describe("audit regressions", () => {
  it("does not let the login response elevate the current actor", async () => {
    const api = new MockApi();
    const user = await api.login("cashier", "demo");
    user.role = "owner";
    await expect(
      sender(api)("SaveTariff", {
        tariff: { id: "ps5", name: "Tampered", hourlyRate: 1 },
      }),
    ).rejects.toThrow("прав");
  });
  it("does not retain caller-owned command data", async () => {
    const api = new MockApi();
    await api.login("owner", "demo");
    const product = {
      id: "cola",
      name: "Cola",
      category: "Напитки",
      salePrice: 18000,
      defaultCost: 10000,
      enabled: true,
    };
    await sender(api)("SaveProduct", { product });
    product.salePrice = 1;
    expect(
      (await api.load()).products.find((p) => p.id === "cola")!.salePrice,
    ).toBe(18000);
  });
  it("cannot restore reserved stock through an inventory adjustment", async () => {
    const api = new MockApi();
    await api.login("owner", "demo");
    const send = sender(api);
    await send("OpenShift", { openingCash: 0 });
    let w = await send("CreateAccount", {
      boothId: "b1",
      customerName: "",
      customerPhone: "",
    });
    const a = w.accounts[0];
    w = await send(
      "AddLine",
      { productId: "cola", quantity: 24, expectedVersion: a.version },
      a.id,
    );
    await expect(
      send("AdjustStock", {
        batchId: "lot1",
        remaining: 24,
        reason: "Инвентаризация",
      }),
    ).rejects.toThrow("поступлением");
    w = await send(
      "RemoveLine",
      {
        lineId: w.accounts[0].lines[0].id,
        reason: "Отмена",
        expectedVersion: w.accounts[0].version,
      },
      a.id,
    );
    expect(w.batches[0].remaining).toBe(24);
  });
  it("rejects missing or invalid report dates", async () => {
    const api = new MockApi();
    await api.login("owner", "demo");
    for (const [from, to] of [
      ["", ""],
      ["2026-02-30", "2026-03-01"],
      ["foo", "zzz"],
    ])
      await expect(api.getReport(from, to)).rejects.toThrow("дат");
  });
  it("does not overwrite committed state when a persistence callback mutates its argument", async () => {
    const api = new MockApi(undefined, (w) => {
      w.tariffs[0].hourlyRate = 1;
    });
    await api.login("owner", "demo");
    await sender(api)("OpenShift", { openingCash: 0 });
    expect((await api.load()).tariffs[0].hourlyRate).toBe(40000);
  });
});

it("keeps cash exact when valid credits and debits cancel near the integer limit", async () => {
  const api = new MockApi();
  await api.login("owner", "demo");
  const send = sender(api);
  await send("OpenShift", { openingCash: Number.MAX_SAFE_INTEGER });
  await send("AddExpense", {
    scope: "shift",
    amount: 2,
    methodId: "cash",
    category: "Прочие",
    reason: "Тест",
  });
  let w = await send("CreateAccount", {
    boothId: "b1",
    customerName: "",
    customerPhone: "",
  });
  const id = w.accounts[0].id;
  w = await send(
    "AddLine",
    { expectedVersion: 1, productId: "cola", quantity: 1 },
    id,
  );
  w = await send("Precheck", { expectedVersion: w.accounts[0].version }, id);
  w = await send(
    "AcceptPayment",
    {
      expectedVersion: w.accounts[0].version,
      methodId: "cash",
      amount: 2,
      transferId: "",
      confirmedByCashier: true,
    },
    id,
  );
  expect(w.shifts[0].expectedCash).toBe(Number.MAX_SAFE_INTEGER);
});
