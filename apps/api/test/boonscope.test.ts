import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { statsOfGroup, STAT_KEYS, STAT_META, type StatKey } from "@gw2logs/shared";
import { paths } from "../src/config.js";
import { openDb, STAT_COL } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import { wvwFixture } from "./fixture.js";

const ACCOUNT = "Atacante.2222";
const STAB = 1122;
const vol = (id: number, outgoing: number) => ({ id, buffVolumeData: [{ outgoing }] });

/** Luta de teste: o Atacante gera stab em três alcances (ele mesmo, o grupo e o squad). */
function fightWithVolumes(o: { self?: number; group?: number; squad?: number; skip?: ("self" | "group")[] } = {}) {
  const f: any = wvwFixture();
  const p = f.players.find((x: any) => x.account === ACCOUNT);
  p.squadBuffVolumes = [vol(STAB, o.squad ?? 0.4)];
  if (!o.skip?.includes("group")) p.groupBuffVolumes = [vol(STAB, o.group ?? 2.7)];
  if (!o.skip?.includes("self")) p.selfBuffVolumes = [vol(STAB, o.self ?? 2.9)];
  return f;
}
const mine = (json: any) => extractFight(json).players.find((x) => x.account === ACCOUNT)!;

describe("extractFight: boons gerados para si, para o grupo e para o squad", () => {
  it("cada alcance vai para a sua métrica", () => {
    const p = mine(fightWithVolumes());

    expect(p.stabSelf).toBeCloseTo(2.9, 5);
    expect(p.stabGroup).toBeCloseTo(2.7, 5);
    expect(p.stabOut).toBeCloseTo(0.4, 5);
  });

  it("log sem os volumes de grupo e próprio (EI antigo) fica com zero e não dá erro", () => {
    const p = mine(fightWithVolumes({ skip: ["self", "group"] }));

    expect([p.stabSelf, p.stabGroup, p.stabOut]).toEqual([0, 0, 0.4]);
  });

  it("junta as instâncias da mesma conta: os volumes de cada alcance somam", () => {
    const json = fightWithVolumes();
    const second = JSON.parse(JSON.stringify(json.players.find((x: any) => x.account === ACCOUNT)));
    second.selfBuffVolumes = [vol(STAB, 1)];
    second.groupBuffVolumes = [vol(STAB, 0.5)];
    json.players.push(second);

    const p = mine(json);

    expect(p.stabSelf).toBeCloseTo(3.9, 5);
    expect(p.stabGroup).toBeCloseTo(3.2, 5);
  });
});

describe("métricas por alcance", () => {
  const bases = ["stab", "quick", "alac", "prot", "might", "aegis", "resist", "resol", "fury", "superspeed"];

  it("os 10 boons existem nos três alcances, com o mesmo id de buff", () => {
    for (const b of bases) {
      const squad = STAT_META[`${b}Out` as StatKey];
      expect(STAT_META[`${b}Group` as StatKey]).toMatchObject({ group: "boons", scope: "group", buffId: squad.buffId, format: "volume" });
      expect(STAT_META[`${b}Self` as StatKey]).toMatchObject({ group: "boons", scope: "self", buffId: squad.buffId, format: "volume" });
    }
  });

  it("statsOfGroup('boons') devolve só o alcance pedido (squad por padrão)", () => {
    expect(statsOfGroup("boons")).toEqual(bases.map((b) => `${b}Out`));
    expect(statsOfGroup("boons", "group")).toEqual(bases.map((b) => `${b}Group`));
    expect(statsOfGroup("boons", "self")).toEqual(bases.map((b) => `${b}Self`));
  });

  it("outros grupos não mudam com o alcance", () => {
    expect(statsOfGroup("offense", "self")).toEqual(statsOfGroup("offense"));
  });
});

describe("migração: banco antigo ganha as colunas de alcance", () => {
  it("cria stab_self e stab_group e mantém os dados", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-scope-"));
    const file = paths(dir).db;
    const old = new Database(file);
    old.exec(`
      CREATE TABLE player_stats (fight_id TEXT NOT NULL, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT, grp INTEGER,
        commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL,
        damage REAL NOT NULL DEFAULT 0, stab_out REAL NOT NULL DEFAULT 0, PRIMARY KEY (fight_id, account));
      INSERT INTO player_stats (fight_id, account, stab_out) VALUES ('f1', 'A.1111', 7);
    `);
    old.close();

    const db = openDb(file);
    const row = db.prepare("SELECT stab_out, stab_self, stab_group FROM player_stats").get();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(row).toEqual({ stab_out: 7, stab_self: 0, stab_group: 0 });
    expect(STAT_KEYS.every((k) => STAT_COL[k])).toBe(true);
  });
});
