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

async function iniciar(env: Record<string, string> = {}) {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }));
  app.db.prepare("INSERT INTO guilds (id) VALUES ('G1')").run();
}
const cookieDe = (userId: number) => `session=${createSession(app.db, userId, "web")}`;
const marcar = (headers: Record<string, string> = {}) => app.server.inject({ method: "PUT", url: "/api/guilds/G1", payload: { inAlliance: true }, headers });
const naAlianca = () => (app.db.prepare("SELECT in_alliance AS v FROM guilds WHERE id = 'G1'").get() as { v: number }).v === 1;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-admin-"));
});
afterEach(async () => {
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("administração pelo login (ADMIN_DISCORD_IDS)", () => {
  it("admin pelo ID do Discord marca a guilda com a sessão do navegador", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10, 20" });
    const ana = criarUsuario(app, "20", "ana");

    const res = await marcar({ cookie: cookieDe(ana.id) });

    expect(res.statusCode).toBe(200);
    expect(naAlianca()).toBe(true);
  });

  it("usuário logado que não é admin recebe 403 e nada muda", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10" });
    const beto = criarUsuario(app, "2", "beto");

    const res = await marcar({ cookie: cookieDe(beto.id) });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("notAdmin");
    expect(naAlianca()).toBe(false);
  });

  it("sem login recebe 401", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10" });

    const res = await marcar();

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("notSignedIn");
    expect(naAlianca()).toBe(false);
  });

  it("o token de envio de um admin não vale como administração (só a sessão do navegador)", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10" });
    const ana = criarUsuario(app, "10", "ana");

    expect((await marcar({ "x-upload-key": ana.token })).statusCode).toBe(401);
    expect(naAlianca()).toBe(false);
  });

  it("admin que saiu de DISCORD_USER_IDS perde a administração junto com a sessão", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10", DISCORD_USER_IDS: "99" });
    const ana = criarUsuario(app, "10", "ana");

    expect((await marcar({ cookie: cookieDe(ana.id) })).statusCode).toBe(401);
  });

  it("admin pelo login não conta nem é barrado pelo limite de senhas erradas", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10", ADMIN_KEY: "chave", UPLOAD_MAX_FAILS: "2" });
    const ana = criarUsuario(app, "10", "ana");
    await marcar({ "x-upload-key": "errada" });
    await marcar({ "x-upload-key": "errada" });

    expect((await marcar({ cookie: cookieDe(ana.id) })).statusCode).toBe(200);
  });
});

describe("ADMIN_KEY continua valendo por cabeçalho (script)", () => {
  it("a chave certa marca a guilda, mesmo sem login", async () => {
    await iniciar({ ADMIN_KEY: "chave" });

    expect((await marcar({ "x-upload-key": "chave" })).statusCode).toBe(200);
    expect(naAlianca()).toBe(true);
  });

  it("a chave certa também vale junto com ADMIN_DISCORD_IDS", async () => {
    await iniciar({ ADMIN_KEY: "chave", ADMIN_DISCORD_IDS: "10" });

    expect((await marcar({ "x-upload-key": "chave" })).statusCode).toBe(200);
  });

  it("chave errada é 401 adminKey e conta nas tentativas (depois, 429)", async () => {
    await iniciar({ ADMIN_KEY: "chave", UPLOAD_MAX_FAILS: "2" });

    const errada = await marcar({ "x-upload-key": "errada" });
    await marcar({ "x-upload-key": "errada" });

    expect(errada.statusCode).toBe(401);
    expect(errada.json().code).toBe("adminKey");
    expect((await marcar({ "x-upload-key": "chave" })).statusCode).toBe(429);
  });

  it("sem ADMIN_KEY e sem ADMIN_DISCORD_IDS a administração fica desligada, nunca aberta", async () => {
    await iniciar();
    const ana = criarUsuario(app, "10", "ana");

    const cenas: Record<string, string>[] = [{}, { "x-upload-key": "" }, { cookie: cookieDe(ana.id) }];
    for (const headers of cenas) {
      const res = await marcar(headers);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("adminDisabled");
    }
    expect(naAlianca()).toBe(false);
  });
});

describe("/api/auth/me e /api/config", () => {
  it("devolve isAdmin e nunca o ID do Discord", async () => {
    await iniciar({ ADMIN_DISCORD_IDS: "10" });
    const ana = criarUsuario(app, "10", "ana");
    const beto = criarUsuario(app, "2", "beto");

    const deAna = (await app.server.inject({ url: "/api/auth/me", headers: { cookie: cookieDe(ana.id) } })).json();
    const deBeto = (await app.server.inject({ url: "/api/auth/me", headers: { cookie: cookieDe(beto.id) } })).json();

    expect(deAna.isAdmin).toBe(true);
    expect(deBeto.isAdmin).toBe(false);
    expect(Object.keys(deAna).sort()).toEqual(["avatar", "isAdmin", "name", "publicId"]);
    expect(JSON.stringify(deAna)).not.toContain('"10"');
  });

  it("o /api/config não conta mais se há senha de administrador", async () => {
    await iniciar({ ADMIN_KEY: "chave" });

    expect((await app.server.inject("/api/config")).json()).not.toHaveProperty("adminKeyRequired");
  });
});
