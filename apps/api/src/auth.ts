// Usuários (login pelo Discord) e sessões. O token só existe em claro no navegador ou com o jogador: o banco guarda o hash.
import crypto from "node:crypto";
import { DEFAULT_API_TOKEN_DAYS, type Config } from "./config.js";
import type { DB } from "./db.js";

export type SessionKind = "web" | "api";

export interface DiscordProfile {
  id: string;
  username: string;
  avatar: string | null;
}

export interface User {
  id: number;
  /** Só para o servidor decidir permissões (administração): nunca vai numa resposta da API. */
  discordId: string;
  publicId: string;
  name: string;
  avatar: string | null;
}

const WEB_SESSION_DAYS = 30;
/** A conferência dos servidores do Discord (só feita no login) vale por este tempo; depois a sessão web pede novo login. */
const GUILD_RECHECK_DAYS = 7;
const DAY_MS = 86_400_000;

/** O que o login confere e o servidor precisa lembrar a cada pedido: quem é permitido e se a conferência dos servidores está em dia. */
export type AccessRules = Pick<Config["discord"], "userIds" | "guildIds">;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Id que vai na URL de compartilhar: aleatório, para não revelar nem permitir adivinhar o id do Discord. */
const newPublicId = () => crypto.randomBytes(9).toString("base64url");

const toUser = (r: { id: number; discord_id: string; public_id: string; name: string; avatar: string | null }): User => ({
  id: r.id,
  discordId: r.discord_id,
  publicId: r.public_id,
  name: r.name,
  avatar: r.avatar,
});

/** Cria o usuário ou atualiza nome e avatar. O primeiro usuário de todos recebe os logs que já existiam sem dono. */
export function upsertDiscordUser(db: DB, p: DiscordProfile): User {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const found = db.prepare("SELECT id FROM users WHERE discord_id = ?").get(p.id) as { id: number } | undefined;
    if (found) {
      db.prepare("UPDATE users SET name = ?, avatar = ?, verified_at = ? WHERE id = ?").run(p.username, p.avatar, now, found.id);
      return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(found.id) as any);
    }
    const first = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
    const id = Number(
      db.prepare("INSERT INTO users (public_id, discord_id, name, avatar, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?)").run(newPublicId(), p.id, p.username, p.avatar, now, now).lastInsertRowid,
    );
    if (first) db.prepare("UPDATE fights SET owner_id = ? WHERE owner_id IS NULL").run(id);
    return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any);
  })();
}

/** Administra pelo login: o ID do Discord está em ADMIN_DISCORD_IDS. */
export const isAdmin = (user: User, cfg: Pick<Config, "adminDiscordIds">): boolean => cfg.adminDiscordIds.includes(user.discordId);

/** Quando uma sessão nova termina: a web dura 30 dias; o token de API, `apiTokenDays`. */
export const sessionExpiry = (kind: SessionKind, now = new Date(), apiTokenDays = DEFAULT_API_TOKEN_DAYS): string =>
  new Date(now.getTime() + (kind === "web" ? WEB_SESSION_DAYS : apiTokenDays) * DAY_MS).toISOString();

/** Cria uma sessão e devolve o token (só aqui ele aparece). Cada usuário tem um token de API por vez: gerar outro invalida o anterior. */
export function createSession(db: DB, userId: number, kind: SessionKind, now = new Date(), apiTokenDays = DEFAULT_API_TOKEN_DAYS): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = sessionExpiry(kind, now, apiTokenDays);
  db.transaction(() => {
    if (kind === "api") db.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'api'").run(userId);
    db.prepare("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(sha256(token), userId, kind, now.toISOString(), expires);
  })();
  return token;
}

/**
 * Quem é o dono do token e se ele ainda tem acesso: com DISCORD_USER_IDS preenchida, quem saiu da lista é tratado como não autenticado mesmo
 * com token válido; com DISCORD_GUILD_IDS preenchida, a sessão web só vale se o login conferiu o Discord nos últimos 7 dias (`needsNewLogin`
 * avisa quando é só isso que falta). O token de API vale até expirar.
 */
export function checkSession(db: DB, token: string | undefined, kind: SessionKind, rules: AccessRules, now = new Date()): { user: User | null; needsNewLogin: boolean } {
  const row = sessionRow(db, token, kind, now);
  if (!row || (rules.userIds.length > 0 && !rules.userIds.includes(row.discord_id))) return { user: null, needsNewLogin: false };
  if (kind === "web" && guildCheckExpired(row.verified_at, rules, now)) return { user: null, needsNewLogin: true };
  return { user: toUser(row), needsNewLogin: false };
}

/** Dono do token, se ele for do tipo pedido, não tiver expirado e ainda tiver acesso. */
export const userFromToken = (db: DB, token: string | undefined, kind: SessionKind, rules: AccessRules, now = new Date()): User | null =>
  checkSession(db, token, kind, rules, now).user;

const sessionRow = (db: DB, token: string | undefined, kind: SessionKind, now: Date) =>
  token
    ? (db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.kind = ? AND (s.expires_at IS NULL OR s.expires_at > ?)`,
        )
        .get(sha256(token), kind, now.toISOString()) as any)
    : undefined;

const guildCheckExpired = (verifiedAt: string | null, rules: AccessRules, now: Date): boolean =>
  rules.guildIds.length > 0 && (verifiedAt === null || verifiedAt <= new Date(now.getTime() - GUILD_RECHECK_DAYS * DAY_MS).toISOString());

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Tira o acesso de quem saiu do servidor do Discord: apaga o token pessoal e as sessões do navegador. As lutas ficam. */
export function revokeAccessByDiscordId(db: DB, discordId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE discord_id = ?)").run(discordId);
}

/** Na subida: apaga as sessões (web e api) de quem não está em DISCORD_USER_IDS. Lista vazia não restringe. Devolve quantas saíram. As lutas ficam. */
export function revokeAccessOutsideList(db: DB, userIds: string[]): number {
  if (userIds.length === 0) return 0;
  const marks = userIds.map(() => "?").join(",");
  return db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE discord_id NOT IN (${marks}))`).run(...userIds).changes;
}

/** Tokens de API criados antes de existir validade (sem prazo) ganham `days` a partir de agora. Devolve quantos. */
export function giveDeadlineToApiTokens(db: DB, days: number, now = new Date()): number {
  return db.prepare("UPDATE sessions SET expires_at = ? WHERE kind = 'api' AND expires_at IS NULL").run(sessionExpiry("api", now, days)).changes;
}

/** Apaga as sessões que já expiraram. Devolve quantas saíram. */
export function purgeExpiredSessions(db: DB, now = new Date()): number {
  return db.prepare("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now.toISOString()).changes;
}

/** Troca o id que vai na URL de compartilhar: o antigo deixa de achar o usuário (404) e o novo é devolvido. As lutas e as sessões não mudam. */
export function rotatePublicId(db: DB, userId: number): string {
  const publicId = newPublicId();
  db.prepare("UPDATE users SET public_id = ? WHERE id = ?").run(publicId, userId);
  return publicId;
}

export function userByPublicId(db: DB, publicId: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE public_id = ?").get(publicId) as any;
  return row ? toUser(row) : null;
}

/** Valor de um cookie do cabeçalho Cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function cookieHeader(name: string, value: string, opts: { secure: boolean; maxAgeSec: number; path?: string }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`, "HttpOnly", "SameSite=Lax", `Max-Age=${opts.maxAgeSec}`];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
