import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { parseFilters, type UploadResult } from "@gw2logs/shared";
import { paths, type Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { eiAvailable } from "./elite-insights.js";
import { Gw2Api } from "./gw2api.js";
import { MEDIA_KEY, MediaStore } from "./media.js";
import * as q from "./queries.js";
import { LogWorker } from "./worker.js";

const MAX_UPLOAD = 80 * 1024 * 1024; // logs grandes de WvW passam fácil de 20 MB
const ALLOWED_EXT = [".zevtc", ".evtc", ".zip", ".json"];

export interface App {
  server: FastifyInstance;
  db: DB;
  worker: LogWorker;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function buildApp(cfg: Config, opts: { logger?: boolean } = {}): Promise<App> {
  const p = paths(cfg.dataDir);
  await fs.mkdir(p.uploads, { recursive: true });
  await fs.mkdir(p.fights, { recursive: true });

  const db = openDb(p.db);
  const api = new Gw2Api(db, cfg.gw2Api);
  // GW2_API=off também desliga o download de ícones (testes e uso sem internet)
  const offline = (async () => {
    throw new Error("rede desligada (GW2_API=off)");
  }) as unknown as typeof fetch;
  const media = new MediaStore(db, cfg.gw2Api ? fetch : offline);
  const server = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  const worker = new LogWorker(db, api, media, cfg, server.log);

  await server.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 50 } });

  const keyOk = (req: FastifyRequest, key: string) => key === "" || safeEqual(String(req.headers["x-upload-key"] ?? ""), key);

  // ---------- Envio de logs ----------
  server.post("/api/upload", async (req, reply) => {
    if (!keyOk(req, cfg.uploadKey)) return reply.code(401).send({ error: "Senha de envio incorreta." });

    const results: UploadResult[] = [];
    let uploader: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "uploader") uploader = String(part.value ?? "").trim().slice(0, 60) || null;
        continue;
      }
      const ext = path.extname(part.filename).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        part.file.resume();
        results.push({ file: part.filename, error: "Formato inválido (use .zevtc, .evtc ou o .json do Elite Insights)." });
        continue;
      }
      // grava num temporário calculando o hash: o mesmo log enviado duas vezes é ignorado
      const tmp = path.join(p.uploads, `tmp-${crypto.randomUUID()}`);
      const hash = crypto.createHash("sha256");
      await pipeline(
        part.file,
        new Transform({ transform: (chunk, _e, cb) => (hash.update(chunk), cb(null, chunk)) }),
        createWriteStream(tmp),
      );
      if (part.file.truncated) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, error: `Arquivo maior que ${MAX_UPLOAD / 1024 / 1024} MB.` });
        continue;
      }
      const sha = hash.digest("hex");
      const existing = db.prepare("SELECT id, status FROM fights WHERE sha256 = ?").get(sha) as { id: string; status: any } | undefined;
      if (existing) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, id: existing.id, status: existing.status, duplicate: true });
        continue;
      }
      const id = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${sha.slice(0, 8)}`;
      await fs.rename(tmp, path.join(p.uploads, id + ext));
      db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, uploader, file_name) VALUES (?, ?, 'queued', ?, ?, ?)").run(
        id, sha, new Date().toISOString(), uploader, part.filename.slice(0, 200),
      );
      worker.enqueue(id);
      results.push({ file: part.filename, id, status: "queued" });
    }
    return results;
  });

  server.get("/api/config", async () => ({
    uploadKeyRequired: cfg.uploadKey !== "",
    adminKeyRequired: cfg.adminKey !== "",
    eliteInsights: eiAvailable(cfg.eiDir),
  }));

  // ---------- Lutas ----------
  server.get("/api/fights", async (req) => {
    const qs = req.query as Record<string, string>;
    const limit = Math.min(Math.max(Number(qs.limit) || 50, 1), 500);
    const offset = Math.max(Number(qs.offset) || 0, 0);
    return q.listFights(db, parseFilters(qs), limit, offset);
  });

  server.get<{ Params: { id: string } }>("/api/fights/:id", async (req, reply) => {
    const d = q.fightDetail(db, req.params.id);
    return d ?? reply.code(404).send({ error: "Luta não encontrada." });
  });

  // relatório HTML completo do Elite Insights (rotação, linha do tempo, replay)
  server.get<{ Params: { id: string } }>("/api/fights/:id/report", async (req, reply) => {
    const id = req.params.id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send();
    const file = path.join(p.fightDir(id), "report.html");
    if (!existsSync(file)) return reply.code(404).send({ error: "Relatório não disponível para esta luta." });
    return reply.type("text/html; charset=utf-8").send(await fs.readFile(file));
  });

  // ícones guardados no banco: o navegador nunca fala direto com a ArenaNet
  server.get<{ Params: { key: string } }>("/api/media/:key", async (req, reply) => {
    if (!MEDIA_KEY.test(req.params.key)) return reply.code(400).send();
    const m = media.get(req.params.key);
    if (!m) return reply.code(404).send();
    return reply.header("x-content-type-options", "nosniff").header("cache-control", "public, max-age=86400").type(m.contentType).send(m.bytes);
  });

  // ---------- Jogadores, ranking, comparação ----------
  server.get("/api/ranking", async (req) => {
    const fl = parseFilters(req.query as Record<string, string>);
    return { rows: q.ranking(db, fl), baseline: q.baseline(db, fl) };
  });

  server.get<{ Params: { account: string } }>("/api/players/:account", async (req, reply) => {
    const prof = q.playerProfile(db, req.params.account, parseFilters(req.query as Record<string, string>));
    return prof ?? reply.code(404).send({ error: "Jogador não encontrado." });
  });

  server.get("/api/compare", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const accounts = String(qs.accounts ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!accounts.length) return reply.code(400).send({ error: "Informe as contas em ?accounts=a,b" });
    const fl = parseFilters(qs);
    const players = accounts.map((a) => q.playerProfile(db, a, fl)).filter((x) => x !== null);
    return { players, baseline: q.baseline(db, fl) };
  });

  // ---------- Guildas ----------
  server.get("/api/guilds", async () => q.guildSummaries(db));

  server.put<{ Params: { id: string }; Body: { inAlliance?: boolean } }>("/api/guilds/:id", async (req, reply) => {
    if (!keyOk(req, cfg.adminKey)) return reply.code(401).send({ error: "Senha de administrador incorreta." });
    if (typeof req.body?.inAlliance !== "boolean") return reply.code(400).send({ error: "Informe inAlliance (true/false)." });
    return q.setGuildAlliance(db, req.params.id, req.body.inAlliance) ? { ok: true } : reply.code(404).send({ error: "Guilda não encontrada." });
  });

  // ---------- Visão geral ----------
  server.get("/api/overview", async (req) => q.overview(db, parseFilters(req.query as Record<string, string>)));
  server.get("/api/meta", async () => q.meta(db));

  // ---------- Site (build do apps/web) ----------
  if (existsSync(cfg.webDir)) {
    await server.register(fastifyStatic, { root: cfg.webDir });
    // rotas do React (ex.: /ranking): devolve o index.html; arquivos e API inexistentes dão 404 de verdade
    server.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") || req.url.startsWith("/assets/") || req.method !== "GET"
        ? reply.code(404).send({ error: "Não encontrado." })
        : reply.sendFile("index.html"),
    );
  }

  server.addHook("onClose", async () => db.close());
  return { server, db, worker };
}
