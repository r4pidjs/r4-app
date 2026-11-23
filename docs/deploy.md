# Deploy

The Dockerfile builds the app and serves it from a slim runtime image. The
runtime binds `0.0.0.0:10000` and Render checks `/healthz`.

## Build the image locally

The install step reads a GitHub Packages token from the BuildKit secret
`github_pkg_token`. The token needs `read:packages`. The Rust build reads
the repository token from `github_repo_token`. That token needs `repo` to
fetch the private r4 tag. One classic token with both scopes can fill both
files.

```sh
printf '%s' "$GITHUB_PKG_TOKEN" > /tmp/github_pkg_token
printf '%s' "$GITHUB_REPO_TOKEN" > /tmp/github_repo_token
docker build \
  --secret id=github_pkg_token,src=/tmp/github_pkg_token \
  --secret id=github_repo_token,src=/tmp/github_repo_token \
  -t r4-app .
rm /tmp/github_pkg_token /tmp/github_repo_token
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

`r4-app-canary` and `r4-app-production` already exist. Both use the settings
above.

Each service needs two secret files:

| File | Token scope |
| --- | --- |
| `github_pkg_token` | `read:packages` for `pnpm install` |
| `github_repo_token` | `repo` for the private r4 git tag |

One classic token with both scopes can fill both files. Render exposes
secret files to Docker builds as BuildKit secrets. The Dockerfile reads
them from `/run/secrets/github_pkg_token` and
`/run/secrets/github_repo_token`.

The `Deploy` workflow triggers deploys through the Render API. Auto-deploy
stays off so the workflow controls when each service builds.

The free plan has 512 MB of memory. The image sets `R4_RENDER_WORKERS=1`
to keep one V8 renderer worker.

## GitHub Actions

`.github/workflows/deploy.yml` triggers Render deploys. A pull request deploys
its head commit to `r4-app-canary`. A push to `main` deploys the commit to the
canary and then production. The job waits for each deploy to go live.

Set these repository settings:

| Name | Kind | Value |
| --- | --- | --- |
| `RENDER_IO_API_KEY` | repository secret | Render API key for the workspace |
| `RENDER_CANARY_SERVICE_ID` | variable | Optional, defaults to the current canary ID |
| `RENDER_PRODUCTION_SERVICE_ID` | variable | Optional, defaults to the current production service ID |

The workflow skips with a warning when `RENDER_IO_API_KEY` is missing, so forks
and unconfigured clones do not fail.

Render builds the Dockerfile for each deploy. The workflow does not run a
separate image build.

## Build cache

The builder prewarms the debug typegen and release app dependency graphs with
dummy bin targets before copying the application source. It touches the real
Rust sources after the copy so Cargo rebuilds the app and typegen. A
source-only change reuses the compiled r4, deno, and V8 artifacts. The pnpm
store and the Cargo registry and git checkouts use BuildKit cache mounts.

## Runtime layout

The image copies the binary, `snapshot.bin`, `bundle.js`, `npm/`, and
`web/` into `/app`. The binary starts V8 from `snapshot.bin` beside it and
reads `bundle.js` and `web/assets/manifest.json` from its working
directory. At runtime `app_root()` falls back to the working
directory when the build-time crate path is absent.
