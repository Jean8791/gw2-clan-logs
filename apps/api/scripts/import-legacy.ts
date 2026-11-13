// Importa as lutas da versão antiga (.NET): lê data/gw2logs.db e os JSON guardados em data/fights/<id>/ei.json.gz.
// Uso: npm run import:legacy   (seguro rodar mais de uma vez: lutas já importadas são ignoradas)
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadConfig, paths } from "../src/config.js";
import { openDb } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { MediaStore } from "../src/media.js";
import { ingestJson, readEiJsonGz } from "../src/worker.js";

const cfg = loadConfig();
const p = paths(cfg.dataDir);
const legacyFile = path.join(cfg.dataDir, "gw2logs.db");
if (!existsSync(legacyFile)) {
  console.error(`Banco antigo não encontrado em ${legacyFile}`);
  process.exit(1);
}

const legacy = new Database(legacyFile, { readonly: true });
const db = openDb(p.db);
const api = new Gw2Api(db, cfg.gw2Api);
const media = new MediaStore(db);

const rows = legacy.prepare("SELECT id, sha256, uploaded_at, uploader, file_name FROM fights WHERE status = 'done'").all() as any[];
let imported = 0;
for (const r of rows) {
  if (db.prepare("SELECT 1 FROM fights WHERE id = ? OR sha256 = ?").get(r.id, r.sha256)) continue;
  const gz = path.join(p.fightDir(r.id), "ei.json.gz");
  if (!existsSync(gz)) {
    console.warn(`sem JSON: ${r.id}`);
    continue;
  }
  db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, uploader, file_name) VALUES (?, ?, 'parsing', ?, ?, ?)").run(
    r.id, r.sha256, r.uploaded_at, r.uploader, r.file_name,
  );
  await ingestJson(db, api, media, r.id, await readEiJsonGz(gz), existsSync(path.join(p.fightDir(r.id), "report.html")));
  imported++;
}
const named = await api.resolvePendingGuilds(500);
console.log(`Importadas ${imported} de ${rows.length} lutas; ${named} guildas identificadas.`);
