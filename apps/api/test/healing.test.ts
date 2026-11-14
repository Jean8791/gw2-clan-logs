import { describe, expect, it } from "vitest";
import { STAT_EN, STAT_KEYS, STAT_META, statsOfGroup, type StatKey } from "@gw2logs/shared";
import { extractFight } from "../src/ingest.js";
import { wvwFixture } from "./fixture.js";

const heal = (healing: number, downedHealing = 0) => [{ healing, downedHealing }];
const barrier = (b: number) => [{ barrier: b }];

/**
 * Luta de teste: o Comandante (posição 0, grupo 1) cura. Por posição na lista de jogadores:
 * ele mesmo, o Atacante (grupo 1), o Outro (grupo 2) e a Fora (fora do squad).
 */
function fightWithHealing(o: { extraFirst?: boolean } = {}) {
  const f: any = wvwFixture();
  const [cmd, atk, outro, fora] = f.players;
  atk.group = 1;
  outro.group = 2;
  fora.group = 1;
  cmd.extHealingStats = {
    outgoingHealing: [{ healing: 200, downedHealing: 30 }],
    outgoingHealingAllies: [heal(100, 5), heal(40, 20), heal(25, 5), heal(10, 0)],
  };
  cmd.extBarrierStats = {
    outgoingBarrier: [{ barrier: 90 }],
    outgoingBarrierAllies: [barrier(50), barrier(20), barrier(15), barrier(5)],
  };
  if (o.extraFirst) {
    // um NPC aliado na frente da lista: todos os índices andam uma casa, e a extração não pode se perder
    const npc = { ...JSON.parse(JSON.stringify(fora)), friendlyNPC: true, account: "Npc.0000" };
    f.players.unshift(npc);
    cmd.extHealingStats.outgoingHealingAllies.unshift(heal(7, 0));
    cmd.extBarrierStats.outgoingBarrierAllies.unshift(barrier(3));
  }
  return f;
}
const cmdOf = (json: any) => extractFight(json).players.find((x) => x.account === "Comandante.1111")!;

describe("extractFight: cura e barreira para si, para o grupo e total", () => {
  it("o total continua o que era, e Self e Group saem da lista por aliado", () => {
    const p = cmdOf(fightWithHealing());

    expect(p.healing).toBe(200);
    expect(p.healingSelf).toBe(100);
    expect(p.healingGroup).toBe(140); // ele mesmo + o Atacante, do mesmo grupo no squad
    expect(p.barrier).toBe(90);
    expect(p.barrierSelf).toBe(50);
    expect(p.barrierGroup).toBe(70);
  });

  it("cura em quem está caído vem do total do jogador", () => {
    expect(cmdOf(fightWithHealing()).downedHealing).toBe(30);
  });

  it("um NPC ou jogador falso na lista não desloca os índices", () => {
    const p = cmdOf(fightWithHealing({ extraFirst: true }));

    expect([p.healingSelf, p.healingGroup, p.barrierSelf, p.barrierGroup]).toEqual([100, 140, 50, 70]);
  });

  it("quem está fora do squad não conta no grupo, mesmo no mesmo número de grupo", () => {
    const p = cmdOf(fightWithHealing());

    expect(p.healingGroup).toBe(100 + 40); // os 10 da Fora (grupo 1, fora do squad) ficam de fora
  });

  it("sem Healing Stats (sem os blocos de cura) tudo fica em zero, sem erro", () => {
    const json: any = fightWithHealing();
    delete json.players[0].extHealingStats;
    delete json.players[0].extBarrierStats;

    const p = cmdOf(json);

    expect([p.healingSelf, p.healingGroup, p.barrierSelf, p.barrierGroup, p.downedHealing]).toEqual([0, 0, 0, 0, 0]);
  });

  it("lista por aliado vazia ou curta não quebra", () => {
    const json: any = fightWithHealing();
    json.players[0].extHealingStats.outgoingHealingAllies = [];
    json.players[0].extBarrierStats.outgoingBarrierAllies = [heal(1)];

    expect(() => cmdOf(json)).not.toThrow();
    expect(cmdOf(json).healingGroup).toBe(0);
  });

  it("junta as instâncias da mesma conta: cada alcance soma", () => {
    const json = fightWithHealing();
    const second = JSON.parse(JSON.stringify(json.players[0]));
    json.players.push(second); // mesma conta de novo, no fim; o próprio índice dela é 4
    second.extHealingStats.outgoingHealingAllies = [heal(0), heal(0), heal(0), heal(0), heal(60, 8)];
    second.extHealingStats.outgoingHealing = [{ healing: 60, downedHealing: 8 }];

    const p = cmdOf(json);

    expect(p.healing).toBe(260);
    expect(p.healingSelf).toBe(160);
    expect(p.downedHealing).toBe(38);
  });
});

describe("colunas de cura na aba Suporte", () => {
  const novas: StatKey[] = ["healingGroup", "healingSelf", "barrierGroup", "barrierSelf", "downedHealing"];

  it("as colunas novas ficam na aba Suporte, ao lado de cura e barreira, e nada vira seletor", () => {
    const suporte = statsOfGroup("support");

    expect(suporte).toEqual(expect.arrayContaining(["healing", "barrier", ...novas]));
    expect(statsOfGroup("support", "group")).toEqual(suporte);
    for (const k of novas) expect(STAT_META[k]).toMatchObject({ group: "support", higherIsBetter: true, format: "int" });
  });

  it("cada coluna tem nome próprio (sem seletor, não podem se confundir com o total)", () => {
    const nomes = (statsOfGroup("support") as StatKey[]).filter((k) => /^(healing|barrier|downedHealing)/.test(k)).map((k) => STAT_META[k].short);

    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("existem em inglês, com nomes também diferentes entre si", () => {
    const nomes = ["healing", "healingGroup", "healingSelf", "barrier", "barrierGroup", "barrierSelf", "downedHealing"].map((k) => STAT_EN[k as StatKey].short);

    expect(new Set(nomes).size).toBe(nomes.length);
    for (const k of novas) expect(STAT_EN[k].hint).toBeTruthy();
    expect(STAT_KEYS).toContain("downedHealing");
  });

  it("a ordem na aba junta cura, e só então barreira", () => {
    const ordem = statsOfGroup("support").filter((k) => /^(healing|barrier|downedHealing)/.test(k));

    expect(ordem).toEqual(["healing", "healingGroup", "healingSelf", "barrier", "barrierGroup", "barrierSelf", "downedHealing"]);
  });
});
