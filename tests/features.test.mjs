import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.TEST_PORT ?? 4312);
const BASE = "http://127.0.0.1:" + PORT;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(BASE + "/api/health")).ok) {
        return;
      }
    } catch {
      // Still booting.
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

test("the route manifest carries ids, methods, pages, and params", async () => {
  const { routes } = await (await fetch(BASE + "/routes.json")).json();
  const home = routes.find(route => route.path === "/");

  assert.deepEqual(
    routes.map(route => route.path).sort(),
    ["/", "/about"],
  );
  assert.equal(home.id, "home");
  assert.deepEqual(home.methods, ["GET"]);
  assert.equal(home.page, "home");
  assert.deepEqual(home.params, []);
});

test("pages are ISR cached: second hit is a cache hit", async () => {
  const first = await fetch(BASE + "/about");
  const firstCache = first.headers.get("x-cache");
  const firstRenders = (await (await fetch(BASE + "/api/metrics")).json()).renderer.renders;

  const second = await fetch(BASE + "/about");
  const secondCache = second.headers.get("x-cache");
  const after = await (await fetch(BASE + "/api/metrics")).json();

  assert.match(firstCache ?? "", /^(miss|fresh|stale)$/);
  assert.equal(secondCache, "fresh");
  assert.equal(after.renderer.renders, firstRenders);
  assert.ok(after.cache.hits > 0);
});

test("pages set a cache policy browsers and CDNs can use", async () => {
  const response = await fetch(BASE + "/");

  assert.match(
    response.headers.get("cache-control") ?? "",
    /public, max-age=\d+, stale-while-revalidate=\d+/,
  );
});

test("security headers include a script-hash CSP", async () => {
  const response = await fetch(BASE + "/");
  const csp = response.headers.get("content-security-policy") ?? "";

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("brand assets are served without rendering", async () => {
  const renders = async () =>
    (await (await fetch(BASE + "/api/metrics")).json()).renderer.renders;
  const before = await renders();
  const assets = [
    ["/favicon.ico", "image/x-icon"],
    ["/apple-touch-icon.png", "image/png"],
    ["/icon.svg", "image/svg+xml"],
    ["/logo.svg", "image/svg+xml"],
  ];

  for (const [path, type] of assets) {
    const response = await fetch(BASE + path);
    const body = await response.arrayBuffer();

    assert.equal(response.status, 200, path);
    assert.ok(
      (response.headers.get("content-type") ?? "").startsWith(type),
      path + " content type",
    );
    assert.ok(body.byteLength > 0, path + " has a body");
  }

  assert.equal(await renders(), before);
});

test("the import map is fingerprinted and maps bare React", async () => {
  const map = await (await fetch(BASE + "/__assets/import-map.json")).json();
  const island = map.imports["/__assets/web/islands/counter.tsx"];

  assert.match(island, /^\/__assets\/web\/islands\/counter\.[0-9a-f]{16}\.js$/);
  assert.match(map.imports.react, /^\/__assets\/npm\/react\.[0-9a-f]{16}\.js$/);
  assert.match(map.imports["react-dom/client"], /react-dom-client\.[0-9a-f]{16}\.js$/);
});

test("fingerprinted assets are immutable", async () => {
  const map = await (await fetch(BASE + "/__assets/import-map.json")).json();
  const response = await fetch(BASE + map.imports["/__assets/web/islands/counter.tsx"]);

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
});

test("the router and route manifest are versioned and immutable", async () => {
  const html = await (await fetch(BASE + "/")).text();
  const router = /src="(\/__r4\/router\.[0-9a-f]{16}\.js)"/.exec(html)?.[1];
  const routes = /data-routes="(\/routes\.[0-9a-f]{16}\.json)"/.exec(html)?.[1];

  assert.ok(router, "the document links the versioned router");
  assert.ok(routes, "the document links the versioned manifest");

  for (const path of [router, routes]) {
    const response = await fetch(BASE + path);

    assert.equal(response.status, 200, path);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
      path,
    );
  }

  const stable = await fetch(BASE + "/__r4/router.js");

  assert.equal(stable.status, 200);
  assert.equal(stable.headers.get("cache-control"), "no-cache");
});

test("the stylesheet is served through the asset server", async () => {
  const html = await (await fetch(BASE + "/")).text();
  const href = /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1];

  assert.ok(href, "the layout links a stylesheet");
  const response = await fetch(BASE + href);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/css/);
});

test("typed RPC authorizes, validates, and returns typed data", async () => {
  const headers = {
    authorization: "Bearer r4",
    "content-type": "application/json",
    "x-csrf-token": "r4",
  };
  const call = (body, extra = {}) =>
    fetch(BASE + "/_rpc/bff.greet", {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });

  const ok = await call({ name: "Ada" });
  const okBody = await ok.json();

  assert.equal(ok.status, 200);
  assert.equal(okBody.ok, true);
  assert.match(okBody.data.message, /^Hello, Ada, from typed RPC$/);
  assert.equal(typeof okBody.data.timestamp, "number");

  const unauthorized = await call({ name: "Ada" }, { authorization: "" });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "unauthorized");

  const forbidden = await call({ name: "Ada" }, { "x-csrf-token": "nope" });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "forbidden");

  const invalid = await call({ name: "   " });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "bad_request");

  const unknown = await fetch(BASE + "/_rpc/bff.nope", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(unknown.status, 404);
});

test("the stream route forwards the V8 render stream", async () => {
  const response = await fetch(BASE + "/stream");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(response.headers.get("transfer-encoding") ?? "", /chunked/);
  assert.match(body, /<h1>Stream<\/h1>/);
  assert.match(body, /<code>\/stream<\/code>/);
  assert.match(body, /streamed from React through V8/);
});

test("the html assigns a stable root and hydratable islands", async () => {
  const html = await (await fetch(BASE + "/")).text();

  assert.match(html, /<div data-r4-root=""/);
  assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml"\/>/);
  assert.match(html, /<a class="brand" href="\/"/);
  assert.match(html, /<img src="\/logo\.svg" alt="R4 \+ React"/);
  assert.match(html, /data-island="counter" data-props="\{&quot;start&quot;:0\}"/);
  assert.match(html, /<script type="importmap">/);

  const router =
    /<script type="module" src="\/__r4\/router\.[0-9a-f]{16}\.js"[^>]*>/.exec(html)?.[0];

  assert.ok(router, "the layout loads the versioned framework router");
  assert.match(router, /data-r4-router=""/);
  assert.match(
    router,
    /data-islands="\/__assets\/web\/\.generated\/islands-client\.[0-9a-f]{16}\.js"/,
  );
  assert.match(router, /data-routes="\/routes\.[0-9a-f]{16}\.json"/);
  assert.match(router, /data-preload="none"/);
});
