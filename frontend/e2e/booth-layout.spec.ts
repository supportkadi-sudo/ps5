import { test, expect } from "@playwright/test";

test("booth columns are selectable, remembered and sorted on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  const grid = page.locator(".booth-grid");
  await expect(grid.locator(".booth h2").first()).toHaveText("Кабинка 01");
  const controls = page.getByRole("group", { name: "Количество колонок" });
  await expect(
    controls.getByRole("button", { name: "2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(grid).toHaveCSS("grid-template-columns", /.+ .+/);
  await controls.getByRole("button", { name: "3", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  await expect(
    page
      .getByRole("group", { name: "Количество колонок" })
      .getByRole("button", { name: "3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".booth").first().click();
  await expect(page.getByRole("dialog", { name: "Новый счёт" })).toBeVisible();
});
