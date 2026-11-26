#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

runtime_only=false
case "${1:-}" in
  '') ;;
  --runtime-only) runtime_only=true ;;
  *) printf 'Uso: bash scripts/setup.sh [--runtime-only]\n' >&2; exit 2 ;;
esac
command -v npm >/dev/null || { printf 'Instale Node.js com npm antes de continuar.\n' >&2; exit 1; }
setup_tmp="$(mktemp -d)"
trap 'rm -rf "$setup_tmp"' EXIT

# Use only the distribution repositories for OS packages. Unrelated Yarn keys
# must not prevent FFmpeg installation, and no repository configuration is edited.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  command -v apt-get >/dev/null || { printf 'Instale FFmpeg (ffmpeg e ffprobe) e execute o setup novamente.\n' >&2; exit 1; }
  elevate=()
  if [[ "$EUID" != 0 ]]; then
    command -v sudo >/dev/null && sudo -n true || { printf 'É necessário instalar FFmpeg com privilégios de administrador.\n' >&2; exit 1; }
    elevate=(sudo -n)
  fi
  mkdir -p "$setup_tmp/sources"
  # Debian/Ubuntu official image layouts; keep Signed-By and security updates.
  for distro_source in debian.sources ubuntu.sources debian.list ubuntu.list; do
    if [[ -f "/etc/apt/sources.list.d/$distro_source" ]]; then
      cp "/etc/apt/sources.list.d/$distro_source" "$setup_tmp/sources/"
    fi
  done
  apt_options=(-o "Dir::Etc::sourcelist=/etc/apt/sources.list" -o "Dir::Etc::sourceparts=$setup_tmp/sources")
  printf 'Instalando FFmpeg pelos repositórios do sistema…\n'
  "${elevate[@]}" apt-get "${apt_options[@]}" update
  "${elevate[@]}" apt-get "${apt_options[@]}" install -y --no-install-recommends ffmpeg libsndfile1
fi
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || { printf 'FFmpeg não foi instalado corretamente.\n' >&2; exit 1; }

# uv bootstraps Python without replacing the system interpreter or editing PATH.
uv_bin="$(command -v uv || true)"
if [[ -z "$uv_bin" && -x "$PWD/.tools/uv/uv" ]]; then uv_bin="$PWD/.tools/uv/uv"; fi
if [[ -z "$uv_bin" ]]; then
  printf 'Preparando o instalador de Python…\n'
  if command -v curl >/dev/null; then
    curl --fail --show-error --location https://astral.sh/uv/install.sh --output "$setup_tmp/install-uv.sh"
  elif command -v wget >/dev/null; then
    wget -q https://astral.sh/uv/install.sh -O "$setup_tmp/install-uv.sh"
  else
    printf 'Instale curl ou wget para preparar o Python automaticamente.\n' >&2; exit 1
  fi
  UV_UNMANAGED_INSTALL="$PWD/.tools/uv" sh "$setup_tmp/install-uv.sh"
  uv_bin="$PWD/.tools/uv/uv"
fi

compatible_python() {
  "$1" -c 'import sys; raise SystemExit(0 if (3,10) <= sys.version_info[:2] < (3,12) else 1)' >/dev/null 2>&1
}
python_bin="${RIFFSYNC_PYTHON:-}"
if [[ -n "$python_bin" ]]; then
  if ! command -v "$python_bin" >/dev/null || ! compatible_python "$python_bin"; then
    printf 'RIFFSYNC_PYTHON deve apontar para Python 3.10 ou 3.11; o app usa 3.11 por padrão.\n' >&2; exit 1
  fi
else
  for candidate in "$PWD/.venv/bin/python" python3.11 python3 python; do
    if command -v "$candidate" >/dev/null && compatible_python "$candidate"; then
      python_bin="$(command -v "$candidate")"; break
    fi
  done
  if [[ -z "$python_bin" ]]; then
    printf 'Python compatível não encontrado. Instalando Python 3.11 isoladamente…\n'
    "$uv_bin" python install 3.11
    python_bin="$("$uv_bin" python find --managed-python 3.11)"
  fi
fi

requested_version="$("$python_bin" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
existing_version="$(.venv/bin/python -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
if ! compatible_python "$PWD/.venv/bin/python" || [[ "$existing_version" != "$requested_version" ]]; then
  # Preserve an incompatible or broken environment, never delete project data.
  if [[ -e .venv || -L .venv ]]; then
    backup=".venv.backup-$(date +%Y%m%d-%H%M%S)-$$"
    mv .venv "$backup"
    printf 'Ambiente anterior preservado em %s\n' "$backup"
  fi
  "$uv_bin" venv --seed --python "$python_bin" .venv
fi
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  "$uv_bin" pip install --python .venv/bin/python pip
fi
.venv/bin/python --version
if "$runtime_only"; then
  printf '\nPython e FFmpeg prontos. Execute bash scripts/setup.sh para instalar o app completo.\n'
  exit 0
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -e './backend[test]' -r backend/requirements-ai.txt
npm ci --prefix frontend
npm run build
printf '\nRiffSync instalado. Inicie com: bash scripts/start.sh --background\n'
