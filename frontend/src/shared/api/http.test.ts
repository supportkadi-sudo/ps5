import { afterEach, it, expect, vi } from "vitest";
import { HttpApi } from "./http";
import { seed } from "./mock/seed";
afterEach(() => vi.unstubAllGlobals());
it("turns a non-JSON gateway failure into an understandable error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>bad gateway</html>", { status: 502 }),
      ),
  );
  await expect(new HttpApi().load()).rejects.toThrow("HTTP 502");
});
it("rejects a malformed successful workspace response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ success: true })),
  );
  await expect(new HttpApi().load()).rejects.toThrow("Некорректные данные");
});
it("sends the same command key and encoded entity id when retrying", async () => {
  const workspace = seed();
  workspace.users = [workspace.users.find((u) => u.role === "cashier")!];
  const fetch = vi
    .fn()
    .mockImplementation((path: string, init?: RequestInit) =>
      Promise.resolve(
        Response.json(
          init?.method === "POST"
            ? { entityId: "one/two", operation: "Precheck", version: 2 }
            : workspace,
        ),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new HttpApi(),
    key = crypto.randomUUID(),
    c = {
      name: "Precheck" as const,
      key,
      entityId: "one/two",
      data: { expectedVersion: 1 },
    };
  await api.execute(c);
  await api.execute(c);
  expect(fetch.mock.calls[0][0]).toBe("/api/v1/accounts/one%2Ftwo/precheck");
  expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(key);
  expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe(key);
});
it("keeps conflicts, gateway errors and malformed acknowledgements ambiguous", async () => {
  const { CommandRejected } = await import("./errors");
  const command = {
    name: "OpenShift" as const,
    key: crypto.randomUUID(),
    data: { openingCash: 0 },
  };
  for (const status of [409, 500]) {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "conflict", message: "Проверка", fieldErrors: {} },
            { status },
          ),
        ),
    );
    await expect(new HttpApi().execute(command)).rejects.not.toBeInstanceOf(
      CommandRejected,
    );
  }
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  await expect(new HttpApi().execute(command)).rejects.toThrow();
});
it("distinguishes a validated definite rejection from uncertain errors", async () => {
  const { CommandRejected } = await import("./errors");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "validation", message: "Отклонено", fieldErrors: {} },
          { status: 422 },
        ),
      ),
  );
  await expect(
    new HttpApi().execute({
      name: "OpenShift",
      key: crypto.randomUUID(),
      data: { openingCash: 0 },
    }),
  ).rejects.toBeInstanceOf(CommandRejected);
});
