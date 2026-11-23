import { expect, test } from "@playwright/test";

const mask = (page: import("@playwright/test").Page) => [page.locator("[data-vrt-mask]")];

test("end to end: home island, client navigation, and the 404 page", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  // 1. Home renders in Rust, then the counter island hydrates and takes input.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("R4 + React");
  await page.locator("[data-island='counter'][data-hydrated]").waitFor();
  await page.locator("[data-island='bff'] [data-vrt-mask]").waitFor();

  const count = page.getByRole("button", { name: /Count:/ });
  await expect(count).toHaveText("Count: 0");
  await count.click();
  await count.click();
  await expect(count).toHaveText("Count: 2");

  // 2. The BFF island read the native endpoints over HTTP.
  await expect(page.locator("[data-island='bff']")).toContainText("/api/health ok");

  await expect(page).toHaveScreenshot("flow-1-home.png", {
    mask: mask(page),
    maskColor: "#e5e7eb",
  });

  // 3. Client navigation: no reload, View Transition, new island instance.
  const probe = await page.evaluate(() => {
    const current = window as {
      __probe?: string;
      __viewTransitions?: number;
    };

    current.__probe = "kept";
    current.__viewTransitions = 0;

    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    const original = doc.startViewTransition;

    if (typeof original === "function") {
      doc.startViewTransition = callback => {
        current.__viewTransitions = (current.__viewTransitions ?? 0) + 1;

        return original.call(doc, callback);
      };
    }

    return { supported: typeof original === "function" };
  });

  await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("About");
  await expect(page).toHaveURL(/\/about$/);

  /* A full reload would drop the probe and reset the counter. */
  expect(
    await page.evaluate(() => (window as { __probe?: string }).__probe),
  ).toBe("kept");
  expect(
    await page.evaluate(
      () => (window as { __viewTransitions?: number }).__viewTransitions ?? 0,
    ),
  ).toBe(probe.supported ? 1 : 0);

  await expect(page).toHaveScreenshot("flow-2-about.png", {
    mask: mask(page),
    maskColor: "#e5e7eb",
  });

  // 4. Back home: the island is a fresh instance, not the previous state.
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("R4 + React");
  await expect(page.getByRole("button", { name: /Count:/ })).toHaveText("Count: 0");

  await expect(page).toHaveScreenshot("flow-3-home-again.png", {
    mask: mask(page),
    maskColor: "#e5e7eb",
  });

  // Nothing above should have thrown or logged an error.
  expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
  expect(pageErrors, JSON.stringify(pageErrors, null, 2)).toEqual([]);

  // 5. Unknown paths render the Rust 404 page with a 404 status. The browser
  // logs the expected 404 response, so only page exceptions are asserted here.
  const response = await page.goto("/missing");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  await expect(page.getByText("Nothing is routed at /missing.")).toBeVisible();

  await expect(page).toHaveScreenshot("flow-4-not-found.png", {
    mask: mask(page),
    maskColor: "#e5e7eb",
  });

  expect(pageErrors, JSON.stringify(pageErrors, null, 2)).toEqual([]);
});
