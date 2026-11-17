import { describe, expect, it } from "vitest";
import { sendInOrder, type ItemState, type UploadResult } from "@gw2logs/shared";

/** Roda a fila com respostas combinadas e devolve o estado final de cada arquivo e as esperas pedidas. */
async function rodar(respostas: (UploadResult | { status: number; code?: string })[][], opts: { stopAfter?: number } = {}) {
  const itens = respostas.map((_, i) => `a${i}.zevtc`);
  const fila = respostas.map((r) => [...r]);
  const estados: ItemState[] = itens.map(() => ({ kind: "pending" }));
  const esperas: number[] = [];
  let enviados = 0;
  await sendInOrder(itens, {
    send: async (item) => {
      enviados++;
      const r = fila[itens.indexOf(item)]!.shift()!;
      if ("status" in r && typeof r.status === "number" && !("file" in r)) throw r;
      return r as UploadResult;
    },
    wait: async (ms) => void esperas.push(ms),
    shouldStop: () => opts.stopAfter !== undefined && enviados >= opts.stopAfter,
    onState: (i, s) => (estados[i] = s),
  });
  return { estados, esperas, enviados };
}

const ok = (n: number): UploadResult => ({ file: `a${n}.zevtc`, id: `id${n}`, status: "queued" });
const recusa = (n: number, code: string): UploadResult => ({ file: `a${n}.zevtc`, error: "x", code });

describe("sendInOrder: envio em fila sem sufocar o servidor", () => {
  it("manda um arquivo por vez, na ordem", async () => {
    const r = await rodar([[ok(0)], [ok(1)], [ok(2)]]);

    expect(r.estados.map((e) => e.kind)).toEqual(["done", "done", "done"]);
    expect(r.enviados).toBe(3);
  });

  it("fila cheia: espera e tenta o mesmo arquivo de novo", async () => {
    const r = await rodar([[recusa(0, "queueFull"), recusa(0, "queueFull"), ok(0)], [ok(1)]]);

    expect(r.estados.map((e) => e.kind)).toEqual(["done", "done"]);
    expect(r.esperas).toHaveLength(2);
    expect(r.esperas.every((ms) => ms >= 10_000)).toBe(true);
  });

  it("fila que não esvazia: desiste depois de esperar e não manda o resto", async () => {
    const sempreCheia = Array.from({ length: 100 }, () => recusa(0, "queueFull"));
    const r = await rodar([sempreCheia, [ok(1)]]);

    expect(r.estados[0]).toMatchObject({ kind: "error", code: "queueFull" });
    expect(r.estados[1]).toMatchObject({ kind: "skipped", code: "queueFull" });
    expect(r.esperas.length).toBeLessThan(100);
  });

  it.each(["hourlyLimit", "diskFull"])("%s: para tudo, sem insistir", async (code) => {
    const r = await rodar([[ok(0)], [recusa(1, code)], [ok(2)]]);

    expect(r.estados.map((e) => e.kind)).toEqual(["done", "error", "skipped"]);
    expect(r.estados[2]).toMatchObject({ code });
    expect(r.enviados).toBe(2);
    expect(r.esperas).toEqual([]);
  });

  it("formato inválido ou arquivo grande só pula aquele arquivo", async () => {
    const r = await rodar([[recusa(0, "badFormat")], [ok(1)]]);

    expect(r.estados.map((e) => e.kind)).toEqual(["error", "done"]);
  });

  it("duplicado conta como enviado", async () => {
    const r = await rodar([[{ file: "a0.zevtc", id: "x", status: "done", duplicate: true }]]);

    expect(r.estados[0]).toMatchObject({ kind: "done" });
  });

  it.each([
    [401, "uploadKey"],
    [429, "tooManyAttempts"],
    [0, "network"],
  ])("HTTP %i: para tudo (sessão expirada, bloqueio ou rede fora)", async (status, code) => {
    const r = await rodar([[ok(0)], [{ status, code }], [ok(2)]]);

    expect(r.estados.map((e) => e.kind)).toEqual(["done", "error", "skipped"]);
    expect(r.estados[2]).toMatchObject({ code });
    expect(r.enviados).toBe(2);
  });

  it("o usuário pode parar: o que não foi enviado fica como parado", async () => {
    const r = await rodar([[ok(0)], [ok(1)], [ok(2)]], { stopAfter: 1 });

    expect(r.estados.map((e) => e.kind)).toEqual(["done", "skipped", "skipped"]);
    expect(r.estados[1]).toMatchObject({ code: "stopped" });
  });
});
