import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-link-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), PUBLIC_URL: "https://logs.exemplo.test" }));
});
afterEach(async () => {
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieDe = (userId: number) => `session=${createSession(app.db, userId, "web")}`;
const trocar = (headers: Record<string, string> = {}) => app.server.inject({ method: "POST", url: "/api/auth/share-link/rotate", headers });
const lutas = (publicId: string) => app.server.inject(`/api/u/${publicId}/fights`);
const luta = (id: string, ownerId: number) =>
  app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, ?, 'done', ?, ?)").run(id, "sha-" + id, new Date().toISOString(), ownerId);

describe("trocar o link de compartilhar", () => {
  it("o link novo funciona (com as lutas de antes) e o antigo passa a dar 404", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta("f1", ana.id);

    const res = await trocar({ cookie: cookieDe(ana.id) });

    expect(res.statusCode).toBe(200);
    const novo = res.json().publicId as string;
    expect(novo).not.toBe(ana.publicId);
    expect(Object.keys(res.json())).toEqual(["publicId"]);
    expect((await lutas(novo)).json().map((f: { id: string }) => f.id)).toEqual(["f1"]);
    expect((await lutas(ana.publicId)).statusCode).toBe(404);
    expect((await app.server.inject(`/api/u/${ana.publicId}`)).statusCode).toBe(404);
    expect((await app.server.inject(`/api/u/${novo}`)).json()).toMatchObject({ publicId: novo, name: "ana" });
  });

  it("cada troca gera um link diferente e só o último vale", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = cookieDe(ana.id);

    const primeiro = (await trocar({ cookie })).json().publicId as string;
    const segundo = (await trocar({ cookie })).json().publicId as string;

    expect(new Set([ana.publicId, primeiro, segundo]).size).toBe(3);
    expect((await lutas(primeiro)).statusCode).toBe(404);
    expect((await lutas(segundo)).statusCode).toBe(200);
  });

  it("a sessão de quem trocou continua valendo e o /api/auth/me já devolve o link novo", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = cookieDe(ana.id);

    const novo = (await trocar({ cookie })).json().publicId as string;

    const me = await app.server.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().publicId).toBe(novo);
  });
});

describe("só o próprio dono, pela sessão do navegador, consegue trocar", () => {
  it("sem sessão: 401 notSignedIn e o link continua o mesmo", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await trocar();

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("notSignedIn");
    expect((await lutas(ana.publicId)).statusCode).toBe(200);
  });

  it("com o token de envio (script), mesmo válido: 401, o link não muda", async () => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await trocar({ "x-upload-key": ana.token })).statusCode).toBe(401);
    expect((await lutas(ana.publicId)).statusCode).toBe(200);
  });

  it("trocar o seu link não mexe no de outra pessoa", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");

    await trocar({ cookie: cookieDe(ana.id) });

    expect((await lutas(beto.publicId)).statusCode).toBe(200);
    expect(app.db.prepare("SELECT public_id AS p FROM users WHERE id = ?").get(beto.id)).toEqual({ p: beto.publicId });
  });

  it("pedido vindo de outro site é recusado e o link não muda", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await trocar({ cookie: cookieDe(ana.id), origin: "https://evil.example" });

    expect(res.statusCode).toBe(403);
    expect((await lutas(ana.publicId)).statusCode).toBe(200);
  });
});
