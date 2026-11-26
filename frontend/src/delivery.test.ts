import { describe, expect, it, vi } from "vitest";
import { mergeResult, receiveResult } from "./delivery";
import { makeTrack } from "./types";
import type { Job, Project } from "./types";

const project: Project = {
  version: 1,
  id: "session",
  title: "Music",
  filename: "song.mp3",
  duration: 270,
  updated: 1,
  tracks: [makeTrack("original", "original")],
  cues: [],
  rawText: "",
  jobId: "job",
};
const job: Job = {
  id: "job",
  status: "completed",
  stage: "Pronto",
  progress: 100,
  warnings: [],
  result: {
    duration: 270,
    bpm: 120,
    timing: {
      beats: [0, 0.5],
      estimated: true,
      measures: [{ index: 0, start: 0, end: 2, numerator: 4, denominator: 4 }],
    },
    tracks: [
      {
        id: "guitar",
        kind: "guitar",
        name: "Guitarra",
        file: "guitar.wav",
        notes: [
          { start: 0, end: 0.5, pitch: 64, velocity: 0.8, string: 1, fret: 0 },
        ],
      },
      { id: "bass", kind: "bass", name: "Baixo", file: "bass.wav", notes: [] },
    ],
    chords: [{ start: 0, end: 2, label: "Em" }],
  },
};

describe("recuperação dos resultados já separados", () => {
  it("revisar acordes ou voz mantém correções de notas e controles do mixer", () => {
    const previous = mergeResult(project, job);
    previous.tracks[0].notes![0].fret = 4;
    previous.tracks[0].muted = true;
    previous.harmony = [{ start: 0, end: 2, label: "Dm" }];
    const refined = mergeResult(previous, {
      ...job,
      id: "refined",
      operation: "vocals_drums",
    });
    expect(refined.tracks[0].notes![0].fret).toBe(4);
    expect(refined.tracks[0].muted).toBe(true);
    expect(refined.harmony![0].label).toBe("Dm");
    expect(
      mergeResult(previous, { ...job, id: "new-chords", operation: "chords" })
        .harmony![0].label,
    ).toBe("Em");
  });

  it("mostra cifra, tablatura e compassos antes de baixar qualquer áudio", () => {
    const result = mergeResult(project, job);
    expect(result.tracks).toHaveLength(3);
    expect(result.tracks[0].notes?.[0].fret).toBe(0);
    expect(result.cues[0].text).toBe("Em");
    expect(result.timing?.measures).toHaveLength(1);
    expect(result.tracks[0].loadState).toBe("pending");
    expect(result.jobApplied).toBe(false);
  });
  it("preserva uma pista bem-sucedida e só recupera a que falhou, sem perder edições", async () => {
    const files: Record<string, Blob> = {},
      ready = new Set<string>();
    let result = mergeResult(project, job),
      first = true;
    const fetchFile = vi.fn(async (name: string) => {
      if (name === "guitar.wav" && first) throw new Error("HTTP 503");
      return new Blob([name]);
    });
    const options = {
      job,
      files,
      signal: new AbortController().signal,
      fetchFile,
      hasAudio: (id: string) => ready.has(id),
      loadAudio: async (id: string) => {
        ready.add(id);
        return [0.1, 0.3];
      },
      onFile: vi.fn(),
      onTrack: (
        id: string,
        loadState: "pending" | "loading" | "ready" | "error",
        loadError?: string,
      ) => {
        result = {
          ...result,
          tracks: result.tracks.map((t) =>
            t.id === id ? { ...t, loadState, loadError } : t,
          ),
        };
      },
    };
    const partial = await receiveResult(options);
    expect(partial.ready).toBe(1);
    expect(result.tracks[0].loadError).toContain("503");
    expect(files["job-bass"]).toBeDefined();
    result.tracks[0].notes![0].fret = 3;
    expect(mergeResult(result, job).tracks[0].notes![0].fret).toBe(3);
    first = false;
    const completed = await receiveResult(options);
    expect(completed.failures).toEqual([]);
    expect(completed.ready).toBe(2);
    expect(fetchFile.mock.calls.map((c) => c[0])).toEqual([
      "guitar.wav",
      "bass.wav",
      "guitar.wav",
    ]);
  });
  it("mantém o arquivo baixado quando o navegador falha ao abri-lo", async () => {
    const files: Record<string, Blob> = {},
      fetchFile = vi.fn(async () => new Blob(["downloaded"]));
    const options = {
      job,
      files,
      signal: new AbortController().signal,
      fetchFile,
      hasAudio: () => false,
      loadAudio: async () => {
        throw new Error("decoder");
      },
      onFile: vi.fn(),
      onTrack: vi.fn(),
    };
    await receiveResult(options);
    await receiveResult({ ...options, loadAudio: async () => [1] });
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(options.onFile).toHaveBeenCalledTimes(2);
  });
  it("interrompe a entrega ao mudar de sessão sem aplicar arquivos na nova sessão", async () => {
    const controller = new AbortController(),
      onFile = vi.fn();
    await expect(
      receiveResult({
        job,
        files: {},
        signal: controller.signal,
        hasAudio: () => false,
        fetchFile: async () => {
          controller.abort();
          return new Blob(["old"]);
        },
        loadAudio: async () => [],
        onFile,
        onTrack: vi.fn(),
      }),
    ).rejects.toThrow();
    expect(onFile).not.toHaveBeenCalled();
  });
});
