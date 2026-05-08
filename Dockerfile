FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npx tsc

# ---- Production image ----
FROM node:22-alpine

# System deps (ffmpeg for audio, python for yt-dlp, ca-certs for HTTPS)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    ca-certificates

# yt-dlp (bilibili + YouTube audio extractor invoked by the bot).
# [default] extras include yt-dlp-ejs — the External JavaScript Solver
# scripts that YouTube's signature challenge requires. Node.js (already in
# this image) is used as the JS runtime via --js-runtimes node.
RUN pip3 install --no-cache-dir --break-system-packages --upgrade "yt-dlp[default]" && \
    mkdir -p /home/node/.config/yt-dlp && \
    echo "--js-runtimes node" > /home/node/.config/yt-dlp/config && \
    chown -R node:node /home/node/.config

WORKDIR /app

# Prod-only deps — no typescript / @types / jest etc.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

# Non-root user
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production \
    METRICS_ENABLED=true \
    METRICS_HOST=127.0.0.1 \
    METRICS_PORT=9090

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://127.0.0.1:9090/healthz >/dev/null || exit 1

CMD ["node", "dist/index.js"]
