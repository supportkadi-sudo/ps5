import { ArrowRight, Clock3, Gamepad2 } from "lucide-react";
import { useClub } from "../../app/context";
import type { Account } from "../../shared/api/types";
import { date, money, status } from "../../shared/lib/format";
import { duration, timeLabel } from "./history-format";

export function HistoryCard({
  account: a,
  disabled,
  opening,
  onOpen,
}: {
  account: Account;
  disabled: boolean;
  opening: boolean;
  onOpen: () => void;
}) {
  const { w } = useClub();
  const h = a.history;
  const booth = w.booths.find((b) => b.id === a.boothId);
  const segments = a.segments;
  const start = segments[0]?.startedAt;
  const last = segments.at(-1);
  const end = last?.stoppedAt;
  return (
    <article className="history-card">
      <div className="history-card-heading">
        <div className="history-booth">
          <Gamepad2 size={20} aria-hidden="true" />
          <div>
            <h3>{h?.boothName ?? booth?.name ?? "Кабинка"}</h3>
            <span>{h?.console ?? booth?.console}</span>
          </div>
        </div>
        <span className={"badge " + a.status}>
          {a.refund ? "Возвращён" : status[a.status]}
        </span>
      </div>
      <div className="history-time">
        <Clock3 size={15} aria-hidden="true" />
        <span>
          {start
            ? `${timeLabel(start, a.createdAt)} — ${end ? timeLabel(end, a.createdAt) : "идёт игра"}`
            : `Создан ${timeLabel(a.createdAt, a.createdAt)} · без игры`}
        </span>
        {h && start && <strong>{duration(h.elapsedMinutes)}</strong>}
      </div>
      {h && (
        <dl className="history-breakdown">
          <div>
            <dt>Игра</dt>
            <dd>{money(a.gameAmount)}</dd>
          </div>
          <div>
            <dt>Товары</dt>
            <dd>{money(h.goodsAmount)}</dd>
          </div>
        </dl>
      )}
      <div className="history-total">
        <span>Итого · с округлением</span>
        <strong>{money(a.total)}</strong>
      </div>
      <div className="history-meta">
        <span>
          Оплата:{" "}
          {h?.paymentMethods.length
            ? h.paymentMethods.join(" + ")
            : a.paid
              ? "Принята"
              : "Не поступала"}
        </span>
        {a.due > 0 && a.status !== "cancelled" && (
          <span className="history-due">Осталось: {money(a.due)}</span>
        )}
        {a.refund && <span>Возврат: {money(a.refund.amount)}</span>}
        {h && <span>Кассир смены: {h.cashierName}</span>}
      </div>
      <div className="history-card-footer">
        <span>
          Чек #{a.id.slice(0, 8)} · {date(a.createdAt)}
        </span>
        <button
          onClick={onOpen}
          disabled={disabled}
          aria-label={`Открыть чек ${a.id.slice(0, 8)}`}
        >
          {opening ? "Открываем…" : "Открыть чек"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
