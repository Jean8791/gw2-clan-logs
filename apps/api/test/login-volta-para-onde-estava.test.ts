import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";

let app: App;
let dir: string;
let quem = { id: "777", username: "fulano" };

/** Discord de mentira: troca o code por um token e devolve o perfil de `quem`. */
const discordFalso = ((url: string | URL) => {
  const corpo = String(url).endsWith("/oauth2/token") ? { access_token: "tok" } : { ...quem, avatar: null };
  return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } }));
}) as unknown as typeof fetch;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-next-"));
  quem = { id: "777", username: "fulano" };
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const iniciar = async (env: Record<string, string> = {}) => {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), DISCORD_CLIENT_ID: "cid", DISCORD_CLIENT_SECRET: "cs", PUBLIC_URL: "https://logs.exemplo.test", ...env }), { fetch: discordFalso });
};
const cookiesDe = (res: { headers: Record<string, unknown> }) => [res.headers["set-cookie"]].flat().map((c) => String(c).split(";")[0]!).join("; ");

/** Faz o login inteiro (ida e volta do Discord) e devolve para onde o servidor mandou o navegador. */
async function entrar(next?: string) {
  const ida = await app.server.inject(`/api/auth/login${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`);
  const state = new URL(String(ida.headers.location)).searchParams.get("state");
  const volta = await app.server.inject({ url: `/api/auth/callback?code=abc&state=${state}`, headers: { cookie: cookiesDe(ida) } });
  return String(volta.headers.location);
}

describe("depois de entrar, volta para a tela de onde a pessoa saiu", () => {
  it("o caminho (com os filtros) vai e volta pelo login", async () => {
    await iniciar();

    expect(await entrar("/ranking?mode=wvw&days=7")).toBe("/ranking?mode=wvw&days=7");
  });

  it("a página de Meu perfil também volta", async () => {
    await iniciar();

    expect(await entrar("/me")).toBe("/me");
  });

  it("sem destino, continua como antes: importar se não tem lutas, visão geral se tem", async () => {
    await iniciar();

    expect(await entrar()).toBe("/import");
    expect(await entrar()).toBe("/import"); // entrar de novo, ainda sem lutas
    const ana = app.db.prepare("SELECT id FROM users WHERE discord_id = '777'").get() as { id: number };
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('f1', 's1', 'done', ?, ?)").run(new Date().toISOString(), ana.id);
    expect(await entrar()).toBe("/");
  });

  it.each(["//evil.com", "///evil.com", "/\\evil.com", "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "evil.com", "/ok\nSet-Cookie: x=1", "/" + "a".repeat(400)])(
    "destino que sairia do site é ignorado: %s",
    async (next) => {
      await iniciar();

      expect(await entrar(next)).toBe("/import");
    },
  );

  it("login negado não segue o destino: volta para a entrada com o aviso", async () => {
    await iniciar({ DISCORD_USER_IDS: "999" });

    expect(await entrar("/ranking")).toBe("/?erro=notAllowed");
  });

  it("o destino vale uma vez só: o login seguinte, sem destino, não reaproveita o antigo", async () => {
    await iniciar();
    await entrar("/ranking");

    expect(await entrar()).toBe("/import");
  });
});
