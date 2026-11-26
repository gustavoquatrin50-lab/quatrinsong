"""Build and restart this checkout's API/worker, then verify both are ready."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


def owned_processes(root):
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            args = (entry/'cmdline').read_bytes().decode(errors='replace').split('\0')
            if not {'riffsync.api:app','riffsync.worker'}.intersection(args):
                continue
            if (entry/'cwd').resolve() == root:
                yield int(entry.name)
        except (OSError, RuntimeError):
            continue


def main():
    root = Path(__file__).resolve().parents[1]; os.chdir(root)
    if not (root/'.venv/bin/python').exists():
        raise SystemExit('O ambiente Python não está instalado. Execute bash scripts/setup.sh primeiro.')
    python = str(root/'.venv/bin/python')
    dependency = subprocess.run([python,'-c',"import importlib.util; raise SystemExit(0 if importlib.util.find_spec('faster_whisper') else 1)"])
    if dependency.returncode:
        subprocess.run([python,'-m','pip','install','faster-whisper>=1.2,<2'],check=True)
    if not (root/'frontend/node_modules').is_dir():
        subprocess.run(['npm','ci','--prefix','frontend'], check=True)
    subprocess.run(['npm','run','build'], check=True)
    expected = json.loads((root/'frontend/dist/version.json').read_text())
    expected_index = (root/'frontend/dist/index.html').read_bytes()
    for pid in list(owned_processes(root)):
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
    deadline = time.monotonic() + 12
    while list(owned_processes(root)) and time.monotonic() < deadline:
        time.sleep(.2)
    if list(owned_processes(root)):
        raise SystemExit('O processamento anterior ainda está encerrando. Aguarde e execute novamente.')
    data = Path(os.environ.get('RIFFSYNC_DATA', str(root/'data')))
    for name in ('api.pid','worker.pid'):
        (data/name).unlink(missing_ok=True)
    subprocess.run(['bash','scripts/start.sh','--background'], check=True)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2) as response:
                status = json.load(response)
            if status.get('worker_online') and status.get('separation_available') and status.get('lyrics_available') and status.get('build') == expected:
                with urllib.request.urlopen('http://127.0.0.1:8000/',timeout=2) as response:
                    delivered_index = response.read()
                if delivered_index != expected_index: raise ValueError('O servidor entregou uma interface antiga.')
                print(f"\nRiffSync {expected['version']} · revisão {expected['revision']} · build {expected['source']}\nInterface, API, worker e reconhecimento de letra confirmados na porta 8000. Recarregue a aba; a barra lateral deve mostrar v{expected['version']}.")
                return
        except (OSError, ValueError): pass
        time.sleep(.5)
    for name in ('api.log','worker.log'):
        path = data/name
        if path.exists(): print(f'\n{name}:\n{path.read_text(errors="replace")[-3000:]}')
    raise SystemExit('A inicialização não foi confirmada. Os detalhes estão acima.')


if __name__ == '__main__':
    main()
