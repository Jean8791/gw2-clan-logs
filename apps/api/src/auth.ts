// Usuários (login pelo Discord) e sessões. O token só existe em claro no navegador ou com o jogador: o banco guarda o hash.
import crypto from "node:crypto";
import type { DB } from "./db.js";

export type SessionKind = "web" | "api";

export interface DiscordProfile {
  id: string;
  username: string;
  avatar: string | null;
}

export interface User {
  id: number;
  publicId: string;
  name: string;
  avatar: string | null;
}

const WEB_SESSION_DAYS = 30;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Id que vai na URL de compartilhar: aleatório, para não revelar nem permitir adivinhar o id do Discord. */
const newPublicId = () => crypto.randomBytes(9).toString("base64url");

const toUser = (r: { id: number; public_id: string; name: string; avatar: string | null }): User => ({
  id: r.id,
  publicId: r.public_id,
  name: r.name,
  avatar: r.avatar,
});

/** Cria o usuário ou atualiza nome e avatar. O primeiro usuário de todos recebe os logs que já existiam sem dono. */
export function upsertDiscordUser(db: DB, p: DiscordProfile): User {
  return db.transaction(() => {
    const found = db.prepare("SELECT id FROM users WHERE discord_id = ?").get(p.id) as { id: number } | undefined;
    if (found) {
      db.prepare("UPDATE users SET name = ?, avatar = ? WHERE id = ?").run(p.username, p.avatar, found.id);
      return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(found.id) as any);
    }
    const first = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
    const id = Number(
      db.prepare("INSERT INTO users (public_id, discord_id, name, avatar, created_at) VALUES (?, ?, ?, ?, ?)").run(newPublicId(), p.id, p.username, p.avatar, new Date().toISOString()).lastInsertRowid,
    );
    if (first) db.prepare("UPDATE fights SET owner_id = ? WHERE owner_id IS NULL").run(id);
    return toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any);
  })();
}

/** Cria uma sessão e devolve o token (só aqui ele aparece). Cada usuário tem um token de API por vez: gerar outro invalida o anterior. */
export function createSession(db: DB, userId: number, kind: SessionKind, now = new Date()): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = kind === "web" ? new Date(now.getTime() + WEB_SESSION_DAYS * 86_400_000).toISOString() : null;
  db.transaction(() => {
    if (kind === "api") db.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'api'").run(userId);
    db.prepare("INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(sha256(token), userId, kind, now.toISOString(), expires);
  })();
  return token;
}

/** Dono do token, se ele for do tipo pedido e não tiver expirado. */
export function userFromToken(db: DB, token: string | undefined, kind: SessionKind, now = new Date()): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.kind = ? AND (s.expires_at IS NULL OR s.expires_at > ?)`,
    )
    .get(sha256(token), kind, now.toISOString()) as any;
  return row ? toUser(row) : null;
}

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Apaga as sessões que já expiraram (o token pessoal não expira e fica). Devolve quantas saíram. */
export function purgeExpiredSessions(db: DB, now = new Date()): number {
  return db.prepare("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now.toISOString()).changes;
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
