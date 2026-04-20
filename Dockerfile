# =========================================================================
# Builder stage — install ALL deps, compile TypeScript to dist/
# =========================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# tsc needs package.json + lock + source + tsconfigs
COPY package*.json ./
COPY tsconfig*.json ./

# Full install including devDependencies (typescript, @types/*)
# --ignore-scripts is fine here because we don't need postinstall for the
# build itself; runtime stage does its own install.
RUN npm ci --ignore-scripts

COPY src ./src

# Compile src/**/*.ts → dist/**/*.js. tsconfig.build.json excludes tests.
RUN npm run build

# =========================================================================
# Runtime stage — slim image with only what's needed to run the bot
# =========================================================================
FROM node:22-alpine AS runtime

# System deps (ffmpeg for audio, python for yt-dlp, ca-certs for HTTPS)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    ca-certificates

# yt-dlp (the actual bilibili extractor invoked by the bot)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Prod-only deps — smaller image, no typescript / @types / jest etc.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Source is still required at runtime: the .js entrypoint (src/index.js)
# requires legacy JS modules directly, and the shadow bridge resolves
# dist/ relative to src/app/. We need both.
COPY src ./src

# Compiled TS output from the builder stage. The shadow_runner_bridge
# tries `../../dist/src/app/shadow_runner` first, then `../../dist/app/shadow_runner`.
# With rootDir=./src in tsconfig.json, tsc emits to dist/app/shadow_runner.js
# (not dist/src/app/...), so the second candidate is the live one.
COPY --from=builder /app/dist ./dist

# Non-root user (uid 1000 in node:alpine). Do this last so it owns
# everything including dist/.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('./src/index.js')" || exit 1

CMD ["node", "src/index.js"]
