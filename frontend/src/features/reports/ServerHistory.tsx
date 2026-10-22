import { useEffect, useState } from "react";
import { useClub } from "../../app/context";
import { api } from "../../shared/api/client";
import type { HttpApi } from "../../shared/api/http";
import type { Schema, Account } from "../../shared/api/types";
import { AccountDetail } from "../accounts/AccountDetail";
import { date, money, actionNames } from "../../shared/lib/format";
export function useServerPage<K extends keyof Schema>(path: string, schema: K) {
  const [data, setData] = useState<Schema[K] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    (api as HttpApi)
      .request<Schema[K]>(
        path +
          (path.includes("?") ? "&" : "?") +
          new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) }),
        {},
        schema,
      )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, schema, cursor]);
  return { data, error, busy, next: setCursor, first: () => setCursor("") };
}
export function ServerAudit({ entityId = "" }: { entityId?: string }) {
  const { data, error, busy, next, first } = useServerPage(
    "/api/v1/audit" +
      (entityId ? "?entityId=" + encodeURIComponent(entityId) : ""),
    "AuditPage",
  );
  return (
    <section className="panel">
      <h2>Серверный аудит</h2>
      {error && <p role="alert">{error}</p>}
      {busy && <p>Загрузка…</p>}
      {data?.items.map((e) => (
        <details className="audit" key={e.id}>
          <summary>
            {actionNames[e.action] || e.action} · {e.actorName} · {date(e.at)}
          </summary>
          <p>{e.reason}</p>
          <pre>{e.before}</pre>
          <pre>{e.after}</pre>
        </details>
      ))}
      <button disabled={busy} onClick={first}>
        С начала
      </button>
      <button
        disabled={busy || !data?.nextCursor}
        onClick={() => next(data!.nextCursor ?? "")}
      >
        Следующая страница
      </button>
    </section>
  );
}
export function ServerAccounts() {
  const { data, error, busy, next, first } = useServerPage(
    "/api/v1/accounts",
    "AccountPage",
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [detailError, setDetailError] = useState("");
  async function open(id: string) {
    setDetailError("");
    try {
      setAccount(
        await (api as HttpApi).request<Account>(
          "/api/v1/accounts/" + encodeURIComponent(id),
          {},
          "Account",
        ),
      );
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Ошибка");
    }
  }
  return (
    <>
      <h1>История счетов</h1>
      <p>
        Страницы из PostgreSQL. Рабочее место содержит только последние счета.
      </p>
      {(error || detailError) && <p role="alert">{error || detailError}</p>}
      {data?.items.map((a) => (
        <button
          className="account-row"
          key={a.id}
          disabled={busy}
          onClick={() => void open(a.id)}
        >
          <span>
            #{a.id.slice(0, 8)} · {date(a.createdAt)} · {a.status}
          </span>
          <b>{money(a.total)}</b>
        </button>
      ))}
      <button onClick={first} disabled={busy}>
        С начала
      </button>
      <button
        disabled={busy || !data?.nextCursor}
        onClick={() => next(data!.nextCursor ?? "")}
      >
        Следующая страница
      </button>
      {account && (
        <AccountDetail
          account={account}
          onBack={() => setAccount(null)}
        />
      )}
    </>
  );
}
export function ServerBatches() {
  const { data, error, busy, next, first } = useServerPage(
    "/api/v1/inventory/batches",
    "BatchPage",
  );
  return (
    <section className="panel">
      <h2>Полный журнал партий</h2>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((b) => (
        <p key={b.id}>
          #{b.id.slice(0, 8)} · {date(b.receivedAt)} · остаток {b.remaining} /{" "}
          {b.quantity} · {money(b.unitCost)}
        </p>
      ))}
      <button disabled={busy} onClick={first}>
        С начала
      </button>
      <button
        disabled={busy || !data?.nextCursor}
        onClick={() => next(data!.nextCursor ?? "")}
      >
        Следующая страница
      </button>
    </section>
  );
}

export function ServerShiftHistory() {
  const shifts = useServerPage("/api/v1/shifts", "ShiftPage");
  const expenses = useServerPage("/api/v1/expenses", "ExpensePage");
  return (
    <>
      <section className="panel">
        <h2>Полный журнал смен</h2>
        {shifts.error && <p role="alert">{shifts.error}</p>}
        {shifts.data?.items.map((s) => (
          <p key={s.id}>
            {date(s.openedAt)} · кассир #{s.cashierId.slice(0, 8)} · ожидается{" "}
            {money(s.expectedCash)} · факт {money(s.actualCash)} · расхождение{" "}
            {money(s.difference)} · {s.reason}
          </p>
        ))}
        <button disabled={shifts.busy} onClick={shifts.first}>
          С начала
        </button>
        <button
          disabled={shifts.busy || !shifts.data?.nextCursor}
          onClick={() => shifts.next(shifts.data?.nextCursor ?? "")}
        >
          Следующая страница
        </button>
      </section>
      <section className="panel">
        <h2>Полный журнал расходов</h2>
        {expenses.error && <p role="alert">{expenses.error}</p>}
        {expenses.data?.items.map((e) => (
          <p key={e.id}>
            {date(e.createdAt)} · {e.category} · {money(e.amount)} · {e.reason}
          </p>
        ))}
        <button disabled={expenses.busy} onClick={expenses.first}>
          С начала
        </button>
        <button
          disabled={expenses.busy || !expenses.data?.nextCursor}
          onClick={() => expenses.next(expenses.data?.nextCursor ?? "")}
        >
          Следующая страница
        </button>
      </section>
    </>
  );
}
