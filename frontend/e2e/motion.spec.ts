import { test, expect } from "@playwright/test";

test("mobile menu stays usable without a dark overlay and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  const overlay = page.getByRole("button", { name: "Закрыть меню" });
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const duration = await page
    .locator(".sidebar")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.001);
  await overlay.click();
  await expect(overlay).toHaveCount(0);
  await page.getByRole("button", { name: "Ещё разделы" }).click();
  await page
    .locator("#club-navigation")
    .getByRole("button", { name: "Каталог и склад" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Каталог и склад", exact: true }),
  ).toBeVisible();
});
