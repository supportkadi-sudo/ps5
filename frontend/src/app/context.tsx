import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { PendingCommands, type PendingCommand } from "../shared/api/pending";
import { CommandRejected } from "../shared/api/errors";
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
  pending: PendingCommand | null;
  retry: () => Promise<boolean>;
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
  const commandLock = useRef(false);
  const requestEpoch = useRef(0);
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
    const refresh = () => {
      if (commandLock.current) return;
      const epoch = requestEpoch.current;
      return api
        .load()
        .then((x) => {
          if (active && epoch === requestEpoch.current && !commandLock.current)
            setW(x);
        })
        .catch((e) => {
          if (active && epoch === requestEpoch.current && !commandLock.current)
            setError(String(e.message));
        });
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const pendingStore = useRef(new PendingCommands(() => localStorage, user.id));
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const refreshPending = () => setPending(pendingStore.current.read());
  useEffect(() => {
    try {
      refreshPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранённой команды");
    }
  }, []);
  const execute = async (getCommand: () => Command) => {
    if (commandLock.current) return false;
    if (!navigator.onLine) {
      setError(
        "Нет сети. Оплаты и изменения заблокированы; сервер ничего не подтвердил.",
      );
      return false;
    }
    commandLock.current = true;
    requestEpoch.current++;
    setBusy(true);
    setError("");
    try {
      const command = getCommand();
      refreshPending();
      try {
        const result = await api.execute(command);
        pendingStore.current.complete(command.key);
        setW(result);
      } catch (e) {
        if (e instanceof CommandRejected)
          pendingStore.current.complete(command.key);
        throw e;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
      return false;
    } finally {
      try {
        refreshPending();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка сохранения команды");
      }
      commandLock.current = false;
      setBusy(false);
    }
  };
  const run: Run = (name, data, entityId) =>
    execute(() => pendingStore.current.prepare(name, data, entityId));
  const retry = () =>
    execute(() => {
      const p = pendingStore.current.read();
      if (!p) throw Error("Команда отсутствует");
      return p.command;
    });
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
        <Context.Provider
          value={{
            user: w.users.find((u) => u.id === user.id) ?? user,
            w,
            run,
            busy,
            online,
            logout,
            pending,
            retry,
          }}
        >
          {children}
        </Context.Provider>
      ) : (
        <div className="loading">Загрузка рабочего места…</div>
      )}
    </>
  );
}
