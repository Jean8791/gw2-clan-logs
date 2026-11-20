import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";
import { readLogsFromZip, ZipError } from "@gw2logs/shared";

const zip = (files: Zippable) => zipSync(files);
const nomes = (r: ReturnType<typeof readLogsFromZip>) => r.logs.map((l) => l.name).sort();
const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe("readLogsFromZip: abrir o zip de logs no navegador", () => {
  it("pega só os logs, em qualquer pasta, pelo nome do arquivo, e ignora o resto", () => {
    const conteudo = strToU8("log de teste");
    const r = readLogsFromZip(
      zip({
        "dia1/mapa-a/20260101-100000.zevtc": conteudo,
        "dia2/b.evtc": strToU8("b"),
        "c.json": strToU8("{}"),
        "leia-me.txt": strToU8("não é log"),
        "dia2/anotacoes.md": strToU8("x"),
        "__MACOSX/dia1/._a.zevtc": strToU8("lixo do macOS"),
        "dentro.zip": zip({ "x.zevtc": strToU8("zip dentro de zip não é aberto") }),
        "pasta/": new Uint8Array(0),
      }),
    );

    expect(nomes(r)).toEqual(["20260101-100000.zevtc", "b.evtc", "c.json"]);
    expect(r.logs.find((l) => l.name === "20260101-100000.zevtc")!.data).toEqual(conteudo);
    expect(r.tooBig).toEqual([]);
  });

  it("não liga para maiúsculas na extensão", () => {
    expect(nomes(readLogsFromZip(zip({ "A.ZEVTC": strToU8("a"), "B.Json": strToU8("{}") })))).toEqual(["A.ZEVTC", "B.Json"]);
  });

  it("zip válido sem nenhum log devolve lista vazia, para a tela avisar", () => {
    const r = readLogsFromZip(zip({ "leia-me.txt": strToU8("x"), "foto.png": strToU8("y") }));

    expect(r).toEqual({ logs: [], tooBig: [] });
  });

  it("zip corrompido ou que nem é zip dá erro zipInvalid", () => {
    const inteiro = zip({ "a.zevtc": strToU8("a".repeat(5000)) });

    expect(erro(() => readLogsFromZip(inteiro.slice(0, inteiro.length / 2)))).toMatchObject({ name: "ZipError", code: "zipInvalid" });
    expect(erro(() => readLogsFromZip(strToU8("isto não é um zip, só texto qualquer")))).toBeInstanceOf(ZipError);
  });

  it("arquivo acima do limite por log não é aberto: aparece em tooBig e os outros entram", () => {
    const r = readLogsFromZip(zip({ "grande.zevtc": new Uint8Array(2_000_000), "ok.zevtc": strToU8("ok") }), { maxFileBytes: 1_000_000 });

    expect(r.tooBig).toEqual(["grande.zevtc"]);
    expect(nomes(r)).toEqual(["ok.zevtc"]);
  });

  it("zip acima do tamanho máximo é recusado antes de abrir (zipTooBig)", () => {
    const e = erro(() => readLogsFromZip(zip({ "a.zevtc": strToU8("a".repeat(1000)) }), { maxZipBytes: 100 }));

    expect(e).toMatchObject({ name: "ZipError", code: "zipTooBig" });
  });

  it("zip que expandiria demais (muito comprimido) é recusado, sem encher a memória", () => {
    const comprimido = zip({ "a.zevtc": new Uint8Array(900_000), "b.zevtc": new Uint8Array(900_000) });

    expect(comprimido.length).toBeLessThan(10_000);
    expect(erro(() => readLogsFromZip(comprimido, { maxTotalBytes: 1_000_000 }))).toMatchObject({ code: "zipTooBig" });
  });
});
