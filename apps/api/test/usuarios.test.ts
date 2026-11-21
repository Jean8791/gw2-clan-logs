import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, purgeExpiredSessions } from "../src/auth.js";
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

async function start(env: Record<string, string> = {}, fetchDiscord: typeof fetch = discordFalso) {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }), { fetch: fetchDiscord });
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
    expect(volta.headers.location).toBe(`/u/${user.p}/import`); // ainda sem lutas: vai direto importar

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

  it("quem já tem lutas entra na visão geral, não na importação", async () => {
    const fulano = criarUsuario(app, "777", "fulano");
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f1', 'sha-f1', 'done', ?, ?)").run(new Date().toISOString(), fulano.id);
    const ida = await app.server.inject("/api/auth/login");
    const state = new URL(String(ida.headers.location)).searchParams.get("state");

    const volta = await app.server.inject({ url: `/api/auth/callback?code=abc&state=${state}`, headers: { cookie: cookieDe(ida, "oauth_state")!.split(";")[0]! } });

    expect(volta.headers.location).toBe(`/u/${fulano.publicId}`);
  });

  it("cancelar na tela do Discord volta para a entrada, sem sessão e sem erro", async () => {
    const ida = await app.server.inject("/api/auth/login");
    const state = new URL(String(ida.headers.location)).searchParams.get("state");

    const res = await app.server.inject({ url: `/api/auth/callback?error=access_denied&error_description=The+resource+owner+denied&state=${state}`, headers: { cookie: cookieDe(ida, "oauth_state")!.split(";")[0]! } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(cookieDe(res, "oauth_state")).toContain("Max-Age=0");
    expect(cookieDe(res, "session")).toBeUndefined();
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

describe("login restrito aos servidores do Discord do clã", () => {
  /** Discord de mentira com a lista de servidores do usuário; guarda as rotas chamadas. */
  const discordComServidores = (servidores: string[] | number) => {
    const chamadas: string[] = [];
    const doFetch = ((url: string | URL) => {
      const u = String(url);
      chamadas.push(new URL(u).pathname);
      if (u.endsWith("/oauth2/token")) return Promise.resolve(Response.json({ access_token: "tok-discord" }));
      if (u.endsWith("/users/@me/guilds")) {
        return typeof servidores === "number" ? Promise.resolve(new Response("{}", { status: servidores })) : Promise.resolve(Response.json(servidores.map((id) => ({ id }))));
      }
      return Promise.resolve(Response.json({ id: "777", username: "fulano", avatar: "abc" }));
    }) as unknown as typeof fetch;
    return { doFetch, chamadas };
  };

  /** Faz o caminho inteiro do login e devolve a resposta do callback. */
  const entrar = async () => {
    const ida = await app.server.inject("/api/auth/login");
    const state = new URL(String(ida.headers.location)).searchParams.get("state");
    return { ida, volta: await app.server.inject({ url: `/api/auth/callback?code=abc&state=${state}`, headers: { cookie: cookieDe(ida, "oauth_state")!.split(";")[0]! } }) };
  };
  const usuarios = () => (app.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  const escopo = (ida: { headers: Record<string, unknown> }) => new URL(String(ida.headers.location)).searchParams.get("scope");

  const iniciar = async (servidores: string[] | number, ids = "111, 222") => {
    await app.server.close();
    const discord = discordComServidores(servidores);
    await start({ ...DISCORD, DISCORD_GUILD_IDS: ids }, discord.doFetch);
    return discord;
  };

  it("sem DISCORD_GUILD_IDS entra qualquer pessoa, só com o escopo identify e sem consultar os servidores", async () => {
    await app.server.close();
    const discord = discordComServidores([]);
    await start(DISCORD, discord.doFetch);

    const { ida, volta } = await entrar();

    expect(escopo(ida)).toBe("identify");
    expect(volta.statusCode).toBe(302);
    expect(cookieDe(volta, "session")).toBeDefined();
    expect(discord.chamadas).not.toContain("/api/users/@me/guilds");
  });

  it("com a lista preenchida o login pede também o escopo guilds", async () => {
    await iniciar([]);
    expect(escopo((await entrar()).ida)).toBe("identify guilds");
  });

  it("quem está em um dos servidores do clã entra (a lista aceita espaços)", async () => {
    await iniciar(["999", "222"]);

    const { volta } = await entrar();

    expect(volta.statusCode).toBe(302);
    expect(cookieDe(volta, "session")).toBeDefined();
    expect(usuarios()).toBe(1);
  });

  it("quem não está em nenhum volta para a entrada com o aviso, sem usuário, sem sessão e sem o state", async () => {
    await iniciar(["999"]);

    const { volta } = await entrar();

    expect(volta.statusCode).toBe(302);
    expect(volta.headers.location).toBe("/?erro=notInGuild");
    expect(cookieDe(volta, "session")).toBeUndefined();
    expect(cookieDe(volta, "oauth_state")).toContain("Max-Age=0");
    expect(usuarios()).toBe(0);
  });

  it("se o Discord falhar ao listar os servidores, ninguém entra", async () => {
    await iniciar(500);

    const { volta } = await entrar();

    expect(volta.statusCode).toBe(502);
    expect(volta.json().code).toBe("loginFailed");
    expect(cookieDe(volta, "session")).toBeUndefined();
    expect(usuarios()).toBe(0);
  });

  it("quem já tinha conta e saiu do servidor perde o token pessoal e as sessões, mas as lutas ficam", async () => {
    await iniciar(["999"]);
    const fulano = criarUsuario(app, "777", "fulano");
    const sessaoWeb = createWebSession(fulano.id);
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f1', 'sha-f1', 'done', ?, ?)").run(new Date().toISOString(), fulano.id);

    const { volta } = await entrar();

    expect(volta.headers.location).toBe("/?erro=notInGuild");
    expect((await enviar(fulano.token)).statusCode).toBe(401);
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie: `session=${sessaoWeb}` } })).statusCode).toBe(401);
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights WHERE owner_id = ?").get(fulano.id)).toEqual({ n: 1 });
  });

  describe("lista de usuários (DISCORD_USER_IDS), que vale junto com a dos servidores", () => {
    /** O usuário do Discord falso tem o id 777. `servidores`: IDs configurados (null = só a lista de usuários); `dele`: servidores em que ele está. */
    const iniciarComUsuarios = async (userIds: string, servidores: string | null, dele: string[] = []) => {
      await app.server.close();
      const discord = discordComServidores(dele);
      await start({ ...DISCORD, DISCORD_USER_IDS: userIds, ...(servidores ? { DISCORD_GUILD_IDS: servidores } : {}) }, discord.doFetch);
      return discord;
    };
    const negadoSemAcesso = (volta: { headers: Record<string, unknown>; statusCode: number }, motivo: string) => {
      expect(volta.statusCode).toBe(302);
      expect(volta.headers.location).toBe(`/?erro=${motivo}`);
      expect(cookieDe(volta, "session")).toBeUndefined();
      expect(cookieDe(volta, "oauth_state")).toContain("Max-Age=0");
      expect(usuarios()).toBe(0);
    };

    it("só a lista de usuários: quem está nela entra, com escopo identify e sem consultar os servidores", async () => {
      const discord = await iniciarComUsuarios("555, 777", null);

      const { ida, volta } = await entrar();

      expect(escopo(ida)).toBe("identify");
      expect(cookieDe(volta, "session")).toBeDefined();
      expect(discord.chamadas).not.toContain("/api/users/@me/guilds");
    });

    it("quem não está na lista volta para a entrada com o aviso, sem usuário, sem sessão e sem consultar os servidores", async () => {
      const discord = await iniciarComUsuarios("555", "111", ["111"]);

      const { volta } = await entrar();

      negadoSemAcesso(volta, "notAllowed");
      expect(discord.chamadas).not.toContain("/api/users/@me/guilds");
    });

    it("as duas listas: na de usuários mas fora dos servidores, é negado pelos servidores", async () => {
      await iniciarComUsuarios("777", "111", ["999"]);

      negadoSemAcesso((await entrar()).volta, "notInGuild");
    });

    it("as duas listas: nos servidores mas fora da lista de usuários, é negado pela lista", async () => {
      await iniciarComUsuarios("555", "111", ["111"]);

      negadoSemAcesso((await entrar()).volta, "notAllowed");
    });

    it("as duas listas: quem está nas duas entra", async () => {
      await iniciarComUsuarios("777", "111", ["111"]);

      const { volta } = await entrar();

      expect(cookieDe(volta, "session")).toBeDefined();
      expect(usuarios()).toBe(1);
    });

    it("quem já tinha conta e saiu da lista perde o token pessoal e as sessões, mas as lutas ficam", async () => {
      await iniciarComUsuarios("555", null);
      const fulano = criarUsuario(app, "777", "fulano");
      const sessaoWeb = createWebSession(fulano.id);
      app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f1', 'sha-f1', 'done', ?, ?)").run(new Date().toISOString(), fulano.id);

      const { volta } = await entrar();

      expect(volta.headers.location).toBe("/?erro=notAllowed");
      expect((await enviar(fulano.token)).statusCode).toBe(401);
      expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie: `session=${sessaoWeb}` } })).statusCode).toBe(401);
      expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights WHERE owner_id = ?").get(fulano.id)).toEqual({ n: 1 });
    });

    it("lista vazia não restringe: a configuração aceita IDs com espaços e ignora vazios", () => {
      expect(loadConfig({ DISCORD_USER_IDS: " 1, 2 ,,3 " }).discord.userIds).toEqual(["1", "2", "3"]);
      expect(loadConfig({}).discord.userIds).toEqual([]);
    });
  });
});

describe("dono do espaço", () => {
  it("o link mostra o nome do dono, sem login e sem expor o id do Discord", async () => {
    const ana = criarUsuario(app, "987654321", "ana");

    const res = await app.server.inject(`/api/u/${ana.publicId}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ publicId: ana.publicId, name: "ana", avatar: null });
    expect(res.body).not.toContain("987654321");
  });
});

describe("o mesmo log enviado por usuários diferentes", () => {
  it("cada um fica com a própria luta; o repetido do mesmo usuário continua sendo ignorado", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");

    const daAna = (await enviar(ana.token)).json()[0];
    await app.worker.idle(); // com a luta da Ana pronta, a do Beto é uma cópia (ver copia-de-luta.test.ts)
    const doBeto = (await enviar(beto.token)).json()[0];
    const repetido = (await enviar(ana.token)).json()[0];

    expect(daAna.duplicate).toBeUndefined();
    expect(doBeto).toMatchObject({ status: "done" });
    expect(doBeto.duplicate).toBeUndefined();
    expect(doBeto.id).not.toBe(daAna.id);
    expect(repetido).toMatchObject({ id: daAna.id, duplicate: true });
    expect((await app.server.inject(`/api/u/${beto.publicId}/fights`)).json()).toHaveLength(1);
    expect((await app.server.inject(`/api/u/${ana.publicId}/fights`)).json()).toHaveLength(1);
  });
});

describe("administração e sessões", () => {
  it("sem ADMIN_KEY a administração fica desligada, mesmo com uma chave qualquer", async () => {
    const res = await app.server.inject({ method: "PUT", url: "/api/guilds/x", payload: { inAlliance: true }, headers: { "x-upload-key": "" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("adminDisabled");
    expect((await app.server.inject({ method: "PUT", url: "/api/guilds/x", payload: { inAlliance: true } })).statusCode).toBe(403);
  });

  it("apaga só as sessões web expiradas e mantém o token pessoal", () => {
    const ana = criarUsuario(app, "1", "ana");
    const agora = new Date();
    const velha = createSession(app.db, ana.id, "web", new Date(agora.getTime() - 400 * 86_400_000));
    const nova = createSession(app.db, ana.id, "web", agora);

    expect(purgeExpiredSessions(app.db, agora)).toBe(1);
    const restam = (app.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'web'").get() as { n: number }).n;
    expect(restam).toBe(1);
    expect(velha).not.toBe(nova);
    expect((app.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'api'").get() as { n: number }).n).toBe(1);
  });
});

describe("apagar a conta", () => {
  it("zera as lutas e os arquivos do usuário, tira o acesso dele e não toca no outro", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    const idAna = (await enviar(ana.token)).json()[0].id;
    const idBeto = (await enviar(beto.token)).json()[0].id;
    await app.worker.idle();
    // o servidor já não guarda o original nem o JSON; planta o que ainda pode existir (relatório e log de uma luta que falhou)
    const pastaAna = path.join(dir, "fights", idAna);
    fs.mkdirSync(pastaAna, { recursive: true });
    fs.writeFileSync(path.join(pastaAna, "report.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "uploads", idAna + ".zevtc"), "x");

    const cookie = `session=${createSession(app.db, ana.id, "web")}`;
    expect((await app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { "x-upload-key": ana.token } })).statusCode).toBe(401);
    const res = await app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { cookie }, payload: { confirm: "ana" } });

    expect(res.statusCode).toBe(200);
    expect(cookieDe(res, "session")).toContain("Max-Age=0");
    expect(fs.existsSync(pastaAna)).toBe(false);
    expect(fs.readdirSync(path.join(dir, "uploads")).some((f) => f.startsWith(idAna + "."))).toBe(false);
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect((await enviar(ana.token)).statusCode).toBe(401);
    expect((await app.server.inject(`/api/u/${ana.publicId}/fights`)).statusCode).toBe(404);
    const restam = (await app.server.inject(`/api/u/${beto.publicId}/fights`)).json();
    expect(restam.map((f: { id: string }) => f.id)).toEqual([idBeto]);
  });
});

describe("o que fica guardado depois de processar", () => {
  const arquivos = (pasta: string) => (fs.existsSync(path.join(dir, pasta)) ? fs.readdirSync(path.join(dir, pasta)) : []);

  it("luta processada: só o banco guarda (sem o log enviado, sem o JSON, sem pasta vazia)", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = (await enviar(ana.token)).json()[0].id;
    await app.worker.idle();

    expect((await app.server.inject(`/api/u/${ana.publicId}/fights/${id}`)).statusCode).toBe(200);
    expect(arquivos("uploads")).toEqual([]);
    expect(arquivos("fights")).toEqual([]);
  });

  it("luta com erro: o log enviado fica, para diagnóstico", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = (await enviar(ana.token, "quebrado.json", "isto não é json")).json()[0].id;
    await app.worker.idle();

    const luta = (await app.server.inject(`/api/u/${ana.publicId}/fights`)).json().find((f: { id: string }) => f.id === id);
    expect(luta.status).toBe("error");
    expect(arquivos("uploads")).toEqual([id + ".json"]);
  });
});

describe("aviso de retenção", () => {
  it("a configuração informa por quantos dias os logs ficam, para a tela avisar o usuário", async () => {
    await app.server.close();
    await start({ RETENTION_DAYS: "30" });

    expect((await app.server.inject("/api/config")).json().retentionDays).toBe(30);
  });
});

describe("limites informados na configuração", () => {
  it("a configuração traz os limites de envio de cada usuário, para a tela de importação mostrar", async () => {
    await app.server.close();
    await start({ UPLOAD_MAX_QUEUE_USER: "7", UPLOAD_MAX_PER_HOUR_USER: "123" });

    expect((await app.server.inject("/api/config")).json().limits).toEqual({ queuePerUser: 7, perHourPerUser: 123 });
  });

  it("sem configurar, mostra os valores padrão", async () => {
    expect((await app.server.inject("/api/config")).json().limits).toEqual({ queuePerUser: 10, perHourPerUser: 200 });
  });
});
