import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fitTableHeight, MIN_TABLE_HEIGHT } from "@gw2logs/shared";
import { repoRoot } from "../src/config.js";

/**
 * Em tela pequena o filtro e a barra de cima quebram em várias linhas e comiam a altura da tabela (sobravam 2 jogadores).
 * A tabela (Ranking, Lutas, Guildas) agora mede a tela e ocupa o que sobrou; só se for pouco demais é a página que rola.
 */
describe("altura da tabela conforme a tela", () => {
  it("ocupa o que sobra da janela depois do que está acima e abaixo dela", () => {
    expect(fitTableHeight({ viewport: 900, top: 400, below: 100 })).toBe(400);
    expect(fitTableHeight({ viewport: 1440, top: 330, below: 100 })).toBe(1010); // monitor grande: a tabela cresce junto
  });

  it("em tela baixa não deixa a tabela sumir: vale o mínimo, e a página rola", () => {
    expect(fitTableHeight({ viewport: 600, top: 560, below: 100 })).toBe(MIN_TABLE_HEIGHT);
    expect(fitTableHeight({ viewport: 640, top: 350, below: 90 })).toBe(MIN_TABLE_HEIGHT); // sobram 200: abaixo do mínimo
  });

  it("arredonda para baixo, para não passar do fim da janela por meio pixel", () => {
    expect(fitTableHeight({ viewport: 800.9, top: 300.4, below: 100 })).toBe(400);
  });
});

describe("tabelas que ocupam a tela", () => {
  const web = path.join(repoRoot, "apps", "web", "src");
  const lido = (...partes: string[]) => fs.readFileSync(path.join(web, ...partes), "utf8");

  it("a DataTable mede a tela em vez de depender de uma altura fixa da página", () => {
    const tabela = lido("components", "DataTable.tsx");
    expect(tabela).toContain("useFitHeight(fill === true)");
    expect(tabela).toContain("style={fill ? { height: fit.height } : undefined}");
    expect(lido("lib", "fit-height.ts")).toContain("fitTableHeight({ viewport: window.innerHeight");
  });

  it("a página não tem mais a altura fixa de tela cheia nem o piso de 44rem", () => {
    const layout = lido("components", "Layout.tsx");
    expect(layout).not.toContain("md:h-screen");
    expect(layout).not.toContain("min-h-[44rem]");
    expect(lido("main.tsx")).not.toContain("handle: { fill");
  });

  it("em tela baixa (até 800px de altura) os filtros começam recolhidos e o subtítulo some, para a tabela ter espaço", () => {
    expect(lido("lib", "screen.ts")).toContain("(max-height: 800px)");
    expect(lido("components", "FilterBar.tsx")).toContain("useMediaQuery(SHORT_SCREEN)");
    expect(lido("components", "ui.tsx")).toContain("[@media(max-height:800px)]:hidden");
    expect(lido("lib", "fit-height.ts")).toContain("matchMedia(SHORT_SCREEN).matches ? 0 : afterTable");
  });

  it("o bloco de comparar do Ranking só existe com jogadores marcados, em vez de ocupar uma linha invisível", () => {
    expect(lido("pages", "Ranking.tsx")).toContain("{selected.length > 0 && (");
    expect(lido("pages", "Ranking.tsx")).not.toContain("opacity-0");
  });

  it("a coluna Classe fica numa linha só, com largura de 3 classes e rolagem para as demais", () => {
    const ranking = lido("pages", "Ranking.tsx");
    expect(ranking).not.toContain("flex-wrap items-center gap-x-3");
    // largura de 3 classes (ícone, nome e lutas): da quarta em diante a célula rola para o lado em vez de alargar a tabela
    expect(ranking).toContain("max-w-[22rem] items-center gap-x-3 overflow-x-auto");
    expect(ranking).toContain("inline-flex shrink-0 items-center gap-1");
  });
});
