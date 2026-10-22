import { useRef, useState } from "react";
import { useClub } from "../../app/context";
import { api } from "../../shared/api/client";
import { HttpApi } from "../../shared/api/http";
import { CommandRejected } from "../../shared/api/errors";
import { Editor } from "../../shared/ui/Editor";
import { Panel } from "../../shared/ui/Form";
import type { Schema } from "../../shared/api/types";
// Credentials stay in component memory only. An ambiguous request can only retry
// the original UUID and body; editing is blocked until its outcome is known.
function useAdminRequest() {
  const { refresh } = useClub();
  const pending = useRef<{ path: string; key: string; data: unknown } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(path: string, data: unknown) {
    if (busy) return false;
    if (!pending.current)
      pending.current = {
        path,
        data: structuredClone(data),
        key: crypto.randomUUID(),
      };
    setBusy(true);
    setError("");
    try {
      const p = pending.current;
      await (api as HttpApi).request(
        p.path,
        {
          method: "POST",
          headers: { "Idempotency-Key": p.key },
          body: JSON.stringify(p.data),
        },
        "CommandResult",
      );
      pending.current = null;
      await refresh();
      return true;
    } catch (e) {
      if (e instanceof CommandRejected) pending.current = null;
      setError(e instanceof Error ? e.message : "Ошибка запроса");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, error, unresolved: !!pending.current };
}
export function LiveEmployees() {
  const { w, user } = useClub();
  const [editing, setEditing] = useState<string | null>(null);
  const person = w.users.find((u) => u.id === editing);
  const { send, error, busy, unresolved } = useAdminRequest();
  return (
    <Panel title="Персональные сотрудники">
      {error && <p role="alert">{error}</p>}
      {unresolved && (
        <p className="notice">
          Результат не подтверждён. Повторите сохранённый запрос кнопкой
          «Сохранить». Введённые изменения не заменят исходный запрос. Не
          закрывайте экран.
        </p>
      )}
      {w.users
        .filter((u) => user.role === "owner" || u.role === "cashier")
        .map((u) => (
          <div className="line" key={u.id}>
            <span>
              {u.name} · {u.role} · {u.isActive ? "Активен" : "Отключён"}
            </span>
            <button
              disabled={busy || unresolved}
              onClick={() => setEditing(u.id)}
            >
              Изменить
            </button>
          </div>
        ))}
      <button disabled={busy || unresolved} onClick={() => setEditing("")}>
        + Новый сотрудник
      </button>
      {editing !== null && (
        <Editor
          title="Сотрудник"
          onClose={() => {
            if (!unresolved && !busy) setEditing(null);
          }}
          fields={[
            { name: "name", label: "Имя", value: person?.name },
            ...(!person
              ? [
                  { name: "username", label: "Логин" },
                  {
                    name: "password",
                    label: "Первый пароль",
                    type: "password" as const,
                  },
                ]
              : []),
            {
              name: "role",
              label: "Роль",
              value: person?.role ?? "cashier",
              options: (user.role === "owner"
                ? ["owner", "manager", "cashier"]
                : ["cashier"]
              ).map((value) => ({ value, label: value })),
            },
            {
              name: "active",
              label: "Доступ",
              value: String(person?.isActive ?? true),
              options: [
                { value: "true", label: "Активен" },
                { value: "false", label: "Отключён" },
              ],
            },
            { name: "reason", label: "Причина" },
          ]}
          submit={async (d) => {
            const data: Schema["SaveEmployee"] = {
              user: {
                id: person?.id ?? "",
                name: d.name,
                role: d.role as "owner" | "manager" | "cashier",
                isActive: d.active === "true",
              },
              expectedVersion: person?.version ?? 0,
              reason: d.reason,
              ...(!person
                ? { username: d.username, password: d.password }
                : {}),
            };
            const ok = await send("/api/v1/access/users", data);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
    </Panel>
  );
}
export function LiveReviews() {
  const { w } = useClub();
  const [editing, setEditing] = useState<string | null>(null);
  const review = w.reviews.find((r) => r.id === editing);
  const { send, error, busy, unresolved } = useAdminRequest();
  return (
    <Panel title="Отзывы и QR">
      {error && <p role="alert">{error}</p>}
      {unresolved && (
        <p>
          Повтор сохранит исходное тело и UUID. Не закрывайте экран до
          подтверждения.
        </p>
      )}
      {w.reviews.map((r) => (
        <div className="line" key={r.id}>
          <span>
            {r.name} · {r.enabled ? "Активна" : "Отключена"}
          </span>
          {r.enabled && (
            <img
              width="160"
              height="160"
              src={`/api/v1/settings/review-links/${r.id}/qr`}
              alt={`QR ${r.name}`}
            />
          )}
          <button
            disabled={busy || unresolved}
            onClick={() => setEditing(r.id)}
          >
            Изменить
          </button>
        </div>
      ))}
      <button disabled={busy || unresolved} onClick={() => setEditing("")}>
        + Добавить ссылку
      </button>
      {editing !== null && (
        <Editor
          title="Ссылка на отзывы"
          onClose={() => {
            if (!busy && !unresolved) setEditing(null);
          }}
          fields={[
            { name: "name", label: "Название", value: review?.name },
            {
              name: "url",
              label: "HTTPS ссылка",
              type: "url",
              value: review?.url,
            },
            {
              name: "enabled",
              label: "Статус",
              value: String(review?.enabled ?? true),
              options: [
                { value: "true", label: "Активна" },
                { value: "false", label: "Отключена" },
              ],
            },
            { name: "reason", label: "Причина" },
          ]}
          submit={async (d) => {
            const data: Schema["SaveReviewLink"] = {
              review: {
                id: review?.id ?? "",
                name: d.name,
                url: d.url,
                enabled: d.enabled === "true",
              },
              expectedVersion: review?.version ?? 0,
              reason: d.reason,
            };
            const ok = await send("/api/v1/settings/review-links", data);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}
    </Panel>
  );
}
