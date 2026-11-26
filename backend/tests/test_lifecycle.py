import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from riffsync import config, db, worker


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = config.DATA
        config.DATA = Path(self.temp.name)
        worker.stop.clear()
        db.init()
        job = db.create('owner', 'song.mp3', 'htdemucs_6s', False)
        db.update(job['id'], status='queued')
        self.job = db.claim('worker')
        self.log = config.DATA/'child.log'

    def tearDown(self):
        worker.stop.clear()
        config.DATA = self.previous
        self.temp.cleanup()

    def test_real_sigterm_retries_once_and_preserves_log(self):
        counter = config.DATA/'attempts'
        script = ("import os,signal,sys; from pathlib import Path; "
                  "p=Path(sys.argv[1]); n=int(p.read_text())+1 if p.exists() else 1; "
                  "p.write_text(str(n)); print('attempt',n,flush=True); "
                  "os.kill(os.getpid(),signal.SIGTERM) if n==1 else None")
        worker.command([sys.executable, '-c', script, str(counter)], self.job['id'], self.log)
        self.assertEqual(counter.read_text(), '2')
        self.assertEqual(db.get(self.job['id'])['signal_retries'], 1)
        self.assertIn('attempt 1', self.log.read_text())
        self.assertIn('attempt 2', self.log.read_text())

    def test_repeated_real_sigterm_fails_after_one_retry(self):
        with self.assertRaises(worker.ProcessingFailure) as raised:
            worker.command([sys.executable, '-c', 'import os,signal; os.kill(os.getpid(),signal.SIGTERM)'], self.job['id'], self.log)
        self.assertEqual(raised.exception.returncode, -signal.SIGTERM)
        self.assertEqual(raised.exception.category, 'terminated')
        self.assertEqual(db.get(self.job['id'])['signal_retries'], 1)

    def test_shutdown_and_cancel_win_when_child_exits_between_polls(self):
        class ExitedChild:
            pid = 99999999
            returncode = -signal.SIGTERM
            def poll(self):
                return self.returncode
        for cancelled in (False, True):
            def exited(*args, **kwargs):
                worker.stop.set()
                if cancelled:
                    db.update(self.job['id'], status='cancelled')
                return ExitedChild()
            worker.stop.clear()
            expected = worker.Cancelled if cancelled else worker.WorkerStopping
            with patch('riffsync.worker.subprocess.Popen', side_effect=exited):
                with self.assertRaises(expected):
                    worker.command(['unused'], self.job['id'], self.log)
            if not cancelled:
                self.assertEqual(db.requeue(self.job['id'])['status'], 'queued')
                db.claim('worker')
            self.assertNotIn('signal_retries', db.get(self.job['id']))

    def test_only_one_worker_can_lock_data_directory(self):
        first = worker.acquire_worker_lock()
        self.assertIsNotNone(first)
        try:
            self.assertIsNone(worker.acquire_worker_lock())
        finally:
            first.close()
        second = worker.acquire_worker_lock()
        self.assertIsNotNone(second)
        second.close()

    def test_background_child_has_independent_session_and_closed_stdin(self):
        path = Path(__file__).resolve().parents[2]/'scripts/services.py'
        spec = importlib.util.spec_from_file_location('riffsync_services', path)
        services = importlib.util.module_from_spec(spec); spec.loader.exec_module(services)
        script = 'import json,os,sys; print(json.dumps([os.getpid(),os.getsid(0),sys.stdin.read()]),flush=True)'
        child = services.launch([sys.executable, '-c', script], self.log, root=config.DATA)
        try:
            self.assertEqual(child.wait(timeout=5), 0)
            pid, session, stdin = json.loads(self.log.read_text())
            self.assertEqual(pid, session)
            self.assertNotEqual(session, os.getsid(0))
            self.assertEqual(stdin, '')
        finally:
            if child.poll() is None:
                child.kill(); child.wait()


if __name__ == '__main__':
    unittest.main()
