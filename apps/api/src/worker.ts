// Fila em segundo plano: roda o Elite Insights em cada log enviado e grava as estatísticas.
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Config } from "./config.js";
import { paths } from "./config.js";
import type { DB } from "./db.js";
import { fightError, runEliteInsights } from "./elite-insights.js";
import type { Gw2Api } from "./gw2api.js";
import { extractFight } from "./ingest.js";
import { collectBuffIcons, collectSkillIcons, ensureMany, type MediaStore } from "./media.js";
import { saveFight, setStatus } from "./store.js";

export function parseJsonBuffer(buf: Buffer): any {
  // alguns JSON do EI vêm com BOM UTF-8
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  return JSON.parse(buf.subarray(start).toString("utf8"));
}

export const readEiJsonGz = async (file: string) => parseJsonBuffer(zlib.gunzipSync(await fs.readFile(file)));

/** Extrai e grava uma luta a partir do JSON do EI já carregado. */
export async function ingestJson(db: DB, api: Gw2Api, media: MediaStore, id: string, json: any, hasReport: boolean) {
  const f = extractFight(json);
  const mapName = await api.mapName(f.mapId);
  saveFight(db, id, f, mapName, hasReport);
  // ícones novos; falha aqui não invalida a luta (ensure nunca lança)
  const skillIds = new Set(f.players.flatMap((p) => p.skills.map((s) => s.id)));
  await ensureMany(media, [...collectBuffIcons(json), ...collectSkillIcons(json, skillIds)]);
  await ensureProfessionIcons(api, media, f.players.map((p) => p.profession));
}

/** Guarda (e atualiza, se mudou) o ícone de cada classe da luta. A lista da API é consultada uma vez por processo. */
async function ensureProfessionIcons(api: Gw2Api, media: MediaStore, professions: (string | null)[]) {
  const names = [...new Set(professions)].filter((n): n is string => !!n && /^\w+$/.test(n));
  if (!names.length) return;
  const icons = await api.professionIcons();
  for (const name of names) if (icons[name]) await media.ensure(`prof:${name}`, icons[name]);
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
    private media: MediaStore,
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
          const started = Date.now();
          const { eiMs } = await this.process(id);
          const totalMs = Date.now() - started;
          this.db.prepare("UPDATE fights SET process_ms = ? WHERE id = ?").run(totalMs, id);
          // eiMs é nulo quando o envio já era o JSON do Elite Insights (o EI não rodou)
          this.log.info({ id, eiMs, totalMs }, "luta processada");
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

  /** Processa o log e devolve quanto tempo o Elite Insights levou (null se ele não rodou). */
  private async process(id: string): Promise<{ eiMs: number | null }> {
    const files = await fs.readdir(this.p.uploads);
    const name = files.find((f) => f.startsWith(id + "."));
    if (!name) throw fightError("logMissing");
    const src = path.join(this.p.uploads, name);
    const outDir = this.p.fightDir(id);
    const work = path.join(outDir, "work");
    await fs.mkdir(work, { recursive: true });
    let eiMs: number | null = null;

    try {
      let jsonFile: string;
      let html: string | null = null;
      if (name.toLowerCase().endsWith(".json")) {
        // JSON já gerado pelo Elite Insights (ex.: baixado do dps.report)
        jsonFile = src;
      } else {
        const eiStarted = Date.now();
        const out = await runEliteInsights({ eiDir: this.cfg.eiDir, dotnet: this.cfg.dotnet, logFile: src, outDir: work, html: this.cfg.eiHtml });
        eiMs = Date.now() - eiStarted;
        jsonFile = out.json;
        html = out.html;
      }

      const json = parseJsonBuffer(await fs.readFile(jsonFile));
      if (html) await fs.rename(html, path.join(outDir, "report.html"));
      await ingestJson(this.db, this.api, this.media, id, json, existsSync(path.join(outDir, "report.html")));

      // o que importa já está no banco: o log enviado não precisa ficar. Em caso de erro ele fica, para tentar de novo.
      await fs.rm(src, { force: true });
      return { eiMs };
    } finally {
      await fs.rm(work, { recursive: true, force: true });
      await fs.rmdir(outDir).catch(() => {}); // só sai se ficou vazia (sobra o report.html quando ele é gerado)
    }
  }
}
