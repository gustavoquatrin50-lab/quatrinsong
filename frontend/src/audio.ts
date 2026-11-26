import type { Track } from "./types";

export class StudioAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  readonly buffers = new Map<string, AudioBuffer>();
  private media = new Map<
    string,
    {
      audio: HTMLAudioElement;
      url: string;
      source: MediaElementAudioSourceNode;
      gain: GainNode;
    }
  >();
  private generation = 0;
  private lastSync = 0;
  private reference?: HTMLAudioElement;
  private offset = 0;
  private started = 0;
  private running = false;
  duration = 0;

  private init() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.master.connect(limiter).connect(this.context.destination);
    }
    return this.context;
  }
  async decode(id: string, blob: Blob) {
    const generation = this.generation;
    const buffer = await this.init().decodeAudioData(await blob.arrayBuffer());
    if (generation !== this.generation)
      throw new DOMException("Sessão alterada", "AbortError");
    this.buffers.set(id, buffer);
    this.duration = Math.max(this.duration, buffer.duration);
    return buffer;
  }
  has(id: string) {
    return this.buffers.has(id) || this.media.has(id);
  }
  retain(ids: Set<string>) {
    for (const id of [...this.buffers.keys(), ...this.media.keys()])
      if (!ids.has(id)) this.drop(id);
  }
  drop(id: string) {
    this.buffers.delete(id);
    const item = this.media.get(id);
    if (item) {
      item.audio.pause();
      item.audio.removeAttribute("src");
      item.audio.load();
      item.source.disconnect();
      item.gain.disconnect();
      URL.revokeObjectURL(item.url);
      this.media.delete(id);
    }
  }
  async load(id: string, blob: Blob, stream = false): Promise<number[]> {
    if (!stream) {
      try {
        return peaks(await this.decode(id, blob));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          throw error;
      }
    }
    const generation = this.generation,
      ctx = this.init();
    const audio = new Audio(),
      url = URL.createObjectURL(blob);
    audio.preload = "metadata";
    try {
      await new Promise<void>((resolve, reject) => {
        const clean = () => {
          clearTimeout(timer);
          audio.onloadedmetadata = null;
          audio.onerror = null;
        };
        const timer = setTimeout(() => {
          clean();
          reject(new Error("Tempo excedido ao abrir o áudio no navegador"));
        }, 15000);
        audio.onloadedmetadata = () => {
          clean();
          resolve();
        };
        audio.onerror = () => {
          const error = audio.error;
          clean();
          reject(
            new Error(
              `O navegador não abriu o áudio (código ${error?.code || "desconhecido"})`,
            ),
          );
        };
        audio.src = url;
      });
      if (generation !== this.generation)
        throw new DOMException("Sessão alterada", "AbortError");
      const source = ctx.createMediaElementSource(audio),
        gain = ctx.createGain();
      source.connect(gain).connect(this.master!);
      this.drop(id);
      this.media.set(id, { audio, url, source, gain });
      this.duration = Math.max(this.duration, audio.duration || 0);
      if (this.running) {
        audio.currentTime = this.time;
        void audio.play().catch(() => {});
      }
      return await wavPeaks(blob).catch(() => []);
    } catch (error) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  synchronize() {
    if (
      !this.running ||
      !this.context ||
      this.context.currentTime - this.lastSync < 0.5
    )
      return;
    this.lastSync = this.context.currentTime;
    const target = this.time;
    for (const { audio } of this.media.values())
      if (
        audio.readyState >= 3 &&
        !audio.paused &&
        target < audio.duration - 0.1 &&
        Math.abs(audio.currentTime - target) > 0.05
      )
        audio.currentTime = target;
  }
  get playing() {
    return this.running;
  }
  get time() {
    if (this.running && this.reference)
      return Math.max(0, Math.min(this.duration, this.reference.currentTime));
    return this.running && this.context
      ? Math.max(
          0,
          Math.min(
            this.duration,
            this.offset + this.context.currentTime - this.started,
          ),
        )
      : this.offset;
  }
  async play(tracks: Track[], at = this.offset) {
    const ctx = this.init();
    await ctx.resume();
    this.pause();
    this.offset = Math.max(0, Math.min(at, Math.max(0, this.duration - 0.001)));
    const when = ctx.currentTime + 0.025;
    this.started = when;
    for (const track of tracks) {
      const buffer = this.buffers.get(track.id);
      if (!buffer || this.offset >= buffer.duration) continue;
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      source.connect(gain).connect(this.master!);
      this.gains.set(track.id, gain);
      this.sources.push(source);
      source.start(when, this.offset);
    }
    this.running = true;
    this.mix(tracks);
    const solo = tracks.some((track) => track.solo);
    this.reference =
      tracks
        .filter((track) => !track.muted && (!solo || track.solo))
        .map((track) => this.media.get(track.id)?.audio)
        .find(Boolean) ||
      tracks.map((track) => this.media.get(track.id)?.audio).find(Boolean);
    try {
      await Promise.all(
        tracks.map(async (track) => {
          const item = this.media.get(track.id);
          if (!item || this.offset >= item.audio.duration) return;
          item.audio.currentTime = this.offset;
          await item.audio.play();
        }),
      );
    } catch (error) {
      this.pause();
      throw error;
    }
  }
  pause() {
    this.offset = this.time;
    this.running = false;
    this.reference = undefined;
    for (const { audio } of this.media.values()) audio.pause();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    for (const gain of this.gains.values()) gain.disconnect();
    this.sources = [];
    this.gains.clear();
  }
  async seek(time: number, tracks: Track[]) {
    const wasPlaying = this.running;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, time));
    if (wasPlaying) await this.play(tracks, this.offset);
  }
  mix(tracks: Track[]) {
    const anySolo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      const gain = this.gains.get(t.id) || this.media.get(t.id)?.gain;
      if (gain && this.context)
        gain.gain.setTargetAtTime(
          t.muted || (anySolo && !t.solo) ? 0 : t.volume,
          this.context.currentTime,
          0.012,
        );
    }
  }
  reset() {
    this.generation++;
    this.pause();
    this.offset = 0;
    this.duration = 0;
    this.buffers.clear();
    for (const id of [...this.media.keys()]) this.drop(id);
  }
  async close() {
    this.reset();
    if (this.context) await this.context.close();
    this.context = undefined;
    this.master = undefined;
  }
}

// Seven 4m30s stereo PCM buffers use about 692 MiB at 48 kHz, before file blobs.
export const preferMediaPlayback = (seconds: number, tracks: number) =>
  seconds * tracks * 2 * 48000 * 4 > 192 * 1024 ** 2;

export async function wavPeaks(blob: Blob, count = 220): Promise<number[]> {
  const prefix = new TextDecoder("ascii").decode(
    await blob.slice(0, 12).arrayBuffer(),
  );
  if (!/^RIFF[\s\S]{4}WAVE$/.test(prefix)) return [];
  const data = await blob.arrayBuffer(),
    view = new DataView(data);
  const tag = (at: number) =>
    String.fromCharCode(...new Uint8Array(data, at, 4));
  if (data.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return [];
  let format = 0,
    channels = 0,
    bits = 0,
    align = 0,
    start = 0,
    bytes = 0;
  for (let at = 12; at + 8 <= data.byteLength;) {
    const name = tag(at),
      size = view.getUint32(at + 4, true),
      body = at + 8;
    if (name === "fmt " && size >= 16 && body + size <= data.byteLength) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      align = view.getUint16(body + 12, true);
      bits = view.getUint16(body + 14, true);
      if (format === 65534 && size >= 40)
        format = view.getUint16(body + 24, true);
    }
    if (name === "data") {
      start = body;
      bytes = Math.min(size, data.byteLength - body);
      break;
    }
    at = body + size + (size % 2);
  }
  if (
    !start ||
    !align ||
    !channels ||
    ![1, 3].includes(format) ||
    ![16, 24, 32].includes(bits)
  )
    return [];
  const frames = Math.floor(bytes / align),
    step = Math.max(1, Math.floor(frames / count));
  const values = Array.from({ length: count }, (_, index) => {
    let peak = 0;
    for (
      let frame = index * step;
      frame < Math.min(frames, (index + 1) * step);
      frame += Math.max(1, Math.floor(step / 100))
    ) {
      const at = start + frame * align;
      const sample =
        format === 3 && bits === 32
          ? view.getFloat32(at, true)
          : bits === 16
            ? view.getInt16(at, true) / 32768
            : bits === 32
              ? view.getInt32(at, true) / 2147483648
              : (view.getUint8(at) |
                  (view.getUint8(at + 1) << 8) |
                  (view.getInt8(at + 2) << 16)) /
                8388608;
      peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
  });
  const max = Math.max(...values, 0.001);
  return values.map((value) => value / max);
}

export function peaks(buffer: AudioBuffer, count = 220): number[] {
  const data = buffer.getChannelData(0),
    step = Math.max(1, Math.floor(data.length / count));
  const result = Array.from({ length: count }, (_, i) => {
    let peak = 0;
    for (
      let j = i * step;
      j < Math.min(data.length, (i + 1) * step);
      j += Math.max(1, Math.floor(step / 100))
    )
      peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
  const max = Math.max(...result, 0.001);
  return result.map((p) => p / max);
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels,
    length = buffer.length * channels * 2;
  const out = new ArrayBuffer(44 + length),
    view = new DataView(out);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, length, true);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++)
      view.setInt16(
        44 + (i * channels + ch) * 2,
        Math.max(-1, Math.min(1, data[i])) * 32767,
        true,
      );
  }
  return new Blob([out], { type: "audio/wav" });
}

export async function renderMix(
  buffers: Map<string, AudioBuffer>,
  tracks: Track[],
  duration: number,
  files: Record<string, Blob> = {},
): Promise<Blob> {
  const context = new OfflineAudioContext(
    2,
    Math.ceil(duration * 44100),
    44100,
  );
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    if (t.muted || (anySolo && !t.solo)) continue;
    const buffer =
      buffers.get(t.id) ||
      (files[t.id]
        ? await context.decodeAudioData(await files[t.id].arrayBuffer())
        : undefined);
    if (!buffer) throw new Error(`Áudio ainda não carregado: ${t.name}`);
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = t.volume;
    source.connect(gain).connect(context.destination);
    source.start();
  }
  const rendered = await context.startRendering();
  let max = 1;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (const value of data) max = Math.max(max, Math.abs(value));
  }
  if (max > 1)
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] /= max;
    }
  return encodeWav(rendered);
}
