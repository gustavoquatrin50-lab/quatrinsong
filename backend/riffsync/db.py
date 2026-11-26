import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from . import config

TERMINAL = {"completed", "failed", "cancelled"}

@contextmanager
def connect():
    config.DATA.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(config.DATA / "riffsync.sqlite3", timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()

def init():
    with connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, payload TEXT NOT NULL)")
        c.execute("CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner, status)")
        c.execute("CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, heartbeat REAL NOT NULL)")

def worker_online():
    with connect() as c:
        return c.execute("SELECT 1 FROM workers WHERE heartbeat > ? LIMIT 1", (time.time() - 30,)).fetchone() is not None

def heartbeat(worker_id):
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO workers VALUES (?, ?)", (worker_id, time.time()))

def create(owner, filename, model, transcribe, lyrics=False, source_job=None, operation=None):
    now, job_id = time.time(), uuid.uuid4().hex
    payload = {"id": job_id, "filename": filename, "model": model, "transcribe": transcribe,
               "status": "uploading", "stage": "Recebendo o áudio", "progress": 0,
               "created": now, "updated": now, "warnings": [], "result": None, "error": None,
               'recognize_lyrics': lyrics, 'lyrics_state': 'waiting' if lyrics else 'not_requested',
               'source_job':source_job, 'operation':operation}
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        if source_job:
            existing = c.execute("SELECT payload FROM jobs WHERE owner=? AND status IN ('uploading','queued','running') AND json_extract(payload,'$.source_job')=? AND json_extract(payload,'$.operation')=? LIMIT 1", (owner,source_job,operation)).fetchone()
            if existing: return {**json.loads(existing[0]),'_existing':True}
        count = c.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('uploading','queued','running')", (owner,)).fetchone()[0]
        total = c.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('uploading','queued','running')").fetchone()[0]
        if count >= 2 or total >= 32:
            raise ValueError("A fila está cheia. Aguarde a conclusão ou cancele uma tarefa.")
        c.execute("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?)", (job_id, owner, "uploading", now, now, json.dumps(payload)))
    return payload

def get(job_id, owner=None):
    with connect() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?" + (" AND owner=?" if owner else ""), (job_id, owner) if owner else (job_id,)).fetchone()
    return json.loads(row["payload"]) if row else None

def update(job_id, **changes):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT payload FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return None
        payload = json.loads(row[0])
        # A cancellation committed by the API must win over a late worker result.
        if payload["status"] == "cancelled" and changes.get("status") != "cancelled":
            return payload
        if payload.get('lyrics_state') == 'cancelled' and any(k.startswith('lyrics_') for k in changes) and changes.get('lyrics_state') != 'cancelled':
            return payload
        payload.update(changes, updated=time.time())
        c.execute("UPDATE jobs SET status=?, updated=?, payload=? WHERE id=?", (payload["status"], payload["updated"], json.dumps(payload), job_id))
    return payload

def claim(worker_id):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT id,payload FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
        if not row:
            return None
        payload = json.loads(row["payload"])
        payload.update(status="running", stage="Preparando o áudio", progress=2, worker=worker_id, updated=time.time())
        c.execute("UPDATE jobs SET status='running', updated=?, payload=? WHERE id=?", (payload["updated"], json.dumps(payload), row["id"]))
        return payload

def request_lyrics(job_id, language='', source='original'):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT owner,payload FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not row: return None
        payload=json.loads(row['payload'])
        if payload['status'] != 'completed': raise ValueError('Aguarde as faixas separadas ficarem prontas.')
        if payload.get('lyrics_state') in {'queued','running'}: return payload
        count=c.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND json_extract(payload,'$.lyrics_state') IN ('queued','running')",(row['owner'],)).fetchone()[0]
        if count >= 2: raise ValueError('Aguarde a letra de outra música terminar.')
        payload.update(lyrics_state='queued',lyrics_progress=0,lyrics_error=None,lyrics_recoveries=0,lyrics_signal_retries=0,lyrics_stage='Letra na fila',
                       lyrics_language=language,lyrics_source=source,updated=time.time())
        c.execute('UPDATE jobs SET updated=?,payload=? WHERE id=?',(payload['updated'],json.dumps(payload),job_id))
    return payload

def claim_lyrics(worker_id):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute("SELECT id,payload FROM jobs WHERE status='completed' AND json_extract(payload,'$.lyrics_state')='queued' ORDER BY updated LIMIT 1").fetchone()
        if not row: return None
        payload=json.loads(row['payload'])
        payload.update(lyrics_state='running',lyrics_worker=worker_id,lyrics_stage='Preparando o reconhecimento da letra',updated=time.time())
        c.execute('UPDATE jobs SET updated=?,payload=? WHERE id=?',(payload['updated'],json.dumps(payload),row['id']))
    return payload

def requeue(job_id, *, manual=False, crashed=False):
    """Preserve the upload while atomically separating retries from cancellation."""
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT owner,payload FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return None
        payload = json.loads(row['payload'])
        if payload['status'] in ('cancelled', 'completed'):
            return payload
        if manual and payload['status'] != 'failed':
            return payload
        if not manual and payload['status'] != 'running':
            return payload
        if manual:
            count = c.execute("SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('uploading','queued','running')", (row['owner'],)).fetchone()[0]
            total = c.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('uploading','queued','running')").fetchone()[0]
            if count >= 2 or total >= 32:
                raise ValueError('A fila está cheia. Aguarde uma tarefa terminar antes de retomar.')
            payload.update(signal_retries=0, recovery_count=0)
        if crashed:
            payload['recovery_count'] = int(payload.get('recovery_count', 0)) + 1
        if crashed and payload['recovery_count'] > 2:
            payload.update(status='failed', stage='Worker interrompido repetidamente',
                           error='O servidor interrompeu o worker repetidamente. O arquivo foi preservado; retome quando o servidor estiver estável.', error_code='worker_interrupted')
        else:
            payload.update(status='queued', stage='Retomando o arquivo enviado' if manual else 'Aguardando o worker reiniciar', progress=0,
                           error=None, error_code=None, error_details='', exit_code=None, result=None)
        payload.pop('worker', None)
        payload['updated'] = time.time()
        c.execute('UPDATE jobs SET status=?,updated=?,payload=? WHERE id=?', (payload['status'], payload['updated'], json.dumps(payload), job_id))
    return payload

def recover():
    with connect() as c:
        rows = c.execute("SELECT id,payload FROM jobs WHERE status='running'").fetchall()
        active = {r[0] for r in c.execute("SELECT id FROM workers WHERE heartbeat > ?", (time.time() - 30,))}
    for row in rows:
        p = json.loads(row["payload"])
        if p.get("worker") not in active and p["updated"] < time.time() - 45:
            requeue(row['id'], crashed=True)
    with connect() as c:
        rows=c.execute("SELECT id,payload FROM jobs WHERE status='completed' AND json_extract(payload,'$.lyrics_state')='running'").fetchall()
    for row in rows:
        payload=json.loads(row['payload'])
        if payload.get('lyrics_worker') not in active and payload['updated'] < time.time()-45:
            count=int(payload.get('lyrics_recoveries',0))+1
            update(row['id'],lyrics_state='queued' if count <= 2 else 'failed',lyrics_recoveries=count,
                   lyrics_error='O reconhecimento da letra foi interrompido pelo servidor.')

def public(payload):
    return {k: v for k, v in payload.items() if k not in {"worker", "model", "transcribe", "filename", 'recognize_lyrics', 'lyrics_worker'}}

def prune():
    """Claim old terminal rows before removing their on-disk audio."""
    import shutil
    if config.RETENTION_DAYS <= 0:
        return
    cutoff = time.time() - config.RETENTION_DAYS * 86400
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        rows = c.execute("SELECT id FROM jobs WHERE status IN ('completed','failed','cancelled') AND updated < ?", (cutoff,)).fetchall()
        c.execute("DELETE FROM jobs WHERE status IN ('completed','failed','cancelled') AND updated < ?", (cutoff,))
        c.execute("DELETE FROM workers WHERE heartbeat < ?", (time.time() - 86400,))
    for row in rows:
        shutil.rmtree(config.DATA / row[0], ignore_errors=True)
