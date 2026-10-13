# The whole app (website and API in one Next.js server). Build from the repo root:
#   docker build -f docker/frontend.Dockerfile -t reel-app .
# Debian (not Alpine) so the native packages (sharp) and FFmpeg match; fonts with Devanagari for captions and story text.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS run
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core fontconfig \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_PATH=/data/storage HF_HOME=/data/hf
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# files the server loads at run time by path (face detection models, the worker threads) and the WebAssembly packages
# those workers require directly (build tracing does not follow a worker file)
COPY --from=build /app/server/video/data ./server/video/data
COPY --from=build /app/server/video/face-worker.cjs ./server/video/face-worker.cjs
COPY --from=build /app/server/audio/essentia-worker.cjs ./server/audio/essentia-worker.cjs
COPY --from=deps /app/node_modules/@techstark ./node_modules/@techstark
COPY --from=deps /app/node_modules/essentia.js ./node_modules/essentia.js
RUN mkdir -p /data/storage /data/hf && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
