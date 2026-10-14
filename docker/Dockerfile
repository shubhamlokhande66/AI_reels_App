# The whole app (website and API in one Next.js server). Build from the repo root:
#   docker build -f docker/Dockerfile -t reel-app .
# Debian (not Alpine) so the native packages (sharp) and FFmpeg match; fonts with Devanagari for captions and story text.
# On Cloudflare Containers the R2 bucket is mounted at STORAGE_PATH by docker/start.sh (tigrisfs, FUSE).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim AS run
ARG TIGRISFS_VERSION=1.2.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core fontconfig fuse3 ca-certificates curl \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz \
    && tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && rm /tmp/tigrisfs.tar.gz && chmod +x /usr/local/bin/tigrisfs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_PATH=/data/storage SCRATCH_PATH=/tmp/reel-scratch HF_HOME=/tmp/hf
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
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data/storage
# root: mounting the bucket (FUSE) needs it; the container itself is the isolation boundary
EXPOSE 3000
CMD ["/start.sh"]
