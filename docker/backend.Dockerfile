# Build from the repo root:  docker build -f docker/backend.Dockerfile -t reel-backend .
FROM python:3.12-slim

# FFmpeg/FFprobe are required for all video work; libsndfile for audio decoding helpers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 fonts-dejavu-core fonts-noto-core fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set to "1" to also install faster-whisper (captions). Adds ~100 MB.
ARG WITH_CAPTIONS=1

COPY backend/requirements.txt backend/requirements-captions.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$WITH_CAPTIONS" = "1" ]; then pip install --no-cache-dir -r requirements-captions.txt; fi

COPY backend/app ./app

# Run as an unprivileged user; storage is a mounted volume.
RUN useradd --create-home reel && mkdir -p /data/storage && chown -R reel /data /app
USER reel
ENV STORAGE_PATH=/data/storage \
    NUMBA_CACHE_DIR=/tmp/numba \
    HF_HOME=/data/hf

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
