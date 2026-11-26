#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  printf 'Execute bash scripts/setup.sh primeiro.\n' >&2
  exit 1
fi
if [[ ! -d frontend/node_modules ]]; then npm ci --prefix frontend; fi
if ! node frontend/scripts/build-info.mjs --check; then npm run build; fi
export RIFFSYNC_DATA="${RIFFSYNC_DATA:-$PWD/data}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-2}"
export TF_CPP_MIN_LOG_LEVEL="${TF_CPP_MIN_LOG_LEVEL:-2}"
mkdir -p "$RIFFSYNC_DATA"
if [[ "${1:-}" == "--background" ]]; then
  exec .venv/bin/python scripts/services.py
else
  .venv/bin/python -m riffsync.worker &
  worker_pid=$!
  trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
  .venv/bin/python -m uvicorn riffsync.api:app --host 0.0.0.0 --port 8000
fi
