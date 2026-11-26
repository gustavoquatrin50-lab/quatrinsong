import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import config, db
from .diagnostics import summarize_failure

@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield

app = FastAPI(title="RiffSync API", version="0.3.1", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGINS, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Workspace-Key", "Range", "If-Range"], expose_headers=["Content-Range", "Content-Length", "Accept-Ranges", "ETag"])

def owner(x_workspace_key: str = Header(default="")):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32,160}", x_workspace_key):
        raise HTTPException(401, "Identificador de sessão ausente ou inválido.")
    return hashlib.sha256(x_workspace_key.encode()).hexdigest()

def owned(job_id, key):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, "Tarefa não encontrada.")
    job = db.get(job_id, key)
    if not job:
        raise HTTPException(404, "Tarefa não encontrada.")
    return job

@app.get("/api/health")
def health():
    return {"status": "ok", "worker_online": db.worker_online(),
            "version": "0.3.1", "build": frontend_version(),
            "separation_available": bool(importlib.util.find_spec("demucs")) and bool(shutil.which("ffmpeg")),
            "transcription_available": bool(importlib.util.find_spec("basic_pitch")),
            "lyrics_available": bool(importlib.util.find_spec('faster_whisper')), "device": config.DEVICE}

@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...), model: str = Form("htdemucs_6s"), transcribe: bool = Form(True), lyrics: bool = Form(True), lyrics_language: str = Form(''), key=Depends(owner)):
    if lyrics_language and not re.fullmatch('[a-z]{2}',lyrics_language): raise HTTPException(422,'Idioma inválido.')
    if model not in config.MODELS:
        raise HTTPException(422, "Modelo de separação inválido.")
    if not db.worker_online() or not importlib.util.find_spec("demucs"):
        raise HTTPException(503, "O servidor de separação não está disponível. Conecte um servidor com o worker ativo.")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".webm", ".weba", ".opus"}:
        raise HTTPException(415, "Envie MP3, WAV, FLAC, OGG, M4A, AAC, WebM ou Opus.")
    try:
        job = db.create(key, Path(file.filename or "audio").name[:180], model, transcribe, lyrics=lyrics)
    except ValueError as error:
        raise HTTPException(429, str(error)) from error
    directory = config.DATA / job["id"]
    directory.mkdir()
    # A job is claimable only once its upload is atomically renamed into place.
    target = directory / "upload.part"
    size = 0
    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD:
                    raise HTTPException(413, f"O arquivo excede {config.MAX_UPLOAD // 1024 // 1024} MB.")
                output.write(chunk)
        if not size:
            raise HTTPException(422, "O arquivo está vazio.")
        target.rename(directory / f"input{extension}")
        db.update(job["id"], status="queued", stage="Na fila de processamento", lyrics_language=lyrics_language,lyrics_source='original')
    except BaseException:
        db.update(job["id"], status="cancelled", stage="Upload interrompido")
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        await file.close()
    return db.public(db.get(job["id"]))

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job['status'] == 'completed' and job.get('result'):
        from .media import waveform
        for track in job['result']['tracks']:
            if Path(track['file']).name == track['file']:
                track['waveform'] = waveform(config.DATA/job_id/'output'/track['file'])
    # Existing failed tasks gain diagnostics without uploading the song again.
    if job['status'] == 'failed':
        detail = job.get('error_details') or ''
        legacy_sigterm = 'código -15' in (job.get('error') or '')
        returncode = -15 if legacy_sigterm else job.get('exit_code', 'indisponível')
        if not detail:
            logs = sorted((config.DATA / job_id).glob('*.log'), key=lambda p: p.stat().st_mtime, reverse=True)
            if logs:
                with logs[0].open('rb') as stream:
                    stream.seek(max(0, logs[0].stat().st_size - 16000))
                    detail = stream.read().decode('utf-8', errors='replace')
        if legacy_sigterm or (detail and not job.get('error_details')):
            code, error, excerpt = summarize_failure(returncode, detail)
            job.update(error=error, error_code=code, error_details=excerpt)
    return db.public(job)

@app.post('/api/jobs/{job_id}/retry', status_code=202)
def retry_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job['status'] == 'cancelled':
        raise HTTPException(409, 'Essa tarefa foi cancelada. Envie a música novamente para criar outra tarefa.')
    if job['status'] == 'completed':
        raise HTTPException(409, 'Essa tarefa já foi concluída.')
    if not list((config.DATA / job_id).glob('input.*')):
        raise HTTPException(409, 'O arquivo original não está mais disponível no servidor. Carregue a música novamente.')
    try:
        return db.public(db.requeue(job_id, manual=True))
    except ValueError as error:
        raise HTTPException(429, str(error)) from error

@app.post('/api/jobs/{job_id}/lyrics', status_code=202)
def recognize_lyrics(job_id: str, language: str = Form(''), source: str = Form('original'), key=Depends(owner)):
    job=owned(job_id,key)
    if job['status'] != 'completed': raise HTTPException(409,'Aguarde a separação dos instrumentos terminar.')
    if not (config.DATA/job_id/'output'/'vocals.wav').is_file():
        raise HTTPException(409,'A faixa de voz separada não está mais disponível no servidor.')
    if not importlib.util.find_spec('faster_whisper'):
        raise HTTPException(503,'O reconhecimento da letra ainda não foi instalado no servidor. Atualize pelo script de reinício.')
    if language and not re.fullmatch('[a-z]{2}',language): raise HTTPException(422,'Idioma inválido.')
    if source not in {'original','vocals'}: raise HTTPException(422,'Fonte de áudio inválida.')
    try: return db.public(db.request_lyrics(job_id,language,source))
    except ValueError as error: raise HTTPException(429,str(error)) from error

@app.post('/api/jobs/{job_id}/revise', status_code=202)
def revise_job(job_id: str, operation: str = Form('chords'), key=Depends(owner)):
    parent = owned(job_id, key)
    if parent['status'] != 'completed' or not parent.get('result'):
        raise HTTPException(409, 'Aguarde as faixas ficarem prontas.')
    if operation not in {'chords', 'vocals_drums'}:
        raise HTTPException(422, 'Revisão inválida.')
    if not db.worker_online(): raise HTTPException(503, 'O worker de processamento está indisponível.')
    source = config.DATA/job_id
    inputs = list(source.glob('input.*'))
    if operation == 'vocals_drums' and not inputs:
        raise HTTPException(409, 'O áudio original não está mais no servidor. Carregue a música novamente para refinar.')
    for track in parent['result']['tracks']:
        name=track['file']
        if Path(name).name != name or not (source/'output'/name).is_file():
            raise HTTPException(409, 'Uma das faixas não está mais no servidor. Recupere o resultado antes de revisar.')
    try: job=db.create(key,parent['filename'],parent['model'],False,source_job=job_id,operation=operation)
    except ValueError as error: raise HTTPException(429,str(error)) from error
    directory=config.DATA/job['id']
    if job.get('_existing'): return db.public(db.get(job['id']))
    if directory.exists(): return db.public(db.get(job['id']))
    try:
        output=directory/'output'; output.mkdir(parents=True)
        def link_or_copy(src, dst):
            try: os.link(src,dst)
            except OSError: shutil.copy2(src,dst)
        for track in parent['result']['tracks']:
            link_or_copy(source/'output'/track['file'],output/track['file'])
        if inputs: link_or_copy(inputs[0],directory/inputs[0].name)
        (directory/'revision.json').write_text(json.dumps(parent['result']),encoding='utf-8')
        # Refresh parent retention; its audio remains an independent comparison result.
        db.update(job_id)
        db.update(job['id'],status='queued',stage='Cifra na fila' if operation=='chords' else 'Voz e bateria na fila de refinamento')
    except BaseException:
        db.update(job['id'],status='failed',error='Não foi possível preparar a revisão; o resultado anterior foi preservado.')
        shutil.rmtree(directory,ignore_errors=True)
        raise
    return db.public(db.get(job['id']))

@app.post('/api/jobs/{job_id}/lyrics/cancel')
def cancel_lyrics(job_id: str, key=Depends(owner)):
    job=owned(job_id,key)
    if job.get('lyrics_state') in {'queued','running'}:
        job=db.update(job_id,lyrics_state='cancelled',lyrics_stage='Reconhecimento da letra cancelado')
    return db.public(job)

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] not in db.TERMINAL:
        job = db.update(job_id, status="cancelled", stage="Cancelado pelo usuário")
    return db.public(job)

@app.delete("/api/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] not in db.TERMINAL:
        raise HTTPException(409, "Cancele a tarefa antes de removê-la.")
    if job["status"] == "cancelled":
        raise HTTPException(409, "O worker ainda pode estar encerrando a tarefa. A limpeza automática removerá os arquivos.")
    shutil.rmtree(config.DATA / job_id, ignore_errors=True)
    with db.connect() as c:
        c.execute("DELETE FROM jobs WHERE id=? AND owner=?", (job_id, key))

@app.get("/api/jobs/{job_id}/files/{filename}")
def get_file(job_id: str, filename: str, format: str = 'wav', key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] != "completed":
        raise HTTPException(409, "O processamento ainda não foi concluído.")
    allowed = {track["file"] for track in job["result"]["tracks"]}
    if filename not in allowed or Path(filename).name != filename:
        raise HTTPException(404, "Arquivo não encontrado.")
    path = config.DATA / job_id / "output" / filename
    if not path.is_file():
        raise HTTPException(404, "Arquivo removido ou indisponível.")
    if format not in {'wav', 'm4a'}:
        raise HTTPException(422, 'Formato de reprodução inválido.')
    if format == 'm4a':
        from .media import playback
        try: path = playback(path)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            raise HTTPException(503, str(error)) from error
    return FileResponse(path, media_type='audio/mp4' if format == 'm4a' else 'audio/wav',
                        filename=Path(filename).stem+'.'+format, headers={'Cache-Control':'private, max-age=86400'})

dist = Path(os.environ.get("FRONTEND_DIST", str(Path.cwd() / "frontend" / "dist")))

def frontend_version():
    try: return json.loads((dist/'version.json').read_text())
    except (OSError, ValueError): return None

@app.middleware('http')
async def fresh_application(request, call_next):
    response = await call_next(request)
    if request.url.path in {'/', '/index.html', '/sw.js', '/version.json', '/api/health'}:
        response.headers['Cache-Control'] = 'no-store'
    return response

if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="studio")
