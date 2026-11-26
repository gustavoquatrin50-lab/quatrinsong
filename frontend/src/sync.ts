import type { Cue } from "./types";

export function formatTime(seconds: number, precision = false): string {
  const n = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const ticks = Math.round(n * 100),
    whole = precision ? Math.floor(ticks / 100) : Math.floor(n);
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(whole % 60).toString().padStart(2, "0")}${precision ? "." + (ticks % 100).toString().padStart(2, "0") : ""}`;
}

export function parseTime(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(s);
  if (!m) return null;
  const seconds = Number(m[2].replace(",", "."));
  if (m[1] && seconds >= 60) return null;
  return Number(m[1] || 0) * 60 + seconds;
}

export function parseText(
  text: string,
  mode: "blocks" | "lines" = "blocks",
): Cue[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lrc = normalized
    .split("\n")
    .some((l) => /^\[\d+:\d+(?:[.:]\d+)?\]/.test(l));
  if (lrc) {
    return normalized.split("\n").flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)];
      if (!matches.length) return [];
      const body = line.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, "");
      return matches.map((m) => ({
        id: crypto.randomUUID(),
        text: body,
        start:
          Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0),
        source: "manual" as const,
      }));
    });
  }
  // Keep all spaces within each block: ASCII tablature depends on their positions.
  return (
    mode === "lines" ? normalized.split("\n") : normalized.split(/\n[ \t]*\n/)
  )
    .filter((block) => block.trim().length > 0)
    .map((block) => ({
      id: crypto.randomUUID(),
      text: block,
      start: null,
      source: "manual",
    }));
}

export function activeCue(cues: Cue[], time: number): string | null {
  const timed = cues
    .filter((c) => c.start !== null)
    .sort((a, b) => a.start! - b.start!);
  let result: Cue | undefined;
  for (const cue of timed) {
    if (cue.start! > time) break;
    result = cue;
  }
  return result && (result.end === undefined || time < result.end)
    ? result.id
    : null;
}

/** Piecewise mapping preserves rubato between manually aligned bar anchors. */
export function scoreTickAt(
  time: number,
  cues: Cue[],
  ticks: number[],
): number | null {
  const anchors = cues
    .filter(
      (c) =>
        c.start !== null &&
        c.barIndex !== undefined &&
        ticks[c.barIndex] !== undefined,
    )
    .map((c) => ({ time: c.start!, tick: ticks[c.barIndex!] }))
    .sort((a, b) => a.time - b.time);
  if (!anchors.length || time < anchors[0].time) return null;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1],
      b = anchors[i];
    if (time <= b.time && b.time > a.time)
      return a.tick + ((time - a.time) / (b.time - a.time)) * (b.tick - a.tick);
  }
  return anchors.at(-1)!.tick;
}
