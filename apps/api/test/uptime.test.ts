import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAT_KEYS, STAT_META, uptimeValue } from "@gw2logs/shared";
import { paths } from "../src/config.js";
import { openDb, STAT_COL, type DB } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { extractFight } from "../src/ingest.js";
import { MediaStore } from "../src/media.js";
import * as q from "../src/queries.js";
import { ingestJson } from "../src/worker.js";
import { wvwFixture } from "./fixture.js";

const ACCOUNT = "Atacante.2222";
const STAB = 1122;
const MIGHT = 740;
const QUICK = 1187;
const offline = (async () => {
  throw new Error("sem rede");
}) as unknown as typeof fetch;

const up = (id: number, uptime: number, presence: number) => ({ id, buffData: [{ uptime, presence }] });

/** Luta de teste: o Atacante tem 60 s ativos e uptimes conhecidos (stab e might são boons em pilha). */
function fightWithUptimes(o: { activeMs?: number; stab?: [number, number]; start?: string; extra?: (p: any) => void } = {}) {
  const f: any = wvwFixture();
  if (o.start) f.timeStartStd = o.start;
  f.buffMap = {
    b1122: { name: "Stability", classification: "Boon", stacking: true },
    b740: { name: "Might", classification: "Boon", stacking: true },
    b1187: { name: "Quickness", classification: "Boon", stacking: false },
  };
  const p = f.players.find((x: any) => x.account === ACCOUNT);
  p.activeTimes = [o.activeMs ?? 60000];
  const [stabUptime, stabPresence] = o.stab ?? [0.7, 14.1];
  p.buffUptimesActive = [up(STAB, stabUptime, stabPresence), up(MIGHT, 5.6, 31.7), up(QUICK, 7.6, 0)];
  o.extra?.(p);
  return f;
}

const mine = (json: any) => extractFight(json).players.find((x) => x.account === ACCOUNT)!;

describe("extractFight: uptime dos boons (em milissegundos com o boon)", () => {
  it("boon em pilha (stab) usa o presence: % do tempo com pelo menos uma pilha", () => {
    expect(mine(fightWithUptimes()).stabUp).toBeCloseTo(0.141 * 60000, 3);
  });

  it("boon sem pilha (quickness) usa o uptime", () => {
    expect(mine(fightWithUptimes()).quickUp).toBeCloseTo(0.076 * 60000, 3);
  });

  it("might: presence vira o %, e o uptime vira a média de pilhas", () => {
    const p = mine(fightWithUptimes());

    expect(p.mightUp).toBeCloseTo(0.317 * 60000, 3);
    expect(uptimeValue("mightUp", p.mightUp, p.activeMs)).toBeCloseTo(31.7, 5);
    expect(uptimeValue("mightStacks", p.mightStacks, p.activeMs)).toBeCloseTo(5.6, 5);
  });

  it("sem a versão Active, usa buffUptimes", () => {
    const json = fightWithUptimes({ extra: (p) => ((p.buffUptimes = p.buffUptimesActive), delete p.buffUptimesActive) });

    expect(mine(json).quickUp).toBeCloseTo(0.076 * 60000, 3);
  });

  it("sem buffMap (EI antigo), trata como pilha quando há presence", () => {
    const json = fightWithUptimes();
    delete json.buffMap;

    expect(mine(json).stabUp).toBeCloseTo(0.141 * 60000, 3);
    expect(mine(json).quickUp).toBeCloseTo(0.076 * 60000, 3); // presence 0 → usa o uptime
  });

  it("jogador sem dados de uptime fica com zero", () => {
    expect(extractFight(fightWithUptimes()).players.find((x) => x.account === "Comandante.1111")!.stabUp).toBe(0);
  });

  it("junta as instâncias da mesma conta: tempo com o boon e tempo ativo somam", () => {
    const json = fightWithUptimes({ stab: [0.1, 10] }); // 60 s ativos, 10% de stab = 6.000 ms
    const first = json.players.find((x: any) => x.account === ACCOUNT);
    const second = JSON.parse(JSON.stringify(first));
    second.activeTimes = [30000];
    second.buffUptimesActive = [up(STAB, 0.5, 50), up(MIGHT, 1, 10), up(QUICK, 1, 0)]; // 50% de 30 s = 15.000 ms
    json.players.push(second);

    const p = mine(json);

    expect(p.stabUp).toBeCloseTo(6000 + 15000, 3);
    expect(uptimeValue("stabUp", p.stabUp, p.activeMs)).toBeCloseTo((21000 / 90000) * 100, 5);
  });
});

describe("uptimeValue", () => {
  it("pct: % do tempo ativo; avg: média de pilhas", () => {
    expect(uptimeValue("stabUp", 24000, 60000)).toBe(40);
    expect(uptimeValue("mightStacks", 24000, 60000)).toBeCloseTo(0.4, 5);
  });

  it("sem tempo ativo, zero (sem dividir por zero)", () => {
    expect(uptimeValue("stabUp", 100, 0)).toBe(0);
  });

  it("os uptimes são métricas de pct/avg e têm o id do buff", () => {
    expect(STAT_META.stabUp).toMatchObject({ group: "uptime", format: "pct", buffId: STAB });
    expect(STAT_META.mightStacks).toMatchObject({ group: "uptime", format: "avg", buffId: MIGHT });
  });
});

describe("agregação: média ponderada pelo tempo ativo", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-up-"));
    db = openDb(paths(dir).db);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ingest = (id: string, json: any) => {
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, 'parsing', ?)").run(id, "sha-" + id, new Date().toISOString());
    return ingestJson(db, new Gw2Api(db, false), new MediaStore(db, offline), id, json, false);
  };

  it("10 min a 80% e 20 min a 20% dão 40%, e não 50%", async () => {
    await ingest("l1", fightWithUptimes({ activeMs: 600_000, stab: [1, 80] }));
    await ingest("l2", fightWithUptimes({ activeMs: 1_200_000, stab: [1, 20], start: "2026-11-12 23:40:00 -03:00" }));

    const row = q.ranking(db, {}).find((r) => r.account === ACCOUNT)!;

    expect(row.activeMs).toBe(1_800_000);
    expect(uptimeValue("stabUp", row.stabUp, row.activeMs)).toBeCloseTo(40, 5);
  });

  it("a média do squad (baseline) também é ponderada pelo tempo ativo de todos", async () => {
    await ingest("l1", fightWithUptimes({ activeMs: 60_000, stab: [1, 50] })); // Atacante: 30 s com stab em 60 s

    const base = q.baseline(db, {});

    // só o Atacante tem uptime; os outros dois do squad têm 60 s ativos cada e 0 de stab
    expect(base.activeMs).toBe(180_000);
    expect(uptimeValue("stabUp", base.stabUp, base.activeMs)).toBeCloseTo((30_000 / 180_000) * 100, 5);
  });
});

describe("migração: banco antigo ganha as colunas novas", () => {
  it("adiciona as colunas de métricas que faltam e mantém os dados", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-mig-"));
    const file = paths(dir).db;
    const old = new Database(file);
    // esquema de antes: sem nenhuma coluna de uptime
    old.exec(`
      CREATE TABLE player_stats (fight_id TEXT NOT NULL, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT, grp INTEGER,
        commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
        damage REAL NOT NULL DEFAULT 0, PRIMARY KEY (fight_id, account));
      INSERT INTO player_stats (fight_id, account, damage) VALUES ('f1', 'A.1111', 123);
    `);
    old.close();

    const db = openDb(file);
    const cols = new Set((db.pragma("table_info(player_stats)") as { name: string }[]).map((c) => c.name));
    const row = db.prepare("SELECT damage, stab_up FROM player_stats WHERE account = 'A.1111'").get() as { damage: number; stab_up: number };
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(STAT_KEYS.every((k) => cols.has(STAT_COL[k]))).toBe(true);
    expect(row).toEqual({ damage: 123, stab_up: 0 });
  });

  it("abrir de novo um banco já atualizado não dá erro", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-mig-"));
    openDb(paths(dir).db).close();

    expect(() => openDb(paths(dir).db).close()).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
