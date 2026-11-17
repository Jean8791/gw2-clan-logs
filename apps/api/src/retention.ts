import fs from "node:fs/promises";
import type { paths } from "./config.js";
import type { DB } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Apaga as lutas mais antigas que o prazo. */
export async function purgeOldFights(db: DB, p: ReturnType<typeof paths>, retentionDays: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  // lutas sem data (na fila ou com erro) valem pela data do envio
  const old = db.prepare("SELECT id FROM fights WHERE COALESCE(time_start, uploaded_at) < ?").all(cutoff) as { id: string }[];
  await removeFights(db, p, old.map((f) => f.id));
  return old.length;
}

/** Apaga as lutas: linha no banco (as estatísticas saem junto), pasta da luta e log enviado. */
export async function removeFights(db: DB, p: ReturnType<typeof paths>, ids: string[]): Promise<void> {
  const uploads = await fs.readdir(p.uploads);
  for (const id of ids) {
    db.prepare("DELETE FROM fights WHERE id = ?").run(id);
    await fs.rm(p.fightDir(id), { recursive: true, force: true });
    for (const file of uploads.filter((f) => f.startsWith(id + "."))) await fs.rm(`${p.uploads}/${file}`, { force: true });
  }
}
