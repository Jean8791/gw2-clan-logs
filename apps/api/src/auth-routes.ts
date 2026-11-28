// Rotas de login (Discord), sessão e token pessoal de envio.
import crypto from "node:crypto";
import { ROUTES } from "@gw2logs/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import { checkSession, cookieHeader, createSession, deleteSession, isAdmin, readCookie, revokeAccessByDiscordId, sessionExpiry, upsertDiscordUser, userFromToken, type User } from "./auth.js";
import type { DB } from "./db.js";
import { safeEqual } from "./guards.js";

const DISCORD = "https://discord.com";
const WEB_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const NEXT_COOKIE = "login_next";

/** Para onde voltar depois do login: só um caminho do próprio site (sem `//`, `/\\`, endereço completo, espaço ou quebra de linha). */
const safeNext = (v: unknown): string | null => (typeof v === "string" && v.length <= 300 && /^\/(?![/\\])[\x21-\x7e]*$/.test(v) ? v : null);
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
  /** Fim de uma tentativa de login, com ou sem sucesso: apaga o state e o destino. */
  const clearLogin = () => [clear(STATE_COOKIE, "/api/auth"), clear(NEXT_COOKIE, "/api/auth")];

  /** Está em algum servidor do clã? (o Discord só é consultado no login) */
  const inClanServer = async (accessToken: string): Promise<boolean> => {
    const res = await doFetch(`${DISCORD}/api/users/@me/guilds`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`servidores ${res.status}`);
    const servers = (await res.json()) as { id: string }[];
    return servers.some((g) => cfg.discord.guildIds.includes(g.id));
  };

  /**
   * Login negado: nada de usuário nem sessão novos, e quem já tinha conta perde o token pessoal e as sessões (as lutas ficam).
   * O ID e o nome do Discord vão só para o log do servidor (nunca para a resposta): é o que o administrador copia para a lista de acesso.
   */
  const deny = (req: FastifyRequest, reply: FastifyReply, me: { id: string; username: string; global_name?: string | null }, reason: "notInGuild" | "notAllowed") => {
    req.log.warn({ discordId: me.id, name: me.global_name || me.username, reason }, "login negado");
    revokeAccessByDiscordId(db, me.id);
    return reply.header("set-cookie", clearLogin()).redirect(`/?erro=${reason}`);
  };

  /** Erro no retorno do Discord: volta para a página inicial com o aviso (quem está no navegador não vê JSON) e limpa o state para a próxima tentativa. */
  const backToStart = (reply: FastifyReply, erro: "badState" | "loginFailed") => reply.header("set-cookie", clearLogin()).redirect(`/?erro=${erro}`);

  // o login e o retorno chamam o Discord: limite próprio e mais baixo por IP (uma pessoa normal não chega perto)
  const authLimit = cfg.rateLimit.authPerMin > 0 ? { config: { rateLimit: { max: cfg.rateLimit.authPerMin, timeWindow: "1 minute" } } } : {};

  // ?next=/caminho: a tela de onde a pessoa saiu; o retorno do Discord volta para lá
  server.get<{ Querystring: { next?: string } }>("/api/auth/login", authLimit, async (req, reply) => {
    if (!enabled) return reply.code(503).send({ error: "Login is not configured.", code: "loginOff" });
    const state = crypto.randomBytes(16).toString("base64url");
    const url = new URL("/oauth2/authorize", DISCORD);
    url.search = new URLSearchParams({ client_id: cfg.discord.clientId, redirect_uri: redirectUri, response_type: "code", scope, state }).toString();
    const next = safeNext(req.query.next);
    const cookies = [cookieHeader(STATE_COOKIE, state, { secure, maxAgeSec: STATE_MINUTES * 60, path: "/api/auth" })];
    if (next) cookies.push(cookieHeader(NEXT_COOKIE, next, { secure, maxAgeSec: STATE_MINUTES * 60, path: "/api/auth" }));
    return reply.header("set-cookie", cookies).redirect(url.toString());
  });

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/callback", authLimit, async (req, reply) => {
    const { code, state, error } = req.query;
    // quem cancela na tela do Discord volta sem código (error=access_denied): é só voltar para a entrada, sem sessão
    if (error) return reply.header("set-cookie", clearLogin()).redirect("/");
    const expected = readCookie(req.headers.cookie, STATE_COOKIE);
    if (!enabled || !code || !state || !expected || !safeEqual(state, expected)) {
      return backToStart(reply, "badState");
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
      if (cfg.discord.userIds.length > 0 && !cfg.discord.userIds.includes(me.id)) return deny(req, reply, me, "notAllowed");
      // a consulta falhar lança erro e cai no loginFailed: na dúvida, ninguém entra
      if (onlyClan && !(await inClanServer(access_token))) return deny(req, reply, me, "notInGuild");

      const user = upsertDiscordUser(db, { id: me.id, username: me.global_name || me.username, avatar: me.avatar ?? null });
      const token = createSession(db, user.id, "web");
      // volta para a tela de onde saiu; sem destino, quem ainda não tem luta nenhuma vai direto para a importação, que é o que ele precisa fazer
      const next = safeNext(readCookie(req.headers.cookie, NEXT_COOKIE));
      const hasFights = db.prepare("SELECT 1 FROM fights WHERE owner_id = ? LIMIT 1").get(user.id) !== undefined;
      return reply
        .header("set-cookie", [cookieHeader(WEB_COOKIE, token, { secure, maxAgeSec: WEB_COOKIE_SECONDS }), ...clearLogin()])
        .redirect(next ?? (hasFights ? ROUTES.overview : ROUTES.import));
    } catch (e) {
      req.log.error({ err: e instanceof Error ? e.message : String(e) }, "falha no login com o Discord");
      return backToStart(reply, "loginFailed");
    }
  });

  server.get("/api/auth/me", async (req, reply) => {
    const { user, needsNewLogin } = checkSession(db, readCookie(req.headers.cookie, WEB_COOKIE), "web", cfg.discord);
    if (user) return { name: user.name, avatar: user.avatar, isAdmin: isAdmin(user, cfg) };
    // a conferência dos servidores do Discord venceu: a tela inicial pede para entrar de novo
    if (needsNewLogin) return reply.code(401).send({ error: "Sign in again.", code: "loginExpired" });
    return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
  });

  server.post("/api/auth/logout", async (req, reply) => {
    deleteSession(db, readCookie(req.headers.cookie, WEB_COOKIE));
    return reply.header("set-cookie", clear(WEB_COOKIE)).send({ ok: true });
  });

  // apagar a conta remove o cadastro e as sessões; as lutas ficam no conjunto único (sem dono e sem o nome de quem enviou).
  // Só pela sessão do navegador.
  server.delete("/api/auth/account", async (req, reply) => {
    const user = sessionUser(db, cfg, req);
    if (!user) return reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
    // não dá para desfazer: a pessoa digita o próprio nome (a tela pede), e um pedido sem isso não apaga nada
    const { confirm } = (req.body ?? {}) as { confirm?: unknown };
    if (confirm !== user.name) return reply.code(400).send({ error: "Type your name to confirm.", code: "confirmName" });
    db.prepare("UPDATE fights SET owner_id = NULL, uploader = NULL WHERE owner_id = ?").run(user.id);
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
