import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-aberto-"));
  fs.mkdirSync(path.join(dir, "site"));
  fs.writeFileSync(path.join(dir, "site", "index.html"), "<!doctype html><title>site</title>");
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("links antigos de espaço (/u/<id>) levam ao mesmo caminho na raiz", () => {
  it.each([
    ["/u/abc123", "/"],
    ["/u/abc123/", "/"],
    ["/u/abc123/fights", "/fights"],
    ["/u/abc123/fights/f1", "/fights/f1"],
    ["/u/abc123/ranking?mode=wvw&days=7", "/ranking?mode=wvw&days=7"],
    ["/u/abc123?mode=wvw", "/?mode=wvw"],
  ])("%s -> %s", async (de, para) => {
    const res = await app.server.inject(de);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(para);
  });

  it("caminho que só parece com /u/ não é redirecionado", async () => {
    const res = await app.server.inject("/usuarios/abc");

    expect(res.statusCode).toBe(200); // o site abre (o React mostra a página não encontrada)
  });
});

describe("a leitura é aberta, mas pede para os buscadores não indexarem", () => {
  it("o robots.txt proíbe tudo", async () => {
    const res = await app.server.inject("/robots.txt");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("User-agent: *\nDisallow: /\n");
  });

  it("a API e as páginas respondem com X-Robots-Tag noindex", async () => {
    for (const url of ["/api/fights", "/fights", "/api/health"]) {
      const res = await app.server.inject(url);

      expect(res.headers["x-robots-tag"], url).toBe("noindex, nofollow");
    }
  });
});

describe("o redirecionamento nunca leva para fora do site", () => {
  // com `//` ou `\` o @fastify/static já responde 403 antes do redirecionamento; o teste vale para as duas camadas
  it.each(["/u/x//evil.com", "/u/x///evil.com/a", "/u/x/\\evil.com", "/u/x/\\/evil.com?a=1", "/u/x/..//evil.com"])("%s", async (de) => {
    const res = await app.server.inject(de);
    const destino = String(res.headers.location ?? "");

    expect([302, 403]).toContain(res.statusCode);
    expect(destino.startsWith("//") || destino.startsWith("/\\")).toBe(false);
  });

  it("barras codificadas viram um caminho do próprio site", async () => {
    const res = await app.server.inject("/u/x/%2F%2Fevil.com");

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/%2F%2Fevil.com");
  });
});
