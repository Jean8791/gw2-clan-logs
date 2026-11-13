import { describe, expect, it } from "vitest";
import { parseHiddenColumns, visibleColumns } from "@gw2logs/shared";

const cols = [{ id: "player", fixed: true }, { id: "damage" }, { id: "kills" }, { id: "cc" }];
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe("visibleColumns: colunas que a pessoa escolheu ver", () => {
  it("tira as colunas ocultas e mantém a ordem das outras", () => {
    expect(ids(visibleColumns(cols, ["kills"]))).toEqual(["player", "damage", "cc"]);
  });

  it("sem nenhuma oculta, mostra todas", () => {
    expect(ids(visibleColumns(cols, []))).toEqual(["player", "damage", "kills", "cc"]);
  });

  it("coluna fixa não some, mesmo marcada como oculta", () => {
    expect(ids(visibleColumns(cols, ["player", "damage"]))).toEqual(["player", "kills", "cc"]);
  });

  it("id oculto que não existe mais (coluna removida) é ignorado", () => {
    expect(ids(visibleColumns(cols, ["nao-existe"]))).toEqual(["player", "damage", "kills", "cc"]);
  });

  it("ocultar tudo que dá deixa só as fixas", () => {
    expect(ids(visibleColumns(cols, ["damage", "kills", "cc"]))).toEqual(["player"]);
  });
});

describe("parseHiddenColumns: lê o que está guardado no navegador", () => {
  it("lê uma lista de ids", () => {
    expect(parseHiddenColumns('["kills","cc"]')).toEqual(["kills", "cc"]);
  });

  it.each([null, "", "isso não é json", "{}", '"texto"', "123", "null"])("valor inválido %j não oculta nada", (raw) => {
    expect(parseHiddenColumns(raw)).toEqual([]);
  });

  it("descarta o que não é texto e repetidos", () => {
    expect(parseHiddenColumns('["kills", 5, null, {"a":1}, "kills", "cc"]')).toEqual(["kills", "cc"]);
  });

  it("limita o tamanho: texto muito longo e lista enorme (valor adulterado)", () => {
    const longo = "x".repeat(200);
    const enorme = JSON.stringify(Array.from({ length: 1000 }, (_, i) => `c${i}`));

    expect(parseHiddenColumns(JSON.stringify([longo, "ok"]))).toEqual(["ok"]);
    expect(parseHiddenColumns(enorme).length).toBe(100);
  });
});
