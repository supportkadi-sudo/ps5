import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

test("responsive screens remain readable and contained", async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(90000);
  const widths = isMobile ? [360, 393] : [768, 1280, 1440];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of widths) {
    await page.setViewportSize({ width, height: isMobile ? 844 : 1000 });
    await page.goto("/");
    await page.evaluate(async () => {
      const { MockApi } = await import("/src/shared/api/mock/client.ts");
      const api = new MockApi(undefined, (w) =>
        localStorage.setItem("club-crm-demo-v1", JSON.stringify(w)),
      );
      await api.login("owner", "demo");
      await api.execute({
        name: "OpenShift",
        key: crypto.randomUUID(),
        data: { openingCash: 100000 },
      });
      let w = await api.execute({
        name: "CreateAccount",
        key: crypto.randomUUID(),
        data: {
          boothId: "b1",
          tariffId: "ps5",
          customerName: "Гость с длинным именем",
          customerPhone: "",
        },
      });
      const id = w.accounts[0].id;
      w = await api.execute({
        name: "AddLine",
        key: crypto.randomUUID(),
        entityId: id,
        data: { expectedVersion: 1, productId: "cola", quantity: 2 },
      });
      w = await api.execute({
        name: "CreateAccount",
        key: crypto.randomUUID(),
        data: {
          boothId: "b4",
          tariffId: "ps5",
          customerName: "",
          customerPhone: "",
        },
      });
      await api.execute({
        name: "Precheck",
        key: crypto.randomUUID(),
        entityId: w.accounts[1].id,
        data: { expectedVersion: 1 },
      });
    });
    await page.getByRole("button", { name: "Войти в клуб" }).click();
    const folder = path.join(testInfo.outputDir, String(width));
    mkdirSync(folder, { recursive: true });
    const shot = async (name: string) => {
      await page.evaluate(() => scrollTo(0, 0));
      await page.mouse.move(0, 0);
      await expect(page.getByRole("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}: ${name} document overflow`,
      ).toBe(true);
      await page.screenshot({
        path: path.join(folder, name + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    };
    const nav = async (name: string) => {
      if (width <= 720)
        await page.getByRole("button", { name: "Меню", exact: true }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await shot("hall");
    if (width <= 720) {
      await expect(page.getByRole("navigation")).not.toBeVisible();
      await page.getByRole("button", { name: "Меню", exact: true }).click();
      await expect(page.getByRole("navigation")).toBeVisible();
      await page.mouse.click(width - 15, 130);
      await expect(page.getByRole("navigation")).not.toBeVisible();
    }
    await page.getByRole("button", { name: /^Идёт игра Кабинка 01/ }).click();
    await shot("account");
    await page
      .getByRole("button", { name: "Предчек · остановить время" })
      .click();
    await page.getByRole("button", { name: "Перейти к оплате" }).click();
    await shot("payment");
    if (width <= 1150) {
      const summary = await page.locator(".account-grid aside").boundingBox(),
        form = await page.locator(".account-grid .form").boundingBox();
      expect(summary!.y + summary!.height).toBeLessThanOrEqual(form!.y);
    }
    for (const button of await page.locator(".tabs:visible button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await nav("Смена и касса");
    await shot("shift");
    await nav("Каталог и склад");
    await shot("catalog");
    if (width <= 720)
      expect(
        await page
          .locator(".table-scroll")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        "mobile catalog must not hide columns offscreen",
      ).toBe(true);
    await nav("Настройки");
    await shot("settings");
    await page.reload();
  }
  expect(errors).toEqual([]);
});
