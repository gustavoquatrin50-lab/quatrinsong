import os
from pathlib import Path

DATA = Path(os.environ.get("RIFFSYNC_DATA", "./data")).resolve()
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "200")) * 1024 * 1024
MAX_DURATION = int(os.environ.get("MAX_DURATION_SECONDS", "1200"))
JOB_TIMEOUT = int(os.environ.get("JOB_TIMEOUT_SECONDS", "7200"))
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "7"))
DEVICE = os.environ.get("RIFFSYNC_DEVICE", "auto")
SEGMENT_SECONDS = float(os.environ.get("SEPARATION_SEGMENT_SECONDS", "7"))
SEPARATION_OVERLAP = float(os.environ.get('SEPARATION_OVERLAP', '.5'))
MODELS = {"htdemucs", "htdemucs_6s", "htdemucs_ft"}
LYRICS_MODEL = os.environ.get('LYRICS_MODEL', 'large-v3-turbo')
LYRICS_LANGUAGE = os.environ.get('LYRICS_LANGUAGE', '')
ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000").split(",") if o.strip()]
