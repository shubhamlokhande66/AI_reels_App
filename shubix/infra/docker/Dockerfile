# One image, two processes (cheap on Cloudflare Containers: one container wakes, not two):
#   BE/api      NestJS on 127.0.0.1:4000 (FFmpeg, the AI models, MongoDB)
#   FE/web-app  Next.js standalone on :3000, /api/* rewritten to the API inside the container
# Build from the monorepo root: docker build -f infra/docker/Dockerfile .
FROM node:22-trixie-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
# onnxruntime-node: the CPU build only (no GPU download at install)
ENV npm_config_onnxruntime_node_install=skip
COPY . ./
RUN pnpm install --frozen-lockfile --filter "@shubix/web-app..." --filter "@shubix/api..."
# the rewrite target is fixed at build time: the API in the same container
RUN API_URL=http://127.0.0.1:4000 pnpm --filter @shubix/web-app build \
    && pnpm --filter @shubix/api build \
    && pnpm --filter @shubix/api deploy --prod --legacy /out/api

FROM node:22-trixie-slim AS run
ARG TIGRISFS_VERSION=1.2.1
# FFmpeg (and fonts for captions); tigrisfs mounts the R2 bucket for My Reels (start.sh)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core fontconfig fuse3 ca-certificates curl \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz \
    && tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && rm /tmp/tigrisfs.tar.gz && chmod +x /usr/local/bin/tigrisfs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 API_PORT=4000 STORAGE_PATH=/data/storage SCRATCH_PATH=/tmp/reel-scratch HF_HOME=/tmp/hf
COPY --from=build /out/api ./api
RUN rm -rf ./api/node_modules/onnxruntime-node/bin/napi-v*/darwin ./api/node_modules/onnxruntime-node/bin/napi-v*/win32
COPY --from=build /repo/FE/web-app/.next/standalone ./web
COPY --from=build /repo/FE/web-app/.next/static ./web/FE/web-app/.next/static
COPY --from=build /repo/FE/web-app/public ./web/FE/web-app/public
COPY infra/docker/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data/storage
EXPOSE 3000
CMD ["/start.sh"]
