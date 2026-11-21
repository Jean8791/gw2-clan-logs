import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { reportForSandbox } from "../src/security.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;

/** Sobe o app com um index.html mínimo no lugar do site compilado. */
async function iniciar(env: Record<string, string> = {}) {
  if (app) await app.server.close();
  fs.mkdirSync(path.join(dir, "site"), { recursive: true });
  fs.writeFileSync(path.join(dir, "site", "index.html"), "<!doctype html><title>site</title>");
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "site"), ...env }));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-seg-"));
  app = undefined as unknown as App;
  await iniciar();
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cabecalho = (res: { headers: Record<string, unknown> }, nome: string) => res.headers[nome] as string | undefined;
const EVIL = "https://evil.example";

describe("cabeçalhos de segurança", () => {
  it.each([
    ["uma resposta da API", "/api/health"],
    ["uma rota da API que não existe", "/api/nao-existe"],
    ["a página do site", "/"],
    ["uma rota do React (fallback do index.html)", "/ranking"],
  ])("%s traz nosniff, X-Frame-Options, Referrer-Policy e Permissions-Policy", async (_nome, url) => {
    const res = await app.server.inject(url);

    expect(cabecalho(res, "x-content-type-options")).toBe("nosniff");
    expect(cabecalho(res, "x-frame-options")).toBe("DENY");
    expect(cabecalho(res, "referrer-policy")).toBe("no-referrer");
    expect(cabecalho(res, "permissions-policy")).toContain("camera=()");
  });

  it("HSTS só quando o endereço do site é https, por 180 dias e sem subdomínios", async () => {
    expect(cabecalho(await app.server.inject("/api/health"), "strict-transport-security")).toBeUndefined();

    await iniciar({ PUBLIC_URL: "https://logs.exemplo.test" });
    const hsts = cabecalho(await app.server.inject("/api/health"), "strict-transport-security");

    expect(hsts).toBe("max-age=15552000");
  });

  it("a página HTML do site traz a CSP: só o próprio site, o Google Fonts e nada de enquadrar o site", async () => {
    for (const url of ["/", "/ranking"]) {
      const csp = cabecalho(await app.server.inject(url), "content-security-policy")!;

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("https://fonts.googleapis.com");
      expect(csp).toContain("https://fonts.gstatic.com");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toMatch(/script-src 'self'(;|$)/); // sem 'unsafe-inline' nos scripts
    }
  });

  it("a resposta da API (JSON) não precisa de CSP", async () => {
    expect(cabecalho(await app.server.inject("/api/health"), "content-security-policy")).toBeUndefined();
  });

  it("o relatório HTML do Elite Insights roda isolado (CSP sandbox allow-scripts, sem a CSP global que quebraria os scripts dele) e leva nosniff", async () => {
    const ana = criarUsuario(app, "1", "ana");
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f1', 's', 'done', ?, ?)").run(new Date().toISOString(), ana.id);
    fs.mkdirSync(path.join(dir, "fights", "f1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fights", "f1", "report.html"), "<html><script>1</script></html>");

    const res = await app.server.inject(`/api/u/${ana.publicId}/fights/f1/report`);

    expect(res.statusCode).toBe(200);
    // origem opaca: o relatório roda scripts, mas não alcança o cookie da sessão nem a API do site
    expect(cabecalho(res, "content-security-policy")).toBe("sandbox allow-scripts");
    expect(cabecalho(res, "x-content-type-options")).toBe("nosniff");
  });

  it("o relatório sandboxed não quebra no localStorage: um script no início do <head> o anula quando o acesso é bloqueado", async () => {
    const ana = criarUsuario(app, "1", "ana");
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f2', 's2', 'done', ?, ?)").run(new Date().toISOString(), ana.id);
    fs.mkdirSync(path.join(dir, "fights", "f2"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fights", "f2", "report.html"), '<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.ORIGINAL = 1;</script></head><body></body></html>');

    const corpo = (await app.server.inject(`/api/u/${ana.publicId}/fights/f2/report`)).body;

    const shim = corpo.indexOf("localStorage");
    expect(shim).toBeGreaterThan(corpo.indexOf("<head>"));
    expect(shim).toBeLessThan(corpo.indexOf("window.ORIGINAL")); // roda antes dos scripts do relatório
    expect(corpo).toContain("window.ORIGINAL = 1;"); // o resto do relatório fica como estava
    expect(corpo).toContain('<meta charset="utf-8">');
  });

  it("a resposta de erro da rota do relatório (JSON) não leva o sandbox", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await app.server.inject(`/api/u/${ana.publicId}/fights/nao-existe/report`);

    expect(res.statusCode).toBe(404);
    expect(cabecalho(res, "content-security-policy")).toBeUndefined();
  });
});

describe("ações que mudam estado só valem vindas do próprio site (Origin e Sec-Fetch-Site)", () => {
  const cookieDe = (userId: number) => `session=${createSession(app.db, userId, "web")}`;
  const tokens = () => (app.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'api'").get() as { n: number }).n;
  const gerarToken = (headers: Record<string, string>, cookie: string) => app.server.inject({ method: "POST", url: "/api/auth/token", headers: { cookie, ...headers } });

  it("Origin de outro site é recusado com 403 em todas as rotas que mudam estado, e nada muda", async () => {
    await iniciar({ ADMIN_KEY: "admin" });
    const ana = criarUsuario(app, "1", "ana");
    const cookie = cookieDe(ana.id);
    const tokensAntes = tokens();
    const m = multipart([{ name: "luta.json", content: "{}" }]);
    const cena = { origin: EVIL };

    const respostas = await Promise.all([
      app.server.inject({ method: "POST", url: "/api/auth/token", headers: { cookie, ...cena } }),
      app.server.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, ...cena } }),
      app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { cookie, ...cena }, payload: { confirm: "ana" } }),
      app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, cookie, ...cena } }),
      app.server.inject({ method: "PUT", url: "/api/guilds/x", payload: { inAlliance: true }, headers: { "x-upload-key": "admin", ...cena } }),
    ]);

    expect(respostas.map((r) => r.statusCode)).toEqual([403, 403, 403, 403, 403]);
    expect(respostas[0]!.json().code).toBe("badOrigin");
    expect(tokens()).toBe(tokensAntes); // nenhum token novo
    expect((await app.server.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(200); // a sessão continua valendo
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(ana.id)).toEqual({ n: 1 }); // a conta não foi apagada
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights").get()).toEqual({ n: 0 });
  });

  it("Origin 'null' (página isolada) também é recusado", async () => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await gerarToken({ origin: "null" }, cookieDe(ana.id))).statusCode).toBe(403);
  });

  it("o Origin do próprio site passa: o endereço configurado (PUBLIC_URL) ou o Host da requisição", async () => {
    await iniciar({ PUBLIC_URL: "https://logs.exemplo.test" });
    const ana = criarUsuario(app, "1", "ana");
    const cookie = cookieDe(ana.id);

    expect((await gerarToken({ origin: "https://logs.exemplo.test" }, cookie)).statusCode).toBe(200);
    expect((await gerarToken({ origin: "http://localhost:5080", host: "localhost:5080" }, cookie)).statusCode).toBe(200);
  });

  it("sem Origin (o script de envio com token, curl) continua funcionando", async () => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await gerarToken({}, cookieDe(ana.id))).statusCode).toBe(200);
  });

  it.each([
    ["cross-site", 403],
    ["same-site", 403],
    ["same-origin", 200],
    ["none", 200],
  ])("Sec-Fetch-Site: %s dá %i", async (valor, status) => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await gerarToken({ "sec-fetch-site": valor }, cookieDe(ana.id))).statusCode).toBe(status);
  });

  it("leituras (GET) com Origin de outro site continuam respondendo: a leitura é pública", async () => {
    expect((await app.server.inject({ url: "/api/health", headers: { origin: EVIL } })).statusCode).toBe(200);
  });
});

describe("apagar a conta pede o nome para confirmar", () => {
  const apagar = (cookie: string, payload?: unknown) => app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { cookie }, payload: payload as object });
  const existe = (id: number) => (app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(id) as { n: number }).n === 1;

  it.each([
    ["sem corpo", undefined],
    ["com o nome vazio", { confirm: "" }],
    ["com o nome errado", { confirm: "beto" }],
    ["com o nome em outra caixa", { confirm: "ANA" }],
  ])("%s: 400 confirmName e a conta fica", async (_nome, payload) => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await apagar(`session=${createSession(app.db, ana.id, "web")}`, payload);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("confirmName");
    expect(existe(ana.id)).toBe(true);
  });

  it("com o nome certo apaga", async () => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await apagar(`session=${createSession(app.db, ana.id, "web")}`, { confirm: "ana" })).statusCode).toBe(200);
    expect(existe(ana.id)).toBe(false);
  });
});

describe("reportForSandbox: onde o script anti-localStorage entra no relatório", () => {
  const SCRIPT = "<script>try{window.localStorage}";

  it("logo depois do <head>, mesmo com atributos", () => {
    const html = reportForSandbox('<!DOCTYPE html><html><head lang="pt"><meta charset="utf-8"></head><body></body></html>');

    expect(html).toContain(`<head lang="pt">${SCRIPT}`);
  });

  it("<header> não é <head>: sem <head>, entra depois do doctype e deixa o <header> intacto", () => {
    const html = reportForSandbox('<!DOCTYPE html><html><body><header class="topo">T</header><script>window.O=1</script></body></html>');

    expect(html.startsWith(`<!DOCTYPE html>${SCRIPT}`)).toBe(true);
    expect(html).toContain('<header class="topo">T</header>');
    expect(html.match(/localStorage/g)).toHaveLength(2); // só o script anti-localStorage (try e defineProperty), uma vez
  });

  it("sem <head> e sem doctype, vai para o começo", () => {
    expect(reportForSandbox("<div>oi</div>").startsWith(SCRIPT)).toBe(true);
  });

  it("o doctype continua na primeira linha (senão o navegador cai em quirks mode)", () => {
    expect(reportForSandbox("<!doctype html><html><body></body></html>").startsWith("<!doctype html>")).toBe(true);
  });
});
