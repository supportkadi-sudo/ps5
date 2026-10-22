import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { api } from "../shared/api/client";
import type {
  User,
  Workspace,
  Command,
  CommandName,
  Schema,
} from "../shared/api/types";
type Run = <K extends CommandName>(
  name: K,
  data: Schema[K],
  entityId?: string,
) => Promise<boolean>;
type State = {
  user: User;
  w: Workspace;
  run: Run;
  busy: boolean;
  online: boolean;
  logout: () => void;
};
const Context = createContext<State | null>(null);
export const useClub = () => {
  const x = useContext(Context);
  if (!x) throw Error("Нет контекста CRM");
  return x;
};
export function ClubProvider({
  user,
  logout,
  children,
}: {
  user: User;
  logout: () => void;
  children: ReactNode;
}) {
  const [w, setW] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api
        .load()
        .then((x) => {
          if (active) setW(x);
        })
        .catch((e) => {
          if (active) setError(String(e.message));
        });
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const commandLock = useRef(false);
  const pending = useRef<{ signature: string; command: Command } | null>(null);
  const run: Run = async (name, data, entityId) => {
    if (commandLock.current) return false;
    if (!navigator.onLine) {
      setError(
        "Нет сети. Оплаты и изменения заблокированы; сервер ничего не подтвердил.",
      );
      return false;
    }
    commandLock.current = true;
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify({ name, data, entityId });
      const command =
        pending.current?.signature === signature
          ? pending.current.command
          : ({ name, data, entityId, key: crypto.randomUUID() } as Command);
      pending.current = { signature, command };
      setW(await api.execute(command));
      pending.current = null;
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
      return false;
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Закрыть ошибку">
            ×
          </button>
        </div>
      )}
      {w ? (
        <Context.Provider value={{ user, w, run, busy, online, logout }}>
          {children}
        </Context.Provider>
      ) : (
        <div className="loading">Загрузка рабочего места…</div>
      )}
    </>
  );
}
