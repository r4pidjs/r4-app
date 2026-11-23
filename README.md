# R4 + React

A React app rendered by the [r4](https://github.com/r4pidjs/r4) Rust runtime at `0.0.1-alpha.2`. Pages and layouts render in Rust through V8, React islands hydrate in the browser, and a small native Axum BFF serves `/api/*` beside the renderer.

## Layout

```text
app/                       the r4 app root
  Cargo.toml               app crate, r4 pinned to tag v0.0.1-alpha.2
  src/app.rs               routes!, pages, and the BFF handlers
  src/bin/app.rs           server entry
  src/bin/typegen.rs       app-linked typegen binary
  src/generated/views.rs   generated page and layout handles
  web/
    pages/                 home, about, not-found
    layouts/main.tsx       document shell
    islands/               counter and bff
    server.jsx             page/layout registry rendered in V8
    build.mjs              server bundle, React vendor modules, assets
  static/                  brand source SVGs plus generated favicon.ico and touch icon
tests/
  http.test.mjs            page and endpoint assertions
  vrt/                     Playwright visual and behavior tests
```

The app root is `app/`, not the repository root: r4's asset server walks the app root to build the import map, so it must not contain `node_modules`, `target`, or the cargo cache. `app/.cargo/config.toml` keeps the Rust build in the repository-level `target/` for that reason.

The brand assets are embedded with `include_bytes!`, so the binary serves them without the renderer. `app/static/icon.svg` and `app/static/logo.svg` are the source; `pnpm brand` re-renders `favicon.ico` (16–256 px) and `apple-touch-icon.png` from them.

## Setup

Use Node.js 26 or later and pnpm. `@r4pidjs/r4` is published to GitHub Packages: add `//npm.pkg.github.com/:_authToken=${GITHUB_PKG_TOKEN}` to your user-level `~/.npmrc` and set `GITHUB_PKG_TOKEN` to a classic token with `read:packages`.

```sh
pnpm install
pnpm build
cargo build --manifest-path app/Cargo.toml --bin app
pnpm start        # http://127.0.0.1:3000
```

`pnpm build` generates the view handles and the island registry, runs the app-linked typegen, bundles `web/`, and writes `app/.r4/manifest.json`. `pnpm start` reads that manifest and launches the app binary.

For the rebuild-and-reload loop:

```sh
pnpm dev
```

The CLI supervisor rebuilds Rust, regenerates views, reruns the web asset build, restarts the app binary, and posts to `/__r4/reload`, which streams the reload event the browser listens to. The framework client router lives at `/__r4/router.js` and hydrates islands from the generated registry URL the layout passes as `data-islands`. The layout sets `data-preload="none"` on that script, so hovering a link does not prefetch it. Set the attribute to `hover` or `all` to opt in.

## Routes

| Route | What it serves |
| --- | --- |
| `/` | Rust-rendered home page with the counter and BFF islands |
| `/about` | Second page through the same layout |
| `/routes.json` | Generated route manifest used by client navigation |
| `/stream` | React streaming through V8, forwarded chunk by chunk |
| `/_rpc/bff.greet` | Typed RPC with generated `.r4/rpc.ts` bindings |
| `/__r4/router.js` | Framework client router used for navigation and island hydration |
| `/__assets/*` | Asset server: compiled TSX, CSS, React modules |
| `/icon.svg`, `/logo.svg`, `/favicon.ico`, `/apple-touch-icon.png` | Embedded brand assets, served without the renderer |
| `/missing` | 404 page through the layout |

## BFF endpoints

Native Axum routes mounted on the app router. They run beside the SSR cell, share its state, and never enter the renderer.

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/health` | `{ status, version, uptimeSeconds, timestamp }` |
| `GET` | `/api/metrics` | Renderer and ISR cache counters |
| `GET` | `/api/hello?name=Ada` | Plain-text greeting |
| `POST` | `/api/echo` | `{ message, length, receivedAt }`; `422` with `{ error }` when empty |

```sh
curl http://127.0.0.1:3000/api/health
curl 'http://127.0.0.1:3000/api/hello?name=Ada'
curl -X POST http://127.0.0.1:3000/api/echo \
  -H 'content-type: application/json' \
  -d '{"message":"hi from the BFF"}'
```

## Tests

```sh
pnpm test          # 20 HTTP tests, 1 dev-supervisor test, codegen drift checks
pnpm test:vrt      # 8 Playwright tests: 4 snapshots, 3 behavior, 1 e2e flow
```

`pnpm test` covers the pages, `/routes.json`, every REST endpoint, typed RPC (success, 401, 403, 400, unknown method), the streamed transport, the 404 status, the asset server, ISR cache headers, CSP and security headers, import-map fingerprints, immutable asset caching, and the rendered island markup. The dev test starts `r4 dev`, edits a page, and waits for the supervisor plus the app watcher to rebuild it and restore it. The run finishes with `views --check` and `typegen --check` so generated handles and RPC types cannot drift.

The Playwright suite screenshots home, about, and the 404 page, checks island hydration, BFF reads, and client navigation, then runs one end-to-end journey: home → counter interaction → native API panel → client navigation → fresh island on return → 404 page, asserting no page exceptions and no unexpected console errors along the way.

The visual tests compare against `tests/vrt/pages.spec.ts-snapshots/`. Write or refresh the baselines after an intentional UI change:

```sh
pnpm test:vrt:update
```

Both suites start their own server (`/api/health` on the configured port), so nothing needs to be running first. Stop `pnpm dev` before running them: the dev supervisor watches the same app root and can race with the suites on `views.rs` and the cargo target lock.

## Pinning r4

`app/Cargo.toml` depends on the runtime as a git tag, matching the published CLI:

```toml
r4 = { git = "https://github.com/r4pidjs/r4", tag = "v0.0.1-alpha.2" }
```

The repository is public, so cargo fetches it without a token; `GITHUB_PKG_TOKEN` is only needed for `pnpm install`.
