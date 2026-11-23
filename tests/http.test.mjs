import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.TEST_PORT ?? 4311);
const BASE = "http://127.0.0.1:" + PORT;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(BASE + "/api/health");

      if (response.ok) {
        return;
      }
    } catch {
      // The app is still booting its V8 workers.
    }

    await delay(100);
  }

  throw new Error("r4 app did not start on " + BASE);
}

before(async () => {
  server = spawn("../target/debug/app", [], {
    cwd: "app",
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForServer();
});

after(() => {
  server?.kill("SIGTERM");
});

test("home page renders the page and its islands", async () => {
  const response = await fetch(BASE + "/");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<h1>R4 \+ React<\/h1>/);
  assert.match(html, /data-island="counter"/);
  assert.match(html, /data-island="bff"/);
});

test("about page renders through the shared layout", async () => {
  const response = await fetch(BASE + "/about");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<h1>About<\/h1>/);
  assert.match(html, /data-r4-root/);
});

test("the route manifest lists the page routes", async () => {
  const manifest = await (await fetch(BASE + "/routes.json")).json();
  const paths = manifest.routes.map(route => route.path);

  assert.ok(paths.includes("/"));
  assert.ok(paths.includes("/about"));
});

test("health reports status, version, and uptime", async () => {
  const body = await (await fetch(BASE + "/api/health")).json();

  assert.equal(body.status, "ok");
  assert.equal(typeof body.version, "string");
  assert.equal(typeof body.uptimeSeconds, "number");
  assert.equal(typeof body.timestamp, "number");
});

test("the platform health check responds", async () => {
  const response = await fetch(BASE + "/healthz");

  assert.equal(response.status, 200);
  assert.ok((await response.text()).length > 0);
});

test("metrics report the renderer and cache counters", async () => {
  const response = await fetch(BASE + "/api/metrics");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof body.renderer.renders, "number");
  assert.equal(typeof body.renderer.recycles, "number");
  assert.equal(typeof body.cache.hits, "number");
  assert.equal(typeof body.cache.misses, "number");
});

test("hello greets with and without a name", async () => {
  assert.equal(await (await fetch(BASE + "/api/hello")).text(), "Hello from native Axum");
  assert.equal(
    await (await fetch(BASE + "/api/hello?name=Ada")).text(),
    "Hello, Ada, from native Axum",
  );
});

test("echo validates JSON and rejects empty messages", async () => {
  const ok = await fetch(BASE + "/api/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "  hi  " }),
  });
  const body = await ok.json();

  assert.equal(ok.status, 200);
  assert.equal(body.message, "hi");
  assert.equal(body.length, 2);

  const empty = await fetch(BASE + "/api/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });

  assert.equal(empty.status, 422);
  assert.equal((await empty.json()).error.code, "empty_message");
});

test("unknown paths render the 404 page", async () => {
  const response = await fetch(BASE + "/missing");
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.match(html, /<h1>Not found<\/h1>/);
});

test("the asset server serves the island modules", async () => {
  const response = await fetch(BASE + "/__assets/web/islands/counter.tsx");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
});
