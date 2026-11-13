import { describe, expect, it } from "vitest";
import { DICT, STAT_EN, STAT_GROUPS, STAT_KEYS, STAT_META, parseLang, statText, translate, type Lang } from "@gw2logs/shared";

describe("parseLang: o idioma inicial é sempre o português", () => {
  it("só 'en' vira inglês", () => {
    expect(parseLang("en")).toBe("en");
  });

  it.each([null, undefined, "", "pt", "PT", "EN", "en-US", "fr", "[object Object]", "x".repeat(500)])("%j vira português", (raw) => {
    expect(parseLang(raw as string | null)).toBe("pt");
  });
});

describe("translate", () => {
  const dicts: Record<Lang, Record<string, string>> = {
    pt: { oi: "Olá", so_pt: "Só em português", cont: "{n} itens", luta_one: "{n} luta", luta_other: "{n} lutas", nome: "Oi, {nome}!" },
    en: { oi: "Hello", cont: "{n} items", luta_one: "{n} fight", luta_other: "{n} fights", nome: "Hi, {nome}!" },
  };

  it("usa o idioma escolhido", () => {
    expect(translate(dicts, "en", "oi")).toBe("Hello");
    expect(translate(dicts, "pt", "oi")).toBe("Olá");
  });

  it("sem tradução no idioma, cai no português", () => {
    expect(translate(dicts, "en", "so_pt")).toBe("Só em português");
  });

  it("sem tradução em nenhum, mostra a própria chave (nunca vazio nem erro)", () => {
    expect(translate(dicts, "en", "nao.existe")).toBe("nao.existe");
  });

  it("troca os valores entre chaves", () => {
    expect(translate(dicts, "en", "nome", { nome: "Ana" })).toBe("Hi, Ana!");
    expect(translate(dicts, "pt", "cont", { n: 3 })).toBe("3 itens");
  });

  it("escolhe singular e plural pelo n", () => {
    expect(translate(dicts, "pt", "luta", { n: 1 })).toBe("1 luta");
    expect(translate(dicts, "pt", "luta", { n: 20 })).toBe("20 lutas");
    expect(translate(dicts, "en", "luta", { n: 1 })).toBe("1 fight");
    expect(translate(dicts, "en", "luta", { n: 0 })).toBe("0 fights");
  });

  it("valor que não foi dado deixa o marcador como está", () => {
    expect(translate(dicts, "pt", "cont")).toBe("{n} itens");
  });
});

describe("dicionário: nada de tradução esquecida", () => {
  const ptKeys = Object.keys(DICT.pt).sort();
  const enKeys = Object.keys(DICT.en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

  it("toda chave em português existe em inglês, e vice-versa", () => {
    expect(enKeys.filter((k) => !(k in DICT.pt))).toEqual([]);
    expect(ptKeys.filter((k) => !(k in DICT.en))).toEqual([]);
  });

  it("nenhum texto vazio", () => {
    const vazios = (["pt", "en"] as const).flatMap((l) => Object.entries(DICT[l]).filter(([, v]) => !v.trim()).map(([k]) => `${l}:${k}`));
    expect(vazios).toEqual([]);
  });

  it("os mesmos marcadores {n}, {nome} nos dois idiomas", () => {
    const diferentes = ptKeys.filter((k) => placeholders(DICT.pt[k]!) !== placeholders(DICT.en[k]!));
    expect(diferentes).toEqual([]);
  });

  it("o inglês não é só uma cópia do português nos textos comuns", () => {
    expect(DICT.en["nav.days"]).not.toBe(DICT.pt["nav.days"]);
    expect(DICT.en["nav.upload"]).toBe("Upload logs");
  });
});

describe("métricas e grupos em inglês", () => {
  it("as 44 métricas têm nome e abreviação em inglês", () => {
    const faltando = STAT_KEYS.filter((k) => !STAT_EN[k]?.label.trim() || !STAT_EN[k]?.short.trim());
    expect(faltando).toEqual([]);
  });

  it("toda métrica com dica em português tem dica em inglês", () => {
    const faltando = STAT_KEYS.filter((k) => STAT_META[k].hint && !STAT_EN[k].hint);
    expect(faltando).toEqual([]);
  });

  it("cada grupo de métricas tem nome nos dois idiomas", () => {
    for (const g of STAT_GROUPS) {
      expect(DICT.pt[`group.${g.id}`]).toBe(g.label);
      expect(DICT.en[`group.${g.id}`]).toBeTruthy();
    }
  });

  it("statText devolve o português original ou o inglês", () => {
    expect(statText("damageTaken", "pt")).toEqual({ label: "Dano recebido", short: "Recebido", hint: undefined });
    expect(statText("damageTaken", "en").label).toBe("Damage taken");
  });
});
