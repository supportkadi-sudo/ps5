import { test, expect } from "@playwright/test";
import { seed } from "../src/shared/api/mock/seed";
import type { Account } from "../src/shared/api/types";

test("history cards, detail, server filters, cursor reset, empty and network error", async ({
  page,
}, info) => {
  const w = seed();
  w.users = [w.users[0]];
  const a: Account = {
    id: "3180d325-example",
    boothId: "b1",
    tariffId: "ps5",
    console: "PS5",
    shiftId: "shift",
    customerName: "",
    customerPhone: "",
    status: "closed",
    version: 1,
    hourlyRate: 60000,
    createdAt: "2026-10-23T15:25:00Z",
    closedAt: "2026-10-23T17:40:00Z",
    segments: [
      { startedAt: "2026-10-23T15:25:00Z", stoppedAt: "2026-10-23T17:40:00Z" },
    ],
    lines: [],
    payments: [],
    gameAmount: 135000,
    total: 165000,
    paid: 165000,
    due: 0,
    history: {
      boothName: "Кабинка №3",
      console: "PS5",
      cashierName: "Тимур",
      elapsedMinutes: 135,
      goodsAmount: 30000,
      paymentMethods: ["Наличные", "Humo"],
    },
  };
  // A workspace snapshot may have the same version but older running-time totals.
  w.accounts = [{ ...a, total: 1000, paid: 1000 }];
  const requests: URL[] = [];
  let fail = false;
  let loggedIn = false;
  await page.route("**/api/v1/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    let json: unknown;
    if (p === "/api/v1/auth/csrf") json = { csrfToken: "test" };
    else if (p === "/api/v1/auth/login") {
      loggedIn = true;
      json = { user: w.users[0], csrfToken: "test" };
    } else if (p === "/api/v1/workspace") {
      if (!loggedIn)
        return route.fulfill({
          status: 403,
          json: {
            code: "not_authenticated",
            message: "Authentication required",
            fieldErrors: {},
          },
        });
      json = w;
    } else if (p === "/api/v1/access/users") json = { items: w.users };
    else if (p === "/api/v1/settings/review-links") json = { items: [] };
    else if (p === "/api/v1/commands/pending") json = { pending: null };
    else if (p === "/api/v1/accounts/" + a.id) json = a;
    else if (p === "/api/v1/accounts") {
      requests.push(u);
      if (fail) return route.fulfill({ status: 502, body: "bad gateway" });
      json = {
        items: u.searchParams.get("status") === "draft" ? [] : [a],
        nextCursor: u.searchParams.has("cursor") ? null : "page-two",
      };
    } else if (p.includes("audit")) json = { items: [], nextCursor: null };
    else
      return route.fulfill({
        status: 404,
        json: { code: "not_found", message: p, fieldErrors: {} },
      });
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.locator("[name=username]").fill("owner");
  await page.locator("[name=password]").fill("test");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Войти в клуб" })).toHaveCount(
    0,
  );
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .locator("#club-navigation")
    .getByRole("button", { name: "История счетов", exact: true })
    .click();
  const card = page.locator(".history-card");
  await expect(card.getByRole("heading", { name: "Кабинка №3" })).toBeVisible();
  await expect(card.getByText("2 ч 15 мин", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Наличные + Humo", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Django / PostgreSQL")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `/tmp/history-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(card).toHaveCSS("background-color", "rgb(25, 33, 48)");
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  await page.screenshot({
    path: `/tmp/history-dark-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Открыть чек 3180d325" }).click();
  await expect(
    page.getByRole("button", { name: "← История счетов" }),
  ).toBeVisible();
  await expect(page.locator(".detail .total")).toHaveText(/165\s*000 сум/);
  await page.evaluate(() => history.back());
  await expect(card.getByRole("heading", { name: "Кабинка №3" })).toBeVisible();
  const payload = '<img src=x onerror="window.historyXss=1">';
  a.history!.cashierName = payload;
  a.history!.paymentMethods = [payload];
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(
    card.getByText(`Кассир смены: ${payload}`, { exact: true }),
  ).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { historyXss?: number }).historyXss,
    ),
  ).toBeUndefined();
  a.history!.cashierName = "Тимур";
  a.history!.paymentMethods = ["Наличные", "Humo"];
  await page.getByRole("button", { name: "Следующие счета" }).click();
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("cursor"))
    .toBe("page-two");
  await page.getByLabel("Кабинка", { exact: true }).selectOption("b2");
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("boothId"))
    .toBe("b2");
  expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.has("from")).toBe(true);
  await page.getByLabel("Статус", { exact: true }).selectOption("draft");
  await expect(
    page.getByRole("heading", { name: "Счетов пока нет" }),
  ).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 502");
  fail = false;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Счетов пока нет" }),
  ).toBeVisible();
});

test("theme uses system preference, persists selection and works without storage", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test" } }),
  );
  await page.route("**/api/v1/workspace", (route) =>
    route.fulfill({
      status: 403,
      json: {
        code: "not_authenticated",
        message: "Authentication required",
        fieldErrors: {},
      },
    }),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Disabled", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Disabled", "SecurityError");
    };
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
