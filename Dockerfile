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
# --upgrade forces the latest release so signature-solving stays current.
RUN pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp

WORKDIR /app

# Prod-only deps — no typescript / @types / jest etc.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

# Non-root user
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('./dist/index.js')" || exit 1

CMD ["node", "dist/index.js"]
