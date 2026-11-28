import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boonViewKeys, inScope, statsOfGroup, STAT_KEYS, STAT_META, uptimeValue } from "@gw2logs/shared";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

const buffUp = (id: number, pct: number) => ({ id, buffData: [{ uptime: pct, presence: pct }] });
const STAB = 1122;

/**
 * Luta de teste, por posição na lista: Comandante (grupo 1, 60 s ativos), Atacante (grupo 1, 30 s), Outro (grupo 2, 60 s) e Fora (grupo 1,
 * fora do squad). `ups` diz o uptime de cada um, em %, por id de buff.
 */
function luta(ups: { cmd?: number[]; atk?: number[]; outro?: number[]; fora?: number[] }, buffs: number[] = [STAB]) {
  const f: any = wvwFixture();
  const [cmd, atk, outro, fora] = f.players;
  cmd.group = 1;
  atk.group = 1;
  outro.group = 2;
  fora.group = 1;
  atk.activeTimes = [30_000];
  f.buffMap = Object.fromEntries(buffs.map((id) => [`b${id}`, { stacking: true }]));
  for (const [p, list] of [[cmd, ups.cmd], [atk, ups.atk], [outro, ups.outro], [fora, ups.fora]] as const) {
    if (list) p.buffUptimesActive = buffs.map((id, i) => buffUp(id, list[i]!));
  }
  return f;
}
const jogador = (json: any, account: string) => extractFight(json).players.find((p) => p.account === account)!;

describe("extractFight: uptime médio do grupo do jogador", () => {
  it("é a média do grupo ponderada pelo tempo ativo, guardada em ms com o boon sobre o tempo ativo do próprio jogador", () => {
    // grupo 1: Comandante 100% por 60 s e Atacante 50% por 30 s → (60 + 15) ÷ 90 = 83,3%
    const json = luta({ cmd: [100], atk: [50], outro: [20] });

    expect(jogador(json, "Comandante.1111").stabGroupUp).toBeCloseTo((75_000 / 90_000) * 60_000, 6);
    expect(jogador(json, "Atacante.2222").stabGroupUp).toBeCloseTo((75_000 / 90_000) * 30_000, 6);
  });

  it("quem está sozinho no grupo recebe o próprio uptime", () => {
    const p = jogador(luta({ cmd: [100], atk: [50], outro: [20] }), "Outro.3333");

    expect(p.stabGroupUp).toBeCloseTo(0.2 * 60_000, 6);
    expect(p.stabGroupUp).toBeCloseTo(p.stabUp, 6);
  });

  it("o uptime do próprio jogador não muda", () => {
    const json = luta({ cmd: [100], atk: [50], outro: [20] });

    expect(jogador(json, "Comandante.1111").stabUp).toBeCloseTo(60_000, 6);
    expect(jogador(json, "Atacante.2222").stabUp).toBeCloseTo(15_000, 6);
  });

  it("quem está fora do squad não entra na média do grupo, mesmo no mesmo número de grupo", () => {
    const sem = jogador(luta({ cmd: [100], atk: [50] }), "Comandante.1111").stabGroupUp;
    const com = jogador(luta({ cmd: [100], atk: [50], fora: [0] }), "Comandante.1111").stabGroupUp;

    expect(com).toBe(sem);
  });

  it("jogador sem grupo no log fica sem valor (zero), e não entra na conta dos outros", () => {
    const json = luta({ cmd: [100], atk: [50], outro: [20] });
    json.players[2].group = undefined;

    expect(jogador(json, "Outro.3333").stabGroupUp).toBe(0);
    expect(jogador(json, "Comandante.1111").stabGroupUp).toBeCloseTo((75_000 / 90_000) * 60_000, 6);
  });

  it("todos os boons que têm uptime ganham a versão do grupo", () => {
    const grupoUp = STAT_KEYS.filter((k) => k.endsWith("GroupUp"));
    const ids = grupoUp.map((k) => STAT_META[k].buffId!);
    const json = luta({ cmd: ids.map(() => 80), atk: ids.map(() => 40) }, ids);
    json.players[1].activeTimes = [60_000];

    const p = jogador(json, "Comandante.1111");

    expect(grupoUp).toHaveLength(12);
    for (const k of grupoUp) expect(p[k]).toBeCloseTo(0.6 * 60_000, 6); // (80% + 40%) ÷ 2, os dois com 60 s
  });

  it("sem uptime no log, tudo fica em zero, sem erro", () => {
    const p = jogador(wvwFixture(), "Comandante.1111");

    expect(STAT_KEYS.filter((k) => k.endsWith("GroupUp")).every((k) => p[k] === 0)).toBe(true);
  });
});

describe("as métricas de uptime no grupo", () => {
  it("ficam no grupo Uptime, em %, com o ícone do boon, e fora das abas e do alcance dos boons", () => {
    expect(STAT_META.stabGroupUp).toMatchObject({ group: "uptime", format: "pct", scope: "group", buffId: STAB });
    expect(statsOfGroup("uptime")).toContain("stabGroupUp");
    expect(statsOfGroup("boons", "group")).not.toContain("stabGroupUp");
    expect(statsOfGroup("boons", "squad")).not.toContain("stabGroupUp");
    expect(inScope("stabGroupUp", "self")).toBe("stabGroupUp");
  });
});

describe("boonViewKeys: as métricas de um boon lado a lado", () => {
  it("estabilidade: volume para squad, geração útil, volume para grupo e si, uptime recebido e uptime no grupo", () => {
    expect(boonViewKeys("stab")).toEqual(["stabOut", "stabEff", "stabGroup", "stabSelf", "stabUp", "stabGroupUp"]);
  });

  it("supervelocidade só tem volume (e a geração útil), e swiftness, vigor e regeneração só têm uptime", () => {
    expect(boonViewKeys("superspeed")).toEqual(["superspeedOut", "superspeedEff", "superspeedGroup", "superspeedSelf"]);
    expect(boonViewKeys("swift")).toEqual(["swiftUp", "swiftGroupUp"]);
    expect(boonViewKeys("regen")).toEqual(["regenUp", "regenGroupUp"]);
  });
});

describe("uptime no grupo no Ranking", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-gup-"));
    db = openDb(path.join(dir, "t.db"));
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('F1', 'F1', 'queued', ?)").run(new Date().toISOString());
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("o valor mostrado é a % do tempo ativo, como as outras métricas de uptime", () => {
    saveFight(db, "F1", extractFight(luta({ cmd: [100], atk: [50], outro: [20] })), null, false, true);

    const cmd = q.ranking(db, {}).find((r) => r.account === "Comandante.1111")!;

    expect(uptimeValue("stabGroupUp", cmd.stabGroupUp, cmd.activeMs)).toBeCloseTo(83.33, 1);
    expect(uptimeValue("stabUp", cmd.stabUp, cmd.activeMs)).toBeCloseTo(100, 6);
  });
});
