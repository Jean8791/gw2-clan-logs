import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { battleDay, filtersToQuery, parseFilters } from "@gw2logs/shared";
import { loadConfig, paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import * as q from "../src/queries.js";
import { buildApp } from "../src/server.js";

// Horários em Brasília (UTC-3), escritos em UTC: 23:55 de 12/11 = 02:55Z de 13/11.
const T = {
  noite12_1805: "2026-11-12T21:05:00.000Z", // 18:05 de 12/11
  noite12_2355: "2026-11-13T02:55:00.000Z", // 23:55 de 12/11
  madrugada13_0008: "2026-11-13T03:08:00.000Z", // 00:08 de 13/11 (ainda a noite de 12/11)
  madrugada13_0559: "2026-11-13T08:59:00.000Z", // 05:59 de 13/11 (ainda a noite de 12/11)
  dia13_0600: "2026-11-13T09:00:00.000Z", // 06:00 de 13/11 (começa o dia 13)
  dia13_1000: "2026-11-13T13:00:00.000Z", // 10:00 de 13/11
};

describe("battleDay: o dia de batalha vai das 06:00 às 06:00 (Brasília)", () => {
  it.each([
    ["18:05 de 12/11", T.noite12_1805, "2026-11-12"],
    ["23:55 de 12/11", T.noite12_2355, "2026-11-12"],
    ["00:08 de 13/11 ainda é a noite de 12/11", T.madrugada13_0008, "2026-11-12"],
    ["05:59 de 13/11 ainda é a noite de 12/11", T.madrugada13_0559, "2026-11-12"],
    ["06:00 de 13/11 já é o dia 13", T.dia13_0600, "2026-11-13"],
    ["10:00 de 13/11", T.dia13_1000, "2026-11-13"],
  ])("%s", (_nome, iso, dia) => {
    expect(battleDay(iso)).toBe(dia);
  });

  it("devolve null sem data ou com data inválida", () => {
    expect(battleDay(null)).toBeNull();
    expect(battleDay("lixo")).toBeNull();
  });
});

describe("filtro day na URL", () => {
  it("lê vários dias, descartando os inválidos e os repetidos", () => {
    expect(parseFilters({ day: "2026-11-12,2026-11-13,xx,2026-13-45,2026-11-12" }).day).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("data impossível não derruba a API (2026-02-30, 2026-13-45)", () => {
    expect(() => parseFilters({ day: "2026-02-30,2026-13-45" })).not.toThrow();
    expect(parseFilters({ day: "2026-02-30,2026-13-45" }).day).toBeUndefined();
  });

  it("sem dia válido, o filtro não existe", () => {
    expect(parseFilters({ day: "lixo" }).day).toBeUndefined();
  });

  it("volta igual para a query string", () => {
    const q = filtersToQuery({ day: ["2026-11-12", "2026-11-13"] });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(q))).day).toEqual(["2026-11-12", "2026-11-13"]);
  });
});

let dir: string;
let db: DB;
let n = 0;

/** Luta já processada, com o tempo em UTC, e os jogadores dela (conta → dano). */
function fight(start: string, players: Record<string, number>, o: { kills?: number; deaths?: number; durationMs?: number } = {}) {
  const id = `l${++n}`;
  db.prepare(
    "INSERT INTO fights (id, sha256, status, uploaded_at, mode, time_start, duration_ms, squad_kills, squad_deaths) VALUES (?, ?, 'done', ?, 'wvw', ?, ?, ?, ?)",
  ).run(id, "sha-" + id, new Date().toISOString(), start, o.durationMs ?? 60000, o.kills ?? 0, o.deaths ?? 0);
  for (const [account, damage] of Object.entries(players)) {
    db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, damage, active_ms) VALUES (?, ?, ?, 'Reaper', ?, 60000)").run(id, account, account, damage);
  }
  return id;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-days-"));
  db = openDb(paths(dir).db);
  fight(T.noite12_1805, { "A.1111": 100 }, { kills: 1 });
  fight(T.noite12_2355, { "A.1111": 200, "B.2222": 50 }, { kills: 2, deaths: 1 });
  fight(T.madrugada13_0008, { "A.1111": 300 }, { kills: 4, deaths: 2, durationMs: 120000 });
  fight(T.dia13_1000, { "A.1111": 1000, "B.2222": 10 }, { kills: 8 });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("filtro por dia nas consultas", () => {
  it("a lista de lutas traz só as do dia, inclusive as depois da meia-noite", () => {
    const lutas = q.listFights(db, { day: ["2026-11-12"] });

    expect(lutas.map((l) => l.timeStart).sort()).toEqual([T.noite12_1805, T.noite12_2355, T.madrugada13_0008]);
  });

  it("vários dias somam as lutas de todos eles", () => {
    expect(q.listFights(db, { day: ["2026-11-12", "2026-11-13"] })).toHaveLength(4);
  });

  it("o ranking soma só o dano das lutas do dia", () => {
    const a = q.ranking(db, { day: ["2026-11-12"] }).find((r) => r.account === "A.1111")!;

    expect(a.damage).toBe(100 + 200 + 300);
    expect(a.fights).toBe(3);
  });
});

describe("battleDays: a lista de dias", () => {
  it("devolve um item por dia, do mais recente para o mais antigo, com os totais", () => {
    const dias = q.battleDays(db, {});

    expect(dias.map((d) => d.day)).toEqual(["2026-11-13", "2026-11-12"]);
    expect(dias[1]).toMatchObject({ day: "2026-11-12", fights: 3, durationMs: 60000 + 60000 + 120000, kills: 7, deaths: 3, players: 2 });
    expect(dias[1]!.first).toBe(T.noite12_1805);
    expect(dias[1]!.last).toBe(T.madrugada13_0008);
  });

  it("a lista de dias ignora o próprio filtro de dia (senão só sobraria o escolhido)", () => {
    expect(q.battleDays(db, { day: ["2026-11-12"] }).map((d) => d.day)).toEqual(["2026-11-13", "2026-11-12"]);
  });

  it("lutas sem data não viram um dia", () => {
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, mode) VALUES ('sem-data', 's', 'done', ?, 'wvw')").run(new Date().toISOString());

    expect(q.battleDays(db, {})).toHaveLength(2);
  });
});

describe("GET /api/days", () => {
  it("devolve os dias de batalha", async () => {
    const app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));

    const res = await app.server.inject({ url: "/api/days?mode=wvw" });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((d: any) => d.day)).toEqual(["2026-11-13", "2026-11-12"]);
    await app.server.close();
  });
});
