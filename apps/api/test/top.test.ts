import { describe, expect, it } from "vitest";
import { emptyStats, topByRate } from "@gw2logs/shared";

const MIN = 120_000;
/** Jogador com `damage` total em `min` minutos ativos. */
const player = (account: string, damage: number, min: number) => ({ ...emptyStats(), account, damage, activeMs: min * 60_000 });
const accounts = (list: { row: { account: string } }[]) => list.map((x) => x.row.account);

describe("topByRate: os melhores por minuto de tempo ativo", () => {
  const rows = [
    player("lento", 1000, 10), // 100/min
    player("rapido", 3000, 10), // 300/min
    player("medio", 2000, 10), // 200/min
    player("curto", 9000, 1), // 9000/min, mas só 1 min ativo
    player("zero", 0, 10),
  ];

  it("ordena do maior para o menor valor por minuto", () => {
    expect(accounts(topByRate(rows, "damage", 10, MIN))).toEqual(["rapido", "medio", "lento"]);
  });

  it("devolve o valor por minuto de cada um", () => {
    expect(topByRate(rows, "damage", 10, MIN).map((x) => x.perMin)).toEqual([300, 200, 100]);
  });

  it("ignora quem lutou menos que o mínimo, mesmo com valor altíssimo, e quem tem zero", () => {
    const todos = accounts(topByRate(rows, "damage", 10, MIN));
    expect(todos).not.toContain("curto");
    expect(todos).not.toContain("zero");
  });

  it("limita ao tamanho pedido", () => {
    expect(accounts(topByRate(rows, "damage", 2, MIN))).toEqual(["rapido", "medio"]);
  });

  it("o top 5 é sempre o começo do top 10", () => {
    const muitos = Array.from({ length: 14 }, (_, i) => player(`j${i}`, (i + 1) * 100, 10));

    const top5 = accounts(topByRate(muitos, "damage", 5, MIN));
    const top10 = accounts(topByRate(muitos, "damage", 10, MIN));

    expect(top10).toHaveLength(10);
    expect(top10.slice(0, 5)).toEqual(top5);
  });

  it("sem ninguém que atenda, lista vazia", () => {
    expect(topByRate([player("a", 0, 10)], "damage", 5, MIN)).toEqual([]);
    expect(topByRate([], "damage", 5, MIN)).toEqual([]);
  });
});
