import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;

const enviar = async (token: string, name: string, content: string): Promise<string> => {
  const m = multipart([{ name, content }]);
  const r = await app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": token } });
  return r.json()[0].id;
};
const status = (ids: string[], token?: string) =>
  app.server.inject({ method: "GET", url: `/api/upload/status?ids=${ids.join(",")}`, headers: token ? { "x-upload-key": token } : {} });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-status-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/upload/status: o monitor confere se o envio virou luta", () => {
  it("Dado um envio pronto e outro com erro, quando consulta pelos ids, então devolve o status de cada um e o código do erro", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const bom = await enviar(ana.token, "bom.json", JSON.stringify(wvwFixture()));
    const ruim = await enviar(ana.token, "ruim.json", "{isto não é json");
    await app.worker.idle();

    const res = await status([bom, ruim], ana.token);

    expect(res.statusCode).toBe(200);
    const porId = Object.fromEntries(res.json().map((r: { id: string }) => [r.id, r]));
    expect(porId[bom]).toMatchObject({ status: "done" });
    expect(porId[ruim]).toMatchObject({ status: "error" });
    expect(porId[ruim].error).toEqual(expect.any(String));
  });

  it("Dado o id de outro usuário ou um id que não existe, então ele não aparece (o monitor trata como não encontrado)", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const bia = criarUsuario(app, "2", "bia");
    const deAna = await enviar(ana.token, "a.json", JSON.stringify(wvwFixture()));
    await app.worker.idle();

    const res = await status([deAna, "nao-existe"], bia.token);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("Dado um envio ainda na fila, então o status é queued, e ids vazio devolve lista vazia", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = await enviar(ana.token, "a.json", JSON.stringify(wvwFixture()));
    await app.worker.idle();
    app.db.prepare("UPDATE fights SET status = 'queued' WHERE id = ?").run(id);

    expect((await status([id], ana.token)).json()).toMatchObject([{ id, status: "queued" }]);
    expect((await status([], ana.token)).json()).toEqual([]);
  });

  it("Exatamente 100 ids passam, e ids repetido na query (?ids=a&ids=b) não derruba a rota", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = await enviar(ana.token, "a.json", JSON.stringify(wvwFixture()));
    await app.worker.idle();

    expect((await status(Array.from({ length: 100 }, (_, i) => `id${i}`), ana.token)).statusCode).toBe(200);
    const repetido = await app.server.inject({ method: "GET", url: `/api/upload/status?ids=${id}&ids=outro`, headers: { "x-upload-key": ana.token } });
    expect(repetido.statusCode).toBe(200);
    expect(repetido.json()).toMatchObject([{ id, status: "done" }]);
  });

  it("Sem token a consulta é recusada", async () => {
    const res = await status(["x"]);

    expect(res.statusCode).toBe(401);
  });

  it("Mais de 100 ids de uma vez é recusado", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await status(Array.from({ length: 101 }, (_, i) => `id${i}`), ana.token);

    expect(res.statusCode).toBe(400);
  });
});
