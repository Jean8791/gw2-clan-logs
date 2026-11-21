import { describe, expect, it } from "vitest";
import { STAT_KEYS, statValue, topByStat, type Stats } from "@gw2logs/shared";

/** Um jogador da luta: tudo zero, menos o que o teste pede. */
const jogador = (o: Partial<Stats> & { activeMs: number; account?: string }): Stats & { activeMs: number; account: string } =>
  ({ account: "x", ...Object.fromEntries(STAT_KEYS.map((k) => [k, 0])), ...o }) as Stats & { activeMs: number; account: string };

describe("statValue: o valor de uma métrica de um jogador, o mesmo na tabela e no gráfico", () => {
  const j = jogador({ activeMs: 120_000, damage: 600_000, deaths: 2 });

  it("total é o valor guardado; por minuto e por segundo dividem pelo tempo ativo", () => {
    expect(statValue("damage", "total", j)).toBe(600_000);
    expect(statValue("damage", "perMin", j)).toBe(300_000);
    expect(statValue("damage", "perSec", j)).toBe(5_000);
  });

  it("sem tempo ativo a taxa é 0, sem dividir por zero", () => {
    expect(statValue("damage", "perMin", jogador({ activeMs: 0, damage: 500 }))).toBe(0);
    expect(statValue("damage", "perSec", jogador({ activeMs: 0, damage: 500 }))).toBe(0);
  });

  it("boon gerado é volume por luta: o modo por minuto não se aplica", () => {
    const b = jogador({ activeMs: 60_000, stabOut: 900 });

    expect(statValue("stabOut", "total", b)).toBe(900);
    expect(statValue("stabOut", "perMin", b)).toBe(900);
  });

  it("uptime é % do tempo ativo nos três modos", () => {
    const u = jogador({ activeMs: 100_000, stabUp: 80_000 });

    expect(statValue("stabUp", "total", u)).toBe(80);
    expect(statValue("stabUp", "perMin", u)).toBe(80);
    expect(statValue("stabUp", "perSec", u)).toBe(80);
  });
});

describe("topByStat: os jogadores do gráfico da luta, na ordem da métrica escolhida", () => {
  const A = jogador({ account: "A", activeMs: 60_000, damage: 600_000, healing: 0 });
  const B = jogador({ account: "B", activeMs: 600_000, damage: 1_000_000, healing: 50_000 });
  const C = jogador({ account: "C", activeMs: 300_000, damage: 400_000, healing: 120_000 });
  const contas = (r: { account: string }[]) => r.map((x) => x.account);

  it("ordena do maior para o menor valor, e o modo muda a ordem", () => {
    expect(contas(topByStat([A, B, C], "damage", "total"))).toEqual(["B", "A", "C"]);
    // A tem menos dano total, mas em 1 minuto: 600 mil por minuto contra 100 mil do B
    expect(contas(topByStat([A, B, C], "damage", "perMin"))).toEqual(["A", "B", "C"]);
  });

  it("deixa de fora quem tem 0 na métrica (cura, por exemplo, quase sempre é 0)", () => {
    expect(contas(topByStat([A, B, C], "healing", "total"))).toEqual(["C", "B"]);
  });

  it("ninguém com valor: lista vazia, para a tela dizer que não há dados", () => {
    expect(topByStat([A, B], "resurrects", "total")).toEqual([]);
    expect(topByStat([], "damage", "total")).toEqual([]);
  });

  it("limita a quantidade (20 por padrão) e mantém a ordem de chegada nos empates", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => jogador({ account: `P${i}`, activeMs: 1000, damage: 100 }));

    expect(topByStat(muitos, "damage", "total")).toHaveLength(20);
    expect(contas(topByStat(muitos, "damage", "total", 3))).toEqual(["P0", "P1", "P2"]);
  });

  it("métrica em que menos é melhor (mortes) também mostra quem tem mais", () => {
    const m1 = jogador({ account: "M1", activeMs: 1000, deaths: 1 });
    const m3 = jogador({ account: "M3", activeMs: 1000, deaths: 3 });

    expect(contas(topByStat([m1, m3], "deaths", "total"))).toEqual(["M3", "M1"]);
  });

  it("devolve o valor já calculado junto da linha, para o gráfico não recalcular", () => {
    expect(topByStat([B], "damage", "perMin")[0]).toMatchObject({ account: "B", value: 100_000 });
  });
});
