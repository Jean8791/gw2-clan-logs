import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boonEfficiency, cardOptions, emptyStats, inScope, STAT_KEYS, STAT_META, statsOfGroup } from "@gw2logs/shared";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

// Geração útil: o volume de boon gerado menos o que passou do limite de pilhas (o EI chama de wasted). No JSON do EI, o volume
// (`outgoing`) é a geração útil (`generation`) mais o desperdício (`wasted`); conferido em um log real de 33 jogadores.

const buffs = (id: number, generation: number, wasted: number) => ({ id, buffData: [{ generation, overstack: generation, wasted }] });

/** Comandante gerou 3 de estabilidade no total, dos quais 2,4 foram úteis e 0,6 desperdício. */
function lutaComGeracao() {
  const f: any = wvwFixture();
  f.players[0].squadBuffs = [buffs(1122, 2.4, 0.6), buffs(1187, 0, 0)];
  return f;
}
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;

describe("extractFight: geração útil de boon", () => {
  it("a geração útil sai de squadBuffs (generation) e o volume gerado continua o de squadBuffVolumes", () => {
    const p = comandante(lutaComGeracao());

    expect(p.stabOut).toBe(3);
    expect(p.stabEff).toBe(2.4);
  });

  it("sem squadBuffs no log, a geração útil fica em zero e o volume não muda", () => {
    const p = comandante(wvwFixture());

    expect(p.stabOut).toBe(3);
    expect(p.stabEff).toBe(0);
  });
});

describe("métricas <boon>Eff: ficam na aba Boons, no alcance \"útil\"", () => {
  it("existe uma por boon que tem volume, com o mesmo buff e o nome 'útil'", () => {
    expect(STAT_KEYS).toContain("stabEff");
    expect(STAT_META.stabEff).toMatchObject({ group: "boons", format: "volume", higherIsBetter: true, buffId: STAT_META.stabOut.buffId });
    expect(STAT_META.stabEff.label).toBe("Estabilidade útil");
    expect(STAT_META.stabEff.scope).toBe("useful");
  });

  it("só aparecem no alcance útil: cada alcance continua com os mesmos 10 boons", () => {
    expect(statsOfGroup("boons", "useful")).toHaveLength(10);
    expect(statsOfGroup("boons", "useful")).toContain("stabEff");
    for (const s of ["squad", "group", "self"] as const) expect(statsOfGroup("boons", s)).not.toContain("stabEff");
  });

  it("trocar de alcance leva de um para o outro, e o volume de squad continua com o seu buff", () => {
    expect(inScope("stabOut", "useful")).toBe("stabEff");
    expect(inScope("stabEff", "group")).toBe("stabGroup");
    expect(inScope("stabEff", "squad")).toBe("stabOut");
    expect(comandante(lutaComGeracao()).stabOut).toBe(3);
  });

  it("o card de Boons oferece o volume da squad e a geração útil, sem grupo e próprio", () => {
    const opcoes = cardOptions("boons");
    expect(opcoes).toContain("stabOut");
    expect(opcoes).toContain("stabEff");
    expect(opcoes).not.toContain("stabGroup");
    expect(opcoes).not.toContain("stabSelf");
  });
});

describe("boonEfficiency: a parte do volume gerado que foi útil", () => {
  it("é a geração útil dividida pelo volume (de 0 a 1)", () => {
    expect(boonEfficiency({ ...emptyStats(), stabOut: 3, stabEff: 2.4 }, "stab")).toBeCloseTo(0.8, 9);
  });

  it("sem volume gerado não há eficiência (zero, sem dividir por zero)", () => {
    expect(boonEfficiency(emptyStats(), "stab")).toBe(0);
  });

  it("nunca passa de 1, mesmo quando o arredondamento do log faz a útil passar do volume", () => {
    expect(boonEfficiency({ ...emptyStats(), quickOut: 1, quickEff: 1.01 }, "quick")).toBe(1);
  });
});

describe("saveFight e Ranking: a geração útil é guardada e agregada como o volume", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-util-"));
    db = openDb(path.join(dir, "t.db"));
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('F1', 'F1', 'queued', ?)").run(new Date().toISOString());
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("grava a coluna stab_eff e o Ranking devolve stabEff ao lado de stabOut", () => {
    saveFight(db, "F1", extractFight(lutaComGeracao()), null, false, true);
    db.prepare("UPDATE fights SET time_start = '2026-11-03T20:00:00.000Z', mode = 'wvw', map_id = 1, duration_ms = 60000 WHERE id = 'F1'").run();

    expect(db.prepare("SELECT stab_out, stab_eff FROM player_stats WHERE account = 'Comandante.1111'").get()).toEqual({ stab_out: 3, stab_eff: 2.4 });
    const row = q.ranking(db, {}).find((r) => r.account === "Comandante.1111")!;
    expect(row.stabOut).toBeCloseTo(3, 9);
    expect(row.stabEff).toBeCloseTo(2.4, 9);
  });

  it("banco antigo, sem a coluna, ganha a coluna ao abrir", () => {
    db.close();
    const file = path.join(dir, "antigo.db");
    const velho = new Database(file);
    velho.exec(`
      CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);
      CREATE TABLE player_stats (
        fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT,
        grp INTEGER, commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
        PRIMARY KEY (fight_id, account));`);
    velho.close();

    db = openDb(file);

    const cols = (db.pragma("table_info(player_stats)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("stab_eff");
    expect(cols).toContain("quick_eff");
  });
});
