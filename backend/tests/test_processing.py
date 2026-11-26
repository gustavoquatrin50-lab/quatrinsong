import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from riffsync import config, db
from riffsync.diagnostics import summarize_failure
from riffsync.timing import measure_grid, merge_chunk_notes
from riffsync.worker import ProcessingFailure, process


class ProcessingTests(unittest.TestCase):
    def test_oom_download_and_dependency_have_distinct_diagnostics(self):
        self.assertEqual(summarize_failure(-9, "")[0], "memory")
        self.assertEqual(summarize_failure(1, "urllib.error.HTTPError: HTTP Error 403")[0], "model_download")
        self.assertEqual(summarize_failure(1, "ModuleNotFoundError: No module named demucs")[0], "dependency")
        category, message, details = summarize_failure(2, "Traceback\nRuntimeError: actual failure")
        self.assertEqual(category, "processing")
        self.assertIn("actual failure", message)
        self.assertIn("Traceback", details)

    def test_grid_covers_whole_recording_and_respects_beats(self):
        grid = measure_grid(5, 120, [0,.5,1,1.5,2.1,2.7,3.3,3.9,4.5])
        self.assertEqual([m['start'] for m in grid['measures']], [0,2.1,4.5])
        self.assertEqual(grid['measures'][-1]['end'], 5)
        self.assertTrue(grid['estimated'])

    def test_overlapping_inference_windows_merge_sustained_notes(self):
        events = [dict(start=29,end=31,pitch=64,velocity=.8,chunk=0),
                  dict(start=29.8,end=34,pitch=64,velocity=.8,chunk=1),
                  dict(start=36,end=37,pitch=64,velocity=.7,chunk=1)]
        merged = merge_chunk_notes(events)
        self.assertEqual([(n['start'],n['end']) for n in merged], [(29,34),(36,37)])
        self.assertNotIn('chunk', merged[0])

    def test_memory_failure_retries_smaller_window_without_shortening_song(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(config, 'DATA', Path(temp)), patch.object(config, 'DEVICE', 'cpu'), patch.object(config, 'SEGMENT_SECONDS', 4):
            db.init()
            job = db.create('owner', 'song.mp3', 'htdemucs_6s', False)
            db.update(job['id'], status='queued'); job = db.claim('test-worker')
            directory = Path(temp)/job['id']; directory.mkdir(); (directory/'input.mp3').write_bytes(b'fixture')
            separation_calls = []
            def fake_command(args, job_id, log_path, progress=False):
                if 'demucs' not in args:
                    return
                separation_calls.append(args)
                if len(separation_calls) == 1:
                    log_path.write_text('RuntimeError: out of memory')
                    raise ProcessingFailure(-9, log_path)
                stems = directory/'separated'/'htdemucs_6s'/'source'; stems.mkdir(parents=True)
                for name in ('vocals','drums','bass','guitar','piano','other'):
                    (stems/f'{name}.wav').write_bytes(b'fixture')
            with patch('riffsync.worker.duration', return_value=196.0), patch('riffsync.worker.command', side_effect=fake_command):
                process(job)
            self.assertEqual([args[args.index('--segment')+1] for args in separation_calls], ['4','2'])
            result = db.get(job['id'])
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['result']['duration'], 196.0)
            self.assertEqual(len(result['result']['tracks']), 6)

if __name__ == '__main__': unittest.main()

class HarmonyLevelTests(unittest.TestCase):
    def test_quiet_accompaniment_keeps_the_same_em_and_c_chords(self):
        import importlib.util
        if not importlib.util.find_spec('librosa'): self.skipTest('Audio analysis dependencies are not installed')
        import numpy as np
        import soundfile as sf
        from riffsync.transcribe import estimate_chords
        sr=22050;t=np.arange(sr*8)/sr;y=np.zeros_like(t)
        for start,frequencies in [(0,[164.8138,195.9977,246.9417]),(4,[130.8128,164.8138,195.9977])]:
            for frequency in frequencies: y+=np.sin(2*np.pi*frequency*t)*((t>=start)&(t<start+4))
        with tempfile.TemporaryDirectory() as temp:
            labels=[]
            for index,gain in enumerate((.12,.00012)):
                file=Path(temp)/f'harmony-{index}.wav';sf.write(file,y*gain,sr,subtype='FLOAT')
                labels.append([chord['label'] for chord in estimate_chords(file)[1]])
            self.assertEqual(labels,[['Em','C'],['Em','C']])
