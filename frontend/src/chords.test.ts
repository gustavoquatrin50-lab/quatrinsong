import { describe, expect, it } from "vitest";
import { chordShape, projectChords } from "./chords";
import type { Project } from "./types";
const tuning = [40, 45, 50, 55, 59, 64];
describe("digitações reais no braço e cifra independente do texto", () => {
  it("sincroniza acordes simples manuais antigos pelo próximo marcador", () => {
    const p = {
      cues: [
        { text: "Em", source: "manual", start: 0 },
        { text: "C", source: "manual", start: 2 },
      ],
      duration: 4,
    } as Project;
    expect(projectChords(p)).toEqual([
      { start: 0, end: 2, label: "Em" },
      { start: 2, end: 4, label: "C" },
    ]);
  });

  it("cada posição produz somente as notas do acorde, incluindo todas as classes", () => {
    const roots: Record<string, number> = {
      C: 0,
      "C#": 1,
      D: 2,
      Eb: 3,
      E: 4,
      F: 5,
      "F#": 6,
      G: 7,
      Ab: 8,
      A: 9,
      Bb: 10,
      B: 11,
    };
    const intervals: Record<string, number[]> = {
      "": [0, 4, 7],
      m: [0, 3, 7],
      "7": [0, 4, 7, 10],
      maj7: [0, 4, 7, 11],
      m7: [0, 3, 7, 10],
      sus2: [0, 2, 7],
      sus4: [0, 5, 7],
      dim: [0, 3, 6],
      aug: [0, 4, 8],
      "5": [0, 7],
    };
    for (const [root, pitch] of Object.entries(roots))
      for (const [quality, tones] of Object.entries(intervals)) {
        const frets = chordShape(root + quality)!;
        expect(frets, root + quality).toHaveLength(6);
        const played = [
          ...new Set(
            frets.flatMap((fret, i) =>
              fret < 0 ? [] : [(tuning[i] + fret) % 12],
            ),
          ),
        ].sort((a, b) => a - b);
        expect(played, root + quality).toEqual(
          tones.map((tone) => (tone + pitch) % 12).sort((a, b) => a - b),
        );
        expect(
          Math.max(...frets) - Math.min(...frets.filter((fret) => fret > 0)),
        ).toBeLessThanOrEqual(4);
      }
  });
  it("não inventa uma posição para acordes sem digitação cadastrada", () => {
    expect(chordShape("C13#11/G")).toBeNull();
  });
  it("mantém a sequência da IA quando o usuário importa letra manual", () => {
    const harmony = [{ start: 0, end: 2, label: "Em" }];
    const p = {
      harmony,
      cues: [{ text: "Letra manual", source: "manual", start: 0 }],
      duration: 2,
    } as Project;
    expect(projectChords(p)).toBe(harmony);
  });
});
