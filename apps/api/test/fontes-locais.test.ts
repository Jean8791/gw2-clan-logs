import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/config.js";

/** As fontes (Inter e Cinzel) saem do próprio site: nada do Google no carregamento da página nem na CSP. */
const web = path.join(repoRoot, "apps", "web");
const lido = (...partes: string[]) => fs.readFileSync(path.join(web, ...partes), "utf8");

describe("fontes hospedadas no próprio site", () => {
  it("o index.html não chama o Google Fonts e antecipa as fontes locais", () => {
    const html = lido("index.html");

    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).toContain('href="/fonts/inter-latin.woff2"');
    expect(html).toContain('href="/fonts/cinzel-latin.woff2"');
  });

  it("o CSS declara as duas famílias a partir dos arquivos locais, com font-display swap", () => {
    const css = lido("src", "index.css");

    for (const [familia, arquivo] of [["Inter", "inter-latin.woff2"], ["Cinzel", "cinzel-latin.woff2"]]) {
      const bloco = css.match(new RegExp(`@font-face\\s*{[^}]*font-family:\\s*"${familia}"[^}]*}`))?.[0] ?? "";
      expect(bloco, familia).toContain(`url("/fonts/${arquivo}")`);
      expect(bloco, familia).toContain("font-display: swap");
      expect(bloco, familia).toMatch(/font-weight:\s*\d+\s+\d+/); // fonte variável: um intervalo de pesos
    }
  });

  it("os arquivos de fonte existem, são woff2 de verdade e vêm com a licença", () => {
    for (const arquivo of ["inter-latin.woff2", "cinzel-latin.woff2"]) {
      const bytes = fs.readFileSync(path.join(web, "public", "fonts", arquivo));
      expect(bytes.subarray(0, 4).toString("latin1"), arquivo).toBe("wOF2");
      expect(bytes.length, arquivo).toBeGreaterThan(10_000);
    }
    for (const licenca of ["OFL-Inter.txt", "OFL-Cinzel.txt"]) {
      expect(fs.readFileSync(path.join(web, "public", "fonts", licenca), "utf8"), licenca).toContain("SIL OPEN FONT LICENSE");
    }
  });
});
