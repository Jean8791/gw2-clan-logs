// Rotas de login (Discord), sessão e token pessoal de envio.
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { cookieHeader, createSession, deleteSession, readCookie, upsertDiscordUser, userFromToken, type User } from "./auth.js";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { safeEqual } from "./guards.js";

const DISCORD = "https://discord.com";
const WEB_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const STATE_MINUTES = 10;
const WEB_COOKIE_SECONDS = 30 * 86_400;

/** Usuário da sessão do navegador (cookie). */
export const sessionUser = (db: DB, req: FastifyRequest): User | null => userFromToken(db, readCookie(req.headers.cookie, WEB_COOKIE), "web");

/** Usuário do token pessoal, enviado no cabeçalho x-upload-key pelo script de envio. */
export const apiUser = (db: DB, req: FastifyRequest): User | null => userFromToken(db, String(req.headers["x-upload-key"] ?? ""), "api");

export function registerAuthRoutes(server: FastifyInstance, db: DB, cfg: Config, doFetch: typeof fetch) {
  const secure = cfg.publicUrl.startsWith("https://");
  const enabled = cfg.discord.clientId !== "" && cfg.discord.clientSecret !== "";
  const redirectUri = `${cfg.publicUrl}/api/auth/callback`;
  const clear = (name: string, path = "/") => cookieHeader(name, "", { secure, maxAgeSec: 0, path });

  server.get("/api/auth/login", async (_req, reply) => {
    if (!enabled) return reply.code(503).send({ error: "Login is not configured.", code: "loginOff" });
    const state = crypto.randomBytes(16).toString("base64url");
    const url = new URL("/oauth2/authorize", DISCORD);
    url.search = new URLSearchParams({ client_id: cfg.discord.clientId, redirect_uri: redirectUri, response_type: "code", scope: "identify", state }).toString();
    return reply.header("set-cookie", cookieHeader(STATE_COOKIE, state, { secure, maxAgeSec: STATE_MINUTES * 60, path: "/api/auth" })).redirect(url.toString());
  });

  server.get<{ Querystring: { code?: string; state?: string } }>("/api/auth/callback", async (req, reply) => {
    const { code, state } = req.query;
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

      const user = upsertDiscordUser(db, { id: me.id, username: me.global_name || me.username, avatar: me.avatar ?? null });
      const token = createSession(db, user.id, "web");
      return reply
        .header("set-cookie", [cookieHeader(WEB_COOKIE, token, { secure, maxAgeSec: WEB_COOKIE_SECONDS }), clear(STATE_COOKIE, "/api/auth")])
        .redirect(`/u/${user.publicId}`);
    } catch (e) {
      req.log.error({ err: e instanceof Error ? e.message : String(e) }, "falha no login com o Discord");
      return reply.code(502).send({ error: "Could not sign in with Discord. Try again.", code: "loginFailed" });
    }
  });

  server.get("/api/auth/me", async (req, reply) => {
    const user = sessionUser(db, req);
    return user ? { publicId: user.publicId, name: user.name, avatar: user.avatar } : reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
  });

  server.post("/api/auth/logout", async (req, reply) => {
    deleteSession(db, readCookie(req.headers.cookie, WEB_COOKIE));
    return reply.header("set-cookie", clear(WEB_COOKIE)).send({ ok: true });
  });

  // token pessoal para o script de envio; o anterior deixa de valer e o novo só aparece nesta resposta
  server.post("/api/auth/token", async (req, reply) => {
    const user = sessionUser(db, req);
    if (!user) return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
    return { token: createSession(db, user.id, "api") };
  });
}
