import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adjustedByTime, emptyStats, referenceTimeMs, statRate, statValue, weightedByActive, type Aggregate, type Stats } from "@gw2logs/shared";
import { upsertDiscordUser } from "../src/auth.js";
import { openDb, type DB } from "../src/db.js";
import type { ExtractedFight, ExtractedPlayer } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";

// Boons e uptime no Ranking: média ponderada pelo tempo ativo, ajustada pelo tempo jogado (puxada para a média geral
// quando a pessoa jogou menos que o tempo típico do período). Dano e afins continuam somados.

const MIN = 60_000;
const linha = (o: Partial<Stats> & { activeMs: number }) => ({ ...emptyStats(), ...o });
const ajuste = (baseline: Partial<Stats> & { activeMs: number }, refMs: number) => ({ baseline: { ...linha(baseline), fights: 1 } as Aggregate, refMs });

describe("referenceTimeMs: a referência do ajuste é metade do tempo mediano de jogo no filtro, com mínimo de 5 min", () => {
  it("Dado jogadores com 20, 40 e 60 min, então a referência é metade da mediana (20 min)", () => {
    expect(referenceTimeMs([20 * MIN, 40 * MIN, 60 * MIN])).toBe(20 * MIN);
  });

  it("a mediana não é a média: um jogador de 600 min não puxa a referência", () => {
    expect(referenceTimeMs([20 * MIN, 24 * MIN, 600 * MIN])).toBe(12 * MIN);
  });

  it("Dado pouco tempo de jogo, então a referência nunca fica abaixo de 5 min", () => {
    expect(referenceTimeMs([2 * MIN, 4 * MIN, 6 * MIN])).toBe(5 * MIN);
  });

  it("Dado ninguém no filtro, então 5 min", () => {
    expect(referenceTimeMs([])).toBe(5 * MIN);
  });
});

describe("weightedByActive: média ponderada pelo tempo ativo (a mesma conta do SQL do Ranking)", () => {
  const luta = (activeMs: number, v: number) => ({ activeMs, v });

  it("Dado 0,4 em 60 s e 0,1 em 180 s, então (0,4×60 + 0,1×180) ÷ 240 = 0,175", () => {
    expect(weightedByActive([luta(60_000, 0.4), luta(180_000, 0.1)], (r) => r.v)).toBeCloseTo(0.175, 10);
  });

  it("Dado a mesma conta no banco, então o Ranking e a função dão o mesmo valor (ver a consulta abaixo)", () => {
    expect(weightedByActive([luta(60_000, 0.4), luta(180_000, 0.1)], (r) => r.v)).toBeCloseTo((0.4 * 60 + 0.1 * 180) / 240, 10);
  });

  it("Dado uma luta só, então o valor dela", () => {
    expect(weightedByActive([luta(90_000, 0.3)], (r) => r.v)).toBeCloseTo(0.3, 10);
  });

  it("Dado nenhuma linha ou nenhum tempo ativo, então 0, sem dividir por zero", () => {
    expect(weightedByActive([], (r: { activeMs: number; v: number }) => r.v)).toBe(0);
    expect(weightedByActive([luta(0, 0.4)], (r) => r.v)).toBe(0);
  });
});

describe("adjustedByTime: (tempo × valor dele + referência × média geral) ÷ (tempo + referência)", () => {
  it("quem jogou o mesmo tempo da referência fica no meio entre o valor dele e a média geral", () => {
    expect(adjustedByTime(0.4, 10 * MIN, 0.1, 10 * MIN)).toBeCloseTo(0.25, 10);
  });

  it("quem jogou muito mais que a referência quase mantém o próprio valor", () => {
    expect(adjustedByTime(0.4, 1000 * MIN, 0.1, 10 * MIN)).toBeCloseTo(0.397, 3);
  });

  it("quem jogou pouco fica quase na média geral", () => {
    expect(adjustedByTime(0.9, 1 * MIN, 0.1, 19 * MIN)).toBeCloseTo(0.14, 10);
  });

  it("sem tempo jogado, o valor é a média geral", () => {
    expect(adjustedByTime(0.9, 0, 0.1, 10 * MIN)).toBe(0.1);
  });
});

describe("statValue com ajuste: só boons e uptime", () => {
  it("Dado boon com média ponderada 0,4 em 10 min, média geral 0,1 e referência de 10 min, então o valor é 0,25", () => {
    const r = linha({ activeMs: 10 * MIN, stabOut: 0.4 });

    expect(statValue("stabOut", "total", r, ajuste({ activeMs: 1_000 * MIN, stabOut: 0.1 }, 10 * MIN))).toBeCloseTo(0.25, 10);
  });

  it("o ajuste vale em qualquer modo (boon não tem por minuto)", () => {
    const r = linha({ activeMs: 10 * MIN, stabOut: 0.4 });
    const adj = ajuste({ activeMs: 1_000 * MIN, stabOut: 0.1 }, 10 * MIN);

    expect(statValue("stabOut", "perMin", r, adj)).toBeCloseTo(0.25, 10);
    expect(statValue("stabOut", "perSec", r, adj)).toBeCloseTo(0.25, 10);
  });

  it("Dado uptime de 100% em 5 min, média geral 40% e referência de 5 min, então o valor é 70%", () => {
    const r = linha({ activeMs: 5 * MIN, stabUp: 5 * MIN });
    const adj = ajuste({ activeMs: 1_000_000, stabUp: 400_000 }, 5 * MIN);

    expect(statValue("stabUp", "total", r, adj)).toBeCloseTo(70, 10);
  });

  it("Dado dano, então não há ajuste: o total é a soma e o por minuto divide pelo tempo ativo", () => {
    const r = linha({ activeMs: 2 * MIN, damage: 600_000 });
    const adj = ajuste({ activeMs: 1_000 * MIN, damage: 1 }, 10 * MIN);

    expect(statValue("damage", "total", r, adj)).toBe(600_000);
    expect(statValue("damage", "perMin", r, adj)).toBe(300_000);
  });

  it("Dado nenhum ajuste (uma luta só, como na tela da luta), então o valor é o guardado", () => {
    expect(statValue("stabOut", "total", linha({ activeMs: MIN, stabOut: 0.4 }))).toBe(0.4);
    expect(statValue("stabUp", "total", linha({ activeMs: 100_000, stabUp: 80_000 }))).toBe(80);
  });

  it("o perfil e a comparação mostram a média ponderada sem ajuste (statRate devolve o valor guardado do boon)", () => {
    expect(statRate({ ...linha({ activeMs: 10 * MIN, stabOut: 0.4 }), fights: 4 } as Aggregate, "stabOut")).toBe(0.4);
  });
});

describe("ranking: boon vira média ponderada pelo tempo ativo; o resto continua somado", () => {
  let db: DB;
  let dir: string;
  let dono: number;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-boons-"));
    db = openDb(path.join(dir, "t.db"));
    dono = upsertDiscordUser(db, { id: "1", username: "ana", avatar: null }).id;
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const jogador = (account: string, activeSeg: number, o: Partial<Stats>): ExtractedPlayer => ({
    ...emptyStats(),
    account,
    name: account,
    profession: "Firebrand",
    guildId: null,
    group: null,
    commander: false,
    role: "support",
    activeMs: activeSeg * 1000,
    distToCom: null,
    skills: [],
    ...o,
  });
  const luta = (id: string, players: ExtractedPlayer[]) => {
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, ?, 'queued', ?, ?)").run(id, id, new Date().toISOString(), dono);
    const f: ExtractedFight = {
      mode: "wvw", fightName: "WvW", mapId: null, timeStart: "2026-11-12T20:00:00.000Z", durationMs: 300_000, success: true, recordedBy: null,
      squadCount: players.length, allyCount: 0, enemyCount: 0, squadDamage: 0, squadKills: 0, squadDowns: 0, squadDeaths: 0, enemyDowns: 0, enemyDeaths: 0,
      eiVersion: null, players,
    };
    saveFight(db, id, f, null, false, true);
  };

  it("Dado 0,4 em 60 s e 0,1 em 180 s, então o boon do jogador é (0,4×60 + 0,1×180) ÷ 240 = 0,175 (e não a soma 0,5 nem a média simples 0,25)", () => {
    luta("F1", [jogador("A.1", 60, { stabOut: 0.4, damage: 1000 })]);
    luta("F2", [jogador("A.1", 180, { stabOut: 0.1, damage: 1000 })]);

    const a = q.ranking(db, { owner: dono }).find((r) => r.account === "A.1")!;

    expect(a.stabOut).toBeCloseTo(0.175, 10);
    expect(a.damage).toBe(2000);
    expect(a.activeMs).toBe(240_000);
    expect(a.fights).toBe(2);
  });

  it("a média geral (baseline) é a média ponderada pelo tempo de todas as linhas do filtro", () => {
    luta("F1", [jogador("A.1", 60, { stabOut: 0.4 })]);
    luta("F2", [jogador("A.1", 180, { stabOut: 0.1 })]);
    luta("F3", [jogador("B.2", 120, { stabOut: 0.2 })]);

    const geral = q.baseline(db, { owner: dono });

    expect(geral.stabOut).toBeCloseTo((0.4 * 60 + 0.1 * 180 + 0.2 * 120) / 360, 10);
  });

  it("uptime continua guardado como tempo com o boon, somado (o % sai de uptimeValue)", () => {
    luta("F1", [jogador("A.1", 60, { stabUp: 30_000 })]);
    luta("F2", [jogador("A.1", 180, { stabUp: 90_000 })]);

    expect(q.ranking(db, { owner: dono }).find((r) => r.account === "A.1")!.stabUp).toBe(120_000);
  });

  it("jogador sem tempo ativo registrado não quebra a média (valor 0)", () => {
    luta("F1", [jogador("Z.9", 0, { stabOut: 0.4 })]);

    expect(q.ranking(db, { owner: dono }).find((r) => r.account === "Z.9")!.stabOut).toBe(0);
  });
});
