import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";

/** Login completo (login, Discord de mentira, callback) com vários usuários na mesma instância, como na vida real. */
let app: App;
let dir: string;
const DISCORD = { DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", PUBLIC_URL: "https://logs.exemplo.test" };

/** Quem está logado no Discord neste momento e em quais servidores ele está. */
let quem = { id: "111", username: "ana", servidores: [] as string[] };
const discord = ((url: string | URL) => {
  const u = String(url);
  if (u.endsWith("/oauth2/token")) return Promise.resolve(Response.json({ access_token: "tok" }));
  if (u.endsWith("/users/@me/guilds")) return Promise.resolve(Response.json(quem.servidores.map((id) => ({ id }))));
  return Promise.resolve(Response.json({ id: quem.id, username: quem.username, avatar: null }));
}) as unknown as typeof fetch;

/** Linhas de log do servidor (JSON), para conferir o que o administrador vê em `docker compose logs app`. */
let logs: string[] = [];
async function iniciar(env: Record<string, string>) {
  if (app) await app.server.close();
  logs = [];
  const stream = { write: (linha: string) => void logs.push(linha) };
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...DISCORD, ...env }), { fetch: discord, logger: { level: "info", stream } });
}
const loginsNegados = () => logs.map((l) => JSON.parse(l)).filter((l) => l.msg === "login negado");
const cookieDe = (res: { headers: Record<string, unknown> }, nome: string) => [res.headers["set-cookie"]].flat().map(String).find((c) => c.startsWith(nome + "="));

/** Entra como `id` e devolve o redirecionamento, o cookie da sessão (se houve) e o que `/api/auth/me` diz com ele. */
async function entrar(id: string, username = "u" + id, servidores: string[] = []) {
  quem = { id, username, servidores };
  const ida = await app.server.inject("/api/auth/login");
  const state = new URL(String(ida.headers.location)).searchParams.get("state");
  const volta = await app.server.inject({ url: `/api/auth/callback?code=abc&state=${state}`, headers: { cookie: cookieDe(ida, "oauth_state")!.split(";")[0]! } });
  const cookie = cookieDe(volta, "session")?.split(";")[0];
  const me = cookie ? await app.server.inject({ url: "/api/auth/me", headers: { cookie } }) : null;
  return { destino: String(volta.headers.location), status: volta.statusCode, cookie, me: me?.statusCode ?? null, publicId: me?.statusCode === 200 ? me.json().publicId : null };
}
const usuarios = () => (app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-login-"));
  app = undefined as unknown as App;
});
afterEach(async () => {
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("vários usuários liberados em DISCORD_USER_IDS", () => {
  it("os dois liberados entram, cada um com a sua sessão e o seu espaço; quem não está na lista recebe notAllowed e nada é criado", async () => {
    await iniciar({ DISCORD_USER_IDS: "111,222" });

    const ana = await entrar("111", "ana");
    const beto = await entrar("222", "beto");
    const carlos = await entrar("333", "carlos");

    expect(ana.me).toBe(200);
    expect(beto.me).toBe(200);
    expect(ana.publicId).not.toBe(beto.publicId);
    expect(ana.destino).toBe(`/u/${ana.publicId}/import`); // sem lutas ainda: vai direto para a importação
    expect(carlos).toMatchObject({ destino: "/?erro=notAllowed", cookie: undefined, me: null });
    expect(usuarios()).toBe(2); // o negado não vira usuário
  });

  it("a sessão de um não atrapalha a do outro, e entrar de novo devolve o mesmo espaço", async () => {
    await iniciar({ DISCORD_USER_IDS: "111,222" });
    const ana = await entrar("111", "ana");
    const beto = await entrar("222", "beto");

    const anaDeNovo = await entrar("111", "ana");

    expect(anaDeNovo.publicId).toBe(ana.publicId);
    expect(usuarios()).toBe(2);
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie: ana.cookie! } })).statusCode).toBe(200); // a sessão antiga continua valendo
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie: beto.cookie! } })).statusCode).toBe(200);
  });

  it("a lista aceita espaços, vírgulas sobrando e quebra de linha", async () => {
    await iniciar({ DISCORD_USER_IDS: " 111 , 222 ,, 333\n," });

    for (const id of ["111", "222", "333"]) expect((await entrar(id)).me).toBe(200);
    expect((await entrar("444")).destino).toBe("/?erro=notAllowed");
  });

  it("a lista editada no Windows (fim de linha \\r\\n) e com tabulação também funciona", async () => {
    await iniciar({ DISCORD_USER_IDS: "111\t,\t222\r\n" });

    expect((await entrar("111")).me).toBe(200);
    expect((await entrar("222")).me).toBe(200);
  });

  it("ID errado na lista (nome, ou o ID de um servidor no lugar do ID do usuário) barra a pessoa certa", async () => {
    await iniciar({ DISCORD_USER_IDS: "ana,999" });

    expect((await entrar("111", "ana")).destino).toBe("/?erro=notAllowed");
  });

  it("quem saiu da lista perde o acesso no próximo login e a sessão antiga cai junto", async () => {
    await iniciar({ DISCORD_USER_IDS: "111,222" });
    const beto = await entrar("222", "beto");
    await iniciar({ DISCORD_USER_IDS: "111" }); // o admin tirou o beto e reiniciou

    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie: beto.cookie! } })).statusCode).toBe(401); // a sessão dele já não vale
    expect((await entrar("222", "beto")).destino).toBe("/?erro=notAllowed");
    expect((await entrar("111", "ana")).me).toBe(200);
  });

  it("administrador por ADMIN_DISCORD_IDS que não está na lista também é barrado no login", async () => {
    await iniciar({ DISCORD_USER_IDS: "111", ADMIN_DISCORD_IDS: "999" });

    expect((await entrar("999", "admin")).destino).toBe("/?erro=notAllowed");
  });
});

describe("lista de usuários junto com a lista de servidores (precisa estar nas duas)", () => {
  beforeEach(() => iniciar({ DISCORD_USER_IDS: "111,222", DISCORD_GUILD_IDS: "S1" }));

  it("na lista e no servidor: entra", async () => {
    expect((await entrar("111", "ana", ["S1", "S9"])).me).toBe(200);
  });

  it("na lista, mas fora do servidor do clã: notInGuild (outra mensagem)", async () => {
    expect((await entrar("222", "beto", ["S9"])).destino).toBe("/?erro=notInGuild");
  });

  it("no servidor, mas fora da lista de usuários: notAllowed", async () => {
    expect((await entrar("333", "carlos", ["S1"])).destino).toBe("/?erro=notAllowed");
  });
});

describe("sem listas", () => {
  it("com ALLOW_ANY_DISCORD=true qualquer conta entra", async () => {
    await iniciar({ ALLOW_ANY_DISCORD: "true" });

    for (const id of ["111", "222", "333"]) expect((await entrar(id)).me).toBe(200);
    expect(usuarios()).toBe(3);
  });
});

describe("login negado vai para o log do servidor (para o administrador saber qual ID liberar)", () => {
  it("fora da lista de usuários: registra o ID, o nome e o motivo notAllowed", async () => {
    await iniciar({ DISCORD_USER_IDS: "111" });

    const res = await entrar("333", "carlos");

    expect(res.destino).toBe("/?erro=notAllowed");
    expect(loginsNegados()).toEqual([expect.objectContaining({ level: 40, discordId: "333", name: "carlos", reason: "notAllowed" })]);
  });

  it("fora do servidor do clã: registra o motivo notInGuild", async () => {
    await iniciar({ DISCORD_USER_IDS: "111,222", DISCORD_GUILD_IDS: "S1" });

    await entrar("222", "beto", ["S9"]);

    expect(loginsNegados()).toEqual([expect.objectContaining({ discordId: "222", name: "beto", reason: "notInGuild" })]);
  });

  it("login liberado não registra negação, e a resposta ao navegador nunca traz o ID", async () => {
    await iniciar({ DISCORD_USER_IDS: "111" });

    const ana = await entrar("111", "ana");
    const carlos = await entrar("333", "carlos");

    expect(loginsNegados()).toHaveLength(1); // só o do carlos
    expect(ana.destino).not.toContain("111");
    expect(carlos.destino).toBe("/?erro=notAllowed"); // o ID fica só no log do servidor
  });
});
