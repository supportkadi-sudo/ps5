import { test, expect } from "@playwright/test";
test("cashier journey, persistence, reasoned removal, payment and closure", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  async function nav(name: string) {
    if (isMobile)
      await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  }
  await nav("Смена и касса");
  await page.getByRole("spinbutton").fill("100000");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
  await nav("Игровой зал");
  await page.getByRole("button", { name: /Кабинка 01/ }).click();
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await page
    .getByRole("button", {
      name: /^Не запущен Кабинка 01/,
    })
    .click();
  await page.getByRole("button", { name: "Запустить таймер" }).click();
  await expect(page.getByText("Идёт игра", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Добавить Coca-Cola/ }).click();
  await page.getByRole("button", { name: "Удалить Coca-Cola · 1 л" }).click();
  await page
    .getByLabel("Причина удаления", { exact: true })
    .fill("Гость передумал");
  await page
    .getByRole("button", { name: "Удалить и вернуть на склад" })
    .click();
  await page.getByRole("button", { name: /^Добавить Coca-Cola/ }).click();
  await page
    .getByRole("button", { name: "Предчек · остановить время" })
    .click();
  await page.getByRole("button", { name: "Перейти к оплате" }).click();
  await page.getByLabel("Сумма части, UZS").fill("10000");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await expect(page.getByText("Ожидает оплаты", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Подтверждаю полную/ }),
  ).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтверждаю полную оплату · закрыть счёт" })
    .click();
  await expect(page.getByText("Закрыт", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(page.getByText("Закрыт", { exact: true })).toBeVisible();
  await nav("Отчёты");
  await expect(
    page.getByRole("heading", { name: "Финансовый результат" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/club-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
    animations: "disabled",
  });
});
test("offline blocks commands and cashier cannot access admin navigation", async ({
  page,
  context,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByLabel("Сотрудник").selectOption("cashier");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Каталог и склад" }),
  ).toHaveCount(0);
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await context.setOffline(true);
  await expect(page.getByText(/Нет сети · записи/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Свободна.*Кабинка 01/ }),
  ).toBeDisabled();
});

test("installed production shell reloads offline without simulating server confirmation", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.some((k) => k.startsWith("club-shell-"));
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Войти в клуб" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(page.getByText(/Нет сети · записи/)).toBeVisible();
});

test("P2P requires explicit fixture match and split cash closes only on confirmation", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Смена и касса" })
    .click();
  await page.getByRole("spinbutton").fill("0");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Игровой зал" })
    .click();
  await page.getByRole("button", { name: /Свободна Кабинка 01/ }).click();
  await page.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await page.getByRole("button", { name: /^Не запущен Кабинка 01/ }).click();
  await page.getByRole("button", { name: /^Добавить Coca-Cola/ }).click();
  await page.getByRole("button", { name: /^Добавить Coca-Cola/ }).click();
  await page
    .getByRole("button", { name: "Предчек · остановить время" })
    .click();
  await page.getByRole("button", { name: "Перейти к оплате" }).click();
  await page
    .getByRole("combobox", { name: "Способ оплаты", exact: true })
    .selectOption("p2p");
  await page.getByLabel("Сумма части, UZS").fill("20000");
  await page.getByLabel("Связать тестовый перевод").selectOption("t1");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять тестовую оплату", exact: true })
    .click();
  await expect(page.getByText("Уже связан", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтверждаю полную оплату · закрыть счёт" })
    .click();
  await expect(page.getByText("Закрыт", { exact: true })).toBeVisible();
});

test("a delayed refresh cannot undo a newer completed cashier action", async ({
  page,
  isMobile,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  if (isMobile)
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Смена и касса" })
    .click();
  await page.evaluate(async () => {
    // Test the actual API boundary: retain one old read while a write completes.
    const { api } = await import("/src/shared/api/client.ts");
    const original = api.load.bind(api);
    let first = true;
    api.load = async () => {
      const old = await original();
      if (first) {
        first = false;
        return new Promise((resolve) => {
          window.__releaseOldRead = () => resolve(old);
        });
      }
      return old;
    };
  });
  await page.clock.fastForward(10000);
  await page.getByRole("spinbutton").fill("100");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__releaseOldRead());
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
});
