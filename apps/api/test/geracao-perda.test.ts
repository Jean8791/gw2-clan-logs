import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOON_FORMULA_VERSION, BOON_SCOPES, boonAccountedUtilization, boonMetrics, boonViewKeys, boonVolumeUtilization, boonWasteRate, DICT, emptyStats, STAT_EN, STAT_KEYS, STAT_META, statsOfGroup,
  type Stats,
} from "@gw2logs/shared";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

// Etapa 3 da auditoria dos boons: guarda a perda registrada (`wasted`) e a rejeição explícita (`overstack − generation`) de cada boon, para
// calcular o aproveitamento contabilizado (ABU = generation ÷ (overstack + wasted)), a taxa de perda e o resíduo, sem mexer nos campos do EI.

const buffs = (id: number, generation: number, wasted: number, overstack = generation) => ({ id, buffData: [{ generation, overstack, wasted }] });
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;
const luta = (g: number, w: number, s = g) => {
  const f: any = wvwFixture();
  f.players[0].squadBuffs = [buffs(1122, g, w, s)];
  return f;
};

describe("métricas <boon>Waste e <boon>Rej", () => {
  it("existem por boon, no alcance 'loss', fora dos alcances que a tela alterna", () => {
    expect(STAT_KEYS).toContain("stabWaste");
    expect(STAT_KEYS).toContain("superspeedRej");
    expect(STAT_META.stabWaste).toMatchObject({ group: "boons", scope: "loss", format: "volume", buffId: STAT_META.stabOut.buffId });
    expect(statsOfGroup("boons", "loss")).toHaveLength(20);
    for (const s of BOON_SCOPES) expect(statsOfGroup("boons", s)).toHaveLength(10);
    expect(BOON_SCOPES).not.toContain("loss");
  });

  it("os nomes dizem perda registrada e rejeição explícita (nunca excesso ou erro do jogador), em pt e en", () => {
    expect(STAT_META.stabWaste.label).toBe("Estabilidade (perda registrada)");
    expect(STAT_META.stabRej.label).toBe("Estabilidade (rejeição explícita)");
    expect(STAT_EN.stabWaste.label).toBe("Stability (recorded waste)");
    expect(STAT_META.stabWaste.hint).toMatch(/Não é excesso de aplicação nem erro do jogador/);
    expect(STAT_EN.stabWaste.hint).toMatch(/not over-application or player error/);
    expect([STAT_META.stabWaste.hint, STAT_EN.stabWaste.hint].join(" ")).not.toMatch(/inútil|useless/i);
    expect(STAT_META.stabRej.hint).toMatch(/zero não prova/);
  });

  it("o Ranking lista o boon lado a lado com a efetiva, a perda registrada e a rejeição", () => {
    expect(boonViewKeys("stab")).toEqual(["stabOut", "stabEff", "stabWaste", "stabRej", "stabGroup", "stabSelf", "stabUp", "stabGroupUp"]);
  });

  it("os textos da tela existem nos dois idiomas", () => {
    for (const k of ["boon.accounted", "boon.accountedHint", "boon.volumeUtilization", "boon.volumeUtilizationHint", "boon.wasteRate", "boon.wasteRateHint"]) {
      expect(DICT.pt[k], k).toBeTruthy();
      expect(DICT.en[k], k).toBeTruthy();
    }
  });
});

describe("extractFight: perda registrada e rejeição explícita", () => {
  it("wasted vira a perda registrada e overstack − generation, a rejeição; a luta com o dado cobre o tempo ativo", () => {
    const p = comandante(luta(2.4, 0.6, 2.9));

    expect(p.stabEff).toBe(2.4);
    expect(p.stabWaste).toBe(0.6);
    expect(p.stabRej).toBeCloseTo(0.5, 9);
    expect(p.genCoverMs).toBe(p.activeMs);
  });

  it("com overstack igual à geração (o caso de todos os 1.644 pares medidos) a rejeição é zero", () => {
    expect(comandante(luta(0.097, 0.009)).stabRej).toBe(0);
  });

  it("overstack menor que a geração é inconsistência: o jogador fica sem cobertura (N/D) em vez de mascarar ou somar negativo", () => {
    const p = comandante(luta(6, 2, 5));

    expect(p.stabRej).toBe(0);
    expect(p.genCoverMs).toBe(0);
  });

  it("diferença de arredondamento (até 0,002) entre overstack e generation não é inconsistência", () => {
    const p = comandante(luta(0.097, 0.009, 0.0965));

    expect(p.genCoverMs).toBe(p.activeMs);
    expect(p.stabRej).toBe(0);
  });

  it("a mesma conta em duas instâncias soma a perda e a rejeição", () => {
    const f = luta(2, 1, 2.5);
    const segunda = JSON.parse(JSON.stringify(f.players[0]));
    segunda.hasCommanderTag = false;
    f.players.push(segunda);

    const p = comandante(f);

    expect(p.stabWaste).toBe(2);
    expect(p.stabRej).toBeCloseTo(1, 9);
  });
});

describe("boonMetrics: os cenários da auditoria (g = geração, o = volume, s = overstack, w = perda)", () => {
  const m = (g: number, o: number, s: number, w: number) => boonMetrics({ generation: g, outgoing: o, rejected: s - g, wasted: w });
  const pct = (x: number | null) => (x === null ? null : Number((x * 100).toFixed(2)));

  it("Stability fornecida (0,097; 0,106; 0,097; 0,009): BVU e ABU ≈ 91,51%, perda ≈ 8,49%, rejeição 0, resíduo ≈ 0", () => {
    const r = m(0.097, 0.106, 0.097, 0.009);

    expect(pct(r.volumeUtilization)).toBe(91.51);
    expect(pct(r.accountedUtilization)).toBe(91.51);
    expect(pct(r.wasteRate)).toBe(8.49);
    expect(r.rejectionRate).toBe(0);
    expect(r.residual).toBeCloseTo(0, 9);
  });

  it("rejeições explícitas (6; 10; 8; 2): BVU e ABU 60%, perda 20%, rejeição 20%, resíduo 0", () => {
    const r = m(6, 10, 8, 2);

    expect([pct(r.volumeUtilization), pct(r.accountedUtilization), pct(r.wasteRate), pct(r.rejectionRate), r.residual]).toEqual([60, 60, 20, 20, 0]);
  });

  it("volume maior que o contabilizado (6; 12; 8; 2): BVU 50%, ABU 60%, resíduo 2 (não vira perda)", () => {
    const r = m(6, 12, 8, 2);

    expect([pct(r.volumeUtilization), pct(r.accountedUtilization), r.residual]).toEqual([50, 60, 2]);
  });

  it("geração maior que o volume (6; 4; 6; 0): BVU 150% sinalizado, ABU 100%, resíduo −2", () => {
    const r = m(6, 4, 6, 0);

    expect([pct(r.volumeUtilization), pct(r.accountedUtilization), r.residual, r.exceeds]).toEqual([150, 100, -2, true]);
  });

  it("tudo zero: razões N/D, não 0% nem 100%", () => {
    const r = m(0, 0, 0, 0);

    expect([r.volumeUtilization, r.accountedUtilization, r.wasteRate, r.rejectionRate]).toEqual([null, null, null, null]);
    expect(r.residual).toBe(0);
  });

  it("ABU + taxa de perda + taxa de rejeição ≈ 100% quando há contabilizado", () => {
    const r = m(6, 10, 8, 2);

    expect(r.accountedUtilization! + r.wasteRate! + r.rejectionRate!).toBeCloseTo(1, 12);
  });
});

describe("aproveitamento por linha (cobertura, N/D e valores ajustados)", () => {
  const linha = (o: Partial<Stats> & { activeMs: number; genCoverMs: number }) => ({ ...emptyStats(), ...o });
  const cheia = linha({ stabOut: 0.106, stabEff: 0.097, stabWaste: 0.009, stabRej: 0, activeMs: 60_000, genCoverMs: 60_000 });

  it("com cobertura total, ABU, BVU e taxa de perda saem da linha", () => {
    expect(boonAccountedUtilization(cheia, "stab").value).toBeCloseTo(0.9151, 4);
    expect(boonVolumeUtilization(cheia, "stab").value).toBeCloseTo(0.9151, 4);
    expect(boonWasteRate(cheia, "stab").value).toBeCloseTo(0.0849, 4);
  });

  it("sem cobertura ou com período misto, os três são N/D com o motivo", () => {
    const sem = { ...cheia, genCoverMs: 0 };
    const misto = { ...cheia, activeMs: 120_000 };

    for (const f of [boonAccountedUtilization, boonVolumeUtilization, boonWasteRate]) {
      expect(f(sem, "stab")).toMatchObject({ value: null, reason: "noData" });
      expect(f(misto, "stab")).toMatchObject({ value: null, reason: "partial" });
    }
  });

  it("sem nada contabilizado a ABU é N/D por falta de volume, e com volume mas tudo perdido é 0% de verdade", () => {
    expect(boonAccountedUtilization({ ...cheia, stabOut: 0, stabEff: 0, stabWaste: 0 }, "stab")).toMatchObject({ value: null, reason: "noVolume" });
    expect(boonAccountedUtilization({ ...cheia, stabEff: 0, stabWaste: 0.1 }, "stab").value).toBe(0);
  });
});

describe("saveFight, Ranking e versão da fórmula", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-perda-"));
    db = openDb(path.join(dir, "t.db"));
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('F1', 'F1', 'queued', ?)").run(new Date().toISOString());
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("grava stab_waste e stab_rej e o Ranking devolve a média só das lutas com o dado, ao lado da efetiva", () => {
    saveFight(db, "F1", extractFight(luta(2.4, 0.6, 2.9)), null, false, true);
    db.prepare("UPDATE fights SET time_start = '2026-11-03T20:00:00.000Z', mode = 'wvw', map_id = 1, duration_ms = 60000 WHERE id = 'F1'").run();

    const r = q.ranking(db, {}).find((x) => x.account === "Comandante.1111")!;

    expect(db.prepare("SELECT stab_waste, stab_rej FROM player_stats WHERE account = 'Comandante.1111'").get()).toEqual({ stab_waste: 0.6, stab_rej: expect.closeTo(0.5, 9) });
    expect(r.stabWaste).toBeCloseTo(0.6, 9);
    expect(r.stabRej).toBeCloseTo(0.5, 9);
    expect(boonAccountedUtilization(r, "stab").value).toBeCloseTo(2.4 / 3.5, 9);
  });

  it("a luta guarda a versão da fórmula dos boons com que foi lida", () => {
    saveFight(db, "F1", extractFight(luta(2.4, 0.6)), null, false, true);

    expect(db.prepare("SELECT boon_formula AS v FROM fights WHERE id = 'F1'").get()).toEqual({ v: BOON_FORMULA_VERSION });
    expect(BOON_FORMULA_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("banco da Etapa 2, com cobertura mas sem as colunas de perda, ganha as colunas e perde a cobertura (não há dado de perda)", () => {
    db.close();
    const file = path.join(dir, "etapa2.db");
    const velho = new Database(file);
    velho.exec(`
      CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);
      CREATE TABLE player_stats (
        fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT,
        grp INTEGER, commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
        gen_cover_ms REAL NOT NULL DEFAULT 0, stab_out REAL NOT NULL DEFAULT 0, stab_eff REAL NOT NULL DEFAULT 0, PRIMARY KEY (fight_id, account));
      INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('f1', 'a', 'done', 'x');
      INSERT INTO player_stats (fight_id, account, active_ms, gen_cover_ms, stab_out, stab_eff) VALUES ('f1', 'Ana', 60000, 60000, 1, 0.8);
    `);
    velho.close();

    db = openDb(file);

    expect((db.pragma("table_info(player_stats)") as { name: string }[]).map((c) => c.name)).toEqual(expect.arrayContaining(["stab_waste", "stab_rej"]));
    expect(db.prepare("SELECT gen_cover_ms AS c, stab_eff AS e FROM player_stats").get()).toEqual({ c: 0, e: 0.8 });
    expect((db.pragma("table_info(fights)") as { name: string }[]).map((c) => c.name)).toContain("boon_formula");
  });
});
