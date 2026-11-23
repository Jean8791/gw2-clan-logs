import { describe, expect, it } from "vitest";
import { BOON_SCOPES, inScope, isShortParticipation, mainRole, metricForGroup, SHORT_PARTICIPATION_MS, STAT_GROUPS, STAT_KEYS, STAT_META, statRate, statsOfGroup, suggestMetric, type Aggregate } from "@gw2logs/shared";

/** Soma de um jogador (ou do squad) em várias lutas: tudo zero, menos o que o teste pede. Padrão: 1 luta de 10 minutos. */
const agg = (o: Partial<Aggregate> = {}): Aggregate =>
  ({ fights: 1, activeMs: 600_000, ...Object.fromEntries(STAT_KEYS.map((k) => [k, 0])), ...o }) as Aggregate;

/** Squad de referência: dano, remoção, cura e boons de um jogador típico em 10 minutos. */
const squad = agg({ damage: 1_500_000, strips: 20, cleanses: 20, healing: 100_000, downedHealing: 10_000, barrier: 50_000, alacOut: 300 });

describe("suggestMetric: a métrica do dia é onde o jogador mais se destaca frente ao squad", () => {
  it("quem fez dano acima da média abre em dano", () => {
    expect(suggestMetric(agg({ damage: 3_000_000, strips: 20, healing: 100_000 }), squad)).toBe("damage");
  });

  it("curandeiro: cura é o que mais se destaca", () => {
    expect(suggestMetric(agg({ damage: 300_000, healing: 500_000, downedHealing: 20_000 }), squad)).toBe("healing");
  });

  it("quem cura muito em caídos abre em cura em caídos", () => {
    expect(suggestMetric(agg({ damage: 1_000_000, healing: 150_000, downedHealing: 60_000 }), squad)).toBe("downedHealing");
  });

  it("quem remove muitos boons abre em boons removidos", () => {
    expect(suggestMetric(agg({ damage: 1_000_000, strips: 200 }), squad)).toBe("strips");
  });

  it("gerador de boon abre no boon que gera (volume por luta)", () => {
    expect(suggestMetric(agg({ damage: 500_000, alacOut: 900 }), squad)).toBe("alacOut");
  });

  it("sem nada a comparar, cai em dano: sem média, jogador zerado ou média zerada na métrica", () => {
    expect(suggestMetric(agg({ healing: 5_000 }), undefined)).toBe("damage");
    expect(suggestMetric(agg(), squad)).toBe("damage");
    // cura onde o squad não tem cura nenhuma: não dá para comparar, então não vale
    expect(suggestMetric(agg({ damage: 1_500_000, healing: 5_000 }), agg({ damage: 1_500_000 }))).toBe("damage");
  });

  it("empate fica com dano", () => {
    expect(suggestMetric(squad, squad)).toBe("damage");
  });
});

describe("quem jogou pouco numa luta e morreu continua contando, na proporção do tempo", () => {
  // luta longa de curandeiro (10 min) + luta em que morreu em 3 segundos como DPS
  const longa = { activeMs: 600_000, healing: 600_000, damage: 100_000 };
  const curta = { activeMs: 3_000, healing: 0, damage: 20_000 };
  const somar = (a: typeof longa, b: typeof curta) => agg({ fights: 2, activeMs: a.activeMs + b.activeMs, healing: a.healing + b.healing, damage: a.damage + b.damage });

  it("o total por minuto é soma dos valores sobre soma do tempo, e não a média das taxas por luta", () => {
    const total = somar(longa, curta);

    expect(statRate(total, "damage")).toBeCloseTo((120_000 * 60_000) / 603_000);
    // a média das taxas (10k/min e 400k/min) daria ~205k/min: a luta de 3 s pesaria tanto quanto a de 10 min
    expect(statRate(total, "damage")).toBeLessThan(15_000);
  });

  it("a luta curta entra na conta mas não vira a métrica do dia", () => {
    expect(suggestMetric(somar(longa, curta), squad)).toBe("healing");
  });

  it("luta com 0 ms ativo (morreu no início) não quebra: a taxa é 0 e ela segue contando como luta", () => {
    const total = agg({ fights: 2, activeMs: 600_000, healing: 600_000 });

    expect(statRate(agg({ fights: 1, activeMs: 0, damage: 500 }), "damage")).toBe(0);
    expect(total.fights).toBe(2);
    expect(suggestMetric(total, squad)).toBe("healing");
  });

  it("boons: o valor da soma já é a média ponderada pelo tempo ativo (a luta curta pesa só o que durou), então não se divide pelas lutas", () => {
    expect(statRate(agg({ fights: 2, alacOut: 300 }), "alacOut")).toBe(300);
  });
});

describe("mainRole: a função principal pesa pelo tempo jogado, não pelo número de lutas", () => {
  it("1 luta longa de suporte vale mais que 2 em que morreu em segundos como DPS", () => {
    expect(
      mainRole([
        { role: "support", activeMs: 600_000 },
        { role: "dps", activeMs: 3_000 },
        { role: "dps", activeMs: 2_000 },
      ]),
    ).toBe("support");
  });

  it("suporte só quando passa de metade do tempo; metade exata é DPS", () => {
    expect(mainRole([{ role: "support", activeMs: 1000 }, { role: "dps", activeMs: 1000 }])).toBe("dps");
    expect(mainRole([{ role: "support", activeMs: 1001 }, { role: "dps", activeMs: 1000 }])).toBe("support");
  });

  it("sem tempo nenhum, vale a contagem de lutas; sem lutas, DPS", () => {
    expect(mainRole([{ role: "support", activeMs: 0 }, { role: "support", activeMs: 0 }, { role: "dps", activeMs: 0 }])).toBe("support");
    expect(mainRole([{ role: "dps", activeMs: 0 }, { role: "dps", activeMs: 0 }, { role: "support", activeMs: 0 }])).toBe("dps");
    expect(mainRole([])).toBe("dps");
  });
});

describe("isShortParticipation: marca no gráfico a luta em que o jogador ficou pouco tempo", () => {
  it("abaixo de 30 segundos de tempo ativo é pouco; 30 segundos ou mais não", () => {
    expect(SHORT_PARTICIPATION_MS).toBe(30_000);
    expect([0, 3_000, 29_999].map(isShortParticipation)).toEqual([true, true, true]);
    expect([30_000, 600_000].map(isShortParticipation)).toEqual([false, false]);
  });
});

describe("seletores do gráfico: grupo, alcance (só nos boons) e métrica", () => {
  /** Tudo o que o seletor de métrica mostra para um grupo, somando os alcances dos boons. */
  const doGrupo = (g: (typeof STAT_GROUPS)[number]["id"]) => (g === "boons" ? BOON_SCOPES.flatMap((s) => statsOfGroup(g, s)) : statsOfGroup(g));

  it("os grupos juntos cobrem todas as métricas, uma vez cada: nenhuma se perde ao separar o seletor", () => {
    const todas = STAT_GROUPS.flatMap((g) => doGrupo(g.id));

    expect(new Set(todas).size).toBe(todas.length);
    expect([...todas].sort()).toEqual([...STAT_KEYS].sort());
  });

  it("cada alcance dos boons lista os mesmos 10 boons, e o grupo de dano abre em dano", () => {
    for (const s of BOON_SCOPES) expect(statsOfGroup("boons", s)).toHaveLength(10);
    expect(statsOfGroup("offense")[0]).toBe("damage");
  });

  it("trocar o alcance mantém o mesmo boon: stabOut vira stabGroup e stabSelf, e volta", () => {
    expect(inScope("stabOut", "group")).toBe("stabGroup");
    expect(inScope("stabGroup", "self")).toBe("stabSelf");
    expect(inScope("stabSelf", "squad")).toBe("stabOut");
    expect(inScope("quickGroup", "group")).toBe("quickGroup");
  });

  it("para todo boon e todo alcance, o resultado existe, é o mesmo boon e está no alcance pedido", () => {
    for (const k of STAT_KEYS.filter((x) => STAT_META[x].group === "boons")) {
      for (const s of BOON_SCOPES) {
        const r = inScope(k, s);

        expect(STAT_KEYS).toContain(r);
        expect(STAT_META[r].buffId).toBe(STAT_META[k].buffId);
        expect(STAT_META[r].scope ?? "squad").toBe(s);
      }
    }
  });

  it("métricas fora dos boons não mudam com o alcance", () => {
    expect(inScope("damage", "self")).toBe("damage");
    expect(inScope("healing", "group")).toBe("healing");
    expect(inScope("stabUp", "group")).toBe("stabUp");
  });

  it("trocar o grupo (no cartão ou no gráfico) leva o gráfico à primeira métrica dele, no alcance escolhido nos boons", () => {
    expect(metricForGroup("offense")).toBe("damage");
    expect(metricForGroup("boons")).toBe("stabOut");
    expect(metricForGroup("boons", "group")).toBe("stabGroup");
    expect(metricForGroup("boons", "self")).toBe("stabSelf");
  });

  it("para todo grupo e alcance existe uma métrica, do grupo e do alcance pedidos", () => {
    for (const g of STAT_GROUPS) {
      for (const s of BOON_SCOPES) {
        const k = metricForGroup(g.id, s);

        expect(STAT_KEYS).toContain(k);
        expect(STAT_META[k].group).toBe(g.id);
        if (g.id === "boons") expect(STAT_META[k].scope ?? "squad").toBe(s);
      }
    }
  });

  it("a métrica sugerida para o dia sempre aparece na lista do seu grupo", () => {
    const sugerida = suggestMetric(agg({ healing: 500_000, damage: 300_000 }), squad);

    expect(doGrupo(STAT_META[sugerida].group)).toContain(sugerida);
  });
});
