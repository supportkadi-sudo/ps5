import { createHash } from "node:crypto";
export function shellVersion(
  resources: { url: string; content: Uint8Array }[],
) {
  const revisions = [...resources]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((r) => [r.url, createHash("sha256").update(r.content).digest("hex")]);
  return createHash("sha256").update(JSON.stringify(revisions)).digest("hex");
}
