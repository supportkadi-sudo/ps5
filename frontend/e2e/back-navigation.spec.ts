import { test, expect } from "@playwright/test";
test("browser back closes menu and account opening and navigates sections", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в клуб" }).click();
  if (isMobile) {
    await page.getByRole("button", { name: "Меню", exact: true }).click();
    await expect(page.locator(".sidebar")).toHaveClass(/open/);
    await page.evaluate(() => history.back());
    await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
    await page.getByRole("button", { name: "Меню", exact: true }).click();
  }
  await page
    .locator("#club-navigation")
    .getByRole("button", { name: "Смена и касса", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.getByRole("button", { name: /Кабинка 01/ })).toBeVisible();
  await page.evaluate(() => history.forward());
  await expect(
    page.getByRole("button", { name: "Открыть смену", exact: true }),
  ).toBeVisible();
  await page.getByRole("spinbutton").fill("100000");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(page.getByText("Смена открыта", { exact: true })).toBeVisible();
  await page.evaluate(() => history.back());
  await page.getByRole("button", { name: /Кабинка 01/ }).click();
  await expect(page.locator("[name=tariffId]")).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.locator("[name=tariffId]")).toHaveCount(0);
});
