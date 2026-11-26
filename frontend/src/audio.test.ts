import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioAudio, preferMediaPlayback } from "./audio";
import { makeTrack } from "./types";

afterEach(() => vi.unstubAllGlobals());
describe("reprodução de músicas longas", () => {
  it("usa mídia para 4m30s e sete pistas, preservando buffers para trechos curtos", () => {
    expect(preferMediaPlayback(270, 7)).toBe(true);
    expect(preferMediaPlayback(5, 7)).toBe(false);
  });
  it("carrega e toca mídia sem alocar AudioBuffers PCM e libera a sessão anterior", async () => {
    const audios: FakeAudio[] = [];
    class FakeAudio {
      onloadedmetadata: (() => void) | null = null;
      onerror = null;
      preload = "";
      duration = 270;
      currentTime = 0;
      paused = true;
      readyState = 4;
      constructor() {
        audios.push(this);
      }
      set src(_value: string) {
        queueMicrotask(() => this.onloadedmetadata?.());
      }
      play = vi.fn(async () => {
        this.paused = false;
      });
      pause = vi.fn(() => {
        this.paused = true;
      });
      load = vi.fn();
      removeAttribute = vi.fn();
    }
    const node = () => ({
      gain: { value: 1, setTargetAtTime: vi.fn() },
      connect: vi.fn(function (this: unknown) {
        return this;
      }),
      disconnect: vi.fn(),
    });
    const decodeAudioData = vi.fn();
    class Context {
      currentTime = 0;
      destination = {};
      decodeAudioData = decodeAudioData;
      createGain = node;
      createMediaElementSource = node;
      createDynamicsCompressor = () => ({
        ...node(),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
      });
      resume = async () => {};
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("AudioContext", Context);
    const engine = new StudioAudio(),
      track = makeTrack("guitar", "guitar");
    await engine.load(track.id, new Blob(["m4a"], { type: "audio/mp4" }), true);
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(engine.buffers.size).toBe(0);
    expect(engine.has(track.id)).toBe(true);
    await engine.play([track]);
    expect(audios[0].play).toHaveBeenCalledOnce();
    audios[0].currentTime = 12.5;
    expect(engine.time).toBe(12.5);
    engine.pause();
    expect(engine.time).toBe(12.5);
    engine.reset();
    expect(engine.has(track.id)).toBe(false);
    expect(audios[0].removeAttribute).toHaveBeenCalledWith("src");
  });
});
