import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { eiConfLines, eiEnv } from "../src/elite-insights.js";

const conf = (html = false) => Object.fromEntries(eiConfLines("/saida", { html }).map((l) => l.split("=") as [string, string]));

describe("eiConfLines: configuração enxuta do Elite Insights", () => {
  it("desliga o que o site não usa e pesa na memória", () => {
    const c = conf();

    expect(c).toMatchObject({ ParseCombatReplay: "false", RawTimelineArrays: "false", ComputeDamageModifiers: "false", SingleThreaded: "true" });
  });

  it("mantém o que a extração precisa (sem DetailledWvW some dano, kills e inimigos)", () => {
    expect(conf()).toMatchObject({ DetailledWvW: "true", SaveOutJSON: "true", ParsePhases: "true", OutLocation: "/saida" });
  });

  it("o relatório HTML só sai quando pedido", () => {
    expect(conf(false).SaveOutHTML).toBe("false");
    expect(conf(true).SaveOutHTML).toBe("true");
  });

  it("não envia nada para fora (dps.report, wingman) e não grava CSV", () => {
    expect(conf()).toMatchObject({ UploadToDPSReports: "false", UploadToWingman: "false", SaveOutCSV: "false" });
  });
});

describe("eiEnv: ambiente do processo do Elite Insights", () => {
  it("pede ao .NET para economizar memória e mantém o resto do ambiente", () => {
    const env = eiEnv({ PATH: "/bin", HOME: "/h" });

    expect(env).toMatchObject({ DOTNET_GCConserveMemory: "9", PATH: "/bin", HOME: "/h" });
  });

  it("respeita um ajuste do .NET já definido pela pessoa", () => {
    expect(eiEnv({ DOTNET_GCConserveMemory: "5" }).DOTNET_GCConserveMemory).toBe("5");
  });
});

describe("EI_HTML", () => {
  it("desligado por padrão, ligado só com 'true'", () => {
    expect(loadConfig({}).eiHtml).toBe(false);
    expect(loadConfig({ EI_HTML: "true" }).eiHtml).toBe(true);
    expect(loadConfig({ EI_HTML: "1" }).eiHtml).toBe(false);
  });
});
