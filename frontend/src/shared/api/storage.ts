import { MockApi } from "./mock/client";
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
      try {
        const parsed: unknown = raw === null ? seed() : JSON.parse(raw);
        assertSchema("Workspace", parsed);
        state = parsed;
      } catch {
        throw storageError();
      }
      lastRaw = raw;
      instance = new MockApi(state, (next) => {
        if (read() !== lastRaw)
          throw Error(
            "Демо-данные изменены в другой вкладке. Перезагрузите страницу перед продолжением.",
          );
        const serialized = JSON.stringify(next);
        try {
          getStorage().setItem(storageKey, serialized);
        } catch {
          throw storageError();
        }
        lastRaw = serialized;
      });
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
