import { useState, type CSSProperties } from "react";
import { Gamepad2, Plus, ArrowUpRight } from "lucide-react";
import { useClub } from "../app/context";
import { AccountDetail, elapsed } from "../features/accounts/AccountDetail";
import { Form, Panel } from "../shared/ui/Form";
import { money, status } from "../shared/lib/format";
const layoutKey = "club-booth-columns";
function initialColumns(): number {
  try {
    const saved = Number(localStorage.getItem(layoutKey));
    return [1, 2, 3].includes(saved) ? saved : 2;
  } catch {
    return 2;
  }
}

export function Cashier({
  selected,
  creating,
  onSelect,
  onCreate,
  onBack,
  onCreated,
}: {
  selected: string;
  creating: string;
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
  onBack: () => void;
  onCreated: () => void;
}) {
  const { w, run, user, busy, online } = useClub();
  const [filter, setFilter] = useState("all"),
    [columns, setColumns] = useState(initialColumns);
  const changeColumns = (value: number) => {
    setColumns(value);
    try {
      localStorage.setItem(layoutKey, String(value));
    } catch {
      // The layout still works for this session if storage is unavailable.
    }
  };
  const active = w.accounts.filter(
    (a) => !["closed", "cancelled"].includes(a.status),
  );
  const a = w.accounts.find((a) => a.id === selected);

  return (
    <div className={"cashier-layout " + (a ? "has-selection" : "")}>
      <section className="hall-pane">
        <div className="section-heading">
          <div>
            <span className="eyebrow">РАБОЧЕЕ МЕСТО</span>
            <h1>Игровой зал</h1>
            <p>Кабинки, таймеры и счета гостей</p>
          </div>
          <div className="date-chip">
            {new Date().toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
            })}{" "}
            · {user.name}
          </div>
        </div>
        <div className="stats">
          <div>
            <span>Кабинок занято</span>
            <strong>
              {active.length}
              <small> / {w.booths.filter((b) => b.enabled).length}</small>
            </strong>
          </div>
          <div>
            <span>Сейчас играют</span>
            <strong>
              {active.filter((a) => a.status === "playing").length}
            </strong>
          </div>
          <div>
            <span>Ожидают оплаты</span>
            <strong>
              {active.filter((a) => a.status === "awaiting_payment").length}
            </strong>
          </div>
          <div>
            <span>Открытые счета</span>
            <strong>{money(active.reduce((n, a) => n + a.total, 0))}</strong>
          </div>
        </div>
        <div className="section-heading compact">
          <h2>Кабинки</h2>
          <div className="tabs">
            {[
              ["all", "Все кабинки"],
              ["busy", "Заняты"],
              ["free", "Свободны"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? "selected" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="booth-layout-control"
          role="group"
          aria-label="Количество колонок"
        >
          <span>Колонки</span>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={columns === value}
              onClick={() => changeColumns(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {!w.shifts.some((s) => !s.closedAt && s.cashierId === user.id) && (
          <p className="notice">
            Откройте смену в разделе «Смена и касса», чтобы создавать счета.
          </p>
        )}
        <div
          className={"booth-grid " + (columns > 1 ? "is-compact" : "")}
          style={{ "--booth-columns": columns } as CSSProperties}
        >
          {w.booths
            .filter((b) => b.enabled)
            .sort((a, b) =>
              a.name.localeCompare(b.name, "ru", {
                numeric: true,
                sensitivity: "base",
              }),
            )
            .filter(
              (b) =>
                filter === "all" ||
                (filter === "busy") === active.some((a) => a.boothId === b.id),
            )
            .map((b) => {
              const account = active.find((a) => a.boothId === b.id);
              return (
                <button
                  className={
                    "booth " +
                    (account?.status ?? "free") +
                    (account?.id === selected ? " current" : "")
                  }
                  key={b.id}
                  disabled={busy || !online}
                  onClick={() =>
                    account ? onSelect(account.id) : onCreate(b.id)
                  }
                >
                  <div className="booth-top">
                    <span className="console-icon">
                      <Gamepad2 size={24} />
                    </span>
                    <span className={"badge " + (account?.status ?? "free")}>
                      {account ? status[account.status] : "Свободна"}
                    </span>
                  </div>
                  <h2>{b.name}</h2>
                  <p>
                    {account
                      ? `${account.console} · ${money(account.hourlyRate)}/час`
                      : "Выберите приставку при открытии"}
                  </p>
                  <div className="booth-bottom">
                    {account ? (
                      <>
                        <strong>
                          {elapsed(account)} <small>мин</small>
                        </strong>
                        <b>
                          {money(account.total)} <ArrowUpRight size={17} />
                        </b>
                      </>
                    ) : (
                      <>
                        <span>Готова к игре</span>
                        <Plus size={22} />
                      </>
                    )}
                  </div>
                </button>
              );
            })}
        </div>
        {creating && (
          <div className="modal-backdrop">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Новый счёт"
              className="modal"
            >
              <button className="close" onClick={onBack} aria-label="Закрыть">
                ×
              </button>
              <h2>Новый счёт</h2>
              <p>
                {w.booths.find((b) => b.id === creating)?.name} · таймер
                запустится сразу
              </p>
              <Form
                fields={[
                  {
                    name: "tariffId",
                    label: "Приставка и стоимость часа",
                    options: [
                      { value: "", label: "Выберите приставку" },
                      ...w.tariffs
                        .filter((t) =>
                          ["PS3", "PS4", "PS5"].includes(t.consoleCode ?? ""),
                        )
                        .map((t) => ({
                          value: t.id,
                          label: `${t.consoleCode} · ${money(t.hourlyRate)}/час`,
                        })),
                    ],
                  },
                  {
                    name: "customerName",
                    label: "Имя гостя · необязательно",
                    required: false,
                  },
                  {
                    name: "customerPhone",
                    label: "Телефон · необязательно",
                    type: "tel",
                    required: false,
                  },
                ]}
                label="Открыть счёт и запустить таймер"
                submit={async (d) => {
                  const ok = await run("CreateAccount", {
                    boothId: creating,
                    tariffId: d.tariffId,
                    customerName: d.customerName,
                    customerPhone: d.customerPhone,
                  });
                  if (ok) onCreated();
                  return ok;
                }}
              />
            </section>
          </div>
        )}
        <Panel title="Последние счета">
          {w.accounts.length === 0 ? (
            <p className="empty">
              Здесь появятся счета гостей. Начните со свободной кабинки.
            </p>
          ) : (
            w.accounts
              .slice()
              .reverse()
              .map((a) => (
                <button
                  className="account-row"
                  key={a.id}
                  onClick={() => onSelect(a.id)}
                >
                  <span>
                    <b>{w.booths.find((b) => b.id === a.boothId)?.name}</b>
                    <small>
                      #{a.id.slice(0, 6)} · {a.customerName || "Гость"}
                    </small>
                  </span>
                  <span className={"badge " + a.status}>
                    {status[a.status]}
                  </span>
                  <b>{money(a.total)}</b>
                  <ArrowUpRight size={18} />
                </button>
              ))
          )}
        </Panel>
      </section>
      {a && (
        <section className="selected-account">
          <AccountDetail key={a.id} account={a} onBack={onBack} />
        </section>
      )}
    </div>
  );
}
