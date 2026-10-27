import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

test("complete screen catalog", async ({ page, isMobile, context }) => {
  test.setTimeout(240000);
  await page.setViewportSize({
    width: isMobile ? 393 : 1440,
    height: isMobile ? 852 : 1000,
  });
  const mode = isMobile ? "mobile" : "desktop";
  const folder = path.resolve("../docs/screenshots/redesign", mode);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const entries: { file: string; title: string }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const shot = async (title: string) => {
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const dialog = await page
      .locator(".editor-dialog[open], [role=dialog]")
      .count();
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const viewport = page.viewportSize()!.height;
    // Actual overlapping phone viewports keep fixed actions visible without hiding fields
    // beneath a fixed bar in a synthetic full-page image.
    const parts =
      isMobile && !dialog
        ? Math.max(1, Math.ceil((height - viewport) / (viewport - 220)) + 1)
        : 1;
    for (let part = 0; part < parts; part++) {
      await page.evaluate((y) => scrollTo(0, y), part * (viewport - 220));
      const file = String(entries.length + 1).padStart(3, "0") + ".png";
      await page.screenshot({
        path: path.join(folder, file),
        fullPage: !isMobile,
        animations: "disabled",
        scale: "css",
      });
      entries.push({
        file,
        title: title + (parts > 1 ? ` · часть ${part + 1}/${parts}` : ""),
      });
    }
    await page.evaluate(() => scrollTo(0, 0));
    if (await page.locator(".editor-dialog[open]").count())
      await page
        .getByRole("button", { name: "Закрыть форму", exact: true })
        .click();
  };
  const nav = async (name: string) => {
    if (isMobile)
      await page.getByRole("button", { name: "Меню", exact: true }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  };
  const tab = (name: string) =>
    page
      .locator(".tabs:visible")
      .getByRole("button", { name, exact: true })
      .click();
  const panel = (name: string) =>
    page
      .locator(".panel")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await page.clock.install();
  await page.goto("/");
  await shot("Вход в CRM");
  await page.getByLabel("Пароль").fill("wrong");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await shot("Ошибка входа");
  await page.getByLabel("Пароль").fill("demo");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(page.locator(".booth").first()).toBeVisible();
  await shot("Пустой зал · смена ещё не открыта");
  if (isMobile) {
    await page.getByRole("button", { name: "Меню", exact: true }).click();
    await shot("Полное меню разделов");
    await page
      .getByRole("button", { name: "Закрыть меню", exact: true })
      .click();
  }
  await nav("Смена и касса");
  await shot("Открытие смены");
  await page.getByLabel("Наличные в кассе на начало, UZS").fill("100000");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await shot("Открытая смена · расходы и пересчёт кассы");
  await panel("Расход кассира").getByLabel("Сумма, UZS").fill("12000");
  await panel("Расход кассира")
    .getByLabel("Комментарий / причина")
    .fill("Питьевая вода для сотрудников");
  await shot("Заполненная форма расхода кассира");
  await page
    .getByRole("button", { name: "Записать расход", exact: true })
    .click();
  await nav("Игровой зал");
  await page.locator(".booth").first().click();
  await shot("Создание счёта · диалог");
  await page.getByLabel("Имя гостя · необязательно").fill("Гость 1");
  await page.locator("[name=tariffId]").selectOption("ps5");
  await page
    .getByRole("button", {
      name: "Открыть счёт и запустить таймер",
      exact: true,
    })
    .click();
  await page.locator(".booth").first().click();
  await shot("Новый счёт · таймер запущен");
  await page.clock.setSystemTime(new Date(Date.now() + 43 * 60000));
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /^Добавить Coca-Cola/ }).click();
  await page.getByRole("button", { name: /^Добавить Чай/ }).click();
  await shot("Идёт игра · товары и быстрый каталог");
  await page.getByRole("button", { name: /^Удалить Coca-Cola/ }).click();
  await page
    .getByLabel("Причина удаления")
    .fill("Гость заменил напиток на чай");
  await shot("Удаление товара · обязательная причина");
  await page
    .getByRole("button", { name: "Удалить и вернуть на склад", exact: true })
    .click();
  await shot("Удалённый товар · история сохранена");
  await page
    .getByRole("button", { name: "Предчек · остановить время", exact: true })
    .click();
  await shot("Предчек · остановленный таймер и возобновление");
  await page.emulateMedia({ media: "print" });
  await shot("Печатный предчек");
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "▶ Возобновить игру", exact: true })
    .click();
  await shot("Возобновлённая игра");
  await page
    .getByRole("button", { name: "Предчек · остановить время", exact: true })
    .click();
  await page.getByRole("button", { name: "Перейти к оплате" }).click();
  await shot("Оплата наличными · полная сумма");
  await page.getByText(/^P2P уведомления ·/).click();
  await shot("P2P уведомления · доступный, неподтверждённый и неоднозначный");
  await page
    .getByRole("group", { name: "Способ оплаты", exact: true })
    .getByRole("button", { name: /P2P/ })
    .click();
  await page.getByLabel("Связать тестовый перевод").selectOption("t1");
  await shot("P2P · ручная привязка тестового перевода");
  await page
    .getByRole("group", { name: "Способ оплаты", exact: true })
    .getByRole("button", { name: "Наличные", exact: true })
    .click();
  await page.getByLabel("Сумма части, UZS").fill("5000");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await shot("Частичная оплата · остаток долга");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Принять оплату", exact: true })
    .click();
  await shot("Полностью оплачено · отдельное подтверждение закрытия");
  await page
    .getByRole("button", {
      name: "Подтверждаю полную оплату · закрыть счёт",
      exact: true,
    })
    .click();
  await shot("Закрытый счёт · платежи");
  await tab("Состав счёта");
  await shot("Закрытый счёт · состав");
  await tab("История");
  await shot("История счёта · все события");
  await page.locator(".audit").first().locator("summary").first().click();
  await page
    .locator(".audit")
    .first()
    .getByText("Значения до / после", { exact: true })
    .click();
  await shot("История счёта · раскрытые значения до и после");
  await page
    .getByRole("button", { name: "← Все кабинки", exact: true })
    .click();
  await shot("Зал · завершённый счёт");
  await page.locator(".booth").nth(1).click();
  await page.locator("[name=tariffId]").selectOption("ps5");
  await page
    .getByRole("button", {
      name: "Открыть счёт и запустить таймер",
      exact: true,
    })
    .click();
  await page.locator(".booth").nth(1).click();
  await page
    .getByRole("button", { name: "← Все кабинки", exact: true })
    .click();
  await shot("Зал · активный таймер и предыдущие счета");
  await tab("Заняты");
  await shot("Зал · только занятые кабинки");
  await tab("Свободны");
  await shot("Зал · только свободные кабинки");
  await nav("Каталог и склад");
  await shot("Каталог · товары, партии и поступление");
  await page
    .getByRole("button", { name: "+ Добавить товар", exact: true })
    .click();
  await shot("Новый товар · форма");
  await panel("Товары")
    .getByRole("button", { name: "Изменить", exact: true })
    .first()
    .click();
  await shot("Изменение товара · цена и себестоимость");
  await page
    .getByRole("button", { name: "Корректировка", exact: true })
    .first()
    .click();
  await shot("Корректировка партии · остаток и причина");
  await nav("Настройки");
  await shot("Настройки · кабинки и тарифы");
  await panel("Тарифы")
    .getByRole("button", { name: "Изменить", exact: true })
    .first()
    .click();
  await shot("Изменение тарифа");
  await page
    .getByRole("button", { name: "+ Новый тариф", exact: true })
    .click();
  await shot("Новый тариф");
  await panel("Кабинки")
    .getByRole("button", { name: "Изменить", exact: true })
    .first()
    .click();
  await shot("Изменение кабинки");
  await page
    .getByRole("button", { name: "+ Новая кабинка", exact: true })
    .click();
  await shot("Новая кабинка");
  await tab("Оплата");
  await shot("Настройки · способы оплаты");
  await page
    .getByRole("button", { name: "Настроить", exact: true })
    .first()
    .click();
  await shot("Настройка способа оплаты");
  await page
    .getByRole("button", { name: "+ Добавить способ оплаты", exact: true })
    .click();
  await shot("Новый способ оплаты");
  await tab("Отзывы и QR");
  await shot("Отзывы · QR-коды");
  await page.emulateMedia({ media: "print" });
  await shot("Печатная версия QR-кодов");
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Изменить", exact: true })
    .first()
    .click();
  await shot("Изменение ссылки на отзывы");
  await page
    .getByRole("button", { name: "+ Добавить ссылку", exact: true })
    .click();
  await shot("Новая ссылка на отзывы");
  await tab("Сотрудники");
  await shot("Сотрудники · список и роли");
  await page.getByRole("button", { name: "Права", exact: true }).nth(2).click();
  await shot("Сотрудник · изменение прав");
  await nav("Отчёты");
  await expect(
    page.getByRole("heading", { name: "Финансовый результат", exact: true }),
  ).toBeVisible();
  await shot("Отчёты · прибыль, способы оплаты, продажи и расход владельца");
  await page.getByLabel("С даты", { exact: true }).fill("2099-01-01");
  await expect(page.getByRole("alert")).toBeVisible();
  await shot("Отчёты · ошибка периода");
  await nav("Журнал аудита");
  await shot("Журнал аудита");
  await page.locator(".audit").first().locator("summary").first().click();
  await page
    .locator(".audit")
    .first()
    .getByText("До / после", { exact: true })
    .click();
  await shot("Аудит · подробности изменения");
  await nav("Смена и касса");
  await page.getByLabel("Фактически пересчитано наличных, UZS").fill("107500");
  await page
    .getByLabel("Причина расхождения · обязательна при недостаче/излишке")
    .fill("Недостача при пересчёте, проверяется владельцем");
  await shot("Закрытие смены · заполненный пересчёт");
  await page
    .getByRole("button", {
      name: "Подтвердить пересчёт и закрыть смену",
      exact: true,
    })
    .click();
  await shot("Закрытая смена · расхождение и история");
  await nav("Игровой зал");
  await context.setOffline(true);
  await expect(page.locator(".connection.offline")).toBeVisible();
  await shot("Нет сети · изменения заблокированы");
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Меню", exact: true })
    .isVisible()
    .then(async (v) => {
      if (v)
        await page.getByRole("button", { name: "Меню", exact: true }).click();
    });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByLabel("Сотрудник").selectOption("cashier");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await shot("Кассир · зал и ограниченный доступ");
  if (isMobile) {
    await page.getByRole("button", { name: "Меню", exact: true }).click();
    await shot("Кассир · доступные разделы меню");
  }
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByLabel("Сотрудник").selectOption("manager");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await nav("Настройки");
  await shot("Управляющий · настройки без управления сотрудниками");
  writeFileSync(
    path.join(folder, "manifest.json"),
    JSON.stringify(entries, null, 2),
  );
  expect(errors).toEqual([]);
});
