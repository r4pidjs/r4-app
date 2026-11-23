# Build the app for Render and serve it from a slim runtime image.
#
# The build needs two BuildKit secrets:
#   github_pkg_token: a classic GitHub token with read:packages for pnpm
#   github_repo_token: a GitHub token with repo for the private r4 tag
# Render mounts the service secret files with the same names. Locally:
#   docker build \
#     --secret id=github_pkg_token,src=/tmp/github_pkg_token \
#     --secret id=github_repo_token,src=/tmp/github_repo_token .

FROM node:26-bookworm AS builder

ENV RUST_VERSION=1.100.0 \
    CARGO_TARGET_DIR=/src/target \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    GIT_TERMINAL_PROMPT=0 \
    GIT_ASKPASS=/usr/local/bin/git-askpass

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    binutils \
    build-essential \
    ca-certificates \
    curl \
    git \
    libclang-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}"

ENV PATH="/root/.cargo/bin:${PATH}"

RUN npm install --global pnpm@12.3.4

RUN printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in' \
  '  *Username*) printf "%s\n" "x-access-token" ;;' \
  '  *Password*) tr -d "\r\n" < /run/secrets/github_repo_token ;;' \
  'esac' \
  > /usr/local/bin/git-askpass \
  && chmod +x /usr/local/bin/git-askpass

WORKDIR /src

COPY app/Cargo.toml app/Cargo.lock ./app/

RUN mkdir -p app/src/bin \
  && printf 'fn main() {}\n' > app/src/bin/app.rs \
  && printf 'fn main() {}\n' > app/src/bin/typegen.rs

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_repo_token,dst=/run/secrets/github_repo_token,required=true \
  cargo build --locked --manifest-path app/Cargo.toml --bin typegen

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_repo_token,dst=/run/secrets/github_repo_token,required=true \
  cargo build --release --locked --manifest-path app/Cargo.toml --bin app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
  printf '//npm.pkg.github.com/:_authToken=%s\n' "$(tr -d '\r\n' < /run/secrets/github_pkg_token)" > /root/.npmrc \
  && pnpm install --frozen-lockfile --ignore-scripts \
  && rm -f /root/.npmrc

RUN cp "$(find node_modules -path '*/@r4pidjs/r4-linux-x64/bin/snapshot.bin' -print -quit)" /src/snapshot.bin \
  && test -s /src/snapshot.bin

COPY . .

# The prewarm bins are placeholders. Touch the real Rust sources so Cargo
# rebuilds the app and typegen instead of reusing the prewarm artifacts.
RUN touch app/src/app.rs app/src/bin/app.rs app/src/bin/typegen.rs

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_repo_token,dst=/run/secrets/github_repo_token,required=true \
  pnpm build

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_repo_token,dst=/run/secrets/github_repo_token,required=true \
  cargo build --release --locked --manifest-path app/Cargo.toml --bin app \
  && strip target/release/app

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 r4 \
  && useradd --system --uid 10001 --gid r4 --no-create-home --home-dir /app --shell /usr/sbin/nologin r4

ENV HOST=0.0.0.0 \
    PORT=10000 \
    R4_RENDER_WORKERS=1

WORKDIR /app

COPY --from=builder /src/target/release/app /app/app
COPY --from=builder /src/snapshot.bin /app/snapshot.bin
COPY --from=builder /src/app/bundle.js /app/bundle.js
COPY --from=builder /src/app/npm /app/npm

# The asset server indexes the app root, so the generated .r4 client ships
# beside web/. Without it web/rpc.ts re-exports a module the import map never
# lists, and every island that imports the typed RPC fails to hydrate.
COPY --from=builder /src/app/.r4 /app/.r4
COPY --from=builder /src/app/web /app/web

USER r4

EXPOSE 10000

CMD ["/app/app"]
