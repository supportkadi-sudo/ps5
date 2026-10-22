import { it, expect } from "vitest";
import { PendingCommands } from "./pending";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
it("restores exact unresolved command after a new store instance and blocks replacement", () => {
  const s = storage();
  const first = new PendingCommands(() => s, "owner");
  const command = first.prepare("AddExpense", {
    scope: "club",
    amount: 15000,
    category: "Прочие",
    methodId: "cash",
    reason: "Тест",
  });
  const restored = new PendingCommands(() => s, "owner");
  expect(restored.read()!.command).toEqual(command);
  expect(() => restored.prepare("OpenShift", { openingCash: 0 })).toThrow(
    "неразрешённая",
  );
  expect(restored.read()!.command.key).toBe(command.key);
  expect(new PendingCommands(() => s, "cashier").read()).toBeNull();
  restored.complete(command.key);
  expect(restored.read()).toBeNull();
});
it("does not send if persistence fails and does not erase corrupt pending data", () => {
  const s = storage();
  const pending = new PendingCommands(() => s, "owner");
  s.setItem("club-command-v1:owner", "broken");
  expect(() => pending.read()).toThrow("запись");
  expect(s.getItem("club-command-v1:owner")).toBe("broken");
  expect(() =>
    new PendingCommands(
      () => ({
        ...s,
        setItem: () => {
          throw Error("quota");
        },
      }),
      "cashier",
    ).prepare("OpenShift", { openingCash: 0 }),
  ).toThrow();
});
