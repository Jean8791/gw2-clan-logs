import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFilters } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";

let app: App;
let dir: string;

function multipart(files: { name: string; content: string }[], fields: Record<string, string> = {}) {
  const boundary = "----teste" + Math.random().toString(16).slice(2);
  let body = "";
  for (const [k, v] of Object.entries(fields)) body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  for (const f of files)
    body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n${f.content}\r\n`;
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-test-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, UPLOAD_KEY: "segredo", GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterAll(async () => {
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("API", () => {
  const json = JSON.stringify(wvwFixture());

  it("recusa envio sem a senha", async () => {
    const res = await app.server.inject({ method: "POST", url: "/api/upload", ...multipart([{ name: "a.json", content: json }]) });
    expect(res.statusCode).toBe(401);
  });

  it("aceita o JSON do EI, processa e ignora duplicado", async () => {
    const m = multipart([{ name: "luta.json", content: json }], { uploader: "Tester" });
    const res = await app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": "segredo" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].status).toBe("queued");
    await app.worker.idle();

    const dup = await app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": "segredo" } });
    expect(dup.json()[0].duplicate).toBe(true);

    const fights = (await app.server.inject("/api/fights")).json();
    expect(fights).toHaveLength(1);
    expect(fights[0].status).toBe("done");
    expect(fights[0].squadCount).toBe(3);
  });

  it("recusa extensão inválida", async () => {
    const m = multipart([{ name: "virus.exe", content: "x" }]);
    const res = await app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": "segredo" } });
    expect(res.json()[0].error).toMatch(/Invalid format/);
  });

  it("ranking filtra por guilda, função e aliança", async () => {
    const all = (await app.server.inject("/api/ranking")).json();
    expect(all.rows.map((r: any) => r.account)).toEqual(["Atacante.2222", "Outro.3333", "Comandante.1111"]);
    expect(all.baseline.fights).toBe(3);

    const guildA = (await app.server.inject("/api/ranking?guild=GUILD-A")).json();
    expect(guildA.rows).toHaveLength(2);

    const sup = (await app.server.inject("/api/ranking?role=support")).json();
    expect(sup.rows.map((r: any) => r.account)).toEqual(["Comandante.1111"]);

    // nenhuma guilda marcada como aliança ainda
    expect((await app.server.inject("/api/ranking?guild=alliance")).json().rows).toHaveLength(0);

    const denied = await app.server.inject({ method: "PUT", url: "/api/guilds/GUILD-B", payload: { inAlliance: true } });
    expect(denied.statusCode).toBe(401);
    const ok = await app.server.inject({ method: "PUT", url: "/api/guilds/GUILD-B", payload: { inAlliance: true }, headers: { "x-upload-key": "segredo" } });
    expect(ok.statusCode).toBe(200);
    expect((await app.server.inject("/api/ranking?guild=alliance")).json().rows.map((r: any) => r.account)).toEqual(["Outro.3333"]);
  });

  it("perfil do jogador e comparação", async () => {
    const p = (await app.server.inject("/api/players/Atacante.2222")).json();
    expect(p.history).toHaveLength(1);
    expect(p.totals.kills).toBe(3);
    expect((await app.server.inject("/api/players/Ninguem.0000")).statusCode).toBe(404);

    const c = (await app.server.inject("/api/compare?accounts=Atacante.2222,Outro.3333")).json();
    expect(c.players).toHaveLength(2);
  });

  it("filtros de luta: mapa e tamanho do squad", async () => {
    expect((await app.server.inject("/api/fights?minSquad=10")).json()).toHaveLength(0);
    expect((await app.server.inject("/api/fights?map=38")).json()).toHaveLength(1);
    expect((await app.server.inject("/api/fights?from=2026-11-14")).json()).toHaveLength(0);
    expect((await app.server.inject("/api/fights?to=2026-11-13")).json()).toHaveLength(1);
  });

  it("filtros De/Até com hora: a luta começou às 02:33:54Z", async () => {
    expect((await app.server.inject("/api/fights?from=2026-11-13T02:33:00Z")).json()).toHaveLength(1);
    expect((await app.server.inject("/api/fights?from=2026-11-13T02:34:00Z")).json()).toHaveLength(0);
    expect((await app.server.inject("/api/fights?to=2026-11-13T02:33:00Z")).json()).toHaveLength(0);
    expect((await app.server.inject("/api/fights?to=2026-11-13T02:34:00Z")).json()).toHaveLength(1);
  });
});

describe("parseFilters", () => {
  it("descarta valores inválidos", () => {
    expect(parseFilters({ mode: "xyz", days: "-3", minSquad: "15", role: "support", from: "2026-11-01", guild: "" })).toEqual({
      minSquad: 15,
      role: "support",
      from: "2026-11-01",
    });
  });

  it("De/Até aceitam só a data ou a data com hora em UTC", () => {
    expect(parseFilters({ from: "2026-11-01", to: "2026-11-02T03:30:00Z" })).toEqual({ from: "2026-11-01", to: "2026-11-02T03:30:00.000Z" });
    expect(parseFilters({ from: "2026-11-01T25:99:00Z" })).toEqual({ from: "2026-11-01" });
  });
});
