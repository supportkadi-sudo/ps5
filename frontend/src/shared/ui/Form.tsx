import { useState, type ReactNode } from "react";
export type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string | number;
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
};
export function Form({
  fields,
  submit,
  label = "Сохранить",
  children,
}: {
  fields: Field[];
  submit: (data: Record<string, string>) => Promise<boolean>;
  label?: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = e.currentTarget;
        const d = Object.fromEntries(new FormData(form)) as Record<
          string,
          string
        >;
        setBusy(true);
        try {
          if (await submit(d)) form.reset();
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select
              name={f.name}
              defaultValue={f.value}
              required={f.required !== false}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={f.value}
              required={f.required !== false}
              min={f.type === "number" ? (f.min ?? 0) : undefined}
              step={f.type === "number" ? 1 : undefined}
            />
          )}
        </label>
      ))}
      {children}
      <button className="primary" disabled={busy}>
        {busy ? "Сохранение…" : label}
      </button>
    </form>
  );
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
