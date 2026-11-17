import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;

const DISCORD = { DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", PUBLIC_URL: "https://logs.exemplo.test" };

/** Discord de mentira: troca o code por um token e devolve o perfil. */
const discordFalso = ((url: string | URL) => {
  const u = String(url);
  const corpo = u.endsWith("/oauth2/token") ? { access_token: "tok-discord" } : { id: "777", username: "fulano", avatar: "abc" };
  return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } }));
}) as unknown as typeof fetch;

async function start(env: Record<string, string> = {}) {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }), { fetch: discordFalso });
}
const enviar = (token: string | null, nome = "luta.json", json = JSON.stringify(wvwFixture())) => {
  const m = multipart([{ name: nome, content: json }]);
  return app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, ...(token ? { "x-upload-key": token } : {}) } });
};
const cookieDe = (res: { headers: Record<string, unknown> }, nome: string) =>
  [res.headers["set-cookie"]].flat().map(String).find((c) => c.startsWith(nome + "="));

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-usr-"));
  await start();
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("cada usuário vê só os próprios logs", () => {
  it("o envio exige o token pessoal e o log fica com o dono", async () => {
    const ana = criarUsuario(app, "1", "ana");
    expect((await enviar(null)).statusCode).toBe(401);
    expect((await enviar("token-inventado")).statusCode).toBe(401);

    const res = await enviar(ana.token);
    expect(res.statusCode).toBe(200);
    await app.worker.idle();

    const lutas = (await app.server.inject(`/api/u/${ana.publicId}/fights`)).json();
    expect(lutas).toHaveLength(1);
    expect(lutas[0].status).toBe("done");
  });

  it("outro usuário não vê lutas, ranking, jogadores nem relatório do primeiro", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    const id = (await enviar(ana.token)).json()[0].id;
    await app.worker.idle();
    const doBeto = (rota: string) => app.server.inject(`/api/u/${beto.publicId}${rota}`);

    expect((await doBeto("/fights")).json()).toEqual([]);
    expect((await doBeto(`/fights/${id}`)).statusCode).toBe(404);
    expect((await doBeto(`/fights/${id}/report`)).statusCode).toBe(404);
    expect((await doBeto("/ranking")).json().rows).toEqual([]);
    expect((await doBeto("/players/Atacante.2222")).statusCode).toBe(404);
    expect((await doBeto("/overview")).json().fights).toBe(0);
    expect((await doBeto("/days")).json()).toEqual([]);
    expect((await doBeto("/guilds")).json()).toEqual([]);
    const meta = (await doBeto("/meta")).json();
    expect(meta.players).toEqual([]);
    expect(meta.maps).toEqual([]);

    expect((await app.server.inject(`/api/u/${ana.publicId}/fights/${id}`)).statusCode).toBe(200);
    expect((await app.server.inject(`/api/u/${ana.publicId}/ranking`)).json().rows.length).toBeGreaterThan(0);
  });

  it("espaço de usuário que não existe dá 404", async () => {
    expect((await app.server.inject("/api/u/naoexiste/fights")).statusCode).toBe(404);
  });

  it("as rotas sem dono deixaram de existir (nada de visão geral misturada)", async () => {
    expect((await app.server.inject("/api/fights")).statusCode).toBe(404);
    expect((await app.server.inject("/api/ranking")).statusCode).toBe(404);
  });

  it("o id público não é o id do Discord", async () => {
    const ana = criarUsuario(app, "1234567890", "ana");
    expect(ana.publicId).not.toContain("1234567890");
    expect(ana.publicId).toMatch(/^[\w-]{12}$/);
  });
});

describe("logs que já existiam antes do login", () => {
  it("ficam com o primeiro usuário a entrar, e só com ele", async () => {
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('antigo', 'sha-antigo', 'queued', ?)").run(new Date().toISOString());
    const primeiro = criarUsuario(app, "1", "ana");
    const segundo = criarUsuario(app, "2", "beto");

    const dono = (app.db.prepare("SELECT owner_id AS o FROM fights WHERE id = 'antigo'").get() as { o: number }).o;
    expect(dono).toBe(primeiro.id);
    expect(dono).not.toBe(segundo.id);
  });
});

describe("login com o Discord", () => {
  beforeEach(async () => {
    await app.server.close();
    await start(DISCORD);
  });

  it("sem as chaves do Discord configuradas o login não existe", async () => {
    await app.server.close();
    await start();
    expect((await app.server.inject("/api/auth/login")).statusCode).toBe(503);
  });

  it("manda para o Discord com um state; o retorno cria o usuário e a sessão", async () => {
    const ida = await app.server.inject("/api/auth/login");
    expect(ida.statusCode).toBe(302);
    const destino = new URL(String(ida.headers.location));
    expect(destino.origin + destino.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(destino.searchParams.get("client_id")).toBe("cid");
    expect(destino.searchParams.get("redirect_uri")).toBe("https://logs.exemplo.test/api/auth/callback");
    const state = destino.searchParams.get("state")!;
    const cookieState = cookieDe(ida, "oauth_state")!;
    expect(cookieState).toMatch(/HttpOnly/i);

    const volta = await app.server.inject({
      url: `/api/auth/callback?code=abc&state=${state}`,
      headers: { cookie: cookieState.split(";")[0]! },
    });
    expect(volta.statusCode).toBe(302);
    const user = app.db.prepare("SELECT public_id AS p, name FROM users WHERE discord_id = '777'").get() as { p: string; name: string };
    expect(user.name).toBe("fulano");
    expect(volta.headers.location).toBe(`/u/${user.p}`);

    const sessao = cookieDe(volta, "session")!;
    expect(sessao).toMatch(/HttpOnly/i);
    expect(sessao).toMatch(/SameSite=Lax/i);
    expect(sessao).toMatch(/Secure/i);

    const me = await app.server.inject({ url: "/api/auth/me", headers: { cookie: sessao.split(";")[0]! } });
    expect(me.json()).toMatchObject({ publicId: user.p, name: "fulano" });
    expect(JSON.stringify(me.json())).not.toContain("777");
  });

  it("recusa o retorno com state errado ou ausente", async () => {
    const ida = await app.server.inject("/api/auth/login");
    const cookieState = cookieDe(ida, "oauth_state")!.split(";")[0]!;
    expect((await app.server.inject({ url: "/api/auth/callback?code=abc&state=outro", headers: { cookie: cookieState } })).statusCode).toBe(400);
    expect((await app.server.inject("/api/auth/callback?code=abc&state=outro")).statusCode).toBe(400);
  });

  it("sair apaga a sessão", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createWebSession(ana.id)}`;
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.server.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("o usuário logado gera o token pessoal, que envia logs; o token antigo deixa de valer", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createWebSession(ana.id)}`;
    expect((await app.server.inject({ method: "POST", url: "/api/auth/token" })).statusCode).toBe(401);

    const novo = (await app.server.inject({ method: "POST", url: "/api/auth/token", headers: { cookie } })).json().token as string;
    expect((await enviar(novo)).statusCode).toBe(200);
    expect((await enviar(ana.token, "outra.json", JSON.stringify({ ...wvwFixture(), fightName: "Outra" }))).statusCode).toBe(401);
  });

  it("o envio também vale com a sessão do navegador", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const m = multipart([{ name: "luta.json", content: JSON.stringify(wvwFixture()) }]);
    const res = await app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, cookie: `session=${createWebSession(ana.id)}` } });
    expect(res.statusCode).toBe(200);
  });
});

const createWebSession = (userId: number) => createSession(app.db, userId, "web");

describe("dono do espaço", () => {
  it("o link mostra o nome do dono, sem login e sem expor o id do Discord", async () => {
    const ana = criarUsuario(app, "987654321", "ana");

    const res = await app.server.inject(`/api/u/${ana.publicId}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicId: ana.publicId, name: "ana", avatar: null });
    expect(res.body).not.toContain("987654321");
  });
});
