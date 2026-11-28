import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardOptions, DICT, emptyStats, inScope, STAT_EN, STAT_KEYS, STAT_META, statsOfGroup } from "@gw2logs/shared";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

// Geração efetiva: o campo `generation` do Elite Insights. O volume (`outgoing`) é outra conta do EI e inclui também a perda registrada
// (`wasted`): em 20 logs reais ele fica perto de `overstack + wasted` na mediana, mas não é uma identidade (docs/research/etapa-0).

const buffs = (id: number, generation: number, wasted: number) => ({ id, buffData: [{ generation, overstack: generation, wasted }] });

/** Comandante gerou 3 de estabilidade no total, dos quais 2,4 foram úteis e 0,6 desperdício. */
function lutaComGeracao() {
  const f: any = wvwFixture();
  f.players[0].squadBuffs = [buffs(1122, 2.4, 0.6), buffs(1187, 0, 0)];
  return f;
}
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;

describe("extractFight: geração efetiva de boon", () => {
  it("a geração efetiva sai de squadBuffs (generation) e o volume gerado continua o de squadBuffVolumes", () => {
    const p = comandante(lutaComGeracao());

    expect(p.stabOut).toBe(3);
    expect(p.stabEff).toBe(2.4);
  });

  it("sem squadBuffs no log, a geração efetiva fica em zero e o volume não muda", () => {
    const p = comandante(wvwFixture());

    expect(p.stabOut).toBe(3);
    expect(p.stabEff).toBe(0);
  });
});

describe("métricas <boon>Eff: ficam na aba Boons, no alcance \"effective\"", () => {
  it("existe uma por boon que tem volume, com o mesmo buff e o nome 'geração efetiva'", () => {
    expect(STAT_KEYS).toContain("stabEff");
    expect(STAT_META.stabEff).toMatchObject({ group: "boons", format: "volume", higherIsBetter: true, buffId: STAT_META.stabOut.buffId });
    expect(STAT_META.stabEff.label).toBe("Estabilidade (geração efetiva)");
    expect(STAT_META.stabEff.scope).toBe("effective");
  });

  it("só aparecem no alcance efetivo: cada alcance continua com os mesmos 10 boons", () => {
    expect(statsOfGroup("boons", "effective")).toHaveLength(10);
    expect(statsOfGroup("boons", "effective")).toContain("stabEff");
    for (const s of ["squad", "group", "self"] as const) expect(statsOfGroup("boons", s)).not.toContain("stabEff");
  });

  it("trocar de alcance leva de um para o outro, e o volume de squad continua com o seu buff", () => {
    expect(inScope("stabOut", "effective")).toBe("stabEff");
    expect(inScope("stabEff", "group")).toBe("stabGroup");
    expect(inScope("stabEff", "squad")).toBe("stabOut");
    expect(comandante(lutaComGeracao()).stabOut).toBe(3);
  });

  it("o card de Boons oferece o volume da squad e a geração efetiva, sem grupo e próprio", () => {
    const opcoes = cardOptions("boons");
    expect(opcoes).toContain("stabOut");
    expect(opcoes).toContain("stabEff");
    expect(opcoes).not.toContain("stabGroup");
    expect(opcoes).not.toContain("stabSelf");
  });
});

describe("saveFight e Ranking: a geração efetiva é guardada e agregada como o volume", () => {
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

describe("nomes e dicas: a perda registrada não é descrita como excesso nem como erro do jogador (Etapa 1 da auditoria)", () => {
  it("a geração efetiva e o aproveitamento não falam em overstack, limite de pilhas ou 'jogar tudo de uma vez'", () => {
    const textos = [STAT_META.stabEff.hint, STAT_META.stabEff.label, DICT.pt["boon.utilizationHint"], DICT.en["boon.utilizationHint"], STAT_EN.stabEff.hint]
      .filter((t): t is string => !!t)
      .join(" ");

    expect(textos).not.toMatch(/overstack|limite de pilhas|stack limit|joga.*de uma vez|útil|useful/i);
    expect(STAT_META.stabEff.hint).toMatch(/perda registrada/);
  });

  it("o boon de pilhas (Stability e Might) avisa a unidade em pilhas médias e os de duração, em % do tempo", () => {
    expect(STAT_META.stabOut.stacks).toBe(true);
    expect(STAT_META.mightEff.stacks).toBe(true);
    expect(STAT_META.quickOut.stacks).toBeUndefined();
    expect(STAT_META.stabOut.hint).toMatch(/pilhas médias/);
    expect(STAT_META.quickOut.hint).toMatch(/% do tempo/);
  });
});
