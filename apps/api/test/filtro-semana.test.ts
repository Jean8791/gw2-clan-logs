import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters, weekOf, weekRange } from "@gw2logs/shared";

// A semana vai da sexta 23:03 até a sexta seguinte 23:00, no horário de Brasília (UTC-3). Entre 23:00 e 23:03 de sexta não há semana.
// 27/11/2026 é uma sexta-feira.

describe("weekRange: o intervalo de uma semana, a partir da data da sexta em que ela começa", () => {
  it("começa na sexta às 23:03 e termina na sexta seguinte às 23:00 (Brasília), em UTC", () => {
    expect(weekRange("2026-11-27")).toEqual({ from: "2026-11-28T02:03:00.000Z", to: "2026-12-05T02:00:00.000Z" });
  });

  it("só aceita uma sexta-feira que exista", () => {
    expect(weekRange("2026-11-28")).toBeNull(); // sábado
    expect(weekRange("2026-11-26")).toBeNull(); // quinta
    expect(weekRange("2026-02-30")).toBeNull(); // data impossível
    expect(weekRange("lixo")).toBeNull();
  });
});

describe("weekOf: a semana (pela data da sexta de início) a que um instante pertence", () => {
  it.each([
    ["sexta 23:03 em ponto abre a semana nova", "2026-11-28T02:03:00.000Z", "2026-11-27"],
    ["sexta 22:59 ainda é da semana anterior", "2026-11-28T01:59:00.000Z", "2026-11-20"],
    ["sexta 23:02 está na janela de 3 minutos, sem semana", "2026-11-28T02:02:00.000Z", null],
    ["sábado de manhã é da semana que começou na sexta", "2026-11-28T13:00:00.000Z", "2026-11-27"],
    ["quinta da semana seguinte é da mesma semana", "2026-12-04T20:00:00.000Z", "2026-11-27"],
    ["a sexta seguinte antes das 23:00 ainda é da mesma semana", "2026-12-05T01:59:00.000Z", "2026-11-27"],
    ["sexta 23:00 em ponto fecha a semana: já não é dela", "2026-12-05T02:00:00.000Z", null],
    ["sexta 23:01 está na janela de 3 minutos, sem semana", "2026-12-05T02:01:00.000Z", null],
    ["sexta 23:03 da semana seguinte abre a próxima", "2026-12-05T02:03:00.000Z", "2026-12-04"],
    ["sexta de tarde, antes das 23:00, é da semana anterior", "2026-11-27T20:00:00.000Z", "2026-11-20"],
  ])("%s", (_nome, instante, semana) => {
    expect(weekOf(instante)).toBe(semana);
  });

  it("instante inválido ou vazio não tem semana", () => {
    expect(weekOf("xx")).toBeNull();
    expect(weekOf(null)).toBeNull();
  });
});

describe("filtro week na URL e na query", () => {
  it("lê uma sexta válida e ignora o resto", () => {
    expect(parseFilters({ week: "2026-11-27" })).toEqual({ week: "2026-11-27" });
    expect(parseFilters({ week: "2026-11-28" })).toEqual({});
    expect(parseFilters({ week: "x" })).toEqual({});
  });

  it("volta para a query", () => {
    expect(filtersToQuery({ week: "2026-11-27", guild: "g" })).toBe("guild=g&week=2026-11-27");
  });
});
