"""Recognize timed lyrics from the isolated vocal in a cancellable child process.

Uses the CPU/int8 and isolated-vocal approach already used by FaixaLab.
"""
import json
import math
import sys
from pathlib import Path
from . import config


def timed_lines(segments):
    lines = []
    for segment in segments:
        text = segment.text.strip()
        start, end = float(segment.start), float(segment.end)
        if not text or not math.isfinite(start + end) or end <= start:
            continue
        if getattr(segment, 'no_speech_prob', 0) > .8 and getattr(segment, 'avg_logprob', 0) < -.8:
            continue
        words = [{'start':round(float(word.start),3), 'end':round(float(word.end),3),
                  'text':word.word.strip(), 'confidence':round(float(word.probability),3)}
                 for word in (getattr(segment, 'words', None) or []) if word.word.strip()]
        lines.append({'start':round(max(0,start),3), 'end':round(end,3), 'text':text, 'words':words})
        print('RIFFSYNC_LYRICS '+json.dumps({'end':end}), flush=True)
    return lines


def recognize(source, destination, language=""):
    language = language or config.LYRICS_LANGUAGE
    from faster_whisper import WhisperModel
    cache = config.DATA/'models'/'whisper'
    print('Preparando Whisper '+config.LYRICS_MODEL+'; os pesos são baixados somente no primeiro uso.', flush=True)
    model = WhisperModel(config.LYRICS_MODEL, device='cpu', compute_type='int8', cpu_threads=2,
                         num_workers=1, download_root=str(cache))
    segments, info = model.transcribe(str(source), language=language or None,
        beam_size=5, word_timestamps=True, vad_filter=False, condition_on_previous_text=False,
        no_speech_threshold=.6)
    lines = timed_lines(segments)
    accepted, review = [], []
    for line in lines:
        words=line.get('words') or []
        confidence=sum(word['confidence'] for word in words)/len(words) if words else 0
        if confidence < .55:
            review.append({'start':line['start'],'end':line['end'],'reason':'Reconhecimento com baixa confiança; texto não exibido'})
        else: accepted.append(line)
    lines=accepted
    result = {'lyrics':lines, 'language':info.language, 'model':config.LYRICS_MODEL,
              'status':'ready' if lines else 'no_speech', 'review':review}
    Path(destination).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')


if __name__ == '__main__':
    recognize(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] if len(sys.argv)>3 else "")
