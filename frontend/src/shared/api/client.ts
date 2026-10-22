import { MockApi } from "./mock/client";
import { seed } from "./mock/seed";
import type { Workspace } from "./types";
const storageKey = "club-crm-demo-v1";
function restore(): Workspace {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return seed();
  try {
    return JSON.parse(raw) as Workspace;
  } catch (error) {
    console.error("Не удалось прочитать демо-состояние", error);
    return seed();
  }
}
export const api = new MockApi(restore(), (w) =>
  localStorage.setItem(storageKey, JSON.stringify(w)),
);
