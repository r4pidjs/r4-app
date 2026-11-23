import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.DEV_TEST_PORT ?? 4314);
const BASE = "http://127.0.0.1:" + PORT;
const PAGE = "app/web/pages/about.tsx";
const MARKER = "Supervisor rebuild marker.";
let server;
let original;

async function waitFor(check, label, attempts = 600) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // Still starting or rebuilding.
    }

    await delay(100);
  }

  throw new Error("timed out waiting for " + label);
}

before(async () => {
  original = await readFile(PAGE, "utf8");
  server = spawn(
    "./node_modules/.bin/r4",
    ["dev", "--root", "app", "--port", String(PORT)],
    { stdio: "ignore" },
  );
  await waitFor(
    async () => (await fetch(BASE + "/api/health")).ok,
    "the dev supervisor to become healthy",
  );
});

after(async () => {
  if (original) {
    await writeFile(PAGE, original);
  }

  server?.kill("SIGTERM");
});

test("dev serves the dev channel and rebuilds on a source change", async () => {
  const dev = await fetch(BASE + "/__r4/dev.js");

  assert.equal(dev.status, 200);
  assert.match(dev.headers.get("content-type") ?? "", /javascript/);

  assert.ok(original.includes("<h1>About</h1>"), "the page marker anchor exists");
  await writeFile(
    PAGE,
    original.replace("<h1>About</h1>", "<h1>About</h1>\n      <p>" + MARKER + "</p>"),
  );

  await waitFor(async () => {
    const html = await (await fetch(BASE + "/about")).text();

    return html.includes(MARKER);
  }, "the rebuilt page");

  await writeFile(PAGE, original);

  await waitFor(async () => {
    const html = await (await fetch(BASE + "/about")).text();

    return !html.includes(MARKER);
  }, "the restored page");
});
