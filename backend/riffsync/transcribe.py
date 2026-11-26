"""Run in a child process, so cancellation also stops model inference."""
import json
import sys
import subprocess
import tempfile
from pathlib import Path
from .fingering import assign_strings
from .timing import measure_grid, merge_chunk_notes

def estimate_chords(path):
    import librosa
    import numpy as np
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
    bpm = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else None
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512)
    bounds = np.unique(np.concatenate(([0.0], beats[::2], [duration]))) if len(beats) >= 4 else np.append(np.arange(0, duration, 0.8), duration)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=512, n_fft=4096)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    # Isolated accompaniment can be much quieter than the original master.
    # A fixed .003 gate discarded valid chords on quiet separated stems.
    energy_gate=max(1e-6,float(np.quantile(rms,.8))*.04)
    templates, labels = [], []
    names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    for root in range(12):
        for minor in (False, True):
            template = np.zeros(12)
            template[root] = 1; template[(root + (3 if minor else 4)) % 12] = 0.85; template[(root + 7) % 12] = 0.8
            templates.append(template / np.linalg.norm(template)); labels.append(names[root] + ("m" if minor else ""))
    templates = np.array(templates)
    observations, energy = [], []
    for start, end in zip(bounds[:-1], bounds[1:]):
        left, right = int(start * sr / 512), max(int(start * sr / 512) + 1, int(end * sr / 512))
        vector = np.mean(chroma[:, left:right], axis=1)
        vector /= max(np.linalg.norm(vector), 1e-8)
        observations.append(templates @ vector)
        energy.append(float(np.mean(rms[left:right])))
    if not observations:
        return bpm, [], measure_grid(duration, bpm, beats.tolist())
    scores = np.array(observations)
    dp, back = scores.copy(), np.zeros(scores.shape, dtype=int)
    transitions = np.full((24, 24), -0.16); np.fill_diagonal(transitions, 0)
    for i in range(1, len(scores)):
        matrix = dp[i - 1, :, None] + transitions
        back[i] = np.argmax(matrix, axis=0)
        dp[i] += np.max(matrix, axis=0)
    state, path_states = int(np.argmax(dp[-1])), []
    for i in range(len(scores) - 1, -1, -1):
        path_states.append(state); state = int(back[i, state])
    path_states.reverse()
    chords = []
    for i, state in enumerate(path_states):
        label = labels[state] if scores[i, state] > 0.66 and energy[i] > energy_gate else "N"
        if chords and chords[-1]["label"] == label:
            chords[-1]["end"] = round(float(bounds[i + 1]), 3)
        else:
            chords.append({"start": round(float(bounds[i]), 3), "end": round(float(bounds[i + 1]), 3), "label": label})
    valid_bpm = round(bpm, 2) if bpm and 30 <= bpm <= 300 else None
    return valid_bpm, chords, measure_grid(duration, valid_bpm, beats.tolist())


def transcribe_track(file, model):
    """Decode note events directly into JSON, with bounded inference windows."""
    import soundfile as sf
    from basic_pitch.inference import run_inference
    from basic_pitch.note_creation import output_to_notes_polyphonic, model_frames_to_time
    events = []
    with sf.SoundFile(str(file)) as stream, tempfile.TemporaryDirectory(prefix="notes-", dir=file.parent) as temp:
        length, sr = len(stream) / stream.samplerate, stream.samplerate
        offset, chunk = 0.0, 0
        while offset < length:
            left, right = max(0.0, offset - 1), min(length, offset + 31)
            stream.seek(int(left * sr))
            audio = stream.read(int((right - left) * sr), dtype="float32")
            path = Path(temp) / "window.wav"; sf.write(str(path), audio, sr)
            output = run_inference(str(path), model)
            decoded = output_to_notes_polyphonic(output["note"], output["onset"], onset_thresh=.5, frame_thresh=.3,
                                                min_note_len=6, infer_onsets=True, max_freq=None, min_freq=None)
            times = model_frames_to_time(len(output["note"]) + 1)
            for start_frame, end_frame, pitch, amplitude in decoded:
                start, end = left + float(times[start_frame]), min(length, left + float(times[end_frame]))
                if end > offset and start < offset + 30 and end - start >= .07 and amplitude >= .15:
                    events.append({"start": round(max(0, start), 4), "end": round(end, 4), "pitch": int(pitch), "velocity": round(float(amplitude), 3), "chunk": chunk})
            offset += 30; chunk += 1
    return merge_chunk_notes(events)

def harmonic_source(output, destination):
    """Prefer the separated accompaniment over vocals/drums for harmony analysis."""
    files = [output/f'{kind}.wav' for kind in ('guitar','piano','other','bass') if (output/f'{kind}.wav').is_file()]
    if not files:
        return output.parent/'source.wav'
    args = ['ffmpeg','-nostdin','-v','error','-y']
    for file in files: args += ['-i',str(file)]
    weights = ['0.65' if file.stem=='bass' else '0.45' if file.stem == 'other' and len(files)>1 else '1' for file in files]
    inputs = ''.join(f'[{i}:a]' for i in range(len(files)))
    graph = inputs+f"amix=inputs={len(files)}:duration=longest:weights='{' '.join(weights)}':normalize=1"
    subprocess.run(args+['-filter_complex',graph,'-ac','1','-ar','22050',str(destination)],check=True,capture_output=True,timeout=120)
    return destination


def run(directory, notes=True):
    import importlib.util
    output = Path(directory)
    result = {"bpm": None, "chords": [], "notes": {}, "timing": None, "warnings": []}
    try:
        with tempfile.TemporaryDirectory(prefix='harmony-',dir=output) as temporary:
            try:
                source = harmonic_source(output, Path(temporary)/'accompaniment.wav')
            except (subprocess.SubprocessError, OSError):
                source = output.parent/'source.wav'
                result['warnings'].append('Não foi possível reunir o acompanhamento; as cifras foram estimadas no áudio original.')
            result["bpm"], result["chords"], result["timing"] = estimate_chords(source)
    except Exception as error:
        result["warnings"].append(f"Não foi possível estimar as cifras ({type(error).__name__}). Importe seu texto para sincronizar.")
    if not notes:
        (output/'transcription.json').write_text(json.dumps(result),encoding='utf-8')
        return
    if importlib.util.find_spec("basic_pitch"):
        try:
            from basic_pitch import build_icassp_2022_model_path, FilenameSuffix
            from basic_pitch.inference import Model
            model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
            for kind in ("guitar", "bass", "piano", "vocals"):
                file = output / f"{kind}.wav"
                if not file.exists():
                    continue
                try:
                    print(f"Transcrevendo eventos de {kind}", flush=True)
                    notes = transcribe_track(file, model)
                    result["notes"][kind] = assign_strings(notes, kind) if kind in ("guitar", "bass") else notes
                except Exception as error:
                    result["warnings"].append(f"A transcrição de {kind} falhou ({type(error).__name__}). O áudio separado continua disponível.")
        except Exception as error:
            result["warnings"].append(f"O modelo de notas não carregou ({type(error).__name__}). Use a importação manual.")
    else:
        result["warnings"].append("Basic Pitch não está instalado. Importe cifras ou tablaturas para sincronizar manualmente.")
    try:
        import librosa
        drum_file = output / "drums.wav"
        if drum_file.exists():
            audio, sr = librosa.load(drum_file, sr=22050)
            onsets = librosa.onset.onset_detect(y=audio, sr=sr, units="time", backtrack=False)
            result["notes"]["drums"] = [{"start": round(float(t), 4), "end": round(min(len(audio) / sr, float(t) + .1), 4), "pitch": 0, "velocity": .8} for t in onsets]
    except Exception:
        result["warnings"].append("A marcação dos ataques de bateria não foi concluída.")
    (output / "transcription.json").write_text(json.dumps(result), encoding="utf-8")

if __name__ == "__main__":
    run(sys.argv[1], notes='--chords-only' not in sys.argv)
