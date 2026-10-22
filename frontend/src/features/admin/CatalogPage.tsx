import { useState } from "react";
import { useClub } from "../../app/context";
import { Form, Panel } from "../../shared/ui/Form";
import { money, date } from "../../shared/lib/format";
export function CatalogPage() {
  const { w, run } = useClub();
  const [edit, setEdit] = useState(""),
    [adjust, setAdjust] = useState("");
  const p = w.products.find((p) => p.id === edit);
  const options = w.products.map((p) => ({ value: p.id, label: p.name }));
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ТОВАРНЫЙ УЧЁТ</span>
          <h1>Каталог и склад</h1>
          <p>FIFO-партии · независимые цена продажи и себестоимость</p>
        </div>
        <button className="primary" onClick={() => setEdit("new")}>
          + Добавить товар
        </button>
      </div>
      <Panel title="Товары">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Остаток</th>
                <th>Продажа</th>
                <th>Базовая себестоимость</th>
                <th>Прибыль / шт.</th>
                <th>Наценка / маржа / ×</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {w.products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    <small>
                      {p.category} · {p.enabled ? "Активен" : "Отключён"}
                    </small>
                  </td>
                  <td>
                    {w.batches
                      .filter((b) => b.productId === p.id)
                      .reduce((n, b) => n + b.remaining, 0)}
                  </td>
                  <td>{money(p.salePrice)}</td>
                  <td>{money(p.defaultCost)}</td>
                  <td>{money(p.salePrice - p.defaultCost)}</td>
                  <td>
                    {p.defaultCost
                      ? (
                          ((p.salePrice - p.defaultCost) / p.defaultCost) *
                          100
                        ).toFixed(1) + "%"
                      : "—"}{" "}
                    /{" "}
                    {p.salePrice
                      ? (
                          ((p.salePrice - p.defaultCost) / p.salePrice) *
                          100
                        ).toFixed(1) + "%"
                      : "—"}{" "}
                    /{" "}
                    {p.defaultCost
                      ? (p.salePrice / p.defaultCost).toFixed(2) + "×"
                      : "—"}
                  </td>
                  <td>
                    <button onClick={() => setEdit(p.id)}>Изменить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Показатели карточки рассчитаны по базовой себестоимости. Фактическая
          себестоимость продаж — по партиям FIFO.
        </p>
      </Panel>
      {edit && (
        <Panel title={p ? "Изменить товар" : "Новый товар"}>
          <Form
            key={edit}
            fields={[
              { name: "name", label: "Название", value: p?.name },
              { name: "category", label: "Категория", value: p?.category },
              {
                name: "salePrice",
                label: "Цена продажи, UZS",
                type: "number",
                value: p?.salePrice,
              },
              {
                name: "defaultCost",
                label: "Базовая себестоимость, UZS",
                type: "number",
                value: p?.defaultCost,
              },
              {
                name: "enabled",
                label: "Статус",
                value: String(p?.enabled ?? true),
                options: [
                  { value: "true", label: "Активен" },
                  { value: "false", label: "Отключён" },
                ],
              },
            ]}
            submit={async (d) => {
              const ok = await run("SaveProduct", {
                product: {
                  id: p?.id ?? crypto.randomUUID(),
                  name: d.name,
                  category: d.category,
                  salePrice: Number(d.salePrice),
                  defaultCost: Number(d.defaultCost),
                  enabled: d.enabled === "true",
                },
              });
              if (ok) setEdit("");
              return ok;
            }}
          />
        </Panel>
      )}
      <div className="two-col">
        <Panel title="Поступление новой партии">
          <Form
            fields={[
              { name: "productId", label: "Товар", options },
              { name: "quantity", label: "Количество", type: "number", min: 1 },
              {
                name: "unitCost",
                label: "Закупочная себестоимость за единицу, UZS",
                type: "number",
              },
            ]}
            label="Оприходовать партию"
            submit={(d) =>
              run("ReceiveBatch", {
                productId: d.productId,
                quantity: Number(d.quantity),
                unitCost: Number(d.unitCost),
              })
            }
          />
        </Panel>
        <Panel title="Как работает FIFO">
          <p>
            При добавлении в счёт товар резервируется из самой ранней доступной
            партии. Цена продажи сохраняется в позиции.
          </p>
          <p>
            Удаление неоплаченной позиции с причиной возвращает товар именно в
            исходные партии.
          </p>
          <p className="notice">
            Корректировки не удаляют историю. Возвраты оплаченных продаж будут
            отдельной операцией backend-этапа.
          </p>
        </Panel>
      </div>
      <Panel title="Партии и остатки">
        {w.batches.map((b) => (
          <div className="line" key={b.id}>
            <div>
              <b>{w.products.find((p) => p.id === b.productId)?.name}</b>
              <small>
                #{b.id.slice(0, 8)} · {date(b.receivedAt)} · поступило{" "}
                {b.quantity}
              </small>
            </div>
            <span>{money(b.unitCost)} / шт.</span>
            <b>{b.remaining} шт.</b>
            <button onClick={() => setAdjust(b.id)}>Корректировка</button>
          </div>
        ))}
        {adjust && (
          <Form
            key={adjust}
            fields={[
              {
                name: "remaining",
                label: "Фактический доступный остаток партии",
                type: "number",
                value: w.batches.find((b) => b.id === adjust)?.remaining,
              },
              { name: "reason", label: "Обязательная причина" },
            ]}
            label="Записать корректировку"
            submit={async (d) => {
              const ok = await run("AdjustStock", {
                batchId: adjust,
                remaining: Number(d.remaining),
                reason: d.reason,
              });
              if (ok) setAdjust("");
              return ok;
            }}
          />
        )}
      </Panel>
    </>
  );
}
