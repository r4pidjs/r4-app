import { expect, test } from "@playwright/test";

test("the counter island hydrates and keeps state", async ({ page }) => {
  await page.goto("/");
  const count = page.getByRole("button", { name: /Count:/ });

  await expect(count).toHaveText("Count: 0");
  await count.click();
  await expect(count).toHaveText("Count: 1");
});

test("the BFF island reads the native endpoints", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-island='bff']")).toContainText("/api/health ok");
});

test("client navigation swaps pages without a reload", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-island='counter'][data-hydrated]").waitFor();

  /* A full reload would drop this window property. */
  await page.evaluate(() => {
    (window as { __probe?: string }).__probe = "kept";
  });

  await page.getByRole("navigation").getByRole("link", { name: "About", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("About");
  await expect(page).toHaveURL(/\/about$/);
  expect(
    await page.evaluate(() => (window as { __probe?: string }).__probe),
  ).toBe("kept");
});
