# The API alone (BE/api), for Cloudflare with the website on Vercel (docs/deploy-vercel-cloudflare.md): no website
# build or server in it, so the image is smaller, builds faster and wakes faster (a container is billed while awake).
# Build from the monorepo root: docker build -f infra/docker/api.Dockerfile .
FROM node:22-trixie-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
# onnxruntime-node: the CPU build only (no GPU download at install)
ENV npm_config_onnxruntime_node_install=skip
COPY . ./
RUN pnpm install --frozen-lockfile --filter "@shubix/api..."
RUN pnpm --filter @shubix/api build && pnpm --filter @shubix/api deploy --prod --legacy /out/api

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
# NODE_OPTIONS: the API's memory kept well inside the basic instance (1 GiB, with FFmpeg and the R2 mount beside it)
ENV NODE_ENV=production CONTAINER_ROLE=api API_PORT=4000 STORAGE_PATH=/data/storage SCRATCH_PATH=/tmp/reel-scratch HF_HOME=/tmp/hf \
    NODE_OPTIONS=--max-old-space-size=512
COPY --from=build /out/api ./api
# only the Linux AI runtime (the others are hundreds of MB)
RUN rm -rf ./api/node_modules/onnxruntime-node/bin/napi-v*/darwin ./api/node_modules/onnxruntime-node/bin/napi-v*/win32     && if [ "$(dpkg --print-architecture)" = amd64 ]; then rm -rf ./api/node_modules/onnxruntime-node/bin/napi-v*/linux/arm64; fi
COPY infra/docker/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data/storage
EXPOSE 4000
CMD ["/start.sh"]
