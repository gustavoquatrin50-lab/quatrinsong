"""FaixaLab's cached AAC playback approach, adapted to RiffSync's owned jobs.

Reference: Marcelo-Preigschadt/FaixaLab app/faixalab/backing.py at 0a74a79.
Original separated WAV files remain untouched and downloadable.
"""
import array
import fcntl
import hashlib
import json
import subprocess
import sys
import threading
import uuid
import wave
from pathlib import Path

ENCODERS = threading.Semaphore(2)


def signature(source):
    stat = source.stat()
    return hashlib.sha256(f'{source.name}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()[:24]


def playback(source):
    source = Path(source)
    folder = source.parent/'playback'; folder.mkdir(exist_ok=True)
    target = folder/(signature(source)+'.m4a')
    with target.with_suffix('.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.is_file():
            return target
        temporary = folder/(uuid.uuid4().hex+'.m4a')
        try:
            with ENCODERS:
                result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
                    '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '320k', '-threads', '1',
                    '-movflags', '+faststart', str(temporary)], capture_output=True, timeout=120)
            if result.returncode or not temporary.is_file() or temporary.stat().st_size < 100:
                raise RuntimeError('Não foi possível preparar o áudio de reprodução. O WAV original continua disponível.')
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return target


def waveform(source, count=220):
    """Bounded-memory peaks from the actual PCM16 output, cached with the WAV revision."""
    source = Path(source)
    try:
        cache = source.parent/(signature(source)+'.peaks.json')
        if cache.is_file(): return json.loads(cache.read_text())
        with wave.open(str(source), 'rb') as audio:
            if audio.getsampwidth() != 2: return []
            frames, channels = audio.getnframes(), audio.getnchannels()
            values = []
            for index in range(count):
                start, end = frames*index//count, frames*(index+1)//count
                audio.setpos(start)
                samples = array.array('h', audio.readframes(end-start))
                if sys.byteorder != 'little': samples.byteswap()
                stride = max(channels, len(samples)//200)
                values.append(max((abs(value)/32768 for value in samples[::stride]), default=0))
        maximum = max(max(values, default=0), .001)
        result = [round(value/maximum, 5) for value in values]
        temporary = cache.with_name(uuid.uuid4().hex+'.peaks.tmp')
        try:
            temporary.write_text(json.dumps(result)); temporary.replace(cache)
        finally: temporary.unlink(missing_ok=True)
        return result
    except (OSError, ValueError, EOFError, wave.Error):
        return []
