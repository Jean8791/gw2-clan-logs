import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { parseFilters, type UploadResult } from "@gw2logs/shared";
import { paths, type Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { eiAvailable } from "./elite-insights.js";
import { Gw2Api } from "./gw2api.js";
import { AttemptLimiter, folderBytes } from "./guards.js";
import { MEDIA_KEY, MediaStore } from "./media.js";
import * as q from "./queries.js";
import { LogWorker } from "./worker.js";

const MAX_UPLOAD = 80 * 1024 * 1024; // logs grandes de WvW passam fácil de 20 MB
const LIMIT_MESSAGES = {
  queueFull: "The processing queue is full. Try again in a few minutes.",
  hourlyLimit: "Hourly upload limit reached. Try again later.",
  diskFull: "The server is out of space for new logs.",
};
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
  const server = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: cfg.trustProxy });
  const worker = new LogWorker(db, api, media, cfg, server.log);

  await server.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 50 } });

  const attempts = new AttemptLimiter(cfg.limits.maxFailedKeys, cfg.limits.blockMinutes * 60_000);

  /** Confere a chave; erros seguidos do mesmo IP o bloqueiam (responde 429 e devolve false). Sem chave configurada, libera. */
  const checkKey = (req: FastifyRequest, reply: FastifyReply, key: string, code: "uploadKey" | "adminKey"): boolean => {
    const wait = attempts.blockedFor(req.ip);
    if (wait > 0) {
      reply.header("retry-after", Math.ceil(wait / 1000)).code(429).send({ error: "Too many wrong passwords. Try again later.", code: "tooManyAttempts" });
      return false;
    }
    if (key === "" || safeEqual(String(req.headers["x-upload-key"] ?? ""), key)) {
      attempts.reset(req.ip);
      return true;
    }
    attempts.fail(req.ip);
    reply.code(401).send(code === "uploadKey" ? { error: "Wrong upload password.", code } : { error: "Wrong admin password.", code });
    return false;
  };

  /** Por que um novo log não pode entrar agora (fila cheia, limite por hora ou disco cheio), ou null se pode. */
  const uploadBlocker = async (): Promise<"queueFull" | "hourlyLimit" | "diskFull" | null> => {
    const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    if (count("SELECT COUNT(*) AS n FROM fights WHERE status IN ('queued','parsing')") >= cfg.limits.maxQueue) return "queueFull";
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    if (count("SELECT COUNT(*) AS n FROM fights WHERE uploaded_at > ?", hourAgo) >= cfg.limits.maxPerHour) return "hourlyLimit";
    if ((await folderBytes(p.uploads)) >= cfg.limits.maxUploadsMb * 1024 * 1024) return "diskFull";
    return null;
  };

  // ---------- Envio de logs ----------
  server.post("/api/upload", async (req, reply) => {
    if (!checkKey(req, reply, cfg.uploadKey, "uploadKey")) return reply;

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
        results.push({ file: part.filename, error: "Invalid format (use .zevtc, .evtc or the Elite Insights .json).", code: "badFormat" });
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
        results.push({ file: part.filename, error: `File larger than ${MAX_UPLOAD / 1024 / 1024} MB.`, code: "tooBig", max: MAX_UPLOAD / 1024 / 1024 });
        continue;
      }
      const sha = hash.digest("hex");
      const existing = db.prepare("SELECT id, status FROM fights WHERE sha256 = ?").get(sha) as { id: string; status: any } | undefined;
      if (existing) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, id: existing.id, status: existing.status, duplicate: true });
        continue;
      }
      // os limites valem só para log novo: um duplicado é ignorado de qualquer jeito e não custa nada
      const blocked = await uploadBlocker();
      if (blocked) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, error: LIMIT_MESSAGES[blocked], code: blocked });
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
    return d ?? reply.code(404).send({ error: "Fight not found.", code: "fightNotFound" });
  });

  // relatório HTML completo do Elite Insights (rotação, linha do tempo, replay)
  server.get<{ Params: { id: string } }>("/api/fights/:id/report", async (req, reply) => {
    const id = req.params.id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send();
    const file = path.join(p.fightDir(id), "report.html");
    if (!existsSync(file)) return reply.code(404).send({ error: "Report not available for this fight.", code: "noReport" });
    return reply.type("text/html; charset=utf-8").send(await fs.readFile(file));
  });

  // ícones guardados no banco: o navegador nunca fala direto com a ArenaNet
  server.get<{ Params: { key: string } }>("/api/media/:key", async (req, reply) => {
    if (!MEDIA_KEY.test(req.params.key)) return reply.code(400).send();
    const m = media.get(req.params.key);
    if (!m) return reply.code(404).send();
    // sempre revalida (ETag): um ícone trocado aparece na hora, e sem trocar a resposta é um 304 sem corpo
    const etag = `"${m.sha256}"`;
    reply.header("x-content-type-options", "nosniff").header("cache-control", "public, no-cache").header("etag", etag);
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(m.contentType).send(m.bytes);
  });

  // ---------- Jogadores, ranking, comparação ----------
  server.get("/api/ranking", async (req) => {
    const fl = parseFilters(req.query as Record<string, string>);
    return { rows: q.ranking(db, fl), baseline: q.baseline(db, fl) };
  });

  server.get<{ Params: { account: string } }>("/api/players/:account", async (req, reply) => {
    const prof = q.playerProfile(db, req.params.account, parseFilters(req.query as Record<string, string>));
    return prof ?? reply.code(404).send({ error: "Player not found.", code: "playerNotFound" });
  });

  server.get<{ Params: { account: string } }>("/api/players/:account/skills", async (req) =>
    q.playerSkills(db, req.params.account, parseFilters(req.query as Record<string, string>)),
  );

  server.get("/api/compare", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const accounts = String(qs.accounts ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!accounts.length) return reply.code(400).send({ error: "Pass the accounts in ?accounts=a,b", code: "needAccounts" });
    const fl = parseFilters(qs);
    const players = accounts.map((a) => q.playerProfile(db, a, fl)).filter((x) => x !== null);
    return { players, baseline: q.baseline(db, fl) };
  });

  // ---------- Guildas ----------
  server.get("/api/guilds", async () => q.guildSummaries(db));

  server.put<{ Params: { id: string }; Body: { inAlliance?: boolean } }>("/api/guilds/:id", async (req, reply) => {
    if (!checkKey(req, reply, cfg.adminKey, "adminKey")) return reply;
    if (typeof req.body?.inAlliance !== "boolean") return reply.code(400).send({ error: "Pass inAlliance (true/false).", code: "needInAlliance" });
    return q.setGuildAlliance(db, req.params.id, req.body.inAlliance) ? { ok: true } : reply.code(404).send({ error: "Guild not found.", code: "guildNotFound" });
  });

  // ---------- Visão geral ----------
  server.get("/api/days", async (req) => q.battleDays(db, parseFilters(req.query as Record<string, string>)));
  server.get("/api/overview", async (req) => q.overview(db, parseFilters(req.query as Record<string, string>)));
  server.get("/api/meta", async () => q.meta(db));

  // ---------- Site (build do apps/web) ----------
  if (existsSync(cfg.webDir)) {
    await server.register(fastifyStatic, { root: cfg.webDir });
    // rotas do React (ex.: /ranking): devolve o index.html; arquivos e API inexistentes dão 404 de verdade
    server.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") || req.url.startsWith("/assets/") || req.method !== "GET"
        ? reply.code(404).send({ error: "Not found.", code: "notFound" })
        : reply.sendFile("index.html"),
    );
  }

  server.addHook("onClose", async () => db.close());
  return { server, db, worker };
}
