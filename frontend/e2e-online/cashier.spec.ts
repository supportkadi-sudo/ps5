import { test, expect, type Page } from "@playwright/test";
const password = "Isolated-E2E-Password-786!";
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.locator("[name=username]").fill(username);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(
    page.getByRole("heading", { name: "Игровой зал", exact: true }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  if (await page.getByRole("button", { name: "Меню", exact: true }).isVisible())
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .locator("#club-navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function logout(page: Page) {
  if (
    !(await page
      .getByRole("button", { name: "Выйти", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.locator("[name=username]")).toBeVisible();
}
async function save(page: Page, fields: Record<string, string>) {
  const dialog = page.getByRole("dialog");
  for (const [key, value] of Object.entries(fields)) {
    const input = dialog.locator(`[name=${key}]`);
    if ((await input.evaluate((e) => e.tagName)) === "SELECT")
      await input.selectOption(value);
    else await input.fill(value);
  }
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).toBeHidden();
}
test("real session owner setup → cashier FIFO, timer, split payments, lost ack, shift and history", async ({
  page,
}, info) => {
  const suffix = info.project.name + Date.now();
  const cashier = "cashier-" + suffix;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "e2e-owner");
  await nav(page, "Настройки");
  await page.getByRole("button", { name: "Сотрудники", exact: true }).click();
  await page.getByRole("button", { name: "+ Новый сотрудник" }).click();
  await save(page, {
    name: cashier,
    username: cashier,
    password,
    role: "cashier",
    reason: "E2E персональный доступ",
  });
  await expect(
    page.getByText(cashier + " · cashier", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Кабинки и тарифы" }).click();
  await page.getByRole("button", { name: "+ Новый тариф" }).click();
  await save(page, { name: "Tariff-" + suffix, hourlyRate: "60000" });
  await page.getByRole("button", { name: "+ Новая кабинка" }).click();
  const tariff = await page
    .getByRole("dialog")
    .locator("[name=tariffId] option")
    .filter({ hasText: "Tariff-" + suffix })
    .getAttribute("value");
  await save(page, {
    name: "Booth-" + suffix,
    console: "PS5",
    tariffId: tariff!,
  });
  await page.getByRole("button", { name: "Оплата", exact: true }).click();
  for (const [kind, name] of [
    ["cash", "Cash-"],
    ["other", "Card-"],
  ]) {
    await page
      .getByRole("button", { name: "+ Добавить способ оплаты" })
      .click();
    await save(page, { name: name + suffix, kind });
  }
  await nav(page, "Каталог и склад");
  await page
    .getByRole("button", { name: /Новый товар|Добавить товар/ })
    .click();
  await save(page, {
    name: "Cola-" + suffix,
    category: "Напитки",
    salePrice: "10000",
    defaultCost: "4000",
  });
  // Receive original FIFO lots through the actual UI.
  const receipt = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /Поступление|Закупка/ }) })
    .last();
  const productId = await receipt
    .locator("[name=productId] option")
    .filter({ hasText: "Cola-" + suffix })
    .getAttribute("value");
  for (const cost of ["4000", "5000"]) {
    await receipt.locator("[name=productId]").selectOption(productId!);
    await receipt.locator("[name=quantity]").fill("1");
    await receipt.locator("[name=unitCost]").fill(cost);
    await receipt.getByRole("button", { name: "Оприходовать партию" }).click();
    await expect(
      receipt.getByRole("button", { name: "Оприходовать партию" }),
    ).toBeEnabled();
  }
  await logout(page);
  await login(page, cashier);
  await nav(page, "Смена и касса");
  await page.locator("[name=openingCash]").fill("100000");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
  await nav(page, "Игровой зал");
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: "Booth-" + suffix }) })
    .click();
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: "Booth-" + suffix }) })
    .click();
  await expect(
    page.getByRole("button", { name: "▶ Запустить таймер", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "▶ Запустить таймер", exact: true })
    .click();
  const add = page.getByRole("button", {
    name: new RegExp("Добавить Cola-" + suffix),
  });
  await add.click();
  await page
    .getByRole("button", { name: "Удалить Cola-" + suffix, exact: true })
    .click();
  await page.locator("[name=reason]").fill("Гость передумал");
  await page
    .getByRole("button", { name: "Удалить и вернуть на склад" })
    .click();
  await expect(add.getByText("2 в наличии")).toBeVisible();
  await add.click();
  await page
    .getByRole("button", { name: "Предчек · остановить время", exact: true })
    .click();
  await page.getByRole("button", { name: "Перейти к оплате →" }).click();
  await page
    .getByRole("button", { name: "Cash-" + suffix, exact: true })
    .click();
  await page.locator("[name=amount]").fill("5000");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Оплата · 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Подтверждаю полную оплату/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Card-" + suffix, exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await page.getByRole("button", { name: /Подтверждаю полную оплату/ }).click();
  await expect(page.locator(".detail .section-heading .badge")).toHaveText(
    "Закрыт",
  );
  await nav(page, "Смена и касса");
  // Lose the reply only AFTER the real backend has committed the expense.
  let lost = false;
  let firstKey = "";
  await page.route("**/api/v1/expenses", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      firstKey = route.request().headers()["idempotency-key"];
      await route.fetch();
      await route.abort("failed");
    } else {
      if (route.request().method() === "POST")
        expect(route.request().headers()["idempotency-key"]).toBe(firstKey);
      await route.continue();
    }
  });
  const cashOption = await page
    .locator("[name=methodId] option")
    .filter({ hasText: "Cash-" + suffix })
    .getAttribute("value");
  await page.locator("[name=methodId]").selectOption(cashOption!);
  await page.locator("[name=amount]").fill("1000");
  await page
    .locator("[name=reason]")
    .first()
    .fill("E2E расход " + suffix);
  await page
    .getByRole("button", { name: "Записать расход", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Повторить исходную команду" }),
  ).toBeVisible();
  await page.reload();
  await login(page, cashier);
  await page
    .getByRole("button", { name: "Повторить исходную команду" })
    .click();
  await expect(
    page.getByRole("button", { name: "Повторить исходную команду" }),
  ).toHaveCount(0);
  await nav(page, "Смена и касса");
  await page.locator("[name=actualCash]").fill("104000");
  await page
    .getByRole("button", { name: "Подтвердить пересчёт и закрыть смену" })
    .click();
  await expect(page.getByText("Смена закрыта", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("club-")),
    ),
  ).toEqual([]);
  const forbidden = await page.request.post("/api/v1/catalog/products", {
    data: {},
  });
  expect([400, 403]).toContain(forbidden.status());
  await logout(page);
  await login(page, "e2e-owner");
  await nav(page, "История счетов");
  await expect(
    page.getByRole("heading", { name: "История счетов", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("PostgreSQL serializes parallel last-stock and payment requests, backend enforces roles", async ({
  page,
}, info) => {
  const suffix = info.project.name + Date.now();
  await login(page, "e2e-owner");
  let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrfToken;
  async function cmd(path: string, data: unknown) {
    return page.request.post("/api/v1/" + path, {
      data,
      headers: { "X-CSRFToken": csrf, "Idempotency-Key": crypto.randomUUID() },
    });
  }
  async function create(path: string, data: unknown) {
    const r = await cmd(path, data);
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).entityId as string;
  }
  const username = "race-" + suffix;
  await create("access/users", {
    user: { id: "", name: username, role: "cashier", isActive: true },
    username,
    password,
    expectedVersion: 0,
    reason: "E2E race",
  });
  const tariffId = await create("club/tariffs", {
    tariff: { id: "", name: username, hourlyRate: 60000 },
  });
  const booths = [];
  for (let i = 0; i < 2; i++)
    booths.push(
      await create("club/booths", {
        booth: {
          id: "",
          name: username + i,
          console: "PS5",
          tariffId,
          enabled: true,
        },
      }),
    );
  const productId = await create("catalog/products", {
    product: {
      id: "",
      name: username,
      category: "Test",
      salePrice: 10000,
      defaultCost: 4000,
      enabled: true,
    },
  });
  await create("inventory/receipts", {
    productId,
    quantity: 1,
    unitCost: 4000,
  });
  const methodId = await create("settings/payment-methods", {
    method: { id: "", name: username, kind: "cash", enabled: true },
  });
  await logout(page);
  await login(page, username);
  csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).csrfToken;
  await create("shifts/open", { openingCash: 0 });
  const accounts = [];
  for (const boothId of booths)
    accounts.push(
      await create("accounts", {
        boothId,
        customerName: "",
        customerPhone: "",
      }),
    );
  const stocks = await Promise.all(
    accounts.map((id) =>
      cmd(`accounts/${id}/lines`, {
        expectedVersion: 1,
        productId,
        quantity: 1,
      }),
    ),
  );
  expect(stocks.map((r) => r.status()).sort()).toEqual([200, 409]);
  const winner = accounts[stocks.findIndex((r) => r.status() === 200)];
  await create(`accounts/${winner}/precheck`, { expectedVersion: 2 });
  const payments = await Promise.all(
    [1, 2].map(() =>
      cmd(`accounts/${winner}/payments`, {
        expectedVersion: 3,
        methodId,
        amount: 10000,
        transferId: "",
        confirmedByCashier: true,
      }),
    ),
  );
  expect(payments.map((r) => r.status()).sort()).toEqual([200, 409]);
  const detail = await (
    await page.request.get(`/api/v1/accounts/${winner}`)
  ).json();
  expect(detail.payments).toHaveLength(1);
  expect(detail.status).toBe("awaiting_payment");
  expect(
    (
      await cmd("club/tariffs", {
        tariff: { id: "", name: "Forbidden", hourlyRate: 1 },
      })
    ).status(),
  ).toBe(403);
  await create(`accounts/${winner}/close`, { expectedVersion: 4 });
  const w = await (await page.request.get("/api/v1/workspace")).json();
  const shift = w.shifts.find((s: { closedAt: string }) => !s.closedAt);
  await create(`shifts/${shift.id}/close`, { actualCash: 10000, reason: "" });
});
