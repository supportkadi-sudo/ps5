import { useClub } from "../../app/context";
import { Form, Panel } from "../../shared/ui/Form";
import { money, date } from "../../shared/lib/format";
export function ShiftPage() {
  const { w, user, run } = useClub(),
    shift = w.shifts.find((s) => !s.closedAt && s.cashierId === user.id);
  const methods = w.methods
    .filter((m) => m.enabled)
    .map((m) => ({ value: m.id, label: m.name }));
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">КАССОВАЯ ДИСЦИПЛИНА</span>
          <h1>Смена и касса</h1>
          <p>Наличные считаем отдельно от прибыли</p>
        </div>
        <span className={"badge " + (shift ? "playing" : "")}>
          {shift ? "Смена открыта" : "Смена закрыта"}
        </span>
      </div>
      {!shift ? (
        <Panel title="Открыть смену">
          <Form
            fields={[
              {
                name: "openingCash",
                label: "Наличные в кассе на начало, UZS",
                type: "number",
                value: 0,
              },
            ]}
            label="Открыть смену"
            submit={(d) =>
              run("OpenShift", { openingCash: Number(d.openingCash) })
            }
          />
        </Panel>
      ) : (
        <>
          <div className="stats">
            <div>
              <span>В начале смены</span>
              <strong>{money(shift.openingCash)}</strong>
            </div>
            <div>
              <span>Ожидаемая наличность</span>
              <strong>{money(shift.expectedCash)}</strong>
            </div>
            <div>
              <span>Расходы смены</span>
              <strong>
                {money(
                  w.expenses
                    .filter((e) => e.shiftId === shift.id)
                    .reduce((n, e) => n + e.amount, 0),
                )}
              </strong>
            </div>
            <div>
              <span>Открыта</span>
              <strong className="small-value">{date(shift.openedAt)}</strong>
            </div>
          </div>
          <div className="two-col">
            <Panel title="Принято по способам оплаты">
              {w.methods.map((m) => (
                <div className="line" key={m.id}>
                  <span>{m.name}</span>
                  <b>
                    {money(
                      w.accounts
                        .flatMap((a) => a.payments)
                        .filter(
                          (p) => p.shiftId === shift.id && p.methodId === m.id,
                        )
                        .reduce((n, p) => n + p.amount, 0),
                    )}
                  </b>
                </div>
              ))}
              <p className="muted">
                Включает части оплаты ещё открытых счетов.
              </p>
            </Panel>
            <Panel title="Расход кассира">
              <Form
                fields={[
                  {
                    name: "amount",
                    label: "Сумма, UZS",
                    type: "number",
                    min: 1,
                  },
                  {
                    name: "category",
                    label: "Категория",
                    options: [
                      "Закупки",
                      "Хозяйственные",
                      "Аренда",
                      "Зарплата",
                      "Коммунальные",
                      "Прочие",
                    ].map((x) => ({ value: x, label: x })),
                  },
                  {
                    name: "methodId",
                    label: "Оплачено через",
                    options: methods,
                  },
                  { name: "reason", label: "Комментарий / причина" },
                ]}
                label="Записать расход"
                submit={(d) =>
                  run("AddExpense", {
                    scope: "shift",
                    amount: Number(d.amount),
                    category: d.category,
                    methodId: d.methodId,
                    reason: d.reason,
                  })
                }
              />
            </Panel>
          </div>
          <Panel title="Закрыть смену">
            <p className="notice">
              Активные игры продолжатся. При открытии следующей смены счета
              будут переданы с записью в аудит.
            </p>
            <Form
              fields={[
                {
                  name: "actualCash",
                  label: "Фактически пересчитано наличных, UZS",
                  type: "number",
                },
                {
                  name: "reason",
                  label:
                    "Причина расхождения · обязательна при недостаче/излишке",
                  required: false,
                },
              ]}
              label="Подтвердить пересчёт и закрыть смену"
              submit={(d) =>
                run(
                  "CloseShift",
                  { actualCash: Number(d.actualCash), reason: d.reason },
                  shift.id,
                )
              }
            />
          </Panel>
        </>
      )}
      <Panel title="История смен">
        {w.shifts.length === 0 && <p className="empty">Смен пока нет.</p>}
        {w.shifts
          .slice()
          .reverse()
          .map((s) => (
            <div className="line" key={s.id}>
              <div>
                <strong>
                  {w.users.find((u) => u.id === s.cashierId)?.name} ·{" "}
                  {date(s.openedAt)}
                </strong>
                <small>
                  {s.closedAt ? "Закрыта " + date(s.closedAt) : "Открыта"} ·{" "}
                  {s.reason}
                </small>
              </div>
              <div>
                <b>{money(s.expectedCash)}</b>
                <small>
                  {s.closedAt
                    ? "Факт " +
                      money(s.actualCash) +
                      " · расхождение " +
                      money(s.difference)
                    : "Ожидаемые наличные"}
                </small>
              </div>
            </div>
          ))}
      </Panel>
      <Panel title="Расходы">
        {w.expenses.length === 0 && (
          <p className="empty">Нет записанных расходов.</p>
        )}
        {w.expenses
          .slice()
          .reverse()
          .map((e) => (
            <div className="line" key={e.id}>
              <div>
                <strong>{e.category}</strong>
                <small>
                  {e.reason} · {date(e.createdAt)}
                </small>
              </div>
              <b>{money(e.amount)}</b>
            </div>
          ))}
      </Panel>
    </>
  );
}
