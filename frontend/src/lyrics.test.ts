import { describe, expect, it } from "vitest";
import { mergeLyrics, chordsForLine } from "./lyrics";
import type { Job, Project } from "./types";
const project: Project = {
  version: 1,
  id: "session",
  title: "song",
  filename: "song.mp3",
  duration: 10,
  updated: 0,
  tracks: [],
  cues: [{ id: "manual", text: "Em", start: 0, source: "manual" }],
  rawText: "",
  jobId: "job",
  jobApplied: true,
};
const job: Job = {
  id: "job",
  status: "completed",
  stage: "Pronto",
  progress: 100,
  warnings: [],
  lyrics_state: "ready",
  result: {
    duration: 10,
    tracks: [],
    chords: [],
    lyrics_revision: "first",
    lyrics_language: "pt",
    lyrics: [{ start: 0, end: 3, text: "Uma canção" }],
  },
};
describe("letra separada dos acordes e da entrega de áudio", () => {
  it("recebe letra depois do áudio completo sem sobrescrever cifra manual", () => {
    const result = mergeLyrics(project, job);
    expect(result.lyrics?.[0].text).toBe("Uma canção");
    expect(result.cues).toBe(project.cues);
    expect(result.jobApplied).toBe(true);
    expect(result.lyricsPending).toBe(false);
  });
  it("preserva letra corrigida ao repetir polling e recebe nova geração explicitamente", () => {
    const corrected = {
      ...mergeLyrics(project, job),
      lyrics: [{ start: 1, end: 3, text: "Correção" }],
    };
    expect(mergeLyrics(corrected, job).lyrics?.[0].text).toBe("Correção");
    expect(
      mergeLyrics(
        { ...corrected, lyrics: [] },
        { ...job, lyrics_state: "queued" },
      ).lyrics,
    ).toEqual([]);
    expect(
      mergeLyrics(corrected, {
        ...job,
        result: { ...job.result!, lyrics_revision: "new" },
      }).lyrics?.[0].text,
    ).toBe("Uma canção");
    expect(mergeLyrics(corrected, { ...job, id: "other" })).toBe(corrected);
  });
  it("acompanha fila sem reabrir a entrega dos stems", () => {
    expect(
      mergeLyrics(project, {
        ...job,
        lyrics_state: "running",
        result: undefined,
      }).lyricsPending,
    ).toBe(true);
    expect(
      mergeLyrics(project, {
        ...job,
        lyrics_state: "failed",
        result: undefined,
      }).jobApplied,
    ).toBe(true);
  });
  it("mostra acorde vigente e mudanças no intervalo da linha", () => {
    const cues = [
      { id: "1", text: "Em", start: 0, end: 2, source: "ai" as const },
      { id: "2", text: "C", start: 2, end: 4, source: "ai" as const },
    ];
    expect(
      chordsForLine({ start: 1, end: 3, text: "test" }, cues).map(
        (c) => c.text,
      ),
    ).toEqual(["Em", "C"]);
    expect(chordsForLine({ start: 4, end: 5, text: "test" }, cues)).toEqual([]);
  });
});
