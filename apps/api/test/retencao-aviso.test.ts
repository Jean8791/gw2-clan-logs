import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retentionCutoff } from "@gw2logs/shared";
import { loadConfig, paths } from "../src/config.js";
import { purgeOldFights } from "../src/retention.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-prazo-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const DIAS = 30;
const AGORA = new Date("2026-11-20T12:00:00.000Z");
const CORTE = retentionCutoff(AGORA, DIAS);
const horas = (h: number) => new Date(Date.parse(CORTE) + h * 3_600_000).toISOString();

const luta = (owner: number, id: string, timeStart: string) =>
  app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id, time_start, mode) VALUES (?, ?, 'done', ?, ?, ?, 'wvw')").run(id, "sha-" + id, AGORA.toISOString(), owner, timeStart);
const foraDoPrazo = async (publicId: string) => ((await app.server.inject(`/api/fights?to=${encodeURIComponent(CORTE)}&limit=500`)).json() as { id: string }[]).map((f) => f.id).sort();
const restantes = () => (app.db.prepare("SELECT id FROM fights ORDER BY id").all() as { id: string }[]).map((r) => r.id);

describe("retentionCutoff: o corte do prazo é o mesmo no servidor e na tela", () => {
  it("é o instante de agora menos os dias do prazo, em ISO UTC", () => {
    expect(retentionCutoff(new Date("2026-11-20T12:00:00.000Z"), 30)).toBe("2026-10-21T12:00:00.000Z");
    expect(retentionCutoff(new Date("2026-11-20T12:00:00.000Z"), 1)).toBe("2026-11-19T12:00:00.000Z");
  });
});

describe("a lista de lutas fora do prazo (a que a tela de importar usa para avisar) é exatamente o que a limpeza apaga", () => {
  it("lutas anteriores ao corte entram na lista e são apagadas; as do corte em diante ficam nos dois", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "velha", horas(-1));
    luta(ana.id, "muito-velha", horas(-24 * 60));
    luta(ana.id, "recente", horas(+1));
    luta(ana.id, "no-corte", CORTE); // exatamente no corte: ainda vale (a regra é "mais velha que")

    expect(await foraDoPrazo(ana.publicId)).toEqual(["muito-velha", "velha"]);

    await purgeOldFights(app.db, paths(dir), DIAS, AGORA);
    expect(restantes()).toEqual(["no-corte", "recente"]);
  });

  it("sem luta fora do prazo, a lista é vazia", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "recente", horas(+1));

    expect(await foraDoPrazo(ana.publicId)).toEqual([]);
  });
});
