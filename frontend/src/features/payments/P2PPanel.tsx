import { useState } from "react";
import { useClub } from "../../app/context";
import type { Account } from "../../shared/api/types";
import { date, money } from "../../shared/lib/format";

export function P2PSources() {
  const { w } = useClub();
  return (
    <p className="notice">
      {["uzcard", "humo"].map((source) => (
        <span key={source}>
          {source === "uzcard" ? "Uzcard" : "Humo"}:{" "}
          {w.p2pSources?.find((s) => s.source === source)?.configured
            ? "настроен · связь с Telegram требует проверки"
            : "источник не подключён"}
          .{" "}
        </span>
      ))}
    </p>
  );
}

export function P2PPanel({ a }: { a: Account }) {
  const { w, run, busy, pending, online, refresh } = useClub();
  const [methodId, setMethodId] = useState("");
  const [error, setError] = useState("");
  const locked = busy || !!pending || !online;
  const methods = w.methods.filter(
    (m) =>
      m.enabled &&
      m.kind === "p2p" &&
      m.p2pSource &&
      m.cardLast4 &&
      w.p2pSources?.some((s) => s.source === m.p2pSource && s.configured),
  );
  return (
    <section className="p2p-panel" aria-label="Банковские переводы">
      <h3>P2P уведомления · {w.transfers.length}</h3>
      <P2PSources />
      <p className="muted">
        Доверенный источник означает только отправителя. Оплату подтверждает
        кассир; закрытие счёта выполняется отдельно.
      </p>
      <button
        disabled={locked}
        onClick={() => {
          setError("");
          void refresh().catch(() =>
            setError("Не удалось обновить уведомления"),
          );
        }}
      >
        Обновить переводы
      </button>
      {error && <p role="alert">{error}</p>}
      {a.status === "awaiting_payment" && a.due > 0 && methods.length > 0 && (
        <form
          key={a.version}
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            await run(
              "ExpectTransfer",
              {
                expectedVersion: a.version,
                methodId,
                amount: Number(d.get("expectedAmount")),
              },
              a.id,
            );
          }}
        >
          <label>
            Карта для перевода
            <select
              name="expectedMethodId"
              required
              value={methodId}
              onChange={(e) => setMethodId(e.target.value)}
            >
              <option value="">Выберите карту</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · ****{m.cardLast4}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ожидаемая часть, UZS
            <input
              name="expectedAmount"
              type="number"
              min="1"
              max={a.due}
              step="1"
              defaultValue={a.due}
              required
            />
          </label>
          <button disabled={locked || !methodId}>Ожидать перевод</button>
        </form>
      )}
      {a.expectedTransfer && (
        <p className="notice">
          Ожидается {money(a.expectedTransfer.amount)} ·{" "}
          {a.expectedTransfer.source} · ****{a.expectedTransfer.cardLast4} · до{" "}
          {date(a.expectedTransfer.expiresAt)}
        </p>
      )}
      {w.transfers.map((t) => (
        <div className="line" key={t.id}>
          <div>
            <strong>{money(t.amount)}</strong>
            <small>
              {t.source} · ****{t.cardLast4 || "????"} · {date(t.receivedAt)}
            </small>
            <span className="badge">
              {t.accountId
                ? "Оплата принята кассиром"
                : t.processingStatus === "found"
                  ? "Перевод найден"
                  : t.processingStatus === "unmatched"
                    ? "Не сопоставлен"
                    : "Ручная проверка"}
            </span>
          </div>
          {!t.accountId &&
            t.processingStatus === "found" &&
            t.candidateAccountId === a.id &&
            a.status === "awaiting_payment" && (
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  run(
                    "AcceptPayment",
                    {
                      expectedVersion: a.version,
                      methodId: t.candidateMethodId!,
                      amount: Number(t.amount),
                      transferId: t.id,
                      confirmedByCashier: true,
                    },
                    a.id,
                  )
                }
              >
                Подтвердить оплату
              </button>
            )}
        </div>
      ))}
    </section>
  );
}
