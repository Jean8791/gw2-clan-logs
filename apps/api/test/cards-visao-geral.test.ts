import { describe, expect, it } from "vitest";
import {
  cardOptions, DEFAULT_CARDS, emptyStats, HEALING_BARRIER, isCardRate, parseCards, resolveCards, serializeCards, statsOfGroup, STAT_GROUPS, STAT_KEYS, STAT_META, topByCard,
  type Cards, type RankingRow,
} from "@gw2logs/shared";

const MIN = 120_000;
/** Jogador com `min` minutos ativos e as métricas dadas. */
const jogador = (account: string, min: number, o: Partial<RankingRow> = {}): RankingRow =>
  ({ ...emptyStats(), fights: 1, distCoverMs: 0, nearCoverMs: 0, name: account, profession: null, professions: [], guildId: null, supportFights: 0, account, activeMs: min * 60_000, ...o });
const contas = (l: { row: { account: string } }[]) => l.map((x) => x.row.account);

describe("cards da Visão geral: o que cada card oferece", () => {
  it("o padrão tem um card por grupo do Ranking e a métrica de cada um pertence ao grupo", () => {
    expect(Object.keys(DEFAULT_CARDS)).toEqual(STAT_GROUPS.map((g) => g.id));
    for (const g of STAT_GROUPS) expect(cardOptions(g.id, "squad")).toContain(DEFAULT_CARDS[g.id]);
    expect(DEFAULT_CARDS).toEqual({ offense: "damage", support: "healing", boons: "stabOut", uptime: "stabUp", defense: "dodges" });
  });

  it("o seletor lista as métricas do grupo, e só o Suporte ganha Cura + barreira (no fim)", () => {
    expect(cardOptions("offense")).toEqual(statsOfGroup("offense"));
    expect(cardOptions("support")).toEqual([...statsOfGroup("support"), HEALING_BARRIER]);
    expect(cardOptions("defense")).not.toContain(HEALING_BARRIER);
  });

  it("nos boons, o seletor lista só o alcance pedido", () => {
    expect(cardOptions("boons", "squad")).toContain("stabOut");
    expect(cardOptions("boons", "squad")).not.toContain("stabGroup");
    expect(cardOptions("boons", "group")).toContain("stabGroup");
    expect(cardOptions("boons", "self")).toContain("stabSelf");
  });
});

describe("cards da Visão geral: escolha guardada no link", () => {
  it("lê grupo:métrica separados por vírgula", () => {
    expect(parseCards("support:strips,boons:stabGroup")).toEqual({ support: "strips", boons: "stabGroup" });
    expect(parseCards("support:healingBarrier")).toEqual({ support: "healingBarrier" });
  });

  it.each([
    ["métrica de outro grupo", "offense:strips"],
    ["métrica que não existe", "offense:xxx"],
    ["grupo que não existe", "foo:damage"],
    ["Cura + barreira fora do Suporte", "offense:healingBarrier"],
    ["sem dois pontos", "damage"],
    ["chave perigosa do objeto", "offense:__proto__"],
    ["vazio", ""],
  ])("descarta %s", (_nome, raw) => {
    expect(parseCards(raw)).toEqual({});
  });

  it("um valor inválido não derruba os válidos ao lado", () => {
    expect(parseCards("offense:xxx,support:cleanses,defense:strips")).toEqual({ support: "cleanses" });
  });

  it("texto enorme ou nulo vira nada escolhido", () => {
    expect(parseCards("support:strips,".repeat(100))).toEqual({});
    expect(parseCards(null)).toEqual({});
    expect(parseCards(undefined)).toEqual({});
  });

  it("o que não foi escolhido fica no padrão", () => {
    expect(resolveCards({ support: "strips" })).toEqual({ ...DEFAULT_CARDS, support: "strips" });
  });

  it("serializa só o que difere do padrão, e volta igual ao ler", () => {
    const cards: Cards = { ...DEFAULT_CARDS, support: "cleanses", defense: "deaths" };

    expect(serializeCards(cards)).toBe("support:cleanses,defense:deaths");
    expect(resolveCards(parseCards(serializeCards(cards)))).toEqual(cards);
    expect(serializeCards(DEFAULT_CARDS)).toBe("");
  });

  it("toda métrica oferecida em qualquer alcance sobrevive à ida e volta", () => {
    for (const g of STAT_GROUPS) {
      for (const m of [...STAT_KEYS.filter((k) => STAT_META[k].group === g.id), ...cardOptions(g.id)]) {
        expect(parseCards(`${g.id}:${m}`)).toEqual({ [g.id]: m });
      }
    }
  });
});

describe("topByCard: o top de cada card", () => {
  it("contagem (dano, cura…): por minuto de tempo ativo, do maior para o menor", () => {
    const rows = [jogador("a", 10, { healing: 1000 }), jogador("b", 10, { healing: 3000 }), jogador("c", 5, { healing: 2000 })];

    expect(topByCard(rows, "healing", 5, MIN).map((x) => [x.row.account, x.value])).toEqual([["c", 400], ["b", 300], ["a", 100]]);
  });

  it("uptime e boon: o valor não é por minuto (é % do tempo ou a média do volume) e sai ajustado pelo tempo jogado", () => {
    // média geral do filtro: 100 min ativos com 50% de estabilidade
    const geral = { ...emptyStats(), fights: 10, distCoverMs: 0, nearCoverMs: 0, activeMs: 100 * 60_000, stabUp: 0.5 * 100 * 60_000 };
    const longo = jogador("longo", 100, { stabUp: 0.9 * 100 * 60_000 }); // 90% do tempo, muito tempo jogado
    const curto = jogador("curto", 2, { stabUp: 1.0 * 2 * 60_000 }); // 100% do tempo, mas só 2 min

    const top = topByCard([longo, curto], "stabUp", 5, MIN, { baseline: geral, refMs: 10 * 60_000 });

    expect(contas(top)).toEqual(["longo", "curto"]); // o curto foi puxado para a média e não passa o longo
    expect(top[0]!.value).toBeGreaterThan(80);
    expect(top[0]!.value).toBeLessThanOrEqual(100);
    expect(isCardRate("stabUp")).toBe(false);
    expect(isCardRate("stabOut")).toBe(false);
    expect(isCardRate("damage")).toBe(true);
  });

  it("menos é melhor (mortes): do menor para o maior, e quem tem zero fica fora", () => {
    const rows = [jogador("muitas", 10, { deaths: 5 }), jogador("poucas", 10, { deaths: 1 }), jogador("nenhuma", 10, { deaths: 0 })];

    expect(contas(topByCard(rows, "deaths", 5, MIN))).toEqual(["poucas", "muitas"]);
  });

  it("Cura + barreira soma as duas por minuto de tempo ativo", () => {
    const rows = [jogador("a", 10, { healing: 600, barrier: 400 }), jogador("b", 10, { healing: 800, barrier: 0 }), jogador("c", 10)];

    expect(topByCard(rows, HEALING_BARRIER, 5, MIN).map((x) => [x.row.account, x.value])).toEqual([["a", 100], ["b", 80]]);
    expect(isCardRate(HEALING_BARRIER)).toBe(true);
  });

  it("métrica da tag sem dado (log lido sem replay) não aparece", () => {
    const rows = [jogador("sem", 10, { tagNear: 0 }), jogador("com", 10, { tagNear: 60, nearCoverMs: 600_000 })];

    expect(contas(topByCard(rows, "tagNear", 5, MIN))).toEqual(["com"]);
  });

  it("quem lutou menos que o mínimo não entra", () => {
    expect(contas(topByCard([jogador("curto", 1, { damage: 9999 }), jogador("ok", 10, { damage: 10 })], "damage", 5, MIN))).toEqual(["ok"]);
  });
});
