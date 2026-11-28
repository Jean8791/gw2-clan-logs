import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters, weekOf, weeksBetween, weekRange } from "@gw2logs/shared";
import { openDb, type DB } from "../src/db.js";
import * as q from "../src/queries.js";

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

describe("weeksBetween: as semanas que cobrem um intervalo de lutas, da mais recente para a mais antiga", () => {
  it("lista a semana do primeiro instante até a do último, sem pular nenhuma", () => {
    expect(weeksBetween("2026-11-22T20:00:00.000Z", "2026-12-08T20:00:00.000Z")).toEqual(["2026-12-04", "2026-11-27", "2026-11-20"]);
  });

  it("um intervalo dentro de uma semana devolve só ela", () => {
    expect(weeksBetween("2026-11-30T20:00:00.000Z", "2026-12-01T20:00:00.000Z")).toEqual(["2026-11-27"]);
  });

  it("instante na janela de 23:00 a 23:03 de sexta usa a semana vizinha, e entrada inválida devolve lista vazia", () => {
    expect(weeksBetween("2026-12-05T02:01:00.000Z", "2026-12-05T02:01:00.000Z")).toEqual(["2026-12-04"]);
    expect(weeksBetween("x", "y")).toEqual([]);
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

describe("week no servidor: só as lutas da semana", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-sem-"));
    db = openDb(path.join(dir, "t.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let n = 0;
  const luta = (id: string, inicio: string) => {
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', 'x', ?, 'wvw', ?, 120000, 10, 1000)").run(id, "s" + id, inicio, 100 + n++);
    db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms) VALUES (?, 'Ana.1', 'Ana', 'Firebrand', 'support', 60000)").run(id);
  };
  const ids = (semana: string) => q.listFights(db, { week: semana }, 100, 0).map((f) => f.id).sort();

  it("inclui da sexta 23:03 até antes da sexta seguinte 23:00, e deixa de fora a janela das 23:00 às 23:03", () => {
    luta("antes", "2026-11-28T01:59:00.000Z"); // sexta 22:59: semana anterior
    luta("abre", "2026-11-28T02:03:00.000Z"); // sexta 23:03: abre a semana
    luta("meio", "2026-12-01T20:00:00.000Z");
    luta("fecha", "2026-12-05T01:59:00.000Z"); // sexta 22:59: ainda dentro
    luta("janela", "2026-12-05T02:01:00.000Z"); // sexta 23:01: em nenhuma semana
    luta("proxima", "2026-12-05T02:03:00.000Z"); // sexta 23:03: semana seguinte

    expect(ids("2026-11-27")).toEqual(["abre", "fecha", "meio"]);
    expect(ids("2026-12-04")).toEqual(["proxima"]);
    expect(ids("2026-11-20")).toEqual(["antes"]);
  });

  it("vale também para o Ranking e combina com os outros filtros", () => {
    luta("a", "2026-11-30T20:00:00.000Z");
    luta("b", "2026-12-08T20:00:00.000Z");

    expect(q.ranking(db, { week: "2026-11-27" }).find((r) => r.account === "Ana.1")?.fights).toBe(1);
    expect(q.ranking(db, { week: "2026-11-27", guild: "nenhuma" })).toEqual([]);
  });
});
