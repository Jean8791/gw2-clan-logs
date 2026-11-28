import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { MAX_JSON_MB, MAX_UPLOAD_MB, parseFilters, referenceTimeMs, type Filters, type UploadResult } from "@gw2logs/shared";
import { SUPPORT_KINDS, type SupportKind } from "@gw2logs/shared";
import { isAdmin, type User } from "./auth.js";
import { apiUser, registerAuthRoutes, sessionUser } from "./auth-routes.js";
import { paths, type Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { eiAvailable } from "./elite-insights.js";
import { Gw2Api } from "./gw2api.js";
import { AttemptLimiter, folderBytes, safeEqual } from "./guards.js";
import { MEDIA_KEY, MediaStore } from "./media.js";
import * as q from "./queries.js";
import { removeFights } from "./retention.js";
import { isCrossSite, reportForSandbox, SAFE_METHODS, securityHeaders } from "./security.js";
import { LogWorker } from "./worker.js";

const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024; // logs grandes de WvW passam fácil de 20 MB
const LIMIT_MESSAGES = {
  queueFull: "The processing queue is full. Try again in a few minutes.",
  hourlyLimit: "Hourly upload limit reached. Try again later.",
  diskFull: "The server is out of space for new logs.",
};
const ALLOWED_EXT = [".zevtc", ".evtc", ".zip", ".json"];
/** Quantos ids o monitor pode conferir de uma vez: o SQLite limita as variáveis de uma consulta. */
const MAX_STATUS_IDS = 100;

export interface App {
  server: FastifyInstance;
  db: DB;
  worker: LogWorker;
}

/** `fetch` é trocável para os testes não falarem com o Discord de verdade. */
export async function buildApp(cfg: Config, opts: { logger?: FastifyServerOptions["logger"]; fetch?: typeof fetch } = {}): Promise<App> {
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

  // Pedido que muda estado vindo de outro site é recusado (só o cookie SameSite=Lax não basta dentro do mesmo site); cabeçalhos de segurança em
  // toda resposta. Registrados antes das rotas e dos plugins, para valerem para todos.
  const publicHost = new URL(cfg.publicUrl).host;
  server.addHook("onRequest", async (req, reply) => {
    if (!SAFE_METHODS.has(req.method) && isCrossSite(req.headers, publicHost)) {
      return reply.code(403).send({ error: "Request blocked: it does not come from this site.", code: "badOrigin" });
    }
  });
  const REPORT = /\/fights\/[^/?]+\/report(\?|$)/; // o relatório HTML do Elite Insights traz scripts próprios: a CSP do site o quebraria
  server.addHook("onSend", async (req, reply, payload) => {
    const html = String(reply.getHeader("content-type") ?? "").startsWith("text/html");
    reply.headers(securityHeaders({ https: cfg.publicUrl.startsWith("https://"), html, report: REPORT.test(req.url) }));
    return payload;
  });

  // Limite de pedidos por IP (o IP do X-Forwarded-For só vale com TRUST_PROXY). Só a API conta: o site (HTML, JS e CSS), os ícones e o alerta de
  // fora do ar ficam de fora, para uma página que faz dezenas de pedidos, ou vários usuários atrás do mesmo IP, não esbarrem no limite.
  // O login, o retorno do Discord e a geração da chave do script têm um limite próprio e mais baixo (ver auth-routes.ts).
  if (cfg.rateLimit.perMin > 0 || cfg.rateLimit.authPerMin > 0) {
    await server.register(rateLimit, {
      global: cfg.rateLimit.perMin > 0,
      max: cfg.rateLimit.perMin,
      timeWindow: "1 minute",
      // vale a rota que o Fastify casou, não o texto da URL: `/%61pi/config` chega à mesma rota que `/api/config` e tem de contar igual
      allowList: (req) => {
        const route = req.routeOptions?.url ?? "";
        return !route.startsWith("/api/") || route === "/api/health" || route.startsWith("/api/media/");
      },
      errorResponseBuilder: () => ({ statusCode: 429, error: "Too many requests. Try again in a moment.", code: "tooManyRequests" }),
    });
  }
  await server.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 50 } });

  const attempts = new AttemptLimiter(cfg.limits.maxFailedKeys, cfg.limits.blockMinutes * 60_000);

  /** Responde 429 e devolve true se o IP está bloqueado por erros seguidos de senha ou token. */
  const ipBlocked = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const wait = attempts.blockedFor(req.ip);
    if (wait <= 0) return false;
    reply.header("retry-after", Math.ceil(wait / 1000)).code(429).send({ error: "Too many wrong passwords. Try again later.", code: "tooManyAttempts" });
    return true;
  };

  /**
   * Quem pode administrar (marcar guildas da aliança): a sessão do navegador de quem está em ADMIN_DISCORD_IDS, ou a ADMIN_KEY no cabeçalho
   * (script). Sem nenhuma das duas configuradas a administração fica desligada, nunca aberta. Só a ADMIN_KEY errada conta como tentativa falha.
   */
  const checkAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (cfg.adminKey === "" && cfg.adminDiscordIds.length === 0) {
      reply.code(403).send({ error: "Administration is disabled: set ADMIN_DISCORD_IDS or ADMIN_KEY.", code: "adminDisabled" });
      return false;
    }
    const user = sessionUser(db, cfg, req);
    if (user && isAdmin(user, cfg)) return true;
    if (cfg.adminKey !== "" && String(req.headers["x-upload-key"] ?? "") !== "") {
      if (ipBlocked(req, reply)) return false;
      if (safeEqual(String(req.headers["x-upload-key"]), cfg.adminKey)) {
        attempts.reset(req.ip);
        return true;
      }
      attempts.fail(req.ip);
      reply.code(401).send({ error: "Wrong admin password.", code: "adminKey" });
      return false;
    }
    if (user) reply.code(403).send({ error: "Only administrators can do this.", code: "notAdmin" });
    else reply.code(401).send({ error: "Not signed in.", code: "notSignedIn" });
    return false;
  };

  /** Quem está enviando: a sessão do navegador ou o token pessoal. Token errado conta como tentativa falha. */
  const uploadUser = (req: FastifyRequest, reply: FastifyReply): User | null => {
    if (ipBlocked(req, reply)) return null;
    const user = sessionUser(db, cfg, req) ?? apiUser(db, cfg, req);
    if (user) {
      attempts.reset(req.ip);
      return user;
    }
    if (req.headers["x-upload-key"]) attempts.fail(req.ip);
    reply.code(401).send({ error: "Sign in or use your personal token to send logs.", code: "uploadKey" });
    return null;
  };

  // Por que um novo log não pode entrar agora, ou null se pode. Um log novo passa pelos três; a cópia de uma luta já pronta
  // só pelo limite por hora, porque não entra na fila nem guarda arquivo.
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const queueBlocker = (userId: number): "queueFull" | null => {
    const pending = "status IN ('queued','parsing')";
    if (count(`SELECT COUNT(*) AS n FROM fights WHERE ${pending}`) >= cfg.limits.maxQueue) return "queueFull";
    if (count(`SELECT COUNT(*) AS n FROM fights WHERE ${pending} AND owner_id = ?`, userId) >= cfg.limits.maxQueuePerUser) return "queueFull";
    return null;
  };
  const hourlyBlocker = (userId: number): "hourlyLimit" | null => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    if (count("SELECT COUNT(*) AS n FROM fights WHERE uploaded_at > ?", hourAgo) >= cfg.limits.maxPerHour) return "hourlyLimit";
    if (count("SELECT COUNT(*) AS n FROM fights WHERE uploaded_at > ? AND owner_id = ?", hourAgo, userId) >= cfg.limits.maxPerHourPerUser) return "hourlyLimit";
    return null;
  };
  const diskBlocker = async (): Promise<"diskFull" | null> => ((await folderBytes(p.uploads)) >= cfg.limits.maxUploadsMb * 1024 * 1024 ? "diskFull" : null);
  const newFightId = (sha: string, userId: number) => `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${sha.slice(0, 8)}-${userId}`;

  // ---------- Envio de logs ----------
  server.post("/api/upload", async (req, reply) => {
    const user = uploadUser(req, reply);
    if (!user) return reply;

    const results: UploadResult[] = [];
    for await (const part of req.parts()) {
      if (part.type === "field") continue;
      const ext = path.extname(part.filename).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        part.file.resume();
        results.push({ file: part.filename, error: "Invalid format (use .zevtc, .evtc or the Elite Insights .json).", code: "badFormat" });
        continue;
      }
      // grava num temporário calculando o hash: o mesmo log enviado duas vezes pelo mesmo usuário é ignorado
      const tmp = path.join(p.uploads, `tmp-${crypto.randomUUID()}`);
      const hash = crypto.createHash("sha256");
      let bytes = 0;
      await pipeline(
        part.file,
        new Transform({ transform: (chunk, _e, cb) => (hash.update(chunk), (bytes += chunk.length), cb(null, chunk)) }),
        createWriteStream(tmp),
      );
      if (part.file.truncated) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, error: `File larger than ${MAX_UPLOAD / 1024 / 1024} MB.`, code: "tooBig", max: MAX_UPLOAD / 1024 / 1024 });
        continue;
      }
      // o .json é lido inteiro na memória (~30 vezes o tamanho do arquivo): acima do limite próprio, o envio derrubaria o servidor
      if (ext === ".json" && bytes > MAX_JSON_MB * 1024 * 1024) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, error: `JSON file larger than ${MAX_JSON_MB} MB. Send the original .zevtc instead.`, code: "jsonTooBig", max: MAX_JSON_MB });
        continue;
      }
      const sha = hash.digest("hex");
      // o mesmo arquivo já enviado por qualquer pessoa e pronto, ou por este usuário (na fila ou com erro), não vira outra luta
      let existing = db.prepare("SELECT id, status FROM fights WHERE sha256 = ? AND (owner_id = ? OR status = 'done') ORDER BY status = 'done' DESC LIMIT 1").get(sha, user.id) as { id: string; status: any } | undefined;
      // um log que ficou com erro (por exemplo, interrompido quando o servidor caiu) pode ser reenviado: o registro com erro sai e o envio segue como novo
      if (existing?.status === "error") {
        await removeFights(db, p, [existing.id]);
        existing = undefined;
      }
      if (existing) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, id: existing.id, status: existing.status, duplicate: true });
        continue;
      }
      // os limites valem só para log novo: um duplicado é ignorado de qualquer jeito e não custa nada
      const blocked = queueBlocker(user.id) ?? hourlyBlocker(user.id) ?? (await diskBlocker());
      if (blocked) {
        await fs.rm(tmp, { force: true });
        results.push({ file: part.filename, error: LIMIT_MESSAGES[blocked], code: blocked });
        continue;
      }
      const id = newFightId(sha, user.id);
      await fs.rename(tmp, path.join(p.uploads, id + ext));
      db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, uploader, owner_id, file_name) VALUES (?, ?, 'queued', ?, ?, ?, ?)").run(
        id, sha, new Date().toISOString(), user.name, user.id, part.filename.slice(0, 200),
      );
      worker.enqueue(id);
      results.push({ file: part.filename, id, status: "queued" });
    }
    return results;
  });

  // O monitor do Windows confere aqui se o que enviou virou luta. Só as lutas do próprio usuário: id alheio ou inexistente não aparece.
  server.get<{ Querystring: { ids?: string | string[] } }>("/api/upload/status", async (req, reply) => {
    const user = uploadUser(req, reply);
    if (!user) return reply;
    const ids = [req.query.ids ?? []].flat().join(",").split(",").filter(Boolean); // ?ids=a&ids=b chega como lista
    if (ids.length > MAX_STATUS_IDS) return reply.code(400).send({ error: `Ask for at most ${MAX_STATUS_IDS} ids at a time.`, code: "tooManyIds", max: MAX_STATUS_IDS });
    if (ids.length === 0) return [];
    return db
      .prepare(`SELECT id, status, error FROM fights WHERE owner_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
      .all(user.id, ...ids);
  });

  // pede aos buscadores que não indexem nada (a leitura é aberta, mas os nomes dos jogadores não devem aparecer em buscas)
  server.get("/robots.txt", async (_req, reply) => reply.type("text/plain; charset=utf-8").send("User-agent: *\nDisallow: /\n"));

  // para o alerta de "fora do ar": só diz se o banco responde e quantos logs esperam (nada de dado de jogador)
  server.get("/api/health", async (_req, reply) => {
    try {
      const count = (status: string) => (db.prepare("SELECT COUNT(*) AS n FROM fights WHERE status = ?").get(status) as { n: number }).n;
      return { status: "ok", queue: { queued: count("queued"), parsing: count("parsing") } };
    } catch {
      return reply.code(503).send({ status: "error" });
    }
  });

  server.get("/api/config", async () => ({
    loginAvailable: cfg.discord.clientId !== "" && cfg.discord.clientSecret !== "",
    eliteInsights: eiAvailable(cfg.eiDir),
    retentionDays: cfg.retentionDays,
    // só o que vale para cada usuário (os limites do servidor todo não são da conta de ninguém); tamanho por arquivo e por zip são constantes do shared
    limits: { queuePerUser: cfg.limits.maxQueuePerUser, perHourPerUser: cfg.limits.maxPerHourPerUser },
  }));

  registerAuthRoutes(server, db, cfg, opts.fetch ?? fetch);

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

  server.put<{ Params: { id: string }; Body: { inAlliance?: boolean } }>("/api/guilds/:id", async (req, reply) => {
    if (!checkAdmin(req, reply)) return reply;
    if (typeof req.body?.inAlliance !== "boolean") return reply.code(400).send({ error: "Pass inAlliance (true/false).", code: "needInAlliance" });
    return q.setGuildAlliance(db, req.params.id, req.body.inAlliance) ? { ok: true } : reply.code(404).send({ error: "Guild not found.", code: "guildNotFound" });
  });

  // ---------- Leitura aberta (/api): um conjunto único de lutas, sem login ----------
  /** Filtros da query string. Só o usuário logado (nunca a query) ganha as próprias lutas na fila ou com erro no topo da lista. */
  const filtersOf = (req: FastifyRequest): Filters => ({ ...parseFilters(req.query as Record<string, string>), viewer: sessionUser(db, cfg, req)?.id });

  server.get("/api/fights", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const limit = Math.min(Math.max(Number(qs.limit) || 50, 1), 500);
    const offset = Math.max(Number(qs.offset) || 0, 0);
    const fl = filtersOf(req);
    // o total (já com os filtros) vai num cabeçalho, para a resposta continuar sendo a lista de lutas
    reply.header("x-total-count", q.countFights(db, fl));
    return q.listFights(db, fl, limit, offset, { sort: qs.sort, dir: qs.dir });
  });

  server.get<{ Params: { id: string } }>("/api/fights/:id", async (req, reply) => {
    const d = q.fightDetail(db, req.params.id);
    return d ?? reply.code(404).send({ error: "Fight not found.", code: "fightNotFound" });
  });

  // relatório HTML completo do Elite Insights (rotação, linha do tempo, replay)
  server.get<{ Params: { id: string } }>("/api/fights/:id/report", async (req, reply) => {
    const id = req.params.id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send();
    const exists = db.prepare("SELECT 1 FROM fights WHERE id = ? AND status = 'done'").get(id);
    const file = path.join(p.fightDir(id), "report.html");
    if (!exists || !existsSync(file)) return reply.code(404).send({ error: "Report not available for this fight.", code: "noReport" });
    return reply.type("text/html; charset=utf-8").send(reportForSandbox(await fs.readFile(file, "utf8")));
  });

  server.get("/api/ranking", async (req) => {
    const fl = filtersOf(req);
    const rows = q.ranking(db, fl);
    // referenceMs: o tempo de referência do ajuste dos boons e do uptime (metade do tempo mediano de jogo no filtro)
    return { rows, baseline: q.baseline(db, fl), referenceMs: referenceTimeMs(rows.map((r) => r.activeMs)) };
  });

  server.get<{ Params: { account: string } }>("/api/players/:account", async (req, reply) => {
    const prof = q.playerProfile(db, req.params.account, filtersOf(req));
    return prof ?? reply.code(404).send({ error: "Player not found.", code: "playerNotFound" });
  });

  // funções, classes e dias que o jogador jogou, para as listas dos filtros da página dele
  server.get<{ Params: { account: string } }>("/api/players/:account/options", async (req, reply) => {
    const o = q.playerOptions(db, req.params.account, filtersOf(req));
    return o ?? reply.code(404).send({ error: "Player not found.", code: "playerNotFound" });
  });

  server.get<{ Params: { account: string } }>("/api/players/:account/skills", async (req) => q.playerSkills(db, req.params.account, filtersOf(req)));

  // cura ou barreira por habilidade (só de quem grava com o addon Healing Stats); sem kind, a cura
  server.get<{ Params: { account: string } }>("/api/players/:account/support-skills", async (req, reply) => {
    const kind = String((req.query as Record<string, unknown>).kind ?? "") || "heal";
    if (!(SUPPORT_KINDS as string[]).includes(kind)) return reply.code(400).send({ error: "Use kind=heal or kind=barrier.", code: "badKind" });
    return q.playerSupportSkills(db, req.params.account, filtersOf(req), kind as SupportKind);
  });

  server.get("/api/compare", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const accounts = String(qs.accounts ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!accounts.length) return reply.code(400).send({ error: "Pass the accounts in ?accounts=a,b", code: "needAccounts" });
    const fl = filtersOf(req);
    const players = accounts.map((a) => q.playerProfile(db, a, fl)).filter((x) => x !== null);
    return { players, baseline: q.baseline(db, fl) };
  });

  server.get("/api/guilds", async (req) => q.guildSummaries(db, filtersOf(req)));
  server.get("/api/days", async (req) => q.battleDays(db, filtersOf(req)));
  server.get("/api/overview", async (req) => q.overview(db, filtersOf(req)));
  server.get("/api/meta", async () => q.meta(db));

  // ---------- Site (build do apps/web) ----------
  if (existsSync(cfg.webDir)) {
    await server.register(fastifyStatic, { root: cfg.webDir });
    // rotas do React (ex.: /ranking): devolve o index.html; arquivos e API inexistentes dão 404 de verdade
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/assets/") || req.method !== "GET") return reply.code(404).send({ error: "Not found.", code: "notFound" });
      // link antigo de espaço (/u/<id>/lutas?x=1): o espaço deixou de existir, o mesmo caminho abre na raiz
      // as barras do começo caem: "//outro.site" ou "/\outro.site" seriam um endereço de fora do site
      const old = /^\/u\/[\w-]+(?:([/?].*))?$/.exec(req.url);
      if (old) return reply.redirect("/" + (old[1] ?? "").replace(/^[/\\]+/, ""));
      return reply.sendFile("index.html");
    });
  }

  server.addHook("onClose", async () => db.close());
  return { server, db, worker };
}
