import { describe, expect, it } from "vitest";
import { guildMatches } from "@gw2logs/shared";

const guilda = (name: string | null, tag: string | null) => ({ name, tag });

describe("guildMatches: busca da tela de Guildas por tag ou nome", () => {
  it("busca vazia (ou só espaços) mostra todas, inclusive as sem nome e sem tag", () => {
    expect(guildMatches(guilda("The Prince", "TPR"), "")).toBe(true);
    expect(guildMatches(guilda(null, null), "   ")).toBe(true);
  });

  it("acha pela tag, com ou sem colchetes, sem diferenciar maiúsculas", () => {
    const g = guilda("Alpha Squad", "ABC");

    expect(guildMatches(g, "ABC")).toBe(true);
    expect(guildMatches(g, "abc")).toBe(true);
    expect(guildMatches(g, "[abc]")).toBe(true);
    expect(guildMatches(g, "[AB")).toBe(true);
  });

  it("acha por um pedaço do nome, em qualquer posição", () => {
    const g = guilda("The Prince Althron", "TPA");

    expect(guildMatches(g, "prince")).toBe(true);
    expect(guildMatches(g, "alth")).toBe(true);
    expect(guildMatches(g, "the prince alt")).toBe(true);
  });

  it("ignora acentos de um lado e do outro", () => {
    expect(guildMatches(guilda("Guilda Ação Rápida", "GAR"), "acao rapida")).toBe(true);
    expect(guildMatches(guilda("Guilda Acao Rapida", "GAR"), "AÇÃO RÁPIDA")).toBe(true);
  });

  it("não acha o que não está nem no nome nem na tag", () => {
    expect(guildMatches(guilda("Alpha Squad", "ABC"), "zzz")).toBe(false);
  });

  it("guilda sem nome ou sem tag não quebra: só casa pelo que tem", () => {
    expect(guildMatches(guilda(null, "XYZ"), "xyz")).toBe(true);
    expect(guildMatches(guilda("Só Nome", null), "nome")).toBe(true);
    expect(guildMatches(guilda(null, null), "qualquer")).toBe(false);
  });
});
