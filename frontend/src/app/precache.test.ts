import { it, expect } from "vitest";
import { shellVersion } from "../../tooling/precache";
it("versions content of every precached resource, independent of ordering", () => {
  const resources = [
    "/",
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/assets/app.js",
    "/assets/app.css",
  ].map((url) => ({ url, content: Buffer.from(url) }));
  const version = shellVersion(resources);
  expect(shellVersion([...resources].reverse())).toBe(version);
  for (let i = 0; i < resources.length; i++) {
    const changed = resources.map((r, j) =>
      j === i ? { ...r, content: Buffer.from("changed") } : r,
    );
    expect(shellVersion(changed), resources[i].url).not.toBe(version);
  }
  expect(shellVersion(resources.slice(1))).not.toBe(version);
});
