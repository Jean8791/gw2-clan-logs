import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveWeek, RankingRow } from "@gw2logs/shared";
import { snapshotDays } from "../src/archive.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import * as q from "../src/queries.js";
import { buildApp, type App } from "../src/server.js";

// A semana do arquivo (sexta 23:03 a sexta 23:00, Brasília) sai do mesmo resumo diário: cada linha do resumo guarda a semana da luta, então
// um dia de batalha que atravessa o corte de sexta se divide entre duas semanas, e o mês continua somando tudo.

let app: App;
let dir: string;
const now = new Date("2026-12-10T12:00:00Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-semanal-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let mapa = 300;
function luta(id: string, inicio: string, conta = "Ana.1111", damage = 1000) {
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', 'x', ?, 'wvw', ?, 120000, 10, 1000)")
    .run(id, "sha-" + id, inicio, mapa++);
  app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, guild_id, active_ms, damage) VALUES (?, ?, ?, 'Guardian', 'dps', 'G1', 60000, ?)").run(id, conta, conta.split(".")[0], damage);
}
const semana = async (week: string, query = "") => {
  const res = await app.server.inject(`/api/archive/ranking?week=${week}${query}`);
  return { status: res.statusCode, body: res.json() as { rows: RankingRow[]; code?: string } };
};
const danoDe = (rows: RankingRow[], conta: string) => rows.find((r) => r.account === conta)?.damage;

describe("arquivo semanal: a soma de uma semana", () => {
  it("soma só as lutas da semana, cortando no meio do dia de batalha de sexta (22:59 é de uma, 23:04 é da outra)", async () => {
    luta("a", "2026-11-28T01:59:00.000Z", "Ana.1111", 100); // sexta 22:59: semana 2026-11-20
    luta("b", "2026-11-28T02:04:00.000Z", "Ana.1111", 10); //  sexta 23:04: semana 2026-11-27 (o mesmo dia de batalha, 27/11)
    luta("c", "2026-12-01T20:00:00.000Z", "Ana.1111", 1); //   terça: semana 2026-11-27
    snapshotDays(app.db, now);

    expect(danoDe((await semana("2026-11-20")).body.rows, "Ana.1111")).toBe(100);
    expect(danoDe((await semana("2026-11-27")).body.rows, "Ana.1111")).toBe(11);
  });

  it("a semana que passa da virada do mês junta os dois meses, e o mês continua inteiro", async () => {
    luta("a", "2026-11-30T20:00:00.000Z", "Ana.1111", 5); // novembro
    luta("b", "2026-12-02T20:00:00.000Z", "Ana.1111", 7); // dezembro
    snapshotDays(app.db, now);

    expect(danoDe((await semana("2026-11-27")).body.rows, "Ana.1111")).toBe(12);
    expect(danoDe(q.archiveRanking(app.db, "2026-11", {}).rows, "Ana.1111")).toBe(5);
    expect(danoDe(q.archiveRanking(app.db, "2026-12", {}).rows, "Ana.1111")).toBe(7);
  });

  it("a luta na janela de 23:00 a 23:03 de sexta fica fora de qualquer semana, mas dentro do mês", async () => {
    luta("janela", "2026-12-05T02:01:00.000Z", "Ana.1111", 9); // sexta 23:01
    snapshotDays(app.db, now);

    expect((await semana("2026-11-27")).body.rows).toEqual([]);
    expect((await semana("2026-12-04")).body.rows).toEqual([]);
    expect(danoDe(q.archiveRanking(app.db, "2026-12", {}).rows, "Ana.1111")).toBe(9);
  });

  it("os filtros do resumo (guilda) valem na semana", async () => {
    luta("a", "2026-12-01T20:00:00.000Z", "Ana.1111", 5);

    snapshotDays(app.db, now);

    expect((await semana("2026-11-27", "&guild=G1")).body.rows).toHaveLength(1);
    expect((await semana("2026-11-27", "&guild=outra")).body.rows).toEqual([]);
  });

  it("data que não é sexta, ou sem month nem week, dá 400 badMonth", async () => {
    const sabado = await semana("2026-11-28");
    expect(sabado.status).toBe(400);
    expect(sabado.body.code).toBe("badMonth");
    expect((await app.server.inject("/api/archive/ranking")).statusCode).toBe(400);
  });
});

describe("GET /api/archive/weeks: as semanas com resumo", () => {
  it("lista da mais nova para a mais antiga, com o primeiro e o último dia, os dias, os jogadores e a semana em andamento", async () => {
    luta("a", "2026-12-01T20:00:00.000Z", "Ana.1111");
    luta("b", "2026-12-02T20:00:00.000Z", "Beto.2222");
    luta("c", "2026-12-08T20:00:00.000Z", "Ana.1111");
    snapshotDays(app.db, now);

    const weeks = q.archiveWeeks(app.db, now);

    expect(((await app.server.inject("/api/archive/weeks")).json() as ArchiveWeek[]).map((w) => w.week)).toEqual(["2026-12-04", "2026-11-27"]);
    expect(weeks).toEqual([
      { week: "2026-12-04", days: 1, first: "2026-12-08", last: "2026-12-08", players: 1, current: true },
      { week: "2026-11-27", days: 2, first: "2026-12-01", last: "2026-12-02", players: 2, current: false },
    ]);
  });
});

describe("migração: o resumo de uma versão sem semana ganha a coluna e é refeito", () => {
  it("linhas antigas ficam sem semana, e os dias ainda abertos são refeitos (os congelados ficam como estão)", () => {
    const file = path.join(dir, "sem-semana.db");
    const velho = new Database(file);
    velho.exec(`
      CREATE TABLE day_stats (day TEXT NOT NULL, mode TEXT NOT NULL, account TEXT NOT NULL, profession TEXT NOT NULL, role TEXT NOT NULL, guild_id TEXT NOT NULL,
        name TEXT, last_seen TEXT, fights INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0, dist_cover_ms REAL NOT NULL DEFAULT 0,
        near_cover_ms REAL NOT NULL DEFAULT 0, damage REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, mode, account, profession, role, guild_id));
      CREATE TABLE day_snapshots (day TEXT PRIMARY KEY, built_at TEXT NOT NULL, signature TEXT NOT NULL, frozen INTEGER NOT NULL DEFAULT 0);
      INSERT INTO day_stats (day, mode, account, profession, role, guild_id, damage) VALUES ('2026-11-01', 'wvw', 'Ana.1111', 'Guardian', 'dps', '', 42);
      INSERT INTO day_snapshots VALUES ('2026-11-01', 'x', 'a', 1), ('2026-11-02', 'x', 'b', 0);
    `);
    velho.close();

    const db = openDb(file);

    expect((db.pragma("table_info(day_stats)") as { name: string }[]).map((c) => c.name)).toContain("week");
    expect(db.prepare("SELECT account, week, damage FROM day_stats").all()).toEqual([{ account: "Ana.1111", week: "", damage: 42 }]);
    expect(db.prepare("SELECT day FROM day_snapshots ORDER BY day").all()).toEqual([{ day: "2026-11-01" }]);
    db.close();
  });
});
