import { it, expect, vi } from "vitest";
import { RemotePendingCommands } from "./remote-pending";
import { HttpApi } from "./http";
it("stages a durable command before execution and recovers the exact server copy", async () => {
  const api = new HttpApi();
  let stored: unknown = null;
  const request = vi
    .spyOn(api, "request")
    .mockImplementation(async (_path, init) => {
      if (!init?.method) return { pending: stored };
      const body = JSON.parse(init.body as string);
      if (body.command) stored = { actorId: "actor", command: body.command };
      else stored = null;
      return {};
    });
  const store = new RemotePendingCommands(api, "actor");
  const first = await store.prepare("AddExpense", {
    scope: "shift",
    amount: 1000,
    methodId: "cash",
    category: "test",
    reason: "test",
  });
  const fresh = new RemotePendingCommands(api, "actor");
  expect((await fresh.read())?.command).toEqual(first);
  await expect(
    fresh.prepare("OpenShift", { openingCash: 0 }),
  ).rejects.toThrow();
  await fresh.complete(first.key);
  expect(await fresh.read()).toBeNull();
  expect(request).toHaveBeenCalled();
});
