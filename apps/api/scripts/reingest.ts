// Reprocessa todas as lutas a partir do JSON guardado (data/fights/<id>/ei.json.gz).
// Use depois de mudar a extração (src/ingest.ts): não precisa reenviar os logs.
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, paths } from "../src/config.js";
import { openDb, SCHEMA_VERSION, setSchemaVersion } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { ingestJson, readEiJsonGz } from "../src/worker.js";

const cfg = loadConfig();
const p = paths(cfg.dataDir);
const db = openDb(p.db);
const api = new Gw2Api(db, cfg.gw2Api);

const ids = (db.prepare("SELECT id FROM fights WHERE status = 'done'").all() as { id: string }[]).map((r) => r.id);
let ok = 0;
for (const id of ids) {
  const gz = path.join(p.fightDir(id), "ei.json.gz");
  if (!existsSync(gz)) continue;
  try {
    await ingestJson(db, api, id, await readEiJsonGz(gz), existsSync(path.join(p.fightDir(id), "report.html")));
    ok++;
  } catch (e) {
    console.error(`falha em ${id}:`, e instanceof Error ? e.message : e);
  }
}
setSchemaVersion(db, SCHEMA_VERSION);
await api.resolvePendingGuilds(500);
console.log(`Reprocessadas ${ok} de ${ids.length} lutas.`);
