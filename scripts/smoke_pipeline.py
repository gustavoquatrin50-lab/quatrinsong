"""Real-model smoke test. Downloads Demucs weights on first run; CPU is supported.

Run from the repository root: .venv/bin/python scripts/smoke_pipeline.py
"""
import hashlib
import json
import math
import os
import subprocess
import struct
import tempfile
import wave
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

from fastapi.testclient import TestClient
from riffsync import config, db
from riffsync.api import app
from riffsync.worker import process

def fixture(path):
    sr, seconds = 22050, int(os.environ.get("RIFFSYNC_SMOKE_SECONDS", "5"))
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, sr, 0, "NONE", "not compressed"))
        data = bytearray()
        for index in range(sr * seconds):
            t = index / sr
            envelope = math.exp(-((t % 0.5) * 5))
            notes = sum(math.sin(2 * math.pi * f * t) for f in (164.81, 196, 246.94)) / 3
            bass = math.sin(2 * math.pi * 82.41 * t)
            kick = math.sin(2 * math.pi * 55 * t) * math.exp(-((t % 1) * 28))
            value = 0.2 * notes * envelope + 0.12 * bass + 0.15 * kick
            data.extend(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))
        output.writeframes(data)

def main():
    with tempfile.TemporaryDirectory(prefix="riffsync-smoke-") as temp:
        config.DATA = Path(temp) / "data"
        source = Path(temp) / "fixture.wav"; fixture(source)
        input_format = os.environ.get('RIFFSYNC_SMOKE_FORMAT', 'wav')
        if input_format not in {'wav', 'mp3', 'webm'}:
            raise ValueError('RIFFSYNC_SMOKE_FORMAT deve ser wav, mp3 ou webm')
        if input_format != 'wav':
            encoded = Path(temp) / f'fixture.{input_format}'
            codec = 'libopus' if input_format == 'webm' else 'libmp3lame'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source), '-c:a', codec, str(encoded)], check=True)
            source = encoded
        upload_name = os.environ.get('RIFFSYNC_SMOKE_UPLOAD_NAME', source.name)
        mime = {'wav':'audio/wav', 'mp3':'audio/mpeg', 'webm':'audio/webm'}[input_format]
        with TestClient(app) as client:
            db.heartbeat("smoke-test")
            response = client.post('/api/jobs', headers={'X-Workspace-Key':'smoke_' + 'a'*60},
                                   files={'file':(upload_name, source.read_bytes(), mime)},
                                   data={'model':'htdemucs_6s','transcribe':'true'})
            assert response.status_code == 202, response.text
            job = db.claim('smoke-test')
            process(job)
            result = client.get(f"/api/jobs/{job['id']}", headers={'X-Workspace-Key':'smoke_' + 'a'*60}).json()
            assert result['status'] == 'completed', result
            assert len(result['result']['tracks']) == 6, result
            assert result['result']['timing']['measures'], result
            assert not list((config.DATA / job['id']).rglob('*.mid')), 'No MIDI file should be generated'
            for track in result['result']['tracks']:
                audio = client.get(f"/api/jobs/{job['id']}/files/{track['file']}", headers={'X-Workspace-Key':'smoke_'+'a'*60})
                assert audio.status_code == 200 and len(audio.content) > 1000
            print(json.dumps({'input_format':input_format, 'upload_name':upload_name, 'status':result['status'], 'tracks':len(result['result']['tracks']),
                              'notes':{t['kind']:len(t.get('notes',[])) for t in result['result']['tracks']},
                              'chords':len(result['result']['chords']), 'warnings':result['warnings']}, ensure_ascii=False))

if __name__ == '__main__': main()
