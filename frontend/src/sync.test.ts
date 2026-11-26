import { describe, expect, it } from "vitest";
import {
  activeCue,
  formatTime,
  parseText,
  parseTime,
  scoreTickAt,
} from "./sync";

describe("importação e sincronização musical", () => {
  it("preserva espaços e as seis linhas de tablatura em um bloco", () => {
    const tab =
      "e|--0---3--|\nB|----1----|\nG|---------|\nD|---------|\nA|---------|\nE|---------|";
    const cues = parseText(`${tab}\n\nEm         C\n  Letra com espaços`);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe(tab);
    expect(cues[1].text).toBe("Em         C\n  Letra com espaços");
    expect(cues.every((c) => c.start === null)).toBe(true);
  });
  it("importa múltiplos timestamps LRC e preserva centésimos", () => {
    const cues = parseText(
      "[ar:Artista]\n[00:12.30][01:05.007]Em  C\n[01:06.00]Final",
    );
    expect(cues.map((c) => c.start)).toEqual([12.3, 65.007, 66]);
    expect(cues[0].text).toBe("Em  C");
  });
  it("não inventa duração nem eventos para texto sem tempo", () => {
    expect(parseText("  Em    C\nverso", "lines").map((c) => c.start)).toEqual([
      null,
      null,
    ]);
  });
  it("segue a ordem temporal mesmo com marcadores fora da ordem textual e respeita pausas", () => {
    const cues = parseText("Final\n\nInício\n\nSem tempo");
    cues[0].start = 10;
    cues[1].start = 2;
    cues[1].end = 6;
    expect(activeCue(cues, 1)).toBeNull();
    expect(activeCue(cues, 3)).toBe(cues[1].id);
    expect(activeCue(cues, 8)).toBeNull();
    expect(activeCue(cues, 12)).toBe(cues[0].id);
  });
  it("valida tempos do editor", () => {
    expect(parseTime("02:03.25")).toBe(123.25);
    expect(parseTime("4,5")).toBe(4.5);
    expect(parseTime("1:79")).toBeNull();
    expect(parseTime("-1")).toBeNull();
    expect(formatTime(123.25, true)).toBe("02:03.25");
    expect(formatTime(2.4, true)).toBe("00:02.40");
  });
  it("interpola compassos usando âncoras locais, sem supor BPM constante", () => {
    const cues = parseText("A\n\nB\n\nC");
    cues.forEach((c, i) => {
      c.barIndex = i;
      c.start = [2, 4, 9][i];
    });
    expect(scoreTickAt(3, cues, [0, 3840, 7680])).toBe(1920);
    expect(scoreTickAt(6.5, cues, [0, 3840, 7680])).toBe(5760);
    expect(scoreTickAt(0, cues, [0, 3840, 7680])).toBeNull();
  });
});
