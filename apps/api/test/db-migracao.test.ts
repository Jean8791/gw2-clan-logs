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
