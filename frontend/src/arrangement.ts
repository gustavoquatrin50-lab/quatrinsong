import type { Measure, Note, Timing } from "./types";

export function normalizeNote(note: Note): Note {
  return { ...note, pitch: note.pitch ?? note.midi ?? 0 };
}

export function measureGrid(
  duration: number,
  bpm = 120,
  numerator = 4,
  beats: number[] = [],
): Timing {
  const safeTempo = Number.isFinite(bpm) && bpm >= 20 && bpm <= 300 ? bpm : 120;
  const boundaries = [0];
  if (beats.length >= numerator * 2) {
    for (let i = numerator; i < beats.length; i += numerator)
      if (beats[i] > boundaries.at(-1)! + 0.05 && beats[i] < duration - 0.05)
        boundaries.push(beats[i]);
  } else {
    const seconds = (numerator * 60) / safeTempo;
    for (let n = seconds; n < duration - 0.05; n += seconds) boundaries.push(n);
  }
  if (duration > 0) boundaries.push(duration);
  return {
    beats,
    estimated: true,
    measures: boundaries
      .slice(0, -1)
      .map((start, index) => ({
        index,
        start,
        end: boundaries[index + 1],
        numerator,
        denominator: 4,
      })),
  };
}

export function measureAt(measures: Measure[], time: number) {
  return Math.max(
    0,
    measures.findIndex((m) => time >= m.start && time < m.end) === -1
      ? measures.length - 1
      : measures.findIndex((m) => time >= m.start && time < m.end),
  );
}

export function noteName(pitch: number) {
  return `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][((Math.round(pitch) % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

// Treble staff bottom line is E4; bass staff bottom line is G2.
export function staffStep(pitch: number, bass = false) {
  const naturalSteps = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const octave = Math.floor(pitch / 12) - 1,
    degree = naturalSteps[((Math.round(pitch) % 12) + 12) % 12];
  return octave * 7 + degree - (bass ? 2 * 7 + 4 : 4 * 7 + 2);
}

export function rhythm(note: Note, measure: Measure) {
  const beats =
    (note.end - note.start) /
    ((measure.end - measure.start) / measure.numerator);
  return [0.25, 0.5, 1, 2, 4].reduce(
    (best, n) => (Math.abs(n - beats) < Math.abs(best - beats) ? n : best),
    1,
  );
}
