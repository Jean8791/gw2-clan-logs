// Rotas de login (Discord), sessão e token pessoal de envio.
import crypto from "node:crypto";
import { ROUTES } from "@gw2logs/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { paths, type Config } from "./config.js";
import { checkSession, cookieHeader, createSession, deleteSession, readCookie, revokeAccessByDiscordId, sessionExpiry, upsertDiscordUser, userFromToken, type User } from "./auth.js";
import type { DB } from "./db.js";
import { safeEqual } from "./guards.js";
import { removeFights } from "./retention.js";

const DISCORD = "https://discord.com";
const WEB_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const STATE_MINUTES = 10;
const WEB_COOKIE_SECONDS = 30 * 86_400;

/** Usuário da sessão do navegador (cookie). */
export const sessionUser = (db: DB, cfg: Config, req: FastifyRequest): User | null => userFromToken(db, readCookie(req.headers.cookie, WEB_COOKIE), "web", cfg.discord);

/** Usuário do token pessoal, enviado no cabeçalho x-upload-key pelo script de envio. */
export const apiUser = (db: DB, cfg: Config, req: FastifyRequest): User | null => userFromToken(db, String(req.headers["x-upload-key"] ?? ""), "api", cfg.discord);

export function registerAuthRoutes(server: FastifyInstance, db: DB, cfg: Config, doFetch: typeof fetch) {
  const secure = cfg.publicUrl.startsWith("https://");
  const enabled = cfg.discord.clientId !== "" && cfg.discord.clientSecret !== "";
  const redirectUri = `${cfg.publicUrl}/api/auth/callback`;
  const onlyClan = cfg.discord.guildIds.length > 0;
  // o escopo guilds só é pedido quando há servidores a conferir
  const scope = onlyClan ? "identify guilds" : "identify";
  const clear = (name: string, path = "/") => cookieHeader(name, "", { secure, maxAgeSec: 0, path });

  /** Está em algum servidor do clã? (o Discord só é consultado no login) */
  const inClanServer = async (accessToken: string): Promise<boolean> => {
    const res = await doFetch(`${DISCORD}/api/users/@me/guilds`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`servidores ${res.status}`);
    const servers = (await res.json()) as { id: string }[];
    return servers.some((g) => cfg.discord.guildIds.includes(g.id));
  };

  /** Login negado: nada de usuário nem sessão novos, e quem já tinha conta perde o token pessoal e as sessões (as lutas ficam). */
  const deny = (reply: FastifyReply, discordId: string, reason: "notInGuild" | "notAllowed") => {
    revokeAccessByDiscordId(db, discordId);
    return reply.header("set-cookie", clear(STATE_COOKIE, "/api/auth")).redirect(`/?erro=${reason}`);
  };

  server.get("/api/auth/login", async (_req, reply) => {
    if (!enabled) return reply.code(503).send({ error: "Login is not configured.", code: "loginOff" });
    const state = crypto.randomBytes(16).toString("base64url");
    const url = new URL("/oauth2/authorize", DISCORD);
    url.search = new URLSearchParams({ client_id: cfg.discord.clientId, redirect_uri: redirectUri, response_type: "code", scope, state }).toString();
    return reply.header("set-cookie", cookieHeader(STATE_COOKIE, state, { secure, maxAgeSec: STATE_MINUTES * 60, path: "/api/auth" })).redirect(url.toString());
  });

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/callback", async (req, reply) => {
    const { code, state, error } = req.query;
    // quem cancela na tela do Discord volta sem código (error=access_denied): é só voltar para a entrada, sem sessão
    if (error) return reply.header("set-cookie", clear(STATE_COOKIE, "/api/auth")).redirect("/");
    const expected = readCookie(req.headers.cookie, STATE_COOKIE);
    if (!enabled || !code || !state || !expected || !safeEqual(state, expected)) {
      return reply.code(400).send({ error: "Invalid login attempt. Try again.", code: "badState" });
    }
    try {
      const tokenRes = await doFetch(`${DISCORD}/api/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: cfg.discord.clientId, client_secret: cfg.discord.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const meRes = await doFetch(`${DISCORD}/api/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
      if (!meRes.ok) throw new Error(`perfil ${meRes.status}`);
      const me = (await meRes.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };

      // as duas listas valem juntas; a de usuários vem primeiro porque não custa uma consulta ao Discord
      if (cfg.discord.userIds.length > 0 && !cfg.discord.userIds.includes(me.id)) return deny(reply, me.id, "notAllowed");
      // a consulta falhar lança erro e cai no loginFailed: na dúvida, ninguém entra
      if (onlyClan && !(await inClanServer(access_token))) return deny(reply, me.id, "notInGuild");

      const user = upsertDiscordUser(db, { id: me.id, username: me.global_name || me.username, avatar: me.avatar ?? null });
      const token = createSession(db, user.id, "web");
      // quem ainda não tem luta nenhuma vai direto para a importação, que é o que ele precisa fazer
      const hasFights = db.prepare("SELECT 1 FROM fights WHERE owner_id = ? LIMIT 1").get(user.id) !== undefined;
      return reply
        .header("set-cookie", [cookieHeader(WEB_COOKIE, token, { secure, maxAgeSec: WEB_COOKIE_SECONDS }), clear(STATE_COOKIE, "/api/auth")])
        .redirect(`/u/${user.publicId}${hasFights ? "" : ROUTES.import}`);
    } catch (e) {
      req.log.error({ err: e instanceof Error ? e.message : String(e) }, "falha no login com o Discord");
      return reply.code(502).send({ error: "Could not sign in with Discord. Try again.", code: "loginFailed" });
    }
  });

  server.get("/api/auth/me", async (req, reply) => {
    const { user, needsNewLogin } = checkSession(db, readCookie(req.headers.cookie, WEB_COOKIE), "web", cfg.discord);
    if (user) return { publicId: user.publicId, name: user.name, avatar: user.avatar };
    // a conferência dos servidores do Discord venceu: a tela inicial pede para entrar de novo
    if (needsNewLogin) return reply.code(401).send({ error: "Sign in again.", code: "loginExpired" });
    return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
  });

  server.post("/api/auth/logout", async (req, reply) => {
    deleteSession(db, readCookie(req.headers.cookie, WEB_COOKIE));
    return reply.header("set-cookie", clear(WEB_COOKIE)).send({ ok: true });
  });

  // apagar a conta zera tudo do usuário: lutas (com os arquivos), sessões e o próprio cadastro. Só pela sessão do navegador.
  server.delete("/api/auth/account", async (req, reply) => {
    const user = sessionUser(db, cfg, req);
    if (!user) return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
    const ids = (db.prepare("SELECT id FROM fights WHERE owner_id = ?").all(user.id) as { id: string }[]).map((f) => f.id);
    await removeFights(db, paths(cfg.dataDir), ids);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    return reply.header("set-cookie", clear(WEB_COOKIE)).send({ ok: true });
  });

  // token pessoal para o script de envio; o anterior deixa de valer e o novo só aparece nesta resposta
  server.post("/api/auth/token", async (req, reply) => {
    const user = sessionUser(db, cfg, req);
    if (!user) return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
    const now = new Date();
    return { token: createSession(db, user.id, "api", now, cfg.apiTokenDays), expiresAt: sessionExpiry("api", now, cfg.apiTokenDays) };
  });
}
