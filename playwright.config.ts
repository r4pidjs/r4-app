import { defineConfig } from "@playwright/test";

const port = Number(process.env.VRT_PORT ?? 4310);

export default defineConfig({
  testDir: "tests/vrt",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:" + port,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: "./node_modules/.bin/r4 start --root app --port " + port,
    url: "http://127.0.0.1:" + port + "/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
