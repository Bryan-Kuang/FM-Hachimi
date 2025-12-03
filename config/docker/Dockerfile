FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY .env.example ./.env.example

# Environment
ENV NODE_ENV=production

# Healthcheck (requires scripts/deploy/healthcheck.js)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD node scripts/deploy/healthcheck.js || exit 1

# Run as non-root
RUN adduser -D appuser && chown -R appuser:appuser /app
USER appuser

CMD ["node", "src/index.js"]

