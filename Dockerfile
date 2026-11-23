# Build the app for Render and serve it from a slim runtime image.
#
# The build needs a GitHub Packages token as a BuildKit secret named
# github_pkg_token. Render mounts the service secret file with that id.
# Locally:
#   docker build --secret id=github_pkg_token,src=/tmp/github_pkg_token .

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
  '  *Password*) tr -d "\r\n" < /run/secrets/github_pkg_token ;;' \
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
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
  cargo build --locked --manifest-path app/Cargo.toml --bin typegen

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
  cargo build --release --locked --manifest-path app/Cargo.toml --bin app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
  printf '//npm.pkg.github.com/:_authToken=%s\n' "$(tr -d '\r\n' < /run/secrets/github_pkg_token)" > /root/.npmrc \
  && pnpm install --frozen-lockfile --ignore-scripts \
  && rm -f /root/.npmrc

COPY . .

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
  pnpm build

RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=secret,id=github_pkg_token,dst=/run/secrets/github_pkg_token,required=true \
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
COPY --from=builder /src/app/bundle.js /app/bundle.js
COPY --from=builder /src/app/npm /app/npm
COPY --from=builder /src/app/web /app/web

USER r4

EXPOSE 10000

CMD ["/app/app"]
