import { encodeWav } from "./audio";
import { makeTrack } from "./types";
import type { Note, Session } from "./types";

/** Original synthesized arrangement. No separation or AI result is simulated. */
export async function createDemo(): Promise<Session> {
  const bpm = 100,
    beat = 60 / bpm,
    duration = 8 * 4 * beat;
  const progression = [
    [40, 47, 52, 55, 59, 64],
    [48, 52, 55, 60, 64],
    [43, 50, 55, 59, 62, 67],
    [50, 57, 62, 66],
  ];
  const labels = ["Em", "C", "G", "D"];
  const files: Record<string, Blob> = {};
  const tracks = [];
  for (const kind of ["guitar", "bass", "drums", "piano"]) {
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * 22050), 22050);
    const notes: Note[] = [];
    const tone = (
      midi: number,
      at: number,
      len: number,
      gain: number,
      type: OscillatorType = "sine",
    ) => {
      const osc = ctx.createOscillator(),
        env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(gain, at + 0.008);
      env.gain.exponentialRampToValueAtTime(
        0.0001,
        Math.min(duration, at + len),
      );
      osc.connect(env).connect(ctx.destination);
      osc.start(at);
      osc.stop(Math.min(duration, at + len));
    };
    for (let bar = 0; bar < 8; bar++) {
      const chord = progression[bar % 4];
      for (let b = 0; b < 4; b++) {
        const at = (bar * 4 + b) * beat;
        if (kind === "guitar") {
          chord.forEach((m, i) => {
            tone(m, at + i * 0.012, beat * 0.9, 0.025, "triangle");
            tone(m + 12, at + i * 0.012, 0.15, 0.006);
          });
          const midi = chord[b % chord.length];
          const tuning = [40, 45, 50, 55, 59, 64];
          const index = tuning.findLastIndex((n) => n <= midi);
          notes.push({
            start: at,
            end: at + beat * 0.8,
            pitch: midi,
            velocity: 0.7,
            string: 6 - index,
            fret: midi - tuning[index],
          });
        } else if (kind === "bass") {
          const midi = chord[0] - (chord[0] > 45 ? 24 : 12);
          tone(midi, at, beat * 0.85, 0.16);
          tone(midi + 12, at, beat * 0.5, 0.025);
          const idx = [28, 33, 38, 43].findLastIndex((n) => n <= midi);
          if (idx >= 0)
            notes.push({
              start: at,
              end: at + beat * 0.85,
              pitch: midi,
              velocity: 0.8,
              string: 4 - idx,
              fret: midi - [28, 33, 38, 43][idx],
            });
        } else if (kind === "piano" && b % 2 === 0) {
          chord.slice(-3).forEach((m) => {
            tone(m + 12, at, beat * 1.8, 0.025);
            tone(m + 24, at, beat * 0.7, 0.006);
          });
        } else if (kind === "drums") {
          if (b % 2 === 0) {
            const osc = ctx.createOscillator(),
              gain = ctx.createGain();
            osc.frequency.setValueAtTime(135, at);
            osc.frequency.exponentialRampToValueAtTime(42, at + 0.16);
            gain.gain.setValueAtTime(0.35, at);
            gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + 0.23);
          }
          for (let sub = 0; sub < 2; sub++) {
            const noise = ctx.createBuffer(1, 2205, 22050),
              data = noise.getChannelData(0);
            let seed = bar * 71 + b * 13 + sub + 1;
            for (let i = 0; i < data.length; i++) {
              seed = (seed * 16807) % 2147483647;
              data[i] =
                (seed / 1073741824 - 1) * Math.exp(-i / (b % 2 ? 400 : 100));
            }
            const source = ctx.createBufferSource(),
              filter = ctx.createBiquadFilter(),
              gain = ctx.createGain();
            source.buffer = noise;
            filter.type = "highpass";
            filter.frequency.value = b % 2 && sub === 0 ? 1500 : 7000;
            gain.gain.value = b % 2 && sub === 0 ? 0.2 : 0.08;
            source.connect(filter).connect(gain).connect(ctx.destination);
            source.start(at + (sub * beat) / 2);
          }
        }
      }
    }
    const track = makeTrack(kind);
    track.notes = notes;
    files[track.id] = encodeWav(await ctx.startRendering());
    tracks.push(track);
  }
  const cues = Array.from({ length: 8 }, (_, i) => ({
    id: crypto.randomUUID(),
    text: `${labels[i % 4]}\n${["Encontre seu ritmo", "Deixe a música acontecer", "Cada nota, um novo caminho", "Toque do seu jeito"][i % 4]}`,
    start: i * 4 * beat,
    end: (i + 1) * 4 * beat,
    source: "manual" as const,
  }));
  return {
    project: {
      version: 1,
      id: crypto.randomUUID(),
      title: "Primeiro riff",
      filename: "Arranjo original sintetizado",
      duration,
      updated: Date.now(),
      bpm,
      demo: true,
      tracks,
      cues,
      rawText: cues.map((c) => c.text).join("\n\n"),
    },
    files,
  };
}
