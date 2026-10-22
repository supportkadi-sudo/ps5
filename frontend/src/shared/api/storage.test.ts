import { describe, it, expect } from "vitest";
import { createDemoApi } from "./storage";
import { seed } from "./mock/seed";
function fixture(raw: string | null = null) {
  let saved = raw;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  return { api: createDemoApi(() => storage), storage, raw: () => saved };
}
describe("demo storage boundary", () => {
  for (const raw of [
    "broken JSON",
    "null",
    "{}",
    JSON.stringify({
      ...seed(),
      users: [{ id: "owner", name: "Owner", role: "root" }],
    }),
  ])
    it(
      "rejects corrupt state without overwriting it: " + raw.slice(0, 15),
      async () => {
        const f = fixture(raw);
        await expect(f.api.login("owner", "demo")).rejects.toThrow(
          "повреждено",
        );
        expect(f.raw()).toBe(raw);
      },
    );
  it("reports blocked browser storage through login rather than import failure", async () => {
    const api = createDemoApi(() => {
      throw Error("SecurityError");
    });
    await expect(api.login("owner", "demo")).rejects.toThrow("хранилище");
  });
  it("does not commit when quota fails", async () => {
    const f = fixture();
    await f.api.login("owner", "demo");
    f.storage.setItem = () => {
      throw Error("QuotaExceeded");
    };
    await expect(
      f.api.execute({
        name: "OpenShift",
        key: crypto.randomUUID(),
        data: { openingCash: 100 },
      }),
    ).rejects.toThrow("хранилище");
    expect((await f.api.load()).shifts).toHaveLength(0);
    expect(f.raw()).toBe(null);
  });
  it("blocks stale-tab overwrites", async () => {
    const f = fixture();
    const second = createDemoApi(() => f.storage);
    await f.api.login("owner", "demo");
    await second.login("owner", "demo");
    await f.api.execute({
      name: "OpenShift",
      key: crypto.randomUUID(),
      data: { openingCash: 100 },
    });
    const raw = f.raw();
    await expect(
      second.execute({
        name: "OpenShift",
        key: crypto.randomUUID(),
        data: { openingCash: 0 },
      }),
    ).rejects.toThrow("другой вкладке");
    expect(f.raw()).toBe(raw);
  });
});
