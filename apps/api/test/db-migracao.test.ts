import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-mig-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Banco como era antes: sha256 único no banco todo, sem dono, com estatísticas ligadas à luta. */
function bancoAntigo(file: string) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);
    CREATE TABLE player_stats (
      fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT,
      grp INTEGER, commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
      PRIMARY KEY (fight_id, account));
    INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('f1', 'sha-a', 'done', '2026-01-01');
    INSERT INTO player_stats (fight_id, account) VALUES ('f1', 'Fulano.1234');
  `);
  db.close();
}

describe("migração do sha256 único por dono", () => {
  it("banco antigo: mantém lutas e estatísticas e passa a aceitar o mesmo log para outro dono", () => {
    const file = path.join(dir, "antigo.db");
    bancoAntigo(file);

    const db = openDb(file);

    expect(db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "f1" }]);
    expect(db.prepare("SELECT account FROM player_stats WHERE fight_id = 'f1'").all()).toEqual([{ account: "Fulano.1234" }]);
    db.prepare("INSERT INTO users (id, public_id, discord_id, name, created_at) VALUES (1, 'a', '1', 'ana', 'x'), (2, 'b', '2', 'beto', 'x')").run();
    const novo = db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, 'sha-a', 'queued', 'x', ?)");
    novo.run("f2", 1);
    novo.run("f3", 2);
    expect(() => novo.run("f4", 1)).toThrow(/UNIQUE/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });

  it("banco antigo ganha a coluna process_ms (tempo de processamento) sem perder as lutas", () => {
    const file = path.join(dir, "antigo-tempo.db");
    bancoAntigo(file);

    const db = openDb(file);

    expect(db.prepare("SELECT id, process_ms FROM fights").all()).toEqual([{ id: "f1", process_ms: null }]);
    db.close();
  });

  it("banco novo já nasce com a coluna process_ms", () => {
    const db = openDb(path.join(dir, "novo-tempo.db"));
    expect((db.pragma("table_info(fights)") as { name: string }[]).map((c) => c.name)).toContain("process_ms");
    db.close();
  });

  it("abrir de novo um banco já migrado não refaz nada", () => {
    const file = path.join(dir, "novo.db");
    openDb(file).close();
    const db = openDb(file);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'fights_novo'").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("resumo diário (day_stats)", () => {
  const colunas = (db: ReturnType<typeof openDb>, tabela: string) => (db.pragma(`table_info(${tabela})`) as { name: string }[]).map((c) => c.name);

  it("banco antigo, sem o resumo, sobe com as duas tabelas e sem perder as lutas", () => {
    const file = path.join(dir, "antigo-resumo.db");
    bancoAntigo(file);

    const db = openDb(file);

    expect(colunas(db, "day_stats")).toEqual(expect.arrayContaining(["day", "account", "profession", "role", "guild_id", "fights", "active_ms", "damage", "stab_out"]));
    expect(colunas(db, "day_snapshots")).toEqual(["day", "built_at", "signature", "frozen"]);
    expect(db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "f1" }]);
    db.close();
  });

  it("resumo de uma versão anterior, com menos métricas, ganha as colunas que faltam e mantém as linhas", () => {
    const file = path.join(dir, "resumo-velho.db");
    const velho = new Database(file);
    velho.exec(`
      CREATE TABLE day_stats (day TEXT NOT NULL, mode TEXT NOT NULL, account TEXT NOT NULL, profession TEXT NOT NULL, role TEXT NOT NULL, guild_id TEXT NOT NULL,
        name TEXT, last_seen TEXT, fights INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0, dist_cover_ms REAL NOT NULL DEFAULT 0,
        near_cover_ms REAL NOT NULL DEFAULT 0, damage REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, mode, account, profession, role, guild_id));
      INSERT INTO day_stats (day, mode, account, profession, role, guild_id, damage) VALUES ('2026-11-01', 'wvw', 'Ana.1111', 'Guardian', 'dps', '', 42);
    `);
    velho.close();

    const db = openDb(file);

    expect(colunas(db, "day_stats")).toContain("healing");
    expect(db.prepare("SELECT account, damage, healing FROM day_stats").all()).toEqual([{ account: "Ana.1111", damage: 42, healing: 0 }]);
    db.close();
  });
});

describe("uptime no grupo: preenche as lutas que já estavam no banco", () => {
  /** Banco de antes da métrica: duas lutas com o uptime do próprio jogador e o grupo guardados. */
  function bancoSemGrupoUp(file: string) {
    const db = new Database(file);
    db.exec(`
      CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);
      CREATE TABLE player_stats (
        fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT,
        grp INTEGER, commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
        stab_up REAL NOT NULL DEFAULT 0, PRIMARY KEY (fight_id, account));
      CREATE TABLE day_snapshots (day TEXT PRIMARY KEY, built_at TEXT NOT NULL, signature TEXT NOT NULL, frozen INTEGER NOT NULL DEFAULT 0);
      INSERT INTO day_snapshots VALUES ('2026-11-01', 'x', 'a', 1), ('2026-11-02', 'x', 'b', 0);
      INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('f1', 'a', 'done', 'x'), ('f2', 'b', 'done', 'x');
      INSERT INTO player_stats (fight_id, account, grp, active_ms, stab_up) VALUES
        ('f1', 'A', 1, 60000, 60000), ('f1', 'B', 1, 30000, 15000), ('f1', 'C', 2, 60000, 12000), ('f1', 'D', NULL, 60000, 60000),
        ('f2', 'A', 1, 10000, 0);
    `);
    db.close();
  }

  it("cada jogador recebe a média do grupo dele na luta, ponderada pelo tempo ativo; sem grupo fica zero", () => {
    const file = path.join(dir, "sem-grupo-up.db");
    bancoSemGrupoUp(file);

    const db = openDb(file);

    const v = (fight: string, account: string) => (db.prepare("SELECT stab_group_up AS v FROM player_stats WHERE fight_id = ? AND account = ?").get(fight, account) as { v: number }).v;
    expect(v("f1", "A")).toBeCloseTo((75_000 / 90_000) * 60_000, 6);
    expect(v("f1", "B")).toBeCloseTo((75_000 / 90_000) * 30_000, 6);
    expect(v("f1", "C")).toBeCloseTo(12_000, 6);
    expect(v("f1", "D")).toBe(0);
    expect(v("f2", "A")).toBe(0);
    db.close();
  });

  it("os dias ainda abertos do resumo diário são refeitos com a métrica nova, e os congelados ficam como estão", () => {
    const file = path.join(dir, "sem-grupo-up-dias.db");
    bancoSemGrupoUp(file);

    const db = openDb(file);

    expect(db.prepare("SELECT day FROM day_snapshots").all()).toEqual([{ day: "2026-11-01" }]);
    db.close();
  });

  it("abrir de novo o banco já preenchido não refaz o preenchimento", () => {
    const file = path.join(dir, "sem-grupo-up-2.db");
    bancoSemGrupoUp(file);
    openDb(file).close();
    const antes = new Database(file);
    antes.prepare("UPDATE player_stats SET stab_group_up = 123 WHERE fight_id = 'f1' AND account = 'C'").run();
    antes.prepare("INSERT INTO day_snapshots VALUES ('2026-11-03', 'x', 'c', 0)").run();
    antes.close();

    const db = openDb(file);

    expect((db.prepare("SELECT stab_group_up AS v FROM player_stats WHERE account = 'C'").get() as { v: number }).v).toBe(123);
    expect(db.prepare("SELECT day FROM day_snapshots WHERE day = '2026-11-03'").all()).toHaveLength(1);
    db.close();
  });
});
