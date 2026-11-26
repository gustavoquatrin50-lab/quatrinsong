import hashlib
import json
import math
import shutil
import struct
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from fastapi.testclient import TestClient
from riffsync import config, db
from riffsync.api import app


class DeliveryTests(unittest.TestCase):
    def test_missing_audio_does_not_hide_completed_notes_and_manifest(self):
        previous = config.DATA
        with tempfile.TemporaryDirectory() as temporary:
            config.DATA = Path(temporary)
            try:
                with TestClient(app) as client:
                    job = db.create(hashlib.sha256(('a'*64).encode()).hexdigest(), 'song.mp3', 'htdemucs', True)
                    note = {'start':0,'end':1,'pitch':64,'velocity':.8,'string':1,'fret':0}
                    db.update(job['id'],status='completed',result={'tracks':[{'file':'guitar.wav','notes':[note]}]})
                    response=client.get(f"/api/jobs/{job['id']}",headers={'X-Workspace-Key':'a'*64})
                    self.assertEqual(response.status_code,200)
                    track=response.json()['result']['tracks'][0]
                    self.assertEqual(track['notes'],[note])
                    self.assertEqual(track['waveform'],[])
            finally: config.DATA=previous

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is required for the real playback encoder')
    def test_completed_wav_can_be_streamed_as_cached_aac_without_reprocessing(self):
        previous = config.DATA
        with tempfile.TemporaryDirectory() as temporary:
            config.DATA = Path(temporary)
            try:
                with TestClient(app) as client:
                    headers = {'X-Workspace-Key':'a'*64}
                    job = db.create(hashlib.sha256(('a'*64).encode()).hexdigest(), 'song.mp3', 'htdemucs', True)
                    folder=config.DATA/job['id']/'output'; folder.mkdir(parents=True)
                    source=folder/'guitar.wav'
                    with wave.open(str(source),'wb') as output:
                        output.setparams((2,2,44100,0,'NONE','not compressed'))
                        output.writeframes(b''.join(struct.pack('<hh',v,v) for v in (round(5000*math.sin(2*math.pi*220*i/44100)) for i in range(44100*3))))
                    original=source.read_bytes()
                    db.update(job['id'], status='completed', result={'tracks':[{'file':'guitar.wav','id':'guitar','kind':'guitar','name':'Guitarra'}]})
                    url=f"/api/jobs/{job['id']}/files/guitar.wav?format=m4a"
                    response=client.get(url,headers=headers)
                    self.assertEqual(response.status_code,200,response.text[:100] if response.status_code!=200 else '')
                    self.assertEqual(response.headers['content-type'],'audio/mp4')
                    self.assertEqual(response.content[4:8],b'ftyp')
                    self.assertLess(len(response.content),len(original))
                    cache=next((folder/'playback').glob('*.m4a')); modified=cache.stat().st_mtime_ns
                    probe=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name:format=duration','-of','json',str(cache)],capture_output=True,text=True,check=True)
                    self.assertEqual(json.loads(probe.stdout)['streams'][0]['codec_name'],'aac')
                    self.assertAlmostEqual(float(json.loads(probe.stdout)['format']['duration']),3,delta=.1)
                    self.assertEqual(client.get(url,headers=headers).content,response.content)
                    self.assertEqual(cache.stat().st_mtime_ns,modified)
                    partial=client.get(url,headers={**headers,'Range':'bytes=0-255'})
                    self.assertEqual(partial.status_code,206)
                    self.assertEqual(partial.content,response.content[:256])
                    self.assertEqual(client.get(url,headers={'X-Workspace-Key':'b'*64}).status_code,404)
                    self.assertEqual(client.get(url.replace('guitar.wav','private.wav'),headers=headers).status_code,404)
                    self.assertEqual(source.read_bytes(),original)
                    metadata=client.get(f"/api/jobs/{job['id']}",headers=headers).json()
                    self.assertEqual(len(metadata['result']['tracks'][0]['waveform']),220)
                    self.assertEqual(metadata['status'],'completed')
            finally:
                config.DATA = previous
