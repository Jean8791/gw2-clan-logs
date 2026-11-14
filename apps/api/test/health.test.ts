import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";

let app: App | undefined;
let dir = "";
afterEach(async () => {
  await app?.server.close().catch(() => undefined);
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
const start = async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-health-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, UPLOAD_KEY: "segredo", GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
  return app;
};

describe("GET /api/health: para o alerta de site fora do ar", () => {
  it("responde 200 com status ok e o tamanho da fila, sem exigir senha", async () => {
    const a = await start();
    a.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('q', 'sq', 'queued', ?), ('p', 'sp', 'parsing', ?), ('d', 'sd', 'done', ?)").run(...Array(3).fill(new Date().toISOString()));

    const res = await a.server.inject("/api/health");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", queue: { queued: 1, parsing: 1 } });
  });

  it("não expõe segredo nem dado dos jogadores", async () => {
    const a = await start();

    const body = (await a.server.inject("/api/health")).body;

    expect(body).not.toContain("segredo");
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["queue", "status"]);
  });

  it("responde 503 quando o banco não responde", async () => {
    const a = await start();
    a.db.close();

    const res = await a.server.inject("/api/health");

    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("error");
  });

  it("não é bloqueado por tentativas de senha erradas (o monitor precisa sempre conseguir perguntar)", async () => {
    const a = await start();
    for (let i = 0; i < 10; i++) await a.server.inject({ method: "POST", url: "/api/upload", headers: { "x-upload-key": "errada", "content-type": "multipart/form-data; boundary=x" }, payload: "--x--\r\n" });

    expect((await a.server.inject("/api/health")).statusCode).toBe(200);
  });
});
