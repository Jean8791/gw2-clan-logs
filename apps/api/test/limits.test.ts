import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptLimiter } from "../src/guards.js";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";

function multipart(files: { name: string; content: string }[]) {
  const boundary = "----teste" + Math.random().toString(16).slice(2);
  let body = "";
  for (const f of files) body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n${f.content}\r\n`;
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const fightJson = (n: number) => JSON.stringify({ ...wvwFixture(), fightName: `Luta ${n}` });

let app: App | undefined;
let dir = "";
async function start(env: Record<string, string> = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-lim-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, UPLOAD_KEY: "segredo", GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }));
  return app;
}
afterEach(async () => {
  await app?.worker.idle();
  await app?.server.close();
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const upload = (a: App, files: { name: string; content: string }[], key: string | null = "segredo", extra: Record<string, unknown> = {}) => {
  const m = multipart(files);
  return a.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, ...(key ? { "x-upload-key": key } : {}) }, ...extra });
};
const putRow = (a: App, id: string, status: string, uploadedAt: string) =>
  a.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, ?, ?)").run(id, "sha-" + id, status, uploadedAt);

describe("AttemptLimiter: bloqueio por senha errada", () => {
  it("bloqueia depois de N erros e libera quando o tempo passa", () => {
    let now = 1_000;
    const l = new AttemptLimiter(3, 60_000, () => now);
    l.fail("1.1.1.1");
    l.fail("1.1.1.1");
    expect(l.blockedFor("1.1.1.1")).toBe(0);

    l.fail("1.1.1.1");
    expect(l.blockedFor("1.1.1.1")).toBe(60_000);
    now += 59_000;
    expect(l.blockedFor("1.1.1.1")).toBe(1_000);
    now += 1_000;
    expect(l.blockedFor("1.1.1.1")).toBe(0);
  });

  it("cada IP tem a sua conta, e acertar a senha zera os erros", () => {
    const l = new AttemptLimiter(2, 60_000, () => 0);
    l.fail("a");
    l.reset("a");
    l.fail("a");
    l.fail("b");

    expect(l.blockedFor("a")).toBe(0);
    expect(l.blockedFor("b")).toBe(0);
  });

  it("não guarda IPs para sempre (limpa os que já passaram do bloqueio)", () => {
    let now = 0;
    const l = new AttemptLimiter(1, 1_000, () => now);
    for (let i = 0; i < 50; i++) l.fail(`ip${i}`);
    now = 10_000;
    l.fail("novo");

    expect(l.size()).toBeLessThanOrEqual(1);
  });
});

describe("envio: senha errada repetida", () => {
  it("depois de N erros a API responde 429 com Retry-After, mesmo com a senha certa", async () => {
    const a = await start({ UPLOAD_MAX_FAILS: "3" });
    for (let i = 0; i < 3; i++) expect((await upload(a, [{ name: "a.json", content: "{}" }], "errada")).statusCode).toBe(401);

    const res = await upload(a, [{ name: "a.json", content: fightJson(1) }], "segredo");

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("tooManyAttempts");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("outro IP não é afetado, e acertar antes do limite zera a conta", async () => {
    const a = await start({ UPLOAD_MAX_FAILS: "3", TRUST_PROXY: "true" });
    const from = (ip: string) => ({ remoteAddress: ip });
    for (let i = 0; i < 3; i++) await upload(a, [{ name: "a.json", content: "{}" }], "errada", from("9.9.9.9"));

    const outro = await upload(a, [{ name: "a.json", content: fightJson(1) }], "segredo", from("8.8.8.8"));
    expect(outro.statusCode).toBe(200);

    await upload(a, [{ name: "a.json", content: "{}" }], "errada", from("7.7.7.7"));
    await upload(a, [{ name: "a.json", content: "{}" }], "errada", from("7.7.7.7"));
    expect((await upload(a, [{ name: "a.json", content: fightJson(2) }], "segredo", from("7.7.7.7"))).statusCode).toBe(200);
    await upload(a, [{ name: "a.json", content: "{}" }], "errada", from("7.7.7.7"));
    expect((await upload(a, [{ name: "a.json", content: fightJson(3) }], "segredo", from("7.7.7.7"))).statusCode).toBe(200);
  });

  it("atrás do proxy (TRUST_PROXY) conta o IP do X-Forwarded-For, e sem ele não confia no cabeçalho", async () => {
    const a = await start({ UPLOAD_MAX_FAILS: "2", TRUST_PROXY: "true" });
    const via = (ip: string) => ({ headers: { "x-forwarded-for": ip } });
    const m = multipart([{ name: "a.json", content: "{}" }]);
    const send = (ip: string, key: string) =>
      a.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": key, ...via(ip).headers } });
    await send("5.5.5.5", "errada");
    await send("5.5.5.5", "errada");

    expect((await send("5.5.5.5", "segredo")).statusCode).toBe(429);
    expect((await send("6.6.6.6", "segredo")).statusCode).not.toBe(429);
  });

  it("sem TRUST_PROXY, um X-Forwarded-For inventado não escapa do bloqueio", async () => {
    const a = await start({ UPLOAD_MAX_FAILS: "2" });
    const m = multipart([{ name: "a.json", content: "{}" }]);
    const send = (xff: string, key: string) =>
      a.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": key, "x-forwarded-for": xff } });
    await send("1.1.1.1", "errada");
    await send("2.2.2.2", "errada");

    expect((await send("3.3.3.3", "segredo")).statusCode).toBe(429);
  });

  it("a senha de administrador também conta nos erros", async () => {
    const a = await start({ UPLOAD_MAX_FAILS: "2", ADMIN_KEY: "admin" });
    const put = (key: string) => a.server.inject({ method: "PUT", url: "/api/guilds/x", payload: { inAlliance: true }, headers: { "x-upload-key": key } });
    await put("errada");
    await put("errada");

    expect((await put("admin")).statusCode).toBe(429);
  });
});

describe("envio: limites de capacidade", () => {
  it("fila cheia: o arquivo é recusado com queueFull e nada é guardado", async () => {
    const a = await start({ UPLOAD_MAX_QUEUE: "2" });
    putRow(a, "q1", "queued", new Date().toISOString());
    putRow(a, "q2", "parsing", new Date().toISOString());

    const res = await upload(a, [{ name: "a.json", content: fightJson(1) }]);

    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ file: "a.json", code: "queueFull" });
    expect(a.db.prepare("SELECT COUNT(*) AS n FROM fights").get()).toEqual({ n: 2 });
    expect(fs.readdirSync(path.join(dir, "uploads"))).toEqual([]);
  });

  it("lutas já prontas ou com erro não contam na fila", async () => {
    const a = await start({ UPLOAD_MAX_QUEUE: "1" });
    putRow(a, "d1", "done", new Date().toISOString());
    putRow(a, "e1", "error", new Date().toISOString());

    expect((await upload(a, [{ name: "a.json", content: fightJson(1) }])).json()[0].status).toBe("queued");
  });

  it("limite por hora: conta só os envios da última hora", async () => {
    const a = await start({ UPLOAD_MAX_PER_HOUR: "2" });
    putRow(a, "velho", "done", new Date(Date.now() - 2 * 3600_000).toISOString());
    putRow(a, "h1", "done", new Date().toISOString());

    expect((await upload(a, [{ name: "a.json", content: fightJson(1) }])).json()[0].status).toBe("queued");

    const res = await upload(a, [{ name: "b.json", content: fightJson(2) }]);
    expect(res.json()[0]).toMatchObject({ file: "b.json", code: "hourlyLimit" });
  });

  it("disco cheio: recusa com diskFull quando a pasta de envios passa do teto", async () => {
    const a = await start({ UPLOAD_MAX_DISK_MB: "0.0005" });
    fs.writeFileSync(path.join(dir, "uploads", "antigo.zevtc"), Buffer.alloc(2048));

    const res = await upload(a, [{ name: "a.json", content: fightJson(1) }]);

    expect(res.json()[0]).toMatchObject({ file: "a.json", code: "diskFull" });
  });

  it("no mesmo pedido, o que cabe entra e o que passa do limite é recusado", async () => {
    const a = await start({ UPLOAD_MAX_PER_HOUR: "1" });

    const res = await upload(a, [
      { name: "a.json", content: fightJson(1) },
      { name: "b.json", content: fightJson(2) },
    ]);

    expect(res.json().map((r: any) => r.code ?? r.status)).toEqual(["queued", "hourlyLimit"]);
  });

  it("log duplicado não é recusado por fila cheia: continua sendo só ignorado", async () => {
    const a = await start({ UPLOAD_MAX_QUEUE: "1" });
    const first = await upload(a, [{ name: "a.json", content: fightJson(1) }]);
    expect(first.json()[0].status).toBe("queued");

    const again = await upload(a, [{ name: "a.json", content: fightJson(1) }]);

    expect(again.json()[0]).toMatchObject({ duplicate: true });
    expect(again.json()[0].code).toBeUndefined();
  });

  it("extensão inválida continua dando badFormat antes de olhar os limites", async () => {
    const a = await start({ UPLOAD_MAX_QUEUE: "1" });
    putRow(a, "q1", "queued", new Date().toISOString());

    expect((await upload(a, [{ name: "virus.exe", content: "x" }])).json()[0].code).toBe("badFormat");
  });
});

describe("configuração dos limites", () => {
  it("valores padrão sensatos", () => {
    const c = loadConfig({});

    expect(c.limits).toEqual({ maxFailedKeys: 5, blockMinutes: 15, maxQueue: 30, maxPerHour: 500, maxUploadsMb: 4096 });
    expect(c.trustProxy).toBe(false);
  });

  it("lê as variáveis de ambiente e ignora valor inválido", () => {
    const c = loadConfig({ UPLOAD_MAX_FAILS: "3", UPLOAD_MAX_QUEUE: "abc", UPLOAD_MAX_DISK_MB: "-5", TRUST_PROXY: "true" });

    expect(c.limits.maxFailedKeys).toBe(3);
    expect(c.limits.maxQueue).toBe(30);
    expect(c.limits.maxUploadsMb).toBe(4096);
    expect(c.trustProxy).toBe(true);
  });
});
