import { MockApi, type CommandRecords } from "./mock/client";
import { seed } from "./mock/seed";
import { assertSchema } from "./validation";
import type { ClubApi, Command, Workspace } from "./types";
const storageKey = "club-crm-demo-v1";
// Lazy reads make storage denial/corruption a recoverable login error, not a blank app.
export function createDemoApi(
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
): ClubApi {
  let instance: MockApi | undefined;
  let lastRaw: string | null = null;
  const storageError = () =>
    Error(
      "Демо-хранилище недоступно или повреждено. Исходные записи не изменены. Проверьте доступ к хранилищу браузера.",
    );
  function read() {
    try {
      return getStorage().getItem(storageKey);
    } catch {
      throw storageError();
    }
  }
  function current() {
    if (!instance) {
      const raw = read();
      let state: Workspace;
      let records: CommandRecords = {};
      try {
        const parsed = raw === null ? seed() : JSON.parse(raw);
        const workspace = parsed?.version === 1 ? parsed.workspace : parsed;
        // Only derived report data changed; preserve the financial history of old demos.
        if (workspace?.report && workspace.report.productSales === undefined)
          workspace.report.productSales = [];
        assertSchema("Workspace", workspace);
        state = workspace;
        if (parsed?.version === 1) {
          records = parsed.records;
          if (!records || typeof records !== "object" || Array.isArray(records))
            throw Error();
          for (const record of Object.values(records)) {
            if (typeof record.body !== "string") throw Error();
            assertSchema("Workspace", record.result);
          }
        }
      } catch {
        throw storageError();
      }
      lastRaw = raw;
      instance = new MockApi(
        state,
        (next, records) => {
          if (read() !== lastRaw)
            throw Error(
              "Демо-данные изменены в другой вкладке. Перезагрузите страницу перед продолжением.",
            );
          const serialized = JSON.stringify({
            version: 1,
            workspace: next,
            records,
          });
          try {
            getStorage().setItem(storageKey, serialized);
          } catch {
            throw storageError();
          }
          lastRaw = serialized;
        },
        records,
      );
    } else if (read() !== lastRaw)
      throw Error(
        "Демо-данные изменены в другой вкладке. Перезагрузите страницу перед продолжением.",
      );
    return instance;
  }
  return {
    async login(u, p) {
      return current().login(u, p);
    },
    async logout() {
      await instance?.logout();
    },
    async load() {
      return current().load();
    },
    async getReport(from, to) {
      return current().getReport(from, to);
    },
    async execute(c: Command) {
      return current().execute(c);
    },
  };
}
