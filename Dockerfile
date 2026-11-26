FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 RIFFSYNC_DATA=/data OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TF_CPP_MIN_LOG_LEVEL=2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/ ./backend/
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir ./backend -r backend/requirements-ai.txt
COPY --from=frontend /build/frontend/dist/ ./frontend/dist/
RUN useradd --create-home --uid 10001 riffsync && mkdir -p /data /home/riffsync/.cache/torch && chown -R riffsync:riffsync /data /home/riffsync
USER riffsync
EXPOSE 8000
CMD ["uvicorn", "riffsync.api:app", "--host", "0.0.0.0", "--port", "8000"]
