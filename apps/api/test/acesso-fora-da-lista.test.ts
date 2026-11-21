import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, giveDeadlineToApiTokens, revokeAccessOutsideList, upsertDiscordUser, userFromToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

const DIA = 86_400_000;
const SEM_REGRAS = { userIds: [], guildIds: [] };

let app: App;
let dir: string;

async function iniciar(env: Record<string, string> = {}) {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), PUBLIC_URL: "https://logs.exemplo.test", ...env }));
}
const enviar = (token: string) => {
  const m = multipart([{ name: "luta.json", content: JSON.stringify(wvwFixture()) }]);
  return app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": token } });
};
const me = (cookie: string) => app.server.inject({ url: "/api/auth/me", headers: { cookie } });
const sessoes = (kind?: string) => (app.db.prepare(`SELECT COUNT(*) AS n FROM sessions ${kind ? "WHERE kind = ?" : ""}`).get(...(kind ? [kind] : [])) as { n: number }).n;
const expiraEm = () => (app.db.prepare("SELECT expires_at AS e FROM sessions WHERE kind = 'api' ORDER BY created_at DESC LIMIT 1").get() as { e: string | null }).e;
const verificadoHa = (userId: number, dias: number) => app.db.prepare("UPDATE users SET verified_at = ? WHERE id = ?").run(new Date(Date.now() - dias * DIA).toISOString(), userId);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-lista-"));
  await iniciar();
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("quem saiu da lista de usuários perde o acesso", () => {
  it("na subida: apaga as sessões (web e api) de quem não está em DISCORD_USER_IDS e diz quantas foram", () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    createSession(app.db, beto.id, "web");
    createSession(app.db, ana.id, "web");

    const apagadas = revokeAccessOutsideList(app.db, ["1"]);

    expect(apagadas).toBe(2); // o token de API e a sessão web do beto
    expect(sessoes()).toBe(2); // sobram as da ana
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 2 }); // a conta e as lutas ficam
  });

  it("lista vazia não apaga nada", () => {
    criarUsuario(app, "1", "ana");

    expect(revokeAccessOutsideList(app.db, [])).toBe(0);
    expect(sessoes()).toBe(1);
  });

  it("token válido de quem não está na lista é tratado como não autenticado (envio e navegador)", async () => {
    await app.server.close();
    await iniciar({ DISCORD_USER_IDS: "1" });
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    const cookieBeto = `session=${createSession(app.db, beto.id, "web")}`;
    const cookieAna = `session=${createSession(app.db, ana.id, "web")}`;

    expect((await enviar(beto.token)).statusCode).toBe(401);
    expect((await me(cookieBeto)).statusCode).toBe(401);
    expect((await enviar(ana.token)).statusCode).toBe(200);
    expect((await me(cookieAna)).statusCode).toBe(200);
  });

  it("sem lista, o token continua valendo para todos", async () => {
    const beto = criarUsuario(app, "2", "beto");

    expect((await enviar(beto.token)).statusCode).toBe(200);
  });
});

describe("o token de API expira", () => {
  it("vale API_TOKEN_DAYS (padrão 90) a partir de quando foi gerado", () => {
    const ana = upsertDiscordUser(app.db, { id: "1", username: "ana", avatar: null });
    const agora = new Date("2026-01-01T00:00:00Z");
    const token = createSession(app.db, ana.id, "api", agora);

    expect(userFromToken(app.db, token, "api", SEM_REGRAS, new Date(agora.getTime() + 89 * DIA))?.id).toBe(ana.id);
    expect(userFromToken(app.db, token, "api", SEM_REGRAS, new Date(agora.getTime() + 91 * DIA))).toBeNull();
  });

  it("API_TOKEN_DAYS muda o prazo", async () => {
    await app.server.close();
    await iniciar({ API_TOKEN_DAYS: "7" });
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const res = await app.server.inject({ method: "POST", url: "/api/auth/token", headers: { cookie } });

    const dias = (Date.parse(res.json().expiresAt) - Date.now()) / DIA;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
  });

  it("gerar o token devolve a data de validade, igual à guardada no banco", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const res = await app.server.inject({ method: "POST", url: "/api/auth/token", headers: { cookie } });

    expect(res.json().token).toEqual(expect.any(String));
    expect(res.json().expiresAt).toBe(expiraEm());
  });

  it("o envio com o token vencido recebe 401", async () => {
    const ana = criarUsuario(app, "1", "ana");
    app.db.prepare("UPDATE sessions SET expires_at = ? WHERE kind = 'api'").run(new Date(Date.now() - 1000).toISOString());

    expect((await enviar(ana.token)).statusCode).toBe(401);
  });

  it("token antigo, que nunca expirava, ganha prazo novo a partir da subida", () => {
    criarUsuario(app, "1", "ana");
    app.db.prepare("UPDATE sessions SET expires_at = NULL WHERE kind = 'api'").run();
    const agora = new Date("2026-01-01T00:00:00Z");

    expect(giveDeadlineToApiTokens(app.db, 90, agora)).toBe(1);

    expect(expiraEm()).toBe(new Date(agora.getTime() + 90 * DIA).toISOString());
    expect(giveDeadlineToApiTokens(app.db, 90, agora)).toBe(0); // não mexe de novo em quem já tem prazo
  });
});

describe("DISCORD_GUILD_IDS: a conferência no Discord vence depois de 7 dias", () => {
  beforeEach(async () => {
    await app.server.close();
    await iniciar({ DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", DISCORD_GUILD_IDS: "111" });
  });

  it("sessão web com a verificação de 8 dias deixa de valer e a resposta pede novo login", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    verificadoHa(ana.id, 8);

    const res = await me(cookie);

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("loginExpired");
  });

  it("com a verificação de 6 dias a sessão continua valendo", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    verificadoHa(ana.id, 6);

    expect((await me(cookie)).statusCode).toBe(200);
  });

  it("entrar de novo (o login confere o Discord) renova a verificação", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    verificadoHa(ana.id, 8);

    upsertDiscordUser(app.db, { id: "1", username: "ana", avatar: null });

    expect((await me(cookie)).statusCode).toBe(200);
  });

  it("sem verificação registrada, a sessão web também vence", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    app.db.prepare("UPDATE users SET verified_at = NULL WHERE id = ?").run(ana.id);

    expect((await me(cookie)).json().code).toBe("loginExpired");
  });

  it("sem DISCORD_GUILD_IDS a verificação antiga não importa", async () => {
    await app.server.close();
    await iniciar();
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    verificadoHa(ana.id, 400);

    expect((await me(cookie)).statusCode).toBe(200);
  });

  it("quem nunca teve sessão recebe notSignedIn, não loginExpired", async () => {
    expect((await app.server.inject("/api/auth/me")).json().code).toBe("notSignedIn");
  });
});
