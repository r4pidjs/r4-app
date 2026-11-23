# Deploy

The Dockerfile builds the app and serves it from a slim runtime image. The
runtime binds `0.0.0.0:10000` and Render checks `/healthz`.

## Build the image locally

The install and Rust build steps read a GitHub Packages token from the
BuildKit secret `github_pkg_token`. The token needs `repo` and
`read:packages`.

```sh
printf '%s' "$GITHUB_PKG_TOKEN" > /tmp/github_pkg_token
docker build --secret id=github_pkg_token,src=/tmp/github_pkg_token -t r4-app .
rm /tmp/github_pkg_token
```

Run it:

```sh
docker run --rm -p 10000:10000 r4-app
```

The image sets `HOST=0.0.0.0`, `PORT=10000`, and `R4_RENDER_WORKERS=1`.

## Render

Both services use the same repository, branch, Dockerfile, and health
check:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/r4pidjs/r4-app` |
| Branch | `main` |
| Runtime | Docker |
| Dockerfile path | `./Dockerfile` |
| Health check path | `/healthz` |
| Region | Singapore |

`r4-app-canary` already exists. Create `r4-app-production` with the same
settings.

Each service needs a secret file named `github_pkg_token` that contains a
classic GitHub token with `repo` and `read:packages`. Render exposes
secret files to Docker builds as BuildKit secrets. The Dockerfile reads
the token from `/run/secrets/github_pkg_token` for pnpm and the cargo git
fetch.

Keep auto-deploy off if you want to promote after the canary passes. The
existing canary service has auto-deploy off, so trigger a deploy from the
dashboard after merging.

The free plan has 512 MB of memory. The image sets `R4_RENDER_WORKERS=1`
to keep one V8 renderer worker.

## Runtime layout

The image copies the binary, `bundle.js`, `npm/`, and `web/` into `/app`.
The binary reads `bundle.js` and `web/assets/manifest.json` from its
working directory. At runtime `app_root()` falls back to the working
directory when the build-time crate path is absent.
