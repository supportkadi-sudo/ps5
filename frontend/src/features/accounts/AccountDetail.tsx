import { P2PPanel } from "../payments/P2PPanel";
import { ServerAudit } from "../reports/ServerHistory";
import { isDemo } from "../../shared/api/client";
import { useState } from "react";
import { useClub } from "../../app/context";
import type { Account } from "../../shared/api/types";
import { Form, Panel } from "../../shared/ui/Form";
import { money, date, status, actionNames } from "../../shared/lib/format";
export function AccountDetail({
  account: a,
  onBack,
  backLabel = "← Все кабинки",
}: {
  account: Account;
  onBack: () => void;
  backLabel?: string;
}) {
  const { w, user, run, busy, online } = useClub();
  const [tab, setTab] = useState("bill"),
    [removing, setRemoving] = useState("");
  const locked = busy || !online,
    done = ["closed", "cancelled"].includes(a.status),
    version = { expectedVersion: a.version };
  const booth = w.booths.find((b) => b.id === a.boothId)!;
  return (
    <div className="detail">
      <button className="back" onClick={onBack}>
        {backLabel}
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">СЧЁТ #{a.id.slice(0, 6)}</span>
          <h1>{booth.name}</h1>
          <p>
            {booth.console} · {money(a.hourlyRate)}/час ·{" "}
            {a.customerName || "Гость"}
          </p>
        </div>
        <span className={"badge " + a.status}>{status[a.status]}</span>
      </div>
      <div className="tabs">
        {[
          ["bill", "Состав счёта"],
          ["payments", "Оплата"],
          ["history", "История"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "payments" && a.payments.length > 0
              ? " · " + a.payments.length
              : ""}
          </button>
        ))}
      </div>
      <div className="account-grid">
        <div>
          {tab === "bill" && (
            <>
              <Panel title="Игровое время">
                <div className="timer">
                  {elapsed(a)} <small>мин</small>
                </div>
                <p className="muted">
                  {a.status === "playing"
                    ? "Таймер работает независимо от открытого экрана"
                    : "Таймер остановлен"}{" "}
                  · начислено {money(a.gameAmount)}
                </p>
                <div className="actions">
                  {a.status === "draft" && (
                    <button
                      disabled={locked}
                      className="primary mobile-action"
                      onClick={() => run("StartTimer", version, a.id)}
                    >
                      ▶ Запустить таймер
                    </button>
                  )}
                  {["playing", "draft"].includes(a.status) && (
                    <button
                      disabled={locked}
                      className={
                        a.status === "playing" ? "mobile-action primary" : ""
                      }
                      onClick={() => run("Precheck", version, a.id)}
                    >
                      Предчек · остановить время
                    </button>
                  )}
                  {a.status === "awaiting_payment" && (
                    <>
                      <button
                        disabled={locked}
                        onClick={() => run("ResumeTimer", version, a.id)}
                      >
                        ▶ Возобновить игру
                      </button>
                      <button onClick={() => window.print()}>
                        Распечатать предчек
                      </button>
                    </>
                  )}
                </div>
              </Panel>
              <Panel title="Товары в счёте">
                {a.lines.length === 0 && (
                  <p className="empty">
                    Пока только игра. Добавьте напитки или снеки.
                  </p>
                )}
                {a.lines.map((l) => (
                  <div
                    className={"line " + (l.removed ? "removed" : "")}
                    key={l.id}
                  >
                    <div>
                      <strong>{l.name}</strong>
                      <small>
                        {l.quantity} × {money(l.unitPrice)}
                        {l.removed ? " · Удалено: " + l.removalReason : ""}
                      </small>
                    </div>
                    <b>{money(l.quantity * l.unitPrice)}</b>
                    {!done && !l.removed && !a.paid && (
                      <button
                        className="danger ghost"
                        aria-label={"Удалить " + l.name}
                        onClick={() => setRemoving(l.id)}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                ))}
                {removing && (
                  <Form
                    fields={[{ name: "reason", label: "Причина удаления" }]}
                    label="Удалить и вернуть на склад"
                    submit={async (d) => {
                      const ok = await run(
                        "RemoveLine",
                        { ...version, lineId: removing, reason: d.reason },
                        a.id,
                      );
                      if (ok) setRemoving("");
                      return ok;
                    }}
                  />
                )}
                {!done && !a.paid && (
                  <div className="product-grid">
                    {w.products
                      .filter((p) => p.enabled)
                      .map((p) => {
                        const available = !isDemo
                          ? (p.availableStock ?? 0)
                          : w.batches
                              .filter((b) => b.productId === p.id)
                              .reduce((n, b) => n + b.remaining, 0);
                        return (
                          <button
                            disabled={locked || available === 0}
                            className="product"
                            aria-label={`Добавить ${p.name} за ${money(p.salePrice)}`}
                            key={p.id}
                            onClick={() =>
                              run(
                                "AddLine",
                                { ...version, productId: p.id, quantity: 1 },
                                a.id,
                              )
                            }
                          >
                            <span className="product-icon">
                              {p.category === "Напитки"
                                ? "◒"
                                : p.category === "Снеки"
                                  ? "▧"
                                  : "☕"}
                            </span>
                            <strong>{p.name}</strong>
                            <small>{available} в наличии</small>
                            <b>+ {money(p.salePrice)}</b>
                          </button>
                        );
                      })}
                  </div>
                )}
              </Panel>
            </>
          )}
          {tab === "payments" && (
            <Panel title="Принять оплату">
              <p className="notice">
                Оплата и закрытие — отдельные действия. Предчек не подтверждает
                получение денег.
              </p>
              {a.payments.map((p) => (
                <div className="line" key={p.id}>
                  <div>
                    <strong>
                      {w.methods.find((m) => m.id === p.methodId)?.name}
                    </strong>
                    <small>
                      {date(p.createdAt)} ·{" "}
                      {w.users.find((u) => u.id === p.actorId)?.name}
                    </small>
                  </div>
                  <b>{money(p.amount)}</b>
                </div>
              ))}
              {a.status === "awaiting_payment" && a.due > 0 ? (
                <PaymentForm key={a.version} a={a} />
              ) : a.status === "playing" || a.status === "draft" ? (
                <p className="empty">Для оплаты сначала сформируйте предчек.</p>
              ) : null}
              {a.status === "awaiting_payment" && a.due === 0 && (
                <button
                  className="primary wide mobile-action"
                  disabled={locked}
                  onClick={() => run("CloseAccount", version, a.id)}
                >
                  Подтверждаю полную оплату · закрыть счёт
                </button>
              )}
              {!isDemo && <P2PPanel a={a} />}
              {isDemo && (
                <details className="p2p-panel">
                  <summary>P2P уведомления · {w.transfers.length}</summary>
                  <p className="muted">
                    Демонстрационные уведомления. Реальный банковский источник
                    здесь не используется.
                  </p>
                  {w.transfers.map((t) => (
                    <div className="line" key={t.id}>
                      <div>
                        <strong>{money(t.amount)}</strong>
                        <small>
                          {t.source} · {date(t.receivedAt)}
                        </small>
                      </div>
                      <span className="badge">
                        {t.accountId
                          ? "Уже связан"
                          : t.status === "verified_fixture"
                            ? "Тест: доступен"
                            : t.status === "ambiguous"
                              ? "Ручная проверка"
                              : "Не подтверждён"}
                      </span>
                    </div>
                  ))}
                </details>
              )}
            </Panel>
          )}
          {tab === "history" && !isDemo && user.role !== "cashier" && (
            <ServerAudit entityId={a.id} />
          )}
          {tab === "history" && !isDemo && a.refund && (
            <p className="notice">
              Возврат: {money(a.refund.amount)} · {a.refund.reason} ·{" "}
              {date(a.refund.createdAt)} · возврат товара:{" "}
              {a.refund.restockGoods ? "да" : "нет"}
            </p>
          )}
          {tab === "history" &&
            !isDemo &&
            a.refund?.reversals.map((r) => (
              <p key={r.paymentId}>
                Возврат {money(r.amount)} ·{" "}
                {w.methods.find((m) => m.id === r.methodId)?.name} · исходная
                оплата #{r.paymentId.slice(0, 8)}
              </p>
            ))}
          {tab === "history" && !isDemo && (
            <Panel title="Игровые отрезки">
              {a.segments.map((segment, i) => (
                <p key={i}>
                  {date(segment.startedAt)} →{" "}
                  {segment.stoppedAt
                    ? date(segment.stoppedAt)
                    : "Игра продолжается"}
                </p>
              ))}
              <p>Кассовая смена #{a.shiftId.slice(0, 8)}</p>
            </Panel>
          )}
          {tab === "history" && isDemo && (
            <Panel title="История счёта">
              {w.audit
                .filter((e) => e.entityId === a.id)
                .slice()
                .reverse()
                .map((e) => (
                  <details key={e.id} className="audit">
                    <summary>
                      <strong>{actionNames[e.action] || e.action}</strong>
                      <small>
                        {e.actorName} · {date(e.at)}
                      </small>
                    </summary>
                    <p>{e.reason || "Причина не требуется"}</p>
                    <details>
                      <summary>Значения до / после</summary>
                      <pre>{e.before}</pre>
                      <pre>{e.after}</pre>
                    </details>
                  </details>
                ))}
            </Panel>
          )}
        </div>
        <aside>
          <Panel title="Итого к оплате">
            <div className="total">{money(a.total)}</div>
            <p className="muted">Округлено до ближайших 500 сум</p>
            <div className="line">
              <span>Принято</span>
              <b>{money(a.paid)}</b>
            </div>
            <div className="line">
              <span>Осталось</span>
              <b>{money(a.due)}</b>
            </div>
            <p className="notice">
              {done
                ? "Счёт завершён. История сохранена."
                : "Счёт остаётся открытым до подтверждения кассиром."}
            </p>
            {tab !== "payments" && !done && a.status === "awaiting_payment" && (
              <button
                className="primary wide"
                onClick={() => setTab("payments")}
              >
                Перейти к оплате →
              </button>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
function PaymentForm({ a }: { a: Account }) {
  const { w, run } = useClub();
  const [method, setMethod] = useState(
    w.methods.find((m) => m.enabled && (isDemo || m.kind !== "p2p"))?.id ?? "",
  );
  const p2p = w.methods.find((m) => m.id === method)?.kind === "p2p";
  return (
    <form
      className="form payment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        await run(
          "AcceptPayment",
          {
            expectedVersion: a.version,
            methodId: method,
            amount: Number(d.get("amount")),
            transferId: p2p ? String(d.get("transferId")) : "",
            confirmedByCashier: true,
          },
          a.id,
        );
      }}
    >
      <div className="field">
        <span>Способ оплаты</span>
        <span
          className="payment-methods"
          role="group"
          aria-label="Способ оплаты"
        >
          {w.methods
            .filter((m) => m.enabled && (isDemo || m.kind !== "p2p"))
            .map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={method === m.id}
                className={method === m.id ? "selected" : ""}
                onClick={() => setMethod(m.id)}
              >
                {m.name}
              </button>
            ))}
        </span>
      </div>
      <label>
        Сумма части, UZS
        <input
          name="amount"
          type="number"
          min="1"
          max={a.due}
          step="1"
          defaultValue={a.due}
          required
        />
      </label>
      {p2p && (
        <label>
          Связать тестовый перевод
          <select name="transferId" required>
            <option value="">Выберите уведомление</option>
            {w.transfers
              .filter((t) => !t.accountId && t.status === "verified_fixture")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {money(t.amount)} · {t.id}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="checkbox">
        <input type="checkbox" required />
        Подтверждаю получение этой части оплаты
        {p2p ? " (тестовый сценарий)" : ""}
      </label>
      <button className="primary">
        Принять {p2p ? "тестовую " : ""}оплату
      </button>
    </form>
  );
}
export function elapsed(a: Account) {
  return Math.floor(
    a.segments.reduce(
      (n, s) =>
        n +
        Math.max(
          0,
          ((s.stoppedAt ? Date.parse(s.stoppedAt) : Date.now()) -
            Date.parse(s.startedAt)) /
            1000,
        ),
      0,
    ) / 60,
  );
}
