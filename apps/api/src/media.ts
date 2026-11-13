// Banco de mídias: os ícones são baixados uma vez, guardados no SQLite e servidos pelo nosso servidor.
// Os links vêm do JSON dos logs (enviado por terceiros), então só baixamos de um host conhecido.
import crypto from "node:crypto";
import type { DB } from "./db.js";

const ALLOWED_HOST = "render.guildwars2.com";
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]); // SVG fica de fora: pode carregar script
const MAX_BYTES = 200 * 1024;

/** Chave de uma mídia, ex.: "buff:1122". */
export const MEDIA_KEY = /^[a-z]+:\w+$/;

export function isAllowedIconUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname === ALLOWED_HOST && u.port === "" && u.username === "" && u.password === "" && u.pathname.startsWith("/file/");
}

const CONCURRENCY = 8;

export interface Media {
  contentType: string;
  bytes: Buffer;
}

export class MediaStore {
  constructor(
    private db: DB,
    private fetchFn: typeof fetch = fetch,
  ) {}

  get(key: string): Media | null {
    const row = this.db.prepare("SELECT content_type AS contentType, bytes FROM media WHERE key = ?").get(key) as Media | undefined;
    return row ?? null;
  }

  /** Garante que a mídia está guardada. Nunca lança erro: um ícone que falha não pode derrubar o processamento da luta. */
  async ensure(key: string, url: string): Promise<boolean> {
    if (this.get(key)) return true;
    if (!isAllowedIconUrl(url)) return false;
    try {
      // redirect: "error" — um redirecionamento poderia levar o servidor a outro endereço
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
      const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!res.ok || !ALLOWED_TYPES.has(type)) return false;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) return false;
      this.db
        .prepare("INSERT OR REPLACE INTO media (key, source_url, content_type, bytes, sha256, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(key, url, type, bytes, crypto.createHash("sha256").update(bytes).digest("hex"), new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }
}

/** Garante vários ícones, alguns por vez: o primeiro log traz centenas. Nunca lança erro. */
export async function ensureMany(store: MediaStore, items: { key: string; url: string }[]): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map((it) => store.ensure(it.key, it.url)));
  }
}

/** Ícones das habilidades usadas (skillMap do Elite Insights; auras e efeitos vêm do buffMap), só de URLs permitidas. */
export function collectSkillIcons(json: any, ids: Iterable<number>): { key: string; url: string }[] {
  const out: { key: string; url: string }[] = [];
  const skills = json?.skillMap;
  const buffs = json?.buffMap;
  for (const id of ids) {
    const icon = skills?.[`s${id}`]?.icon ?? buffs?.[`b${id}`]?.icon;
    if (typeof icon === "string" && isAllowedIconUrl(icon)) out.push({ key: `skill:${id}`, url: icon });
  }
  return out;
}

/** Ícones dos boons que aparecem no JSON do Elite Insights (buffMap), só de URLs permitidas. */
export function collectBuffIcons(json: any): { key: string; url: string }[] {
  const out: { key: string; url: string }[] = [];
  const map = json?.buffMap;
  if (!map || typeof map !== "object") return out;
  for (const [k, v] of Object.entries<any>(map)) {
    const id = /^b(\d+)$/.exec(k)?.[1];
    if (id && v?.classification === "Boon" && typeof v.icon === "string" && isAllowedIconUrl(v.icon)) out.push({ key: `buff:${id}`, url: v.icon });
  }
  return out;
}
