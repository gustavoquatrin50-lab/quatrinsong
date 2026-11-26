"""Launch API and worker with independent sessions and explicit log files."""
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def service_pid(module, root=ROOT):
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            args = (entry/'cmdline').read_bytes().decode(errors='replace').split('\0')
            if module in args and (entry/'cwd').resolve() == root:
                return int(entry.name)
        except (OSError, RuntimeError):
            continue
    return None


def launch(argv, log_path, *, root=ROOT):
    with log_path.open('ab') as output:
        return subprocess.Popen(argv, cwd=root, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                start_new_session=True, close_fds=True)


def main():
    os.chdir(ROOT)
    data = Path(os.environ.get('RIFFSYNC_DATA', str(ROOT/'data'))).resolve()
    data.mkdir(parents=True, exist_ok=True)
    with (data/'services.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for name, module, args in (
            ('worker', 'riffsync.worker', ['-m', 'riffsync.worker']),
            ('api', 'riffsync.api:app', ['-m', 'uvicorn', 'riffsync.api:app', '--host', '0.0.0.0', '--port', '8000']),
        ):
            pid = service_pid(module)
            if pid is None:
                pid = launch([sys.executable, *args], data/f'{name}.log').pid
            (data/f'{name}.pid').write_text(str(pid))
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2) as response:
                    health = json.load(response)
                if health.get('worker_online') and health.get('separation_available'):
                    print('RiffSync ativo na porta 8000. API e worker estão em sessões independentes do terminal.')
                    return
            except (OSError, ValueError):
                pass
            time.sleep(.25)
    for name in ('api', 'worker'):
        path = data/f'{name}.log'
        if path.exists():
            print(f'\n{name}:\n{path.read_text(errors="replace")[-2500:]}', file=sys.stderr)
    raise SystemExit('API e worker não confirmaram a inicialização. Consulte os detalhes acima.')


if __name__ == '__main__':
    main()
