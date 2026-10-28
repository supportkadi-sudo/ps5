import { HistoryCard } from "./HistoryCard";
import { useEffect, useState } from "react";
import { ArrowRight, ReceiptText } from "lucide-react";
import { useClub } from "../../app/context";
import { api } from "../../shared/api/client";
import type { HttpApi } from "../../shared/api/http";
import type { Account } from "../../shared/api/types";
import { status } from "../../shared/lib/format";
import { assertPeriod } from "../../shared/api/validation";
import { AccountDetail } from "../accounts/AccountDetail";
import { useServerPage } from "./ServerHistory";
import { dayKey, dayLabel, periodDates } from "./history-format";
import "./account-history.css";

export function ServerAccounts({
  selected,
  onSelect,
  onBack,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const { w } = useClub();
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [booth, setBooth] = useState("");
  const [state, setState] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const params = new URLSearchParams({
    ...(booth ? { boothId: booth } : {}),
    ...(state ? { status: state } : {}),
    ...(range.from ? range : {}),
  });
  const { data, error, busy, next, first } = useServerPage(
    "/api/v1/accounts?" + params,
    "AccountPage",
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [detailError, setDetailError] = useState("");
  const [opening, setOpening] = useState("");
  useEffect(() => {
    if (!selected) {
      setOpening("");
      return;
    }
    let active = true;
    setOpening(selected);
    setDetailError("");
    (api as HttpApi)
      .request<Account>(
        "/api/v1/accounts/" + encodeURIComponent(selected),
        {},
        "Account",
      )
      .then((found) => {
        if (active) setAccount(found);
      })
      .catch((error) => {
        if (active)
          setDetailError(
            error instanceof Error ? error.message : "Не удалось открыть чек",
          );
      })
      .finally(() => {
        if (active) setOpening("");
      });
    return () => {
      active = false;
    };
  }, [selected]);
  if (account && account.id === selected)
    return (
      <AccountDetail
        key={account.id}
        account={
          w.accounts.find(
            (a) => a.id === account.id && a.version > account.version,
          ) ?? account
        }
        onBack={() => {
          onBack();
          first();
        }}
        backLabel="← История счетов"
      />
    );
  const groups = new Map<string, Account[]>();
  for (const a of data?.items ?? []) {
    const day = dayKey(a.createdAt);
    groups.set(day, [...(groups.get(day) ?? []), a]);
  }
  function choosePeriod(value: string) {
    setPeriod(value);
    setRangeError("");
    if (value !== "custom") {
      const dates = periodDates(value);
      setRange(dates);
      setFrom(dates.from);
      setTo(dates.to);
    }
  }
  return (
    <section className="account-history" aria-label="История счетов">
      <div className="section-heading">
        <div>
          <span className="eyebrow">СЧЕТА КЛУБА</span>
          <h1>История счетов</h1>
          <p>Игра, покупки и оплата — в одном чеке</p>
        </div>
        <button onClick={first} disabled={busy}>
          Обновить
        </button>
      </div>
      <div className="history-filters">
        <div className="tabs" role="group" aria-label="Период истории">
          {[
            ["all", "Все"],
            ["today", "Сегодня"],
            ["yesterday", "Вчера"],
            ["custom", "Период"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={period === id}
              className={period === id ? "selected" : ""}
              onClick={() => choosePeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <form
            className="history-range"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                assertPeriod(from, to);
                setRange({ from, to });
                setRangeError("");
              } catch (e) {
                setRangeError((e as Error).message);
              }
            }}
          >
            <label>
              С даты
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              По дату
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
            <button type="submit">Применить</button>
          </form>
        )}
        <div className="history-selects">
          <label>
            Кабинка
            <select
              aria-label="Кабинка"
              value={booth}
              onChange={(e) => setBooth(e.target.value)}
            >
              <option value="">Все кабинки</option>
              {w.booths.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.console}
                </option>
              ))}
            </select>
          </label>
          <label>
            Статус
            <select
              aria-label="Статус"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">Все статусы</option>
              {Object.entries(status).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="history-hint">
          По дате создания счёта · время Ташкента
          {period === "custom" && range.from
            ? ` · ${dayLabel(range.from)} — ${dayLabel(range.to)}`
            : ""}
        </p>
      </div>
      {(error || detailError || rangeError) && (
        <p role="alert" className="error">
          {error || detailError || rangeError}
        </p>
      )}
      <div aria-busy={busy}>
        {busy && (
          <p role="status" className="history-empty">
            Загрузка счетов…
          </p>
        )}
        {!busy && !error && data?.items.length === 0 && (
          <div className="history-empty">
            <ReceiptText aria-hidden="true" />
            <h2>Счетов пока нет</h2>
            <p>За выбранный период и с этими фильтрами ничего не найдено.</p>
          </div>
        )}
        {[...groups].map(([day, accounts]) => (
          <section className="history-day" key={day} aria-label={dayLabel(day)}>
            <h2>{dayLabel(day)}</h2>
            <div className="history-cards">
              {accounts.map((a) => (
                <HistoryCard
                  key={a.id}
                  account={a}
                  disabled={!!opening}
                  opening={opening === a.id}
                  onOpen={() => onSelect(a.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {!busy && data && data.items.length > 0 && (
        <div className="history-pagination">
          <button
            disabled={!data.nextCursor}
            onClick={() => {
              next(data.nextCursor ?? "");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Следующие счета <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button className="ghost" onClick={first}>
            К последним
          </button>
        </div>
      )}
    </section>
  );
}
