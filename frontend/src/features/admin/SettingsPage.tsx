import { P2PSources } from "../payments/P2PPanel";
import { LiveEmployees, LiveReviews } from "./ServerAdministration";
import { isDemo } from "../../shared/api/client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useClub } from "../../app/context";
import { Panel } from "../../shared/ui/Form";
import { Editor } from "../../shared/ui/Editor";
import { money } from "../../shared/lib/format";
export function SettingsPage() {
  const { w, user, run } = useClub();
  const [tab, setTab] = useState("club"),
    [editing, setEditing] = useState("");
  const tariff = w.tariffs.find((t) => t.id === editing),
    booth = w.booths.find((t) => t.id === editing),
    method = w.methods.find((t) => t.id === editing),
    review = w.reviews.find((t) => t.id === editing),
    person = w.users.find((t) => t.id === editing);
  const editorTitle =
    tariff || editing === "new-tariff"
      ? "Тариф"
      : booth || editing === "new-booth"
        ? "Кабинка"
        : tab === "methods"
          ? "Способ оплаты"
          : tab === "reviews"
            ? "Ссылка на отзывы"
            : "Права сотрудника";
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">УПРАВЛЕНИЕ КЛУБОМ</span>
          <h1>Настройки</h1>
          <p>Тарифы, оборудование, способы оплаты и отзывы</p>
        </div>
      </div>
      <div className="tabs">
        {[
          ["club", "Кабинки и тарифы"],
          ["methods", "Оплата"],
          ["reviews", "Отзывы и QR"],
          ["users", "Сотрудники"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setEditing("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "club" && (
        <div className="two-col">
          <Panel title="Тарифы">
            {w.tariffs.map((t) => (
              <div className="line" key={t.id}>
                <div>
                  <b>{t.name}</b>
                  <small>{money(t.hourlyRate)} / час</small>
                </div>
                <button onClick={() => setEditing(t.id)}>Изменить</button>
              </div>
            ))}
            <button onClick={() => setEditing("new-tariff")}>
              + Новый тариф
            </button>
            {(tariff || editing === "new-tariff") && (
              <Editor
                title={editorTitle}
                onClose={() => setEditing("")}
                key={editing}
                fields={[
                  { name: "name", label: "Название", value: tariff?.name },
                  {
                    name: "hourlyRate",
                    label: "Стоимость часа, UZS",
                    type: "number",
                    min: 1,
                    value: tariff?.hourlyRate,
                  },
                ]}
                submit={async (d) => {
                  const ok = await run("SaveTariff", {
                    tariff: {
                      id: tariff?.id ?? (isDemo ? crypto.randomUUID() : ""),
                      name: d.name,
                      hourlyRate: Number(d.hourlyRate),
                    },
                  });
                  if (ok) setEditing("");
                  return ok;
                }}
              />
            )}
            <p className="muted">
              Изменение тарифа не меняет уже созданные счета.
            </p>
          </Panel>
          <Panel title="Кабинки">
            {w.booths.map((b) => (
              <div className="line" key={b.id}>
                <div>
                  <b>{b.name}</b>
                  <small>{b.enabled ? "Активна" : "Отключена"}</small>
                </div>
                <button onClick={() => setEditing(b.id)}>Изменить</button>
              </div>
            ))}
            <button onClick={() => setEditing("new-booth")}>
              + Новая кабинка
            </button>
            {(booth || editing === "new-booth") && (
              <Editor
                title={editorTitle}
                onClose={() => setEditing("")}
                key={editing}
                fields={[
                  { name: "name", label: "Название", value: booth?.name },
                  {
                    name: "enabled",
                    label: "Статус",
                    value: String(booth?.enabled ?? true),
                    options: [
                      { value: "true", label: "Активна" },
                      { value: "false", label: "Отключена" },
                    ],
                  },
                ]}
                submit={async (d) => {
                  const ok = await run("SaveBooth", {
                    booth: {
                      id: booth?.id ?? (isDemo ? crypto.randomUUID() : ""),
                      name: d.name,
                      console: booth?.console ?? "",
                      tariffId: booth?.tariffId ?? w.tariffs[0]?.id ?? "",
                      enabled: d.enabled === "true",
                    },
                  });
                  if (ok) setEditing("");
                  return ok;
                }}
              />
            )}
          </Panel>
        </div>
      )}
      {tab === "methods" && (
        <Panel title="Способы оплаты">
          {w.methods.map((m) => (
            <div className="line" key={m.id}>
              <div>
                <b>{m.name}</b>
                <small>
                  {m.kind} · {m.enabled ? "Доступен" : "Отключён"} {m.p2pSource}{" "}
                  {m.cardLast4 ? "****" + m.cardLast4 : ""}
                </small>
              </div>
              <button onClick={() => setEditing(m.id)}>Настроить</button>
            </div>
          ))}
          <button onClick={() => setEditing("new-method")}>
            + Добавить способ оплаты
          </button>
          {editing && (
            <Editor
              title={editorTitle}
              onClose={() => setEditing("")}
              key={editing}
              fields={[
                { name: "name", label: "Название", value: method?.name },
                {
                  name: "kind",
                  label: "Тип · у существующего способа неизменяемый",
                  value: method?.kind,
                  options: [
                    { value: "cash", label: "Наличные" },
                    { value: "p2p", label: "P2P с подтверждением источника" },
                    { value: "other", label: "Другой ручной способ" },
                  ],
                },
                {
                  name: "p2pSource",
                  label: "Источник P2P",
                  value: method?.p2pSource ?? "",
                  required: false,
                  options: [
                    { value: "", label: "Не задан" },
                    { value: "uzcard", label: "Uzcard" },
                    { value: "humo", label: "Humo" },
                  ],
                },
                {
                  name: "cardLast4",
                  label: "Последние 4 цифры карты P2P",
                  value: method?.cardLast4 ?? "",
                  required: false,
                },
                {
                  name: "enabled",
                  label: "Статус",
                  value: String(method?.enabled ?? true),
                  options: [
                    { value: "true", label: "Доступен" },
                    { value: "false", label: "Отключён" },
                  ],
                },
              ]}
              submit={async (d) => {
                const ok = await run("SaveMethod", {
                  method: {
                    id: method?.id ?? (isDemo ? crypto.randomUUID() : ""),
                    name: d.name,
                    kind: d.kind as "cash" | "p2p" | "other",
                    p2pSource: (d.p2pSource || "") as "" | "uzcard" | "humo",
                    cardLast4: d.cardLast4 || "",
                    enabled: d.enabled === "true",
                  },
                });
                if (ok) setEditing("");
                return ok;
              }}
            />
          )}
          <P2PSources />
        </Panel>
      )}
      {tab === "reviews" && !isDemo && <LiveReviews />}
      {tab === "reviews" && isDemo && (
        <>
          <Panel title="Страницы отзывов">
            <p>
              Замените примерные ссылки ссылками на карточки клуба. QR не даёт
              скидок.
            </p>
            <div className="review-grid">
              {w.reviews.map((r) => (
                <div className="qr-card" key={r.id}>
                  <QRCodeSVG value={r.url} size={160} />
                  <h3>{r.name}</h3>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    Открыть страницу ↗
                  </a>
                  <button onClick={() => setEditing(r.id)}>Изменить</button>
                </div>
              ))}
            </div>
            <div className="actions">
              <button onClick={() => setEditing("new-review")}>
                + Добавить ссылку
              </button>
              <button onClick={() => window.print()}>Печать QR</button>
            </div>
            {editing && (
              <Editor
                title={editorTitle}
                onClose={() => setEditing("")}
                key={editing}
                fields={[
                  { name: "name", label: "Сервис", value: review?.name },
                  {
                    name: "url",
                    label: "HTTPS ссылка на карточку клуба",
                    type: "url",
                    value: review?.url,
                  },
                ]}
                submit={async (d) => {
                  const ok = await run("SaveReview", {
                    review: {
                      id: review?.id ?? (isDemo ? crypto.randomUUID() : ""),
                      name: d.name,
                      url: d.url,
                    },
                  });
                  if (ok) setEditing("");
                  return ok;
                }}
              />
            )}
          </Panel>
        </>
      )}
      {tab === "users" && !isDemo && <LiveEmployees />}
      {tab === "users" && isDemo && user.role === "owner" && (
        <Panel title="Персональные сотрудники">
          {w.users.map((u) => (
            <div className="line" key={u.id}>
              <div>
                <b>{u.name}</b>
                <small>
                  {u.id} · {u.role}
                </small>
              </div>
              <button onClick={() => setEditing(u.id)}>Права</button>
            </div>
          ))}
          <p className="notice">
            Демо-вход: идентификатор сотрудника и пароль demo. Настоящие пароли
            и сессии появятся в backend.
          </p>
          {editing && person && (
            <Editor
              title={editorTitle}
              onClose={() => setEditing("")}
              key={editing}
              fields={[
                { name: "name", label: "Имя", value: person.name },
                {
                  name: "role",
                  label: "Роль",
                  value: person.role,
                  options: [
                    { value: "owner", label: "Владелец" },
                    { value: "manager", label: "Управляющий" },
                    { value: "cashier", label: "Кассир" },
                  ],
                },
              ]}
              submit={async (d) => {
                const ok = await run("SaveUser", {
                  user: {
                    id: person.id,
                    name: d.name,
                    role: d.role as "owner" | "manager" | "cashier",
                  },
                });
                if (ok) setEditing("");
                return ok;
              }}
            />
          )}
        </Panel>
      )}
    </>
  );
}
