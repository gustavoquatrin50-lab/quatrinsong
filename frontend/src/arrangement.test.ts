import { describe, expect, it } from "vitest";
import {
  measureAt,
  measureGrid,
  normalizeNote,
  noteName,
  staffStep,
} from "./arrangement";

describe("arranjo gerado a partir dos eventos de áudio", () => {
  it("cobre a música inteira com compassos, incluindo o último incompleto", () => {
    const timing = measureGrid(9.5, 120);
    expect(timing.measures.map((m) => [m.start, m.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
      [8, 9.5],
    ]);
    expect(measureAt(timing.measures, 4)).toBe(2);
  });
  it("preserva variações de andamento da grade de batidas detectada", () => {
    const timing = measureGrid(
      5,
      120,
      4,
      [0, 0.5, 1, 1.5, 2.1, 2.7, 3.3, 3.9, 4.5],
    );
    expect(timing.measures[0].end).toBe(2.1);
    expect(timing.measures[1].end).toBe(4.5);
  });
  it("lê projetos anteriores sem gerar arquivos ou sons sintetizados", () => {
    expect(
      normalizeNote({ start: 0, end: 1, midi: 64, velocity: 0.8 } as never)
        .pitch,
    ).toBe(64);
    expect(noteName(64)).toBe("E4");
    expect(staffStep(64)).toBe(0);
    expect(staffStep(43, true)).toBe(0);
  });
});
