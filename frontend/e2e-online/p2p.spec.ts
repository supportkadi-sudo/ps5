import { test, expect, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
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
async function menu(page: Page, name: string) {
  if (
    !(await page
      .locator("#club-navigation")
      .getByRole("button", { name, exact: true })
      .isVisible())
  )
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
}
for (const source of ["uzcard", "humo"] as const) {
  test(`${source}: real bank ingress → cashier finds → explicit part confirmation → separate close`, async ({
    page,
  }, info) => {
    const secret = process.env.P2P_WEBHOOK_SECRET;
    if (
      !secret ||
      process.env.P2P_UZCARD_SENDER_IDS !== "900001" ||
      process.env.P2P_HUMO_SENDER_IDS !== "900002"
    )
      throw Error(
        "Run Django and Playwright with the documented synthetic P2P test environment",
      );
    const suffix = `${source}-${info.project.name}-${Date.now()}`;
    const cashier = `p2p-${suffix}`;
    const last4 = source === "uzcard" ? "9522" : "5763";
    await login(page, "e2e-owner");
    let csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
      .csrfToken;
    async function command(path: string, data: unknown) {
      const r = await page.request.post("/api/v1/" + path, {
        data,
        headers: { "X-CSRFToken": csrf, "Idempotency-Key": randomUUID() },
      });
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()).entityId as string;
    }
    await command("access/users", {
      user: { id: "", name: cashier, role: "cashier", isActive: true },
      username: cashier,
      password,
      expectedVersion: 0,
      reason: "Synthetic P2P E2E",
    });
    const workspace = await (
      await page.request.get("/api/v1/workspace")
    ).json();
    const tariffId = workspace.tariffs.find(
      (t: { consoleCode: string }) => t.consoleCode === "PS5",
    ).id;
    const boothId = await command("club/booths", {
      booth: { id: "", name: suffix, console: "PS5", tariffId, enabled: true },
    });
    const productId = await command("catalog/products", {
      product: {
        id: "",
        name: suffix,
        category: "Test",
        salePrice: 10000,
        defaultCost: 1000,
        enabled: true,
      },
    });
    await command("inventory/receipts", {
      productId,
      quantity: 1,
      unitCost: 1000,
    });
    const methodId = await command("settings/payment-methods", {
      method: {
        id: "",
        name: suffix,
        kind: "p2p",
        enabled: true,
        p2pSource: source,
        cardLast4: last4,
      },
    });
    const cashId = await command("settings/payment-methods", {
      method: { id: "", name: "cash-" + suffix, kind: "cash", enabled: true },
    });
    await logout(page);
    await login(page, cashier);
    csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
      .csrfToken;
    await menu(page, "Смена и касса");
    await page.locator("[name=openingCash]").fill("0");
    await page
      .getByRole("button", { name: "Открыть смену", exact: true })
      .click();
    await expect(
      page.getByText("Смена открыта", { exact: true }),
    ).toBeVisible();
    await menu(page, "Игровой зал");
    const booth = page.getByRole("button").filter({
      has: page.getByRole("heading", { name: suffix, exact: true }),
    });
    await booth.click();
    await page.locator("[name=tariffId]").selectOption(tariffId);
    await page
      .getByRole("button", {
        name: "Открыть счёт и запустить таймер",
        exact: true,
      })
      .click();
    await booth.click();
    await page
      .getByRole("button", { name: new RegExp("Добавить " + suffix) })
      .click();
    await page
      .getByRole("button", { name: "Предчек · остановить время", exact: true })
      .click();
    await page.getByRole("button", { name: "Перейти к оплате →" }).click();
    const panel = page.getByRole("region", { name: "Банковские переводы" });
    await panel.locator("[name=expectedMethodId]").selectOption(methodId);
    await panel.locator("[name=expectedAmount]").fill("5000");
    await panel
      .getByRole("button", { name: "Ожидать перевод", exact: true })
      .click();
    await expect(panel.getByText(/Ожидается/)).toBeVisible();
    const w = await (await page.request.get("/api/v1/workspace")).json();
    const accountId = w.accounts.find(
      (a: { boothId: string }) => a.boothId === boothId,
    ).id;
    // Real HTTP backend with a synthetic Telegram provenance envelope. No API route mocking.
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const time = `${part("hour")}:${part("minute")}`;
    const date = `${part("day")}.${part("month")}.${part("year")}`;
    const text =
      source === "uzcard"
        ? `🟢 Perevod na kartu\n➕ 5000.00 UZS\n💳 ***9522\n📍 IYB HUMO 2 UZCARD, UZ\n🕓 ${date.slice(0, 6) + date.slice(-2)} ${time}\n💵 1 000.56 UZS`
        : `🎉 Пополнение\n➕ 5.000,00 UZS\n📍 HAMKOR HUMO P2P>Andi\n💳 HUMOCARD *5763\n🕓 ${time} ${date}\n💰 401.502,70 UZS`;
    const body = JSON.stringify({
      source,
      senderId: source === "uzcard" ? 900001 : 900002,
      senderIsBot: true,
      businessConnectionId: "synthetic-business",
      chatId: 700001,
      messageId: Date.now(),
      text,
    });
    const stamp = Math.floor(Date.now() / 1000);
    const sig =
      "v1=" +
      createHmac("sha256", secret)
        .update(`v1\n${stamp}\n`)
        .update(body)
        .digest("hex");
    const headers = {
      "Content-Type": "application/json",
      "X-P2P-Timestamp": String(stamp),
      "X-P2P-Signature": sig,
    };
    const incoming = await page.request.post(
      "/api/v1/integrations/telegram-business",
      { data: body, headers },
    );
    expect(incoming.status(), await incoming.text()).toBe(200);
    const eventId = (await incoming.json()).eventId;
    const duplicate = await page.request.post(
      "/api/v1/integrations/telegram-business",
      { data: body, headers },
    );
    expect((await duplicate.json()).eventId).toBe(eventId);
    await panel.getByRole("button", { name: "Обновить переводы" }).click();
    const found = panel.locator(".line").filter({
      has: page.getByRole("button", {
        name: "Подтвердить оплату",
        exact: true,
      }),
    });
    await expect(
      found.getByText("Перевод найден", { exact: true }),
    ).toBeVisible();
    await expect(
      found.getByText(new RegExp("\\*\\*\\*\\*" + last4)),
    ).toBeVisible();
    let detail = await (
      await page.request.get(`/api/v1/accounts/${accountId}`)
    ).json();
    expect(detail.status).toBe("awaiting_payment");
    expect(detail.payments).toHaveLength(0);
    await found
      .getByRole("button", { name: "Подтвердить оплату", exact: true })
      .click();
    await expect(
      panel.getByText("Оплата принята кассиром", { exact: true }),
    ).toBeVisible();
    detail = await (
      await page.request.get(`/api/v1/accounts/${accountId}`)
    ).json();
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0].transferId).toBe(eventId);
    expect(detail.paid).toBe(5000);
    expect(detail.status).toBe("awaiting_payment");
    expect(detail.due).toBe(detail.total - 5000);
    await expect(
      page.getByRole("button", { name: /Подтверждаю полную оплату/ }),
    ).toHaveCount(0);
    // Complete the remaining part through the normal cashier payment UI.
    await page
      .getByRole("button", { name: "cash-" + suffix, exact: true })
      .click();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Принять оплату", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Подтверждаю полную оплату/ }),
    ).toBeVisible();
    detail = await (
      await page.request.get(`/api/v1/accounts/${accountId}`)
    ).json();
    expect(detail.status).toBe("awaiting_payment");
    expect(detail.paid).toBe(detail.total);
    await page
      .getByRole("button", { name: /Подтверждаю полную оплату/ })
      .click();
    await expect(page.locator(".detail .section-heading .badge")).toHaveText(
      "Закрыт",
    );
    const final = await (
      await page.request.get(`/api/v1/accounts/${accountId}`)
    ).json();
    expect(final.status).toBe("closed");
    expect(final.payments).toHaveLength(2);
    expect(
      final.payments.some((p: { methodId: string }) => p.methodId === cashId),
    ).toBe(true);
    const shiftId = final.shiftId;
    await command(`shifts/${shiftId}/close`, { actualCash: final.total - 5000, reason: "" });
    await logout(page);
    await login(page, "e2e-owner");
    const audit = await (
      await page.request.get(`/api/v1/audit?entityId=${accountId}`)
    ).json();
    expect(
      audit.items.filter(
        (e: { action: string }) => e.action === "AcceptPayment",
      ),
    ).toHaveLength(2);
    expect(
      audit.items.filter(
        (e: { action: string }) => e.action === "CloseAccount",
      ),
    ).toHaveLength(1);
  });
}
