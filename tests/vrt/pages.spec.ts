import { expect, test } from "@playwright/test";

const dynamic = (page: import("@playwright/test").Page) => [
  page.locator("[data-vrt-mask]"),
];

test("home page", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-island='counter'][data-hydrated]").waitFor();
  await page.locator("[data-island='bff'] [data-vrt-mask]").waitFor();

  await expect(page).toHaveScreenshot("home.png", {
    mask: dynamic(page),
    maskColor: "#e5e7eb",
  });
});

test("about page", async ({ page }) => {
  await page.goto("/about");

  await expect(page).toHaveScreenshot("about.png", {
    mask: dynamic(page),
    maskColor: "#e5e7eb",
  });
});

test("streamed page", async ({ page }) => {
  await page.goto("/stream");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stream");

  await expect(page).toHaveScreenshot("stream.png", { fullPage: true });
});

test("not found page", async ({ page }) => {
  const response = await page.goto("/missing");

  expect(response?.status()).toBe(404);
  await expect(page).toHaveScreenshot("not-found.png", {
    mask: dynamic(page),
    maskColor: "#e5e7eb",
  });
});
