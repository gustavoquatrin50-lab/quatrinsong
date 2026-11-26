#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python_bin="${RIFFSYNC_PYTHON:-python3.11}"
if ! command -v "$python_bin" >/dev/null; then
  printf 'Instale Python 3.11 ou defina RIFFSYNC_PYTHON com seu caminho.\n' >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { printf 'Instale FFmpeg antes de continuar.\n' >&2; exit 1; }
"$python_bin" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -e './backend[test]' -r backend/requirements-ai.txt
npm ci --prefix frontend
npm run build
printf '\nRiffSync instalado. Inicie com: bash scripts/start.sh\n'
