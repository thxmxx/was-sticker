# syntax=docker/dockerfile:1.7
#
# was-sticker bot — image for Fly.io / any container host.
#
# Two stages: install deps once with caching, then a slim runtime layer.
# Sharp + Baileys + libsignal all use native modules; node:20-bookworm-slim
# ships glibc + libvips and works with sharp's prebuilt binaries.

FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Lockfile first for layer caching.
COPY package.json package-lock.json ./

# We install dev deps in this stage because the bot depends on Baileys / pino /
# sharp / qrcode-terminal, which are declared as devDependencies of the lib
# itself. Pruning would remove them.
RUN npm ci --include=dev

FROM node:20-bookworm-slim AS runtime

# libvips runtime lives in the base image; nothing extra to apt-install.
WORKDIR /app

# Code (no node_modules yet — copy from deps stage)
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY examples ./examples
COPY package.json ./

# The bot calls `useMultiFileAuthState('./auth')`, which resolves relative to
# the process cwd. Run it from /data so the auth folder lands on the volume.
WORKDIR /data

# Default to pairing-code mode (PAIRING=1) — set PHONE via `fly secrets set`.
ENV PAIRING=1 NODE_ENV=production

CMD ["node", "/app/examples/rebrand-bot.js"]
