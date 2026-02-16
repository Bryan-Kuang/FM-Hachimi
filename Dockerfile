# Multi-stage build for Bilibili Discord Bot
FROM node:22-alpine AS base

# Install system dependencies (ffmpeg, python for yt-dlp)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    ca-certificates

# Install yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy application source
COPY src ./src

# Use existing non-root 'node' user (uid 1000 in node:alpine)
RUN chown -R node:node /app
USER node

# Environment
ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('./src/index.js')" || exit 1

# Run the bot
CMD ["node", "src/index.js"]
