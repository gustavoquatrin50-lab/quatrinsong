export type Note = {
  start: number;
  end: number;
  pitch: number;
  midi?: number; // Compatibility with projects saved before 0.2; no MIDI files or playback.
  velocity: number;
  string?: number;
  fret?: number;
};
export type Track = {
  id: string;
  name: string;
  kind: string;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  visible: boolean;
  notes?: Note[];
  filename?: string;
  loadState?: "pending" | "loading" | "ready" | "error";
  loadError?: string;
  waveform?: number[];
  playbackFormat?: "wav" | "m4a";
};
export type Cue = {
  id: string;
  text: string;
  start: number | null;
  end?: number;
  barIndex?: number;
  source: "manual" | "ai";
};
export type Lyric = {
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string; confidence?: number }[];
};
export type Chord = { start: number; end: number; label: string };
export type Project = {
  version: 1;
  id: string;
  title: string;
  filename: string;
  duration: number;
  updated: number;
  tracks: Track[];
  cues: Cue[];
  rawText: string;
  lyrics?: Lyric[];
  lyricsLanguage?: string;
  lyricsSource?: string;
  lyricsReview?: { start: number; end: number; reason: string }[];
  lyricsRevision?: string;
  lyricsPending?: boolean;
  harmony?: Chord[];
  bpm?: number;
  demo?: boolean;
  jobId?: string;
  jobBase?: string;
  jobApplied?: boolean;
  jobResultId?: string;
  scoreName?: string;
  timing?: Timing;
};
export type Session = {
  project: Project;
  files: Record<string, Blob>;
  score?: Blob;
};
export type Job = {
  operation?: "chords" | "vocals_drums";
  source_job?: string;
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  error?: string;
  error_code?: string;
  error_details?: string;
  warnings: string[];
  lyrics_state?:
    | "waiting"
    | "not_requested"
    | "queued"
    | "running"
    | "ready"
    | "no_speech"
    | "failed"
    | "cancelled";
  lyrics_progress?: number;
  lyrics_stage?: string;
  lyrics_error?: string;
  result?: {
    duration: number;
    bpm?: number;
    timing?: Timing;
    tracks: {
      id: string;
      name: string;
      kind: string;
      file: string;
      notes?: Note[];
      waveform?: number[];
    }[];
    chords: Chord[];
    lyrics?: Lyric[];
    lyrics_language?: string;
    lyrics_revision?: string;
    lyrics_review?: { start: number; end: number; reason: string }[];
    lyrics_source?: string;
  };
};
export type Measure = {
  index: number;
  start: number;
  end: number;
  numerator: number;
  denominator: number;
};
export type Timing = {
  beats: number[];
  measures: Measure[];
  estimated: boolean;
};
export const PALETTE: Record<string, string> = {
  vocals: "#d6a1f3",
  drums: "#f4b969",
  bass: "#7ea9ff",
  guitar: "#c5f16d",
  piano: "#73d9cf",
  other: "#e399aa",
  original: "#a0a8b8",
};
export const NAMES: Record<string, string> = {
  vocals: "Voz",
  drums: "Bateria",
  bass: "Baixo",
  guitar: "Guitarra",
  piano: "Piano",
  other: "Outros",
  original: "Música original",
};
export function makeTrack(
  kind: string,
  id: string = crypto.randomUUID(),
): Track {
  return {
    id,
    kind,
    name: NAMES[kind] || kind,
    color: PALETTE[kind] || "#c5f16d",
    volume: 0.8,
    muted: false,
    solo: false,
    visible: true,
  };
}
