import { describe, expect, it } from "vitest";
import { perMinute, perSecond } from "@gw2logs/shared";

describe("perSecond: valor por segundo de tempo ativo", () => {
  it("600 de dano em 60 s ativos são 10 por segundo e 600 por minuto", () => {
    expect(perSecond(600, 60_000)).toBe(10);
    expect(perMinute(600, 60_000)).toBe(600);
  });

  it("por minuto é sempre 60 vezes o por segundo", () => {
    expect(perMinute(1234, 47_300)).toBeCloseTo(perSecond(1234, 47_300) * 60, 9);
  });

  it("contagens pequenas não somem: 3 abates em 4 min ativos dão 0,0125 por segundo", () => {
    expect(perSecond(3, 240_000)).toBeCloseTo(0.0125, 9);
  });

  it("sem tempo ativo, zero (sem dividir por zero)", () => {
    expect(perSecond(100, 0)).toBe(0);
  });
});
