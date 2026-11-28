import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boonVolumeUtilization, emptyStats, hasStatData, statValue, type Stats } from "@gw2logs/shared";
import { snapshotDays } from "../src/archive.js";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

// Etapa 2 da auditoria dos boons: a geração efetiva só vale onde o log a trouxe (cobertura), o aproveitamento mostra N/D em vez de 0 ou
// 100% inventados, não é limitado a 100% e usa os mesmos valores (ajustados) das colunas vizinhas.

const buffs = (id: number, generation: number, wasted: number) => ({ id, buffData: [{ generation, overstack: generation, wasted }] });
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;
const comGeracao = () => {
  const f: any = wvwFixture();
  f.players[0].squadBuffs = [buffs(1122, 2.4, 0.6)];
  return f;
};

describe("extractFight: a cobertura da geração efetiva (genCoverMs)", () => {
  it("com squadBuffs e squadBuffVolumes no log, cobre o tempo ativo todo", () => {
    const p = comandante(comGeracao());

    expect(p.stabEff).toBe(2.4);
    expect(p.genCoverMs).toBe(p.activeMs);
    expect(p.genCoverMs).toBeGreaterThan(0);
  });

  it("quem não gerou nenhum boon (listas vazias) num log que tem a geração tem cobertura cheia: o zero é verdadeiro", () => {
    const f: any = comGeracao();
    f.players[1].squadBuffs = [];
    f.players[1].squadBuffVolumes = [];

    const outro = extractFight(f).players.find((p) => p.account === "Atacante.2222")!;

    expect(outro.stabEff).toBe(0);
    expect(outro.genCoverMs).toBe(outro.activeMs);
  });

  it("sem squadBuffs em ninguém, não cobre nada (a geração efetiva é dado ausente, não zero)", () => {
    const p = comandante(wvwFixture());

    expect(p.stabOut).toBe(3);
    expect(p.genCoverMs).toBe(0);
  });

  it("log de EI antigo, sem squadBuffVolumes: o volume vem de generation, então não há par válido e a cobertura é zero", () => {
    const f: any = comGeracao();
    for (const j of f.players) delete j.squadBuffVolumes;

    const p = comandante(f);

    expect(p.stabOut).toBe(2.4); // o volume ainda cai no fallback, como antes
    expect(p.stabEff).toBe(0);
    expect(p.genCoverMs).toBe(0);
  });

  it("a mesma conta em duas instâncias soma a cobertura de cada uma (a luta tem a geração)", () => {
    const f: any = comGeracao();
    const segunda = JSON.parse(JSON.stringify(f.players[0]));
    segunda.hasCommanderTag = false;
    f.players.push(segunda);

    const p = comandante(f);

    expect(p.genCoverMs).toBe(120_000);
    expect(p.activeMs).toBe(120_000);
  });
});

describe("Ranking e arquivo: a geração efetiva é a média só das lutas que a têm", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-cob-"));
    db = openDb(path.join(dir, "t.db"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const luta = (id: string, json: any, inicio: string) => {
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, 'queued', ?)").run(id, id, new Date().toISOString());
    saveFight(db, id, extractFight(json), null, false, true);
    db.prepare("UPDATE fights SET time_start = ?, mode = 'wvw', map_id = ?, duration_ms = 60000 WHERE id = ?").run(inicio, id === "A" ? 1 : 2, id);
  };
  const ranking = () => q.ranking(db, {}).find((r) => r.account === "Comandante.1111")!;

  it("uma luta com o dado e uma sem (antiga): a efetiva não é puxada para baixo pela antiga, e a cobertura mostra a diferença", () => {
    luta("A", comGeracao(), "2026-11-03T20:00:00.000Z");
    luta("B", wvwFixture(), "2026-11-04T20:00:00.000Z");

    const r = ranking();

    expect(r.stabOut).toBeCloseTo(3, 9); // o volume é de todas as lutas
    expect(r.stabEff).toBeCloseTo(2.4, 9); // a efetiva, só da luta que a tem (não 1,2)
    expect(r.genCoverMs).toBe(60_000);
    expect(r.activeMs).toBe(120_000);
  });

  it("sem nenhuma luta com o dado, a linha não tem dado (hasStatData falso), e com uma luta com o dado, tem", () => {
    luta("B", wvwFixture(), "2026-11-04T20:00:00.000Z");
    expect(hasStatData("stabEff", ranking())).toBe(false);

    luta("A", comGeracao(), "2026-11-03T20:00:00.000Z");
    expect(hasStatData("stabEff", ranking())).toBe(true);
    expect(hasStatData("stabOut", ranking())).toBe(true);
  });

  it("o resumo diário traz a mesma média e a mesma cobertura do Ranking dos mesmos dias", () => {
    luta("A", comGeracao(), "2026-11-03T20:00:00.000Z");
    luta("B", wvwFixture(), "2026-11-04T20:00:00.000Z");
    snapshotDays(db, new Date("2026-12-10T12:00:00Z"));

    const arq = q.archiveRanking(db, "2026-11", {}).rows.find((r) => r.account === "Comandante.1111")!;
    const rank = ranking();

    expect(arq.stabEff).toBeCloseTo(rank.stabEff, 9);
    expect(arq.genCoverMs).toBe(rank.genCoverMs);
  });

  it("a linha de uma luta só (perfil, página da luta) traz o dado ou não, conforme a cobertura", () => {
    luta("B", wvwFixture(), "2026-11-04T20:00:00.000Z");
    const linha = q.fightDetail(db, "B")!.players.find((p) => p.account === "Comandante.1111")!;

    expect(hasStatData("stabEff", linha)).toBe(false);
  });
});

describe("boonVolumeUtilization: aproveitamento do volume, com N/D e sem limitar a 100%", () => {
  const linha = (o: Partial<Stats> & { activeMs: number; genCoverMs: number }) => ({ ...emptyStats(), ...o });

  it("com cobertura total é a geração efetiva sobre o volume", () => {
    const u = boonVolumeUtilization(linha({ stabOut: 3, stabEff: 2.4, activeMs: 60_000, genCoverMs: 60_000 }), "stab");

    expect(u.value).toBeCloseTo(0.8, 9);
    expect(u.exceeds).toBe(false);
    expect(u.reason).toBeUndefined();
  });

  it("0% de verdade (tudo perdido, com cobertura) é 0, não N/D", () => {
    const u = boonVolumeUtilization(linha({ stabOut: 3, stabEff: 0, activeMs: 60_000, genCoverMs: 60_000 }), "stab");

    expect(u.value).toBe(0);
  });

  it("sem cobertura é N/D por falta de dado, e com cobertura parcial é N/D por período misto", () => {
    expect(boonVolumeUtilization(linha({ stabOut: 3, stabEff: 0, activeMs: 60_000, genCoverMs: 0 }), "stab")).toMatchObject({ value: null, reason: "noData" });
    expect(boonVolumeUtilization(linha({ stabOut: 3, stabEff: 2.4, activeMs: 120_000, genCoverMs: 60_000 }), "stab")).toMatchObject({ value: null, reason: "partial" });
  });

  it("sem volume é N/D (nem 0% nem 100%)", () => {
    expect(boonVolumeUtilization(linha({ activeMs: 60_000, genCoverMs: 60_000 }), "stab")).toMatchObject({ value: null, reason: "noVolume" });
  });

  it("geração maior que o volume não é limitada: o valor passa de 1 e vem sinalizado", () => {
    const u = boonVolumeUtilization(linha({ quickOut: 1, quickEff: 1.2, activeMs: 60_000, genCoverMs: 60_000 }), "quick");

    expect(u.value).toBeCloseTo(1.2, 9);
    expect(u.exceeds).toBe(true);
  });

  it("diferença de arredondamento (até 0,5%) não sinaliza", () => {
    expect(boonVolumeUtilization(linha({ quickOut: 1, quickEff: 1.004, activeMs: 60_000, genCoverMs: 60_000 }), "quick").exceeds).toBe(false);
  });

  it("com o ajuste por tempo jogado usa os mesmos valores das colunas vizinhas (volume e efetiva ajustados)", () => {
    const r = linha({ stabOut: 3, stabEff: 2.4, activeMs: 60_000, genCoverMs: 60_000 });
    const baseline = { ...emptyStats(), stabOut: 1, stabEff: 0.9, activeMs: 600_000, genCoverMs: 600_000, fights: 10, distCoverMs: 0, nearCoverMs: 0 };
    const adjust = { baseline, refMs: 120_000 };

    const u = boonVolumeUtilization(r, "stab", adjust);

    expect(u.value).toBeCloseTo(statValue("stabEff", "perMin", r, adjust) / statValue("stabOut", "perMin", r, adjust), 12);
    expect(u.value).not.toBeCloseTo(0.8, 3); // o ajuste muda o número em relação ao bruto
  });
});
