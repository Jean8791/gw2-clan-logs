// Fila em segundo plano: roda o Elite Insights em cada log enviado e grava as estatísticas.
import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import type { Config } from "./config.js";
import { paths } from "./config.js";
import type { DB } from "./db.js";
import { runEliteInsights } from "./elite-insights.js";
import type { Gw2Api } from "./gw2api.js";
import { extractFight } from "./ingest.js";
import { saveFight, setStatus } from "./store.js";

export function parseJsonBuffer(buf: Buffer): any {
  // alguns JSON do EI vêm com BOM UTF-8
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  return JSON.parse(buf.subarray(start).toString("utf8"));
}

export const readEiJsonGz = async (file: string) => parseJsonBuffer(zlib.gunzipSync(await fs.readFile(file)));

/** Extrai e grava uma luta a partir do JSON do EI já carregado. */
export async function ingestJson(db: DB, api: Gw2Api, id: string, json: any, hasReport: boolean) {
  const f = extractFight(json);
  const mapName = await api.mapName(f.mapId);
  saveFight(db, id, f, mapName, hasReport);
}

export class LogWorker {
  private queue: string[] = [];
  private running = false;
  private p: ReturnType<typeof paths>;
  /** Resolvida quando a fila esvazia (usada nos testes). */
  private idleWaiters: (() => void)[] = [];

  constructor(
    private db: DB,
    private api: Gw2Api,
    private cfg: Config,
    private log: { info: (...a: any[]) => void; error: (...a: any[]) => void } = console,
  ) {
    this.p = paths(cfg.dataDir);
  }

  /** Recoloca na fila o que ficou pela metade numa execução anterior. */
  resume() {
    const rows = this.db.prepare("SELECT id FROM fights WHERE status IN ('queued','parsing') ORDER BY uploaded_at").all() as { id: string }[];
    for (const r of rows) this.enqueue(r.id);
  }

  enqueue(id: string) {
    this.queue.push(id);
    void this.loop();
  }

  idle(): Promise<void> {
    return this.running || this.queue.length ? new Promise((r) => this.idleWaiters.push(r)) : Promise.resolve();
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        try {
          setStatus(this.db, id, "parsing");
          await this.process(id);
          this.log.info({ id }, "luta processada");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.log.error({ id, err: msg }, "falha ao processar luta");
          setStatus(this.db, id, "error", msg);
        }
      }
      // nomes das guildas novas (não bloqueia o processamento)
      await this.api.resolvePendingGuilds().catch(() => 0);
    } finally {
      this.running = false;
      this.idleWaiters.splice(0).forEach((r) => r());
    }
  }

  private async process(id: string) {
    const files = await fs.readdir(this.p.uploads);
    const name = files.find((f) => f.startsWith(id + "."));
    if (!name) throw new Error("Arquivo do log não encontrado.");
    const src = path.join(this.p.uploads, name);
    const outDir = this.p.fightDir(id);
    const work = path.join(outDir, "work");
    await fs.mkdir(work, { recursive: true });

    try {
      let jsonFile: string;
      let html: string | null = null;
      if (name.toLowerCase().endsWith(".json")) {
        // JSON já gerado pelo Elite Insights (ex.: baixado do dps.report)
        jsonFile = src;
      } else {
        const out = await runEliteInsights({ eiDir: this.cfg.eiDir, dotnet: this.cfg.dotnet, logFile: src, outDir: work });
        jsonFile = out.json;
        html = out.html;
      }

      const json = parseJsonBuffer(await fs.readFile(jsonFile));
      if (html) await fs.rename(html, path.join(outDir, "report.html"));
      await ingestJson(this.db, this.api, id, json, existsSync(path.join(outDir, "report.html")));

      // guarda o JSON completo: dá para criar estatísticas novas depois sem reenviar os logs
      await pipeline(createReadStream(jsonFile), zlib.createGzip({ level: 9 }), createWriteStream(path.join(outDir, "ei.json.gz")));
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
}
