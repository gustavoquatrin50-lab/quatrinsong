import type { Chord, Project } from "./types";
const roots: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const open: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  D7: [-1, -1, 0, 2, 1, 2],
  G: [3, 2, 0, 0, 0, 3],
  G7: [3, 2, 0, 0, 0, 1],
  "C/G": [3, 3, 2, 0, 1, 0],
  "D/F#": [2, -1, 0, 2, 3, 2],
  "G/B": [-1, 2, 0, 0, 3, 3],
  "C/E": [0, 3, 2, 0, 1, 0],
  "Am/G": [3, 0, 2, 2, 1, 0],
};
const eShapes: Record<string, number[]> = {
  "": [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  sus2: [0, 2, 4, 4, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  "5": [0, 2, 2, -1, -1, -1],
  dim: [0, 1, 2, 0, -1, -1],
  aug: [0, 3, 2, 1, 1, 0],
};
const aShapes: Record<string, number[]> = {
  "": [-1, 0, 2, 2, 2, 0],
  m: [-1, 0, 2, 2, 1, 0],
  "7": [-1, 0, 2, 0, 2, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  sus4: [-1, 0, 2, 2, 3, 0],
  "5": [-1, 0, 2, 2, -1, -1],
  dim: [-1, 0, 1, 2, 1, -1],
  aug: [-1, 0, 3, 2, 2, 1],
};

// Frets run from low E to high e. Movable E/A shapes preserve every chord tone.
export function chordShape(label: string): number[] | null {
  if (open[label]) return [...open[label]];
  const match = /^([A-G])([#b]?)(maj7|m7|sus2|sus4|dim|aug|m|7|5)?$/.exec(
    label,
  );
  if (!match) return null;
  const root =
    (roots[match[1]] +
      (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) +
      12) %
    12;
  const quality = match[3] || "";
  const e = (root - 4 + 12) % 12,
    a = (root - 9 + 12) % 12;
  const shape = e <= a ? eShapes[quality] : aShapes[quality];
  const offset = Math.min(e, a);
  return shape?.map((fret) => (fret < 0 ? -1 : fret + offset)) || null;
}
export function projectChords(project: Project | null): Chord[] {
  if (!project) return [];
  return (
    project.harmony ??
    project.cues
      .filter(
        (c) =>
          c.start !== null &&
          (c.source === "ai" || chordShape(c.text) !== null),
      )
      .sort((a, b) => a.start! - b.start!)
      .map((c, index, cues) => ({
        start: c.start!,
        end: c.end ?? cues[index + 1]?.start ?? project.duration,
        label: c.text,
      }))
  );
}
