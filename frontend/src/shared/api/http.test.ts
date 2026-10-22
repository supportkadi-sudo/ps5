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
  const fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(Response.json(seed())));
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
  expect(fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
});
