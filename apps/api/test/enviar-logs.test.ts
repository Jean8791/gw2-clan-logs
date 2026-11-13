import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";

const run = promisify(execFile);
const script = path.resolve(import.meta.dirname, "../../../scripts/enviar-logs.sh");

let app: App;
let dir: string;
let home: string;
let url: string;

const start = async (env: Record<string, string> = {}) => {
  app = await buildApp(loadConfig({ DATA_DIR: dir, UPLOAD_KEY: "chave-certa", GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }));
  await app.server.listen({ port: 0, host: "127.0.0.1" });
  url = `http://127.0.0.1:${(app.server.server.address() as { port: number }).port}`;
};
const logFile = (name: string, n: number) => {
  const f = path.join(home, name);
  fs.writeFileSync(f, JSON.stringify({ ...wvwFixture(), fightName: `Luta ${n}` }));
  return f;
};
/** Roda o script e devolve saída e código de saída (não lança quando o código não é 0). */
const enviar = async (args: string[], key = "chave-certa") => {
  const env = { PATH: process.env.PATH, HOME: home, GW2LOGS_URL: url, GW2LOGS_KEY: key };
  try {
    const r = await run("bash", [script, ...args], { env });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e: any) {
    return { code: e.code as number, out: String(e.stdout) + String(e.stderr) };
  }
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-env-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-home-"));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("scripts/enviar-logs.sh", () => {
  it("envia os logs de um arquivo e de uma pasta, e a luta aparece na API", async () => {
    await start();
    const a = logFile("a.json", 1);
    fs.mkdirSync(path.join(home, "pasta"));
    fs.writeFileSync(path.join(home, "pasta", "b.json"), JSON.stringify({ ...wvwFixture(), fightName: "Luta 2" }));
    fs.writeFileSync(path.join(home, "pasta", "leia-me.txt"), "não é log");

    const r = await enviar([a, path.join(home, "pasta")]);
    await app.worker.idle();

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/2 enviado/);
    expect((await app.server.inject("/api/fights")).json()).toHaveLength(2);
  });

  it("não reenvia o que já foi enviado (guarda o que já mandou)", async () => {
    await start();
    const a = logFile("a.json", 1);
    await enviar([a]);

    const again = await enviar([a]);

    expect(again.code).toBe(0);
    expect(again.out).toMatch(/0 enviado/);
    expect(again.out).toMatch(/1 já enviado/);
  });

  it("chave errada: para com erro e não vaza a chave na saída", async () => {
    await start();
    const r = await enviar([logFile("a.json", 1)], "chave-errada");

    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/senha|chave/i);
    expect(r.out).not.toContain("chave-errada");
    expect((await app.server.inject("/api/fights")).json()).toHaveLength(0);
  });

  it("bloqueado por senhas erradas (429): para e avisa para tentar mais tarde", async () => {
    await start({ UPLOAD_MAX_FAILS: "1" });
    await enviar([logFile("a.json", 1)], "chave-errada");

    const r = await enviar([logFile("b.json", 2)]);

    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/mais tarde|bloquead/i);
  });

  it("limite por hora: para e diz quantos ficaram sem enviar", async () => {
    await start({ UPLOAD_MAX_PER_HOUR: "1" });
    const r = await enviar([logFile("a.json", 1), logFile("b.json", 2), logFile("c.json", 3)]);

    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/limite/i);
    expect(r.out).toMatch(/1 enviado/);
  });

  it("sem URL ou sem chave configuradas, explica como configurar", async () => {
    await start();
    const r = await run("bash", [script, "x.json"], { env: { PATH: process.env.PATH, HOME: home } }).then(
      (o) => ({ code: 0, out: o.stderr }),
      (e) => ({ code: e.code as number, out: String(e.stderr) }),
    );

    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/GW2LOGS_URL/);
  });
});

describe("scripts/enviar-logs.sh: registro do que já foi enviado", () => {
  it("é separado por servidor: o que foi enviado a um endereço é enviado ao outro", async () => {
    await start();
    const a = logFile("a.json", 1);
    await enviar([a]);
    const outro = await buildApp(loadConfig({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-env2-")), UPLOAD_KEY: "chave-certa", GW2_API: "off" }));
    await outro.server.listen({ port: 0, host: "127.0.0.1" });
    const urlOutro = `http://127.0.0.1:${(outro.server.server.address() as { port: number }).port}`;

    const env = { PATH: process.env.PATH, HOME: home, GW2LOGS_URL: urlOutro, GW2LOGS_KEY: "chave-certa" };
    const r = await run("bash", [script, a], { env });
    await outro.worker.idle();
    await outro.server.close();

    expect(r.stdout).toMatch(/1 enviado/);
  });
});
