import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";

let app: App;
let dir: string;

async function iniciar(env: Record<string, string> = {}) {
  if (app) await app.server.close();
  fs.mkdirSync(path.join(dir, "site", "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "site", "index.html"), "<!doctype html><title>site</title>");
  fs.writeFileSync(path.join(dir, "site", "assets", "app.js"), "1");
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "site"), ...env }));
}
const ler = (url: string, ip = "10.0.0.1", headers: Record<string, string> = {}) => app.server.inject({ url, remoteAddress: ip, headers });
/** Faz `n` pedidos seguidos e devolve os códigos de resposta. */
const rajada = async (n: number, url = "/api/config", ip = "10.0.0.1", headers: Record<string, string> = {}) => {
  const codigos: number[] = [];
  for (let i = 0; i < n; i++) codigos.push((await ler(url, ip, headers)).statusCode);
  return codigos;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-rate-"));
  app = undefined as unknown as App;
});
afterEach(async () => {
  if (app) await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("limite de requisições por IP", () => {
  it("passou do limite por minuto: 429 com o código tooManyRequests e o tempo de espera", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "5" });

    expect(await rajada(5)).toEqual([200, 200, 200, 200, 200]);
    const res = await ler("/api/config");

    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: "tooManyRequests" });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("cada IP tem a sua conta: um IP no limite não barra os outros", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "3" });

    await rajada(4, "/api/config", "10.0.0.1");

    expect((await ler("/api/config", "10.0.0.1")).statusCode).toBe(429);
    expect((await ler("/api/config", "10.0.0.2")).statusCode).toBe(200);
  });

  it("atrás do proxy (TRUST_PROXY) vale o IP do X-Forwarded-For: dois clientes, duas contas", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "2", TRUST_PROXY: "true" });
    const via = (ip: string) => ({ "x-forwarded-for": ip });

    await rajada(3, "/api/config", "172.18.0.5", via("203.0.113.10"));

    expect((await ler("/api/config", "172.18.0.5", via("203.0.113.10"))).statusCode).toBe(429);
    expect((await ler("/api/config", "172.18.0.5", via("203.0.113.11"))).statusCode).toBe(200);
  });

  it("sem TRUST_PROXY o X-Forwarded-For é ignorado: trocar o cabeçalho não dá uma conta nova", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "2" });

    await rajada(3, "/api/config", "10.0.0.1", { "x-forwarded-for": "1.1.1.1" });

    expect((await ler("/api/config", "10.0.0.1", { "x-forwarded-for": "2.2.2.2" })).statusCode).toBe(429);
  });

  it("o alerta de fora do ar (/api/health), o site e os ícones não contam no limite", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "3" });

    for (const url of ["/api/health", "/", "/ranking", "/assets/app.js", "/api/media/buff:1"]) {
      const codigos = await rajada(12, url);
      expect(codigos.includes(429), url).toBe(false);
    }
    expect((await ler("/api/config")).statusCode).toBe(200); // e o limite das rotas da API continua inteiro
  });

  it("escrever a URL de outro jeito (letra codificada, %61 = a) não foge do limite: vale a rota que o servidor casou", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "2" });

    expect(await rajada(4, "/%61pi/config")).toEqual([200, 200, 429, 429]);
    expect(await rajada(4, "/%61pi/health")).toEqual([200, 200, 200, 200]); // a rota isenta também é a mesma, escrita de qualquer jeito
  });

  it("só o login limita quando o geral está desligado, e sem limite próprio o login vale só o geral", async () => {
    await iniciar({ DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", ALLOW_ANY_DISCORD: "true", RATE_LIMIT_PER_MIN: "0", RATE_LIMIT_AUTH_PER_MIN: "2" });
    expect(await rajada(3, "/api/auth/login")).toEqual([302, 302, 429]);
    expect((await rajada(20)).every((c) => c === 200)).toBe(true); // o resto da API sem limite

    await iniciar({ DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", ALLOW_ANY_DISCORD: "true", RATE_LIMIT_PER_MIN: "3", RATE_LIMIT_AUTH_PER_MIN: "0" });
    expect(await rajada(4, "/api/auth/login")).toEqual([302, 302, 302, 429]); // só o geral
  });

  it("RATE_LIMIT_PER_MIN=0 desliga o limite", async () => {
    await iniciar({ RATE_LIMIT_PER_MIN: "0" });

    expect((await rajada(40)).every((c) => c === 200)).toBe(true);
  });

  it("o login e o retorno do Discord têm um limite mais baixo, separado do geral", async () => {
    await iniciar({ DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", ALLOW_ANY_DISCORD: "true", RATE_LIMIT_AUTH_PER_MIN: "2" });

    const login = await rajada(3, "/api/auth/login");
    const retorno = await rajada(3, "/api/auth/callback?error=access_denied");

    expect(login).toEqual([302, 302, 429]);
    expect(retorno).toEqual([302, 302, 429]); // a conta do retorno é separada da do login
    expect((await ler("/api/config")).statusCode).toBe(200); // o resto da API segue livre
  });

  it("gerar a chave do script também tem o limite mais baixo, na conta própria", async () => {
    await iniciar({ DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "csecret", ALLOW_ANY_DISCORD: "true", RATE_LIMIT_AUTH_PER_MIN: "2" });
    const gerar = async () => (await app.server.inject({ method: "POST", url: "/api/auth/token", remoteAddress: "10.0.0.1" })).statusCode;

    expect([await gerar(), await gerar(), await gerar()]).toEqual([401, 401, 429]); // sem sessão dá 401; o terceiro pedido já passa do limite
    expect(await rajada(2, "/api/auth/login")).toEqual([302, 302]); // o login tem a conta dele
  });
});

describe("configuração do limite", () => {
  it("padrões folgados e valores inválidos voltam ao padrão", () => {
    expect(loadConfig({}).rateLimit).toEqual({ perMin: 600, authPerMin: 30 });
    expect(loadConfig({ RATE_LIMIT_PER_MIN: "abc", RATE_LIMIT_AUTH_PER_MIN: "-5" }).rateLimit).toEqual({ perMin: 600, authPerMin: 30 });
    expect(loadConfig({ RATE_LIMIT_PER_MIN: "120", RATE_LIMIT_AUTH_PER_MIN: "10" }).rateLimit).toEqual({ perMin: 120, authPerMin: 10 });
    expect(loadConfig({ RATE_LIMIT_PER_MIN: "0" }).rateLimit.perMin).toBe(0);
    // só número inteiro: 0,5 não pode virar 0 e desligar o limite sem querer
    expect(loadConfig({ RATE_LIMIT_PER_MIN: "0.5", RATE_LIMIT_AUTH_PER_MIN: "2.5" }).rateLimit).toEqual({ perMin: 600, authPerMin: 30 });
  });
});
