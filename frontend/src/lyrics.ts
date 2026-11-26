import type { Cue, Job, Lyric, Project } from "./types";

export function mergeLyrics(project: Project, job: Job): Project {
  if (project.jobId !== job.id) return project;
  const pending =
    !["failed", "cancelled"].includes(job.status) &&
    ["waiting", "queued", "running"].includes(job.lyrics_state || "");
  const revision = job.result?.lyrics_revision;
  const changed =
    ["ready", "no_speech"].includes(job.lyrics_state || "") &&
    revision &&
    revision !== project.lyricsRevision;
  return {
    ...project,
    lyricsPending: pending,
    ...(changed && job.result?.lyrics
      ? {
          lyrics: job.result.lyrics,
          lyricsLanguage: job.result.lyrics_language,
          lyricsSource: job.result.lyrics_source,
          lyricsReview: job.result.lyrics_review,
          lyricsRevision: revision,
        }
      : {}),
  };
}

export function chordsForLine(line: Lyric, cues: Cue[]) {
  const chords = cues.filter(
    (c) =>
      c.start !== null &&
      (c.source === "ai" ||
        /^[A-G][#b]?(?:maj|min|m|M|sus|dim|aug|add)?[0-9#b()+/A-G-]*$/.test(
          c.text,
        )),
  );
  const previous = chords
    .filter(
      (c) =>
        c.start! <= line.start && (c.end === undefined || c.end > line.start),
    )
    .at(-1);
  return [
    ...(previous ? [previous] : []),
    ...chords.filter((c) => c.start! > line.start && c.start! < line.end),
  ];
}
