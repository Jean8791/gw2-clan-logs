// Reprocessa as lutas que ainda têm o JSON guardado (data/fights/<id>/ei.json.gz), sem reenviar os logs.
// As lutas processadas depois de o servidor parar de guardar o JSON não entram (o total impresso no fim mostra quantas foram).
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, paths } from "../src/config.js";
import { openDb, SCHEMA_VERSION, setSchemaVersion } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { MediaStore } from "../src/media.js";
import { ingestJson, readEiJsonGz } from "../src/worker.js";

const cfg = loadConfig();
const p = paths(cfg.dataDir);
const db = openDb(p.db);
const api = new Gw2Api(db, cfg.gw2Api);
const media = new MediaStore(db);

const ids = (db.prepare("SELECT id FROM fights WHERE status = 'done'").all() as { id: string }[]).map((r) => r.id);
let ok = 0;
for (const id of ids) {
  const gz = path.join(p.fightDir(id), "ei.json.gz");
  if (!existsSync(gz)) continue;
  try {
    await ingestJson(db, api, media, id, await readEiJsonGz(gz), existsSync(path.join(p.fightDir(id), "report.html")));
    ok++;
  } catch (e) {
    console.error(`falha em ${id}:`, e instanceof Error ? e.message : e);
  }
}
setSchemaVersion(db, SCHEMA_VERSION);
await api.resolvePendingGuilds(500);
console.log(`Reprocessadas ${ok} de ${ids.length} lutas.`);
