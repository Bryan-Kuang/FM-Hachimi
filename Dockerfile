FROM node:22-alpine AS builder

WORKDIR /app

# --ignore-scripts skips the husky `prepare` hook (no .git in the build context).
COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts

COPY src ./src
# Match CI's `npm run build` (lean output: no sourcemaps/comments) instead of
# the default tsconfig.json, so the image ships exactly what CI validated.
RUN npx tsc -p tsconfig.build.json

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
# bgutil-ytdlp-pot-provider is the yt-dlp plugin half of the PO-token
# provider: it fetches GVS PO tokens from the pot-provider sidecar
# (see docker-compose.yml + YTDLP_POT_PROVIDER_URL). YouTube requires PO
# tokens for a growing set of clients — without one, stream URLs 403
# (2026-07-01 tv-client incident).
RUN pip3 install --no-cache-dir --break-system-packages --upgrade \
        "yt-dlp[default]" \
        bgutil-ytdlp-pot-provider && \
    mkdir -p /home/node/.config/yt-dlp && \
    echo "--js-runtimes node" > /home/node/.config/yt-dlp/config && \
    chown -R node:node /home/node/.config

# zotify (direct Spotify extraction sidecar, Project B — see
# src/spotify/direct_extractor.ts + OPERATIONS.md "Spotify direct playback").
# Pinned to a release tag for reproducibility; only used when
# SPOTIFY_DIRECT_ENABLED=true (a dedicated Spotify account's OAuth login must
# still be bootstrapped manually on the deploy host — this install alone
# does not enable playback). Community-maintained fork of the original
# zotify-dev project — chosen over the official librespot-org/librespot
# binary because that binary is a Spotify Connect *receiver* (needs a phone/
# desktop client to remote-control it) and can't be driven as a plain
# "fetch this track id and exit" subprocess the way zotify can.
#
# Alpine build deps: Pillow (album art) needs libjpeg/zlib headers + a C
# compiler to build from source on musl (no manylinux wheels apply here);
# removed again after install to keep the image lean. protobuf/librespot-python
# install as pure-Python/sdist and don't need them, but harmless to have
# present during the same install step.
RUN apk add --no-cache --virtual .zotify-build-deps \
        git gcc musl-dev python3-dev zlib-dev jpeg-dev libffi-dev && \
    apk add --no-cache zlib libjpeg-turbo libffi && \
    pip3 install --no-cache-dir --break-system-packages \
        "git+https://github.com/Googolplexed0/zotify.git@v0.17.0" && \
    apk del .zotify-build-deps

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
