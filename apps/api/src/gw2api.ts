// Nomes de mapas e de guildas pela API oficial do Guild Wars 2 (pública, sem chave), com cache no banco.
import type { DB } from "./db.js";

const API = "https://api.guildwars2.com";

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export class Gw2Api {
  constructor(
    private db: DB,
    private enabled = true,
  ) {}

  async mapName(id: number | null): Promise<string | null> {
    if (!id) return null;
    const row = this.db.prepare("SELECT name FROM maps WHERE id = ?").get(id) as { name: string } | undefined;
    if (row) return row.name;
    if (!this.enabled) return null;
    const j = await getJson(`${API}/v2/maps/${id}`);
    const name = typeof j?.name === "string" && j.name.trim() ? (j.name as string).trim() : null;
    if (name) this.db.prepare("INSERT OR REPLACE INTO maps (id, name) VALUES (?, ?)").run(id, name);
    return name;
  }

  /** Busca nome e tag das guildas que ainda não têm (ou que falharam há mais de um dia). */
  async resolvePendingGuilds(limit = 50): Promise<number> {
    if (!this.enabled) return 0;
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const pending = this.db
      .prepare("SELECT id FROM guilds WHERE name IS NULL AND (fetched_at IS NULL OR fetched_at < ?) LIMIT ?")
      .all(dayAgo, limit) as { id: string }[];
    const upd = this.db.prepare("UPDATE guilds SET name = ?, tag = ?, fetched_at = ? WHERE id = ?");
    let ok = 0;
    for (const { id } of pending) {
      const j = await getJson(`${API}/v2/guild/${encodeURIComponent(id)}`);
      upd.run(j?.name ?? null, j?.tag ?? null, new Date().toISOString(), id);
      if (j?.name) ok++;
    }
    return ok;
  }
}
