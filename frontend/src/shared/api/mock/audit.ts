import type { Workspace } from "../types";
// Snapshot only the changed aggregate, never recursively copy the journal.
export function snapshot(w: Workspace, id: string): string {
  const account = w.accounts.find((a) => a.id === id);
  if (account) {
    const ids = new Set(
      account.lines.flatMap((l) => l.allocations.map((x) => x.batchId)),
    );
    return JSON.stringify({
      account,
      batches: w.batches.filter((b) => ids.has(b.id)),
    });
  }
  for (const list of [
    w.products,
    w.batches,
    w.booths,
    w.tariffs,
    w.methods,
    w.reviews,
    w.users,
    w.shifts,
    w.expenses,
  ]) {
    const entity = list.find((x) => x.id === id);
    if (entity) return JSON.stringify(entity);
  }
  return "null";
}
