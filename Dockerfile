FROM node:22-alpine

# System deps (ffmpeg for audio, python for yt-dlp, ca-certs for HTTPS)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    ca-certificates

# yt-dlp (the actual bilibili extractor invoked by the bot)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Prod-only deps — no typescript / @types / jest etc.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY src ./src

# Non-root user
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('./src/index.js')" || exit 1

CMD ["node", "src/index.js"]
