import { ThemeToggle } from "./ThemeToggle";
import { ServerAccounts } from "../features/reports/AccountHistory";
import { ServerAudit } from "../features/reports/ServerHistory";
import { useState } from "react";
import {
  Gamepad2,
  LayoutDashboard,
  Wallet,
  Package,
  ChartNoAxesCombined,
  ScrollText,
  Settings,
  LogOut,
  WifiOff,
  Menu,
  X,
  MoreHorizontal,
} from "lucide-react";
import { ClubProvider, useClub } from "./context";
import { api, isDemo } from "../shared/api/client";
import type { User } from "../shared/api/types";
import { Cashier } from "../pages/Cashier";
import { ShiftPage } from "../features/shifts/ShiftPage";
import { CatalogPage } from "../features/admin/CatalogPage";
import { SettingsPage } from "../features/admin/SettingsPage";
import { ReportsPage, AuditPage } from "../features/reports/ReportsPage";
export function App() {
  const [user, setUser] = useState<User | null>(null);
  if (!user) return <Login onLogin={setUser} />;
  return (
    <ClubProvider
      user={user}
      logout={() => {
        void api
          .logout()
          .then(() => setUser(null))
          .catch((e) => window.alert("Выход не подтверждён: " + e.message));
      }}
    >
      <Shell />
    </ClubProvider>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-story">
        <div className="brand">
          <Gamepad2 /> PLAYROOM <span>CLUB OS</span>
        </div>
        <div>
          <span className="eyebrow">МЕНЬШЕ РУТИНЫ. БОЛЬШЕ ИГРЫ.</span>
          <h1>
            Весь клуб.
            <br />
            Одно рабочее
            <br />
            место.
          </h1>
          <p>
            Игровой зал, счета и касса —<br />в понятном ритме вашей смены.
          </p>
        </div>
        <small>CRM игрового клуба · первая web-версия</small>
      </div>
      <section className="login-card">
        <div className="login-controls">
          <ThemeToggle />
        </div>
        <span className="eyebrow">С ВОЗВРАЩЕНИЕМ</span>
        <h2>Начнём смену?</h2>
        <p>Войдите в своё рабочее место</p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              onLogin(
                await api.login(
                  String(d.get("username")),
                  String(d.get("password")),
                ),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "Ошибка входа");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Сотрудник
            {isDemo ? (
              <select name="username">
                <option value="owner">Тимур · владелец</option>
                <option value="cashier">Азиз · кассир</option>
                <option value="manager">Управляющий</option>
              </select>
            ) : (
              <input name="username" autoComplete="username" required />
            )}
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              defaultValue={isDemo ? "demo" : ""}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти в клуб →"}
          </button>
        </form>
        <p className="notice">
          {isDemo
            ? "ДЕМО · пароль demo. Данные только в браузере."
            : "Онлайн · персональный вход. P2P выключен: доверенный источник не подключён."}
        </p>
      </section>
    </main>
  );
}
function Shell() {
  const { user, online, logout, pending, retry, busy } = useClub();
  const [page, setPage] = useState("cashier"),
    [menu, setMenu] = useState(false);
  const manager = user.role !== "cashier";
  const nav = [
    { id: "cashier", label: "Игровой зал", icon: LayoutDashboard },
    { id: "shifts", label: "Смена и касса", icon: Wallet },
    ...(manager
      ? [
          { id: "catalog", label: "Каталог и склад", icon: Package },
          { id: "reports", label: "Отчёты", icon: ChartNoAxesCombined },
          ...(!isDemo
            ? [{ id: "history", label: "История счетов", icon: ScrollText }]
            : []),
          { id: "audit", label: "Журнал аудита", icon: ScrollText },
          { id: "settings", label: "Настройки", icon: Settings },
        ]
      : []),
  ];
  return (
    <div
      className="app-shell"
      onKeyDown={(e) => {
        if (e.key === "Escape") setMenu(false);
      }}
    >
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <div className="brand">
          <Gamepad2 /> PLAYROOM <span>CLUB OS</span>
        </div>
        <span className="nav-caption">УПРАВЛЕНИЕ КЛУБОМ</span>
        <nav id="club-navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMenu(false);
              }}
            >
              <n.icon size={20} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{user.name[0]}</div>
          <div>
            <b>{user.name}</b>
            <small>
              {user.role === "owner"
                ? "Владелец"
                : user.role === "manager"
                  ? "Управляющий"
                  : "Кассир"}
            </small>
          </div>
          <button onClick={logout} aria-label="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="nav-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Меню"
            aria-expanded={menu}
            aria-controls="club-navigation"
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <span>
            Рабочее пространство{" "}
            <b>/ {nav.find((n) => n.id === page)?.label}</b>
          </span>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="demo-chip">
              {isDemo ? "ДЕМО · mock API" : "Онлайн"}
            </span>
          </div>
        </header>
        <div
          className={"connection " + (!online ? "offline" : "")}
          aria-live="polite"
        >
          {online ? (
            <>
              <span className="green-dot" />{" "}
              {isDemo
                ? "Локальная демоверсия · сервер не подключён"
                : "Подключено"}
            </>
          ) : (
            <>
              <WifiOff size={16} /> Нет сети · записи не синхронизированы с
              сервером · изменения заблокированы
            </>
          )}
        </div>
        {pending && (
          <section className="notice" role="status">
            Результат команды «{pending.command.name}» не подтверждён. Новые
            операции заблокированы. При конфликте требуется проверка результата;
            новый ключ не создаётся.
            <button disabled={busy || !online} onClick={() => void retry()}>
              Повторить исходную команду
            </button>
          </section>
        )}
        <main className="content">
          <div key={page} className="page-content">
            {page === "cashier" ? (
              <Cashier />
            ) : page === "shifts" ? (
              <ShiftPage />
            ) : manager && page === "catalog" ? (
              <CatalogPage />
            ) : manager && page === "reports" ? (
              <ReportsPage />
            ) : manager && page === "history" && !isDemo ? (
              <ServerAccounts />
            ) : manager && page === "audit" ? (
              isDemo ? (
                <AuditPage />
              ) : (
                <ServerAudit />
              )
            ) : manager && page === "settings" ? (
              <SettingsPage />
            ) : null}
          </div>
        </main>
        <footer>PLAYROOM · Все суммы в UZS</footer>
        <div className="bottom-nav" role="group" aria-label="Быстрая навигация">
          {nav.slice(0, 2).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMenu(false);
              }}
            >
              <n.icon size={21} />
              <span>{n.id === "cashier" ? "Зал и счета" : "Смена"}</span>
            </button>
          ))}
          {manager && (
            <button
              className={page === "catalog" ? "active" : ""}
              onClick={() => {
                setPage("catalog");
                setMenu(false);
              }}
            >
              <Package size={21} />
              <span>Товары</span>
            </button>
          )}
          <button
            aria-label="Ещё разделы"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={21} />
            <span>Ещё</span>
          </button>
        </div>
      </div>
    </div>
  );
}
