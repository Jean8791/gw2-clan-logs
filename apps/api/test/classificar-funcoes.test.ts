import { describe, expect, it } from "vitest";
import { emptyStats, type Stats } from "@gw2logs/shared";
import { classifyRoles, type ExtractedPlayer } from "../src/ingest.js";

// Testes de caracterização: registram o que classifyRoles faz HOJE, inclusive o que parece errado (marcado como "hoje").

const jogador = (id: string, over: Partial<Stats> & Partial<ExtractedPlayer> = {}): ExtractedPlayer => ({
  ...emptyStats(),
  account: id,
  name: id,
  profession: "Reaper",
  guildId: null,
  group: null,
  commander: false,
  role: "dps",
  activeMs: 120_000,
  distToCom: null,
  distCoverMs: 0,
  nearCoverMs: 0,
  skills: [],
  supportSkills: [],
  skillUsage: [],
  genCoverMs: 0,
  damage: 1000,
  ...over,
});

/** Classifica e devolve a função de cada jogador, na mesma ordem. */
const funcoes = (players: ExtractedPlayer[]) => {
  classifyRoles(players);
  return players.map((p) => p.role);
};

describe("classifyRoles: cura e barreira em relação ao próprio dano", () => {
  it("cura maior que metade do dano é suporte", () => {
    expect(funcoes([jogador("a", { damage: 1000, healing: 600 })])).toEqual(["support"]);
  });

  it("cura exatamente igual à metade do dano ainda é DPS (a comparação é estrita)", () => {
    expect(funcoes([jogador("a", { damage: 1000, healing: 500 })])).toEqual(["dps"]);
  });

  it("cura e barreira somam", () => {
    expect(funcoes([jogador("a", { damage: 1000, healing: 300, barrier: 300 })])).toEqual(["support"]);
  });

  it("só barreira também vale", () => {
    expect(funcoes([jogador("a", { damage: 1000, barrier: 600 })])).toEqual(["support"]);
  });

  it("hoje: com dano zero, qualquer cura mínima já é suporte", () => {
    expect(funcoes([jogador("a", { damage: 0, healing: 1 })])).toEqual(["support"]);
  });

  it("sem dano, sem cura e sem barreira é DPS", () => {
    expect(funcoes([jogador("a", { damage: 0 })])).toEqual(["dps"]);
  });
});

describe("classifyRoles: quem gera boons para o squad", () => {
  // SUPPORT_BOONS: stabOut, protOut, aegisOut, resistOut, resolOut, quickOut, alacOut. Danos iguais: a mediana é 1000 e ninguém fica abaixo dela.
  const squad = (boons: number[]) => boons.map((b, i) => jogador(`j${i}`, { stabOut: b }));

  it("um dos maiores geradores (a partir de 35% do maior) é suporte", () => {
    expect(funcoes(squad([100, 40]))).toEqual(["support", "support"]);
  });

  it("gera boons (≥ 2) mas fica abaixo de 35% do maior e não tem dano abaixo da mediana: DPS", () => {
    expect(funcoes(squad([100, 30]))).toEqual(["support", "dps"]);
  });

  it("os boons somam entre os 7 considerados", () => {
    const p = jogador("a", { stabOut: 1, quickOut: 1 });
    expect(funcoes([p])).toEqual(["support"]);
  });

  it("Poder (mightOut) não entra na conta de suporte", () => {
    expect(funcoes([jogador("a", { mightOut: 500 })])).toEqual(["dps"]);
  });

  it("boons abaixo de 2 não bastam, nem sozinho no squad", () => {
    expect(funcoes([jogador("a", { stabOut: 1.9 })])).toEqual(["dps"]);
  });

  it("boons exatamente 2 bastam (a comparação é ≥)", () => {
    expect(funcoes([jogador("a", { stabOut: 2 })])).toEqual(["support"]);
  });

  it("sozinho no squad com boons ≥ 2 é suporte (ele mesmo é o maior)", () => {
    expect(funcoes([jogador("a", { stabOut: 5 })])).toEqual(["support"]);
  });
});

describe("classifyRoles: gera boons e causa menos dano que a mediana", () => {
  // danos 1000, 2000, 3000: a mediana é 2000. O j2 gera 100 de boons e segura o "maior gerador", então 2,5 fica abaixo de 35% dele.
  const squad = (boonsDoPrimeiro: number, boonsDoSegundo = 0) => [
    jogador("j0", { damage: 1000, stabOut: boonsDoPrimeiro }),
    jogador("j1", { damage: 2000, stabOut: boonsDoSegundo }),
    jogador("j2", { damage: 3000, stabOut: 100 }),
  ];

  it("dano abaixo da mediana e boons ≥ 2: suporte", () => {
    expect(funcoes(squad(2.5))).toEqual(["support", "dps", "support"]);
  });

  it("dano exatamente na mediana não conta (a comparação é estrita)", () => {
    expect(funcoes(squad(0, 2.5))).toEqual(["dps", "dps", "support"]);
  });

  it("dano abaixo da mediana mas boons < 2: DPS", () => {
    expect(funcoes(squad(1.9))).toEqual(["dps", "dps", "support"]);
  });
});

describe("classifyRoles: sem sinal, a classe e o tempo ativo não pesam", () => {
  it("hoje: um Druid de luta curta, sem cura, sem barreira e com poucos boons, vira DPS", () => {
    const druid = jogador("a", { profession: "Druid", activeMs: 24_000, damage: 282, stabOut: 0.23 });
    expect(funcoes([druid])).toEqual(["dps"]);
  });

  it("a classe não entra na decisão: a mesma estatística dá a mesma função em qualquer classe", () => {
    const stats = { damage: 1000, healing: 600 };
    expect(funcoes([jogador("a", { ...stats, profession: "Druid" })])).toEqual(funcoes([jogador("b", { ...stats, profession: "Reaper" })]));
    expect(funcoes([jogador("a", { damage: 282, profession: "Druid" })])).toEqual(funcoes([jogador("b", { damage: 282, profession: "Reaper" })]));
  });

  it("o tempo ativo não entra na decisão: os mesmos números dão a mesma função com 1 s ou com 10 min", () => {
    const curto = funcoes([jogador("a", { damage: 1000, healing: 600, activeMs: 1_000 })]);
    const longo = funcoes([jogador("b", { damage: 1000, healing: 600, activeMs: 600_000 })]);
    expect(curto).toEqual(longo);
  });
});

describe("classifyRoles: formato da chamada", () => {
  it("lista vazia não quebra", () => {
    expect(() => classifyRoles([])).not.toThrow();
  });

  it("grava a função no próprio jogador e não devolve nada", () => {
    const p = jogador("a", { damage: 1000, healing: 600 });
    expect(classifyRoles([p])).toBeUndefined();
    expect(p.role).toBe("support");
  });

  it("sobrescreve a função anterior: quem chegou como suporte sem sinal volta a DPS", () => {
    const p = jogador("a", { role: "support", damage: 1000 });
    expect(funcoes([p])).toEqual(["dps"]);
  });

  it("a mediana de uma lista par é o elemento de cima do meio (índice n/2 da lista ordenada)", () => {
    // danos 100, 200, 300, 400: mediana = 300. Só quem tem dano abaixo de 300 e boons ≥ 2 vira suporte pelo critério da mediana.
    const players = [100, 200, 300, 400].map((d, i) => jogador(`j${i}`, { damage: d, stabOut: i === 3 ? 100 : 2.5 }));
    expect(funcoes(players)).toEqual(["support", "support", "dps", "support"]);
  });
});
