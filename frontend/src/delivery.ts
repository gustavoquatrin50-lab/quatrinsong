import { makeTrack } from "./types";
import type { Job, Project, Track } from "./types";
import { normalizeNote } from "./arrangement";

export function mergeResult(project: Project, job: Job): Project {
  if (!job.result || !job.result.tracks.length)
    throw new Error("O servidor não devolveu o manifesto das pistas.");
  // Retrying a transfer must preserve note corrections, mixer settings and text edits.
  if (project.jobResultId === job.id) return project;
  const manual = project.cues.filter(
    (c) => c.source === "manual" && c.barIndex === undefined,
  );
  return {
    ...project,
    jobResultId: job.id,
    jobApplied: false,
    duration: job.result.duration,
    bpm: job.result.bpm,
    timing: job.result.timing,
    harmony:
      job.operation === "vocals_drums" && project.harmony?.length
        ? project.harmony
        : job.result.chords.filter((chord) => chord.label !== "N"),
    tracks: [
      ...job.result.tracks.map((t) => ({
        ...(job.operation
          ? project.tracks.find((old) => old.kind === t.kind)
          : undefined),
        ...makeTrack(t.kind, `${job.id}-${t.id}`),
        name: t.name,
        volume: 1,
        ...(job.operation
          ? (() => {
              const old = project.tracks.find((track) => track.kind === t.kind);
              return old
                ? {
                    volume: old.volume,
                    muted: old.muted,
                    solo: old.solo,
                    visible: old.visible,
                  }
                : {};
            })()
          : {}),
        filename: t.file,
        notes: (job.operation
          ? (project.tracks.find((old) => old.kind === t.kind)?.notes ??
            t.notes)
          : t.notes
        )?.map(normalizeNote),
        waveform: t.waveform,
        loadState: "pending" as const,
      })),
      ...project.tracks
        .filter((t) => t.kind === "original")
        .map((t) => ({ ...t, muted: true, solo: false })),
    ],
    cues: manual.length
      ? manual
      : job.result.chords
          .filter((c) => c.label !== "N")
          .map((c) => ({
            id: crypto.randomUUID(),
            text: c.label,
            start: c.start,
            end: c.end,
            source: "ai" as const,
          })),
  };
}

export type DeliveryOptions = {
  job: Job;
  files: Record<string, Blob>;
  signal: AbortSignal;
  hasAudio: (id: string) => boolean;
  fetchFile: (file: string, signal: AbortSignal) => Promise<Blob>;
  loadAudio: (id: string, file: Blob) => Promise<number[]>;
  onFile: (id: string, file: Blob) => void;
  onTrack: (
    id: string,
    state: NonNullable<Track["loadState"]>,
    error?: string,
    peaks?: number[],
  ) => void;
};

export async function receiveResult(options: DeliveryOptions) {
  const {
    job,
    files,
    signal,
    hasAudio,
    fetchFile,
    loadAudio,
    onFile,
    onTrack,
  } = options;
  const failures: string[] = [];
  let ready = 0;
  const pending = job.result!.tracks.values();
  async function transfer() {
    for (const track of pending) {
      signal.throwIfAborted();
      const id = `${job.id}-${track.id}`;
      if (hasAudio(id)) {
        ready++;
        onTrack(id, "ready");
        continue;
      }
      onTrack(id, "loading");
      try {
        let file = files[id];
        if (!file) {
          file = await fetchFile(track.file, signal);
          signal.throwIfAborted();
          files[id] = file;
          // Keep each successful download even if decoding or another track fails.
          onFile(id, file);
        }
        const samples = await loadAudio(id, file);
        signal.throwIfAborted();
        onTrack(id, "ready", undefined, samples);
        ready++;
      } catch (error) {
        signal.throwIfAborted();
        const detail = `${track.name}: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(detail);
        onTrack(id, "error", detail);
      }
    }
  }
  // Match the two-encoder server limit while bounding network and decode memory.
  await Promise.all([transfer(), transfer()]);
  return { ready, total: job.result!.tracks.length, failures };
}
