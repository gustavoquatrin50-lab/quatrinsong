import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from riffsync import config, db, worker
from riffsync.api import app
from riffsync.lyrics import timed_lines


class LyricsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = config.DATA
        config.DATA = Path(self.temp.name)
        self.client = TestClient(app)
        self.client.__enter__()
        self.headers = {'X-Workspace-Key': 'a'*64}
        self.owner = hashlib.sha256(('a'*64).encode()).hexdigest()
        worker.stop.clear()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        config.DATA = self.previous
        self.temp.cleanup()
        worker.stop.clear()

    def completed(self):
        job = db.create(self.owner, 'song.mp3', 'htdemucs_6s', True)
        folder = config.DATA/job['id']/'output'; folder.mkdir(parents=True)
        (folder/'vocals.wav').write_bytes(b'original isolated vocal')
        (folder/'guitar.wav').write_bytes(b'original isolated guitar')
        return db.update(job['id'], status='completed', result={'duration':10,'tracks':[{'file':'vocals.wav'},{'file':'guitar.wav'}],'chords':[{'start':0,'end':4,'label':'Em'}]})

    def test_lyrics_reuses_completed_stems_and_is_idempotent_and_isolated(self):
        job = self.completed(); url = f"/api/jobs/{job['id']}/lyrics"
        with patch('riffsync.api.importlib.util.find_spec',return_value=object()):
            self.assertEqual(self.client.post(url,headers={'X-Workspace-Key':'b'*64}).status_code,404)
            result = self.client.post(url,headers=self.headers)
            self.assertEqual(result.status_code,202)
            self.assertEqual(result.json()['status'],'completed')
            self.assertEqual(result.json()['lyrics_state'],'queued')
            self.assertEqual(self.client.post(url,headers=self.headers).json()['id'],job['id'])
        self.assertIsNone(db.claim('separator'))
        claimed = db.claim_lyrics('recognizer')
        self.assertEqual(claimed['id'],job['id'])
        self.assertIsNone(db.claim_lyrics('duplicate'))
        self.assertEqual(db.get(job['id'])['result'],job['result'])

    def test_cancel_lyrics_keeps_audio_and_blocks_late_result_but_allows_new_request(self):
        job=self.completed(); db.request_lyrics(job['id']); db.claim_lyrics('worker')
        result=self.client.post(f"/api/jobs/{job['id']}/lyrics/cancel",headers=self.headers).json()
        self.assertEqual(result['status'],'completed')
        db.update(job['id'],lyrics_state='ready',result={'tracks':[]})
        self.assertEqual(db.get(job['id'])['lyrics_state'],'cancelled')
        self.assertEqual(db.get(job['id'])['result'],job['result'])
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/files/guitar.wav",headers=self.headers).status_code,200)
        with self.assertRaises(worker.Cancelled): worker.check_job(job['id'],lyrics=True)
        db.request_lyrics(job['id'])
        self.assertEqual(db.get(job['id'])['lyrics_state'],'queued')

    def test_stale_lyrics_recovery_preserves_stems_and_main_completion(self):
        job=self.completed(); db.request_lyrics(job['id']); db.claim_lyrics('dead')
        payload=db.get(job['id']); payload['updated']=time.time()-100
        with db.connect() as c: c.execute('UPDATE jobs SET payload=? WHERE id=?',(json.dumps(payload),job['id']))
        db.recover(); result=db.get(job['id'])
        self.assertEqual(result['status'],'completed')
        self.assertEqual(result['lyrics_state'],'queued')
        self.assertEqual(result['result'],job['result'])
        self.assertTrue((config.DATA/job['id']/'output'/'vocals.wav').exists())

    def test_lyrics_requires_finished_separation_and_available_vocal_and_model(self):
        job=db.create(self.owner,'song.mp3','htdemucs',False)
        url=f"/api/jobs/{job['id']}/lyrics"
        self.assertEqual(self.client.post(url,headers=self.headers).status_code,409)
        db.update(job['id'],status='completed',result={'tracks':[]})
        self.assertEqual(self.client.post(url,headers=self.headers).status_code,409)
        folder=config.DATA/job['id']/'output';folder.mkdir(parents=True);(folder/'vocals.wav').touch()
        with patch('riffsync.api.importlib.util.find_spec',return_value=None):
            self.assertEqual(self.client.post(url,headers=self.headers).status_code,503)

    def test_timed_words_and_low_speech_or_invalid_segments(self):
        segment=SimpleNamespace(start=.1,end=1,text='  Test lyric ',words=[SimpleNamespace(start=.1,end=.9,word=' Test',probability=.8)])
        silent=SimpleNamespace(start=1,end=2,text='invented',no_speech_prob=.99,avg_logprob=-2)
        invalid=SimpleNamespace(start=float('nan'),end=3,text='invalid')
        self.assertEqual(timed_lines([silent,invalid,segment]),[{'start':.1,'end':1,'text':'Test lyric','words':[{'start':.1,'end':.9,'text':'Test','confidence':.8}]}])

    def test_cross_origin_range_headers_are_allowed_and_visible(self):
        job=self.completed(); url=f"/api/jobs/{job['id']}/files/vocals.wav"
        origin='http://localhost:5173'
        response=self.client.options(url,headers={'Origin':origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-workspace-key,range,if-range'})
        self.assertEqual(response.status_code,200)
        response=self.client.get(url,headers={**self.headers,'Origin':origin,'Range':'bytes=0-7'})
        self.assertEqual(response.status_code,206)
        self.assertIn('Content-Range',response.headers['access-control-expose-headers'])
        self.assertEqual(response.content,b'original')

    def test_version_matches_delivered_build_and_mutable_assets_are_not_cached(self):
        from riffsync.api import dist
        if not (dist/'version.json').is_file(): self.skipTest('Production build is not available')
        health=self.client.get('/api/health').json()
        manifest=self.client.get('/version.json')
        self.assertEqual(manifest.json(),health['build'])
        self.assertEqual(health['version'],'0.3.1')
        response=self.client.get('/')
        self.assertEqual(response.content,(dist/'index.html').read_bytes())
        for path in ('/','/version.json','/sw.js','/api/health'):
            self.assertEqual(self.client.get(path).headers['cache-control'],'no-store')

    def test_lyrics_worker_uses_original_and_explicit_language(self):
        job=self.completed(); folder=config.DATA/job['id']
        (folder/'input.mp3').write_bytes(b'original recording')
        db.request_lyrics(job['id'],language='en'); claimed=db.claim_lyrics('asr')
        def recognize(args,*_args,**_kwargs):
            self.assertEqual(Path(args[3]),folder/'input.mp3')
            self.assertEqual(args[-1],'en')
            Path(args[4]).write_text(json.dumps({'lyrics':[{'start':0,'end':1,'text':'Known lyric'}],'language':'en','model':'large-v3-turbo','status':'ready','review':[]}))
        with patch('riffsync.worker.command',side_effect=recognize):worker.process_lyrics(claimed)
        result=db.get(job['id'])
        self.assertEqual(result['status'],'completed');self.assertEqual(result['result']['lyrics_source'],'original')
        self.assertEqual(result['result']['lyrics_model'],'large-v3-turbo')
