import { test, expect } from "@playwright/test";
import type { Command } from "../src/shared/api/types";

test("lost HTTP response survives reload with the original key/body and no duplicate expense", async ({
  page,
  isMobile,
  browser,
}) => {
  // Isolated MockApi acts as the test HTTP server and survives client-page reloads.
  const serverContext = await browser.newContext();
  const serverPage = await serverContext.newPage();
  await serverPage.goto("http://127.0.0.1:4173/");
  await serverPage.evaluate(async () =>
    (await import("/src/shared/api/client.ts")).api.login("owner", "demo"),
  );
  const server = {
    execute: (c: Command) =>
      serverPage.evaluate(
        async (c) => (await import("/src/shared/api/client.ts")).api.execute(c),
        c,
      ),
    load: () =>
      serverPage.evaluate(async () =>
        (await import("/src/shared/api/client.ts")).api.load(),
      ),
  };
  const requests: { key: string; body: string }[] = [];
  await page.route("**/api/v1/expenses", async (route) => {
    const request = route.request();
    const key = request.headers()["idempotency-key"];
    const body = request.postData()!;
    requests.push({ key, body });
    const result = await server.execute({
      name: "AddExpense",
      key,
      data: JSON.parse(body),
    });
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ json: result });
  });
  const install = async () =>
    page.evaluate(async () => {
      const { api } = await import("/src/shared/api/client.ts");
      const { HttpApi } = await import("/src/shared/api/http.ts");
      const http = new HttpApi();
      api.execute = (c) => http.execute(c);
    });
  const expenses = async () => {
    if (isMobile)
      await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Отчёты", exact: true })
      .click();
  };
  await page.goto("/");
  await install();
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expenses();
  const form = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Расход клуба вне кассы",
      exact: true,
    }),
  });
  await form.getByLabel("Сумма, UZS", { exact: true }).fill("15000");
  await form.getByLabel("Комментарий / причина").fill("Тест расхода");
  await page
    .getByRole("button", { name: "Записать расход клуба", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Повторить исходную команду" }),
  ).toBeVisible();
  expect((await server.load()).expenses).toHaveLength(1);
  await page.reload();
  await install();
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(page.getByRole("status")).toContainText("не подтверждён");
  await expenses();
  await form.getByLabel("Сумма, UZS", { exact: true }).fill("25000");
  await form.getByLabel("Комментарий / причина").fill("Другой расход");
  await page
    .getByRole("button", { name: "Записать расход клуба", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("неразрешённая");
  expect(requests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Повторить исходную команду" })
    .click();

  await expect(
    page.getByRole("button", { name: "Повторить исходную команду" }),
  ).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const state = await server.load();
  expect(state.expenses).toHaveLength(1);
  expect(state.audit.filter((e) => e.action === "AddExpense")).toHaveLength(1);
  await serverContext.close();
});

test("report renders server product sales when workspace accounts and products are omitted", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { api } = await import("/src/shared/api/client.ts");
    await api.login("owner", "demo");
    let w = await api.execute({
      name: "OpenShift",
      key: crypto.randomUUID(),
      data: { openingCash: 0 },
    });
    w = await api.execute({
      name: "CreateAccount",
      key: crypto.randomUUID(),
      data: { boothId: "b1", customerName: "", customerPhone: "" },
    });
    const id = w.accounts[0].id;
    await api.execute({
      name: "AddLine",
      entityId: id,
      key: crypto.randomUUID(),
      data: { expectedVersion: 1, productId: "cola", quantity: 2 },
    });
    w = await api.execute({
      name: "Precheck",
      entityId: id,
      key: crypto.randomUUID(),
      data: { expectedVersion: 2 },
    });
    await api.execute({
      name: "AcceptPayment",
      entityId: id,
      key: crypto.randomUUID(),
      data: {
        expectedVersion: 3,
        methodId: "cash",
        amount: w.accounts[0].due,
        transferId: "",
        confirmedByCashier: true,
      },
    });
    await api.execute({
      name: "CloseAccount",
      entityId: id,
      key: crypto.randomUUID(),
      data: { expectedVersion: 4 },
    });
    const load = api.load.bind(api);
    api.load = async () => {
      const w = await load();
      return { ...w, accounts: [], products: [] };
    };
  });
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Отчёты", exact: true })
    .click();
  const sales = page.locator(".line").filter({ hasText: "Coca-Cola" });
  await expect(sales).toContainText("2 шт.");
  await expect(sales).toContainText("36 000 сум");
});
test("conflict retains unresolved UUID and body through reload", async ({
  page,
  isMobile,
}) => {
  const requests: { key: string; body: string }[] = [];
  await page.route("**/api/v1/shifts/open", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData()!,
    });
    await route.fulfill({
      status: 409,
      json: {
        code: "version_conflict",
        message: "Конфликт. Требуется проверка",
        fieldErrors: {},
      },
    });
  });
  const login = async () => {
    await page.evaluate(async () => {
      const { api } = await import("/src/shared/api/client.ts");
      const { HttpApi } = await import("/src/shared/api/http.ts");
      api.execute = (c) => new HttpApi().execute(c);
    });
    await page.getByRole("button", { name: "Войти в клуб" }).click();
  };
  await page.goto("/");
  await login();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Смена и касса", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Конфликт");
  await page.reload();
  await login();
  await page
    .getByRole("button", { name: "Повторить исходную команду" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Конфликт");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByRole("status")).toContainText("не подтверждён");
});
