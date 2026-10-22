import { useState, useEffect } from "react";
import { api } from "../../shared/api/client";
import type { Schema } from "../../shared/api/types";
import { useClub } from "../../app/context";
import { Form, Panel } from "../../shared/ui/Form";
import { money, date, actionNames } from "../../shared/lib/format";
export function ReportsPage() {
  const { w, run } = useClub();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [r, setReport] = useState<Schema["Report"] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    api
      .getReport(from, to)
      .then((report) => {
        if (active) setReport(report);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [from, to, w.serverTime]);
  const inPeriod = (stamp: string) => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(stamp));
    return key >= from && key <= to;
  };
  const closed = w.accounts.filter(
    (a) => a.status === "closed" && inPeriod(a.closedAt),
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ФИНАНСЫ КЛУБА</span>
          <h1>Отчёты</h1>
          <p>Период по времени клуба · выручка только по закрытым счетам</p>
        </div>
      </div>
      <div className="report-filters">
        <label>
          С даты
          <input
            aria-label="С даты"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          По дату
          <input
            aria-label="По дату"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !r ? (
        <p>Загрузка отчёта…</p>
      ) : (
        <>
          <div className="stats">
            <div>
              <span>Выручка</span>
              <strong>{money(r.revenue)}</strong>
            </div>
            <div>
              <span>FIFO-себестоимость</span>
              <strong>{money(r.costOfGoods)}</strong>
            </div>
            <div>
              <span>Валовая прибыль</span>
              <strong>{money(r.grossProfit)}</strong>
            </div>
            <div>
              <span>Чистый результат</span>
              <strong>{money(r.netResult)}</strong>
            </div>
          </div>
          <div className="two-col">
            <Panel title="Финансовый результат">
              {[
                ["Выручка", r.revenue],
                ["Себестоимость проданных товаров", r.costOfGoods],
                ["Валовая прибыль", r.grossProfit],
                ["Введённые расходы", r.expenses],
                ["Чистый результат", r.netResult],
                ["Расхождение закрытых касс", r.cashDifference],
              ].map(([label, value]) => (
                <div className="line" key={label}>
                  <span>{label}</span>
                  <b>{money(Number(value))}</b>
                </div>
              ))}
              <p className="notice">
                Остаток наличных не равен прибыли. Расходы на аренду, зарплату и
                коммунальные услуги вносятся вручную.
              </p>
            </Panel>
            <Panel title="Выручка закрытых счетов по методам">
              {w.methods.map((m) => (
                <div className="line" key={m.id}>
                  <span>
                    {m.name}
                    <small>
                      Принято денег: {money(r.paymentsByMethod[m.id] ?? 0)}
                    </small>
                  </span>
                  <b>{money(r.revenueByMethod[m.id] ?? 0)}</b>
                </div>
              ))}
              <p className="muted">
                «Принято денег» содержит частичные оплаты открытых счетов и
                потому может отличаться от выручки.
              </p>
              <h3>Продажи товаров</h3>
              {r.productSales.map((p) => (
                <div className="line" key={p.productId}>
                  <span>
                    {p.name}
                    <small>{p.quantity} шт.</small>
                  </span>
                  <b>{money(p.revenue)}</b>
                </div>
              ))}
            </Panel>
          </div>
          <Panel title="Расход клуба вне кассы">
            <p className="muted">
              Аренда, зарплата и другие расходы, оплаченные владельцем отдельно.
              Для выдачи денег из кассы используйте расход в смене.
            </p>
            <Form
              fields={[
                { name: "amount", label: "Сумма, UZS", type: "number", min: 1 },
                {
                  name: "category",
                  label: "Категория",
                  options: ["Аренда", "Зарплата", "Коммунальные", "Прочие"].map(
                    (x) => ({ value: x, label: x }),
                  ),
                },
                {
                  name: "methodId",
                  label: "Способ оплаты",
                  options: w.methods
                    .filter((m) => m.enabled)
                    .map((m) => ({ value: m.id, label: m.name })),
                },
                { name: "reason", label: "Комментарий / причина" },
              ]}
              label="Записать расход клуба"
              submit={(d) =>
                run("AddExpense", {
                  scope: "club",
                  amount: Number(d.amount),
                  category: d.category,
                  methodId: d.methodId,
                  reason: d.reason,
                })
              }
            />
          </Panel>
          <Panel title="Последние закрытые счета рабочего места">
            {closed.map((a) => (
              <div className="line" key={a.id}>
                <span>
                  #{a.id.slice(0, 6)} ·{" "}
                  {w.booths.find((b) => b.id === a.boothId)?.name}
                  <small>{date(a.closedAt)}</small>
                </span>
                <b>{money(a.total)}</b>
              </div>
            ))}
          </Panel>
        </>
      )}
    </>
  );
}
export function AuditPage() {
  const { w } = useClub();
  return (
    <>
      <h1>Журнал аудита</h1>
      <p className="muted">
        Актор, время, причина и снимки значимых изменений. Демо-журнал доступен
        только в этом браузере.
      </p>
      <Panel title="События">
        {!w.audit.length && <p className="empty">Событий пока нет.</p>}
        {w.audit
          .slice()
          .reverse()
          .map((e) => (
            <details key={e.id} className="audit">
              <summary>
                <strong>{actionNames[e.action] || e.action}</strong>
                <small>
                  {e.actorName} · {date(e.at)} · #{e.entityId.slice(0, 8)}
                </small>
              </summary>
              <p>{e.reason || "Причина не требуется"}</p>
              <details>
                <summary>До / после</summary>
                <pre>{e.before}</pre>
                <pre>{e.after}</pre>
              </details>
            </details>
          ))}
      </Panel>
    </>
  );
}
