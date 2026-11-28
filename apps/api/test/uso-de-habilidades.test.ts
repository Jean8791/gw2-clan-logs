import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import * as q from "../src/queries.js";
import { buildApp, type App } from "../src/server.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

const cast = (id: number, vezes: number) => ({ id, skills: Array.from({ length: vezes }, (_, i) => ({ castTime: 1000 * i, duration: 500, timeGained: 0, quickness: 0 })) });
const taken = (id: number, total: number, hits: number, indirect = false) => ({ id, totalDamage: total, hits, connectedHits: hits, min: 1, max: total, indirectDamage: indirect });

/** Luta com o Comandante usando habilidades (rotação) e recebendo dano por habilidade. */
function lutaComUso() {
  const f: any = wvwFixture();
  f.skillMap = { s100: { name: "Cura A" }, "s-2": { name: "Troca de arma" }, s300: { name: "Golpe inimigo" } };
  f.buffMap = { b800: { name: "Sangramento" } };
  const cmd = f.players[0];
  cmd.rotation = [cast(100, 4), cast(-2, 2), cast(555, 0)];
  cmd.totalDamageTaken = [[taken(300, 200, 5), taken(800, 50, 10, true), taken(301, 0, 0)]];
  return f;
}
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;

describe("extractFight: usos de habilidade (rotação) e dano recebido por habilidade", () => {
  it("rotação: uma linha por habilidade com o número de usos; habilidade sem nenhum uso não vira linha", () => {
    expect(comandante(lutaComUso()).skillUsage.filter((u) => u.kind === "cast")).toEqual([
      { id: 100, name: "Cura A", kind: "cast", amount: 4, hits: 4, indirect: false },
      { id: -2, name: "Troca de arma", kind: "cast", amount: 2, hits: 2, indirect: false },
    ]);
  });

  it("dano recebido: a indireta (condição) leva o nome do buff, e a que não causou dano não vira linha", () => {
    expect(comandante(lutaComUso()).skillUsage.filter((u) => u.kind === "taken")).toEqual([
      { id: 300, name: "Golpe inimigo", kind: "taken", amount: 200, hits: 5, indirect: false },
      { id: 800, name: "Sangramento", kind: "taken", amount: 50, hits: 10, indirect: true },
    ]);
  });

  it("sem rotação nem dano recebido no log, nenhuma linha e nenhum erro", () => {
    const json = lutaComUso();
    delete json.players[0].rotation;
    delete json.players[0].totalDamageTaken;

    expect(comandante(json).skillUsage).toEqual([]);
  });

  it("a mesma conta em duas instâncias soma usos e dano recebido das habilidades iguais", () => {
    const json = lutaComUso();
    const segunda = JSON.parse(JSON.stringify(json.players[0]));
    segunda.hasCommanderTag = false;
    segunda.rotation = [cast(100, 3)];
    segunda.totalDamageTaken = [[taken(300, 100, 2)]];
    json.players.push(segunda);

    const u = comandante(json).skillUsage;

    expect(u.find((x) => x.kind === "cast" && x.id === 100)).toMatchObject({ amount: 7, hits: 7 });
    expect(u.find((x) => x.kind === "taken" && x.id === 300)).toMatchObject({ amount: 300, hits: 7 });
    expect(u.filter((x) => x.id === 100)).toHaveLength(1);
  });
});

describe("saveFight e consultas: usos de habilidade", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-uso-"));
    db = openDb(path.join(dir, "t.db"));
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('F1', 'F1', 'queued', ?)").run(new Date().toISOString());
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const salvar = (json: any) => saveFight(db, "F1", extractFight(json), null, false, true);
  const linhas = () => db.prepare("SELECT account, skill_id, kind, amount, hits, indirect FROM player_skill_usage ORDER BY kind, skill_id").all();

  it("grava uma linha por habilidade e tipo, com o nome na tabela de habilidades", () => {
    salvar(lutaComUso());

    expect(linhas()).toEqual([
      { account: "Comandante.1111", skill_id: -2, kind: "cast", amount: 2, hits: 2, indirect: 0 },
      { account: "Comandante.1111", skill_id: 100, kind: "cast", amount: 4, hits: 4, indirect: 0 },
      { account: "Comandante.1111", skill_id: 300, kind: "taken", amount: 200, hits: 5, indirect: 0 },
      { account: "Comandante.1111", skill_id: 800, kind: "taken", amount: 50, hits: 10, indirect: 1 },
    ]);
    expect(db.prepare("SELECT name FROM skills WHERE id IN (-2, 100, 300, 800) ORDER BY id").all()).toEqual([{ name: "Troca de arma" }, { name: "Cura A" }, { name: "Golpe inimigo" }, { name: "Sangramento" }]);
  });

  it("gravar a mesma luta de novo troca as linhas, e apagar a luta apaga as habilidades (retenção)", () => {
    salvar(lutaComUso());
    salvar(lutaComUso());
    expect(linhas()).toHaveLength(4);

    db.prepare("DELETE FROM fights WHERE id = 'F1'").run();

    expect(linhas()).toEqual([]);
  });

  it("fightPlayerUsage: só a luta pedida, em ordem, com % que fecha em 100 e média por acerto", () => {
    salvar(lutaComUso());

    const usos = q.fightPlayerUsage(db, "F1", "Comandante.1111", "cast");
    const recebido = q.fightPlayerUsage(db, "F1", "Comandante.1111", "taken");

    expect(usos.map((u) => [u.skillId, u.name, u.amount, u.pct.toFixed(1)])).toEqual([[100, "Cura A", 4, "66.7"], [-2, "Troca de arma", 2, "33.3"]]);
    expect(recebido.map((u) => [u.skillId, u.indirect, u.amount, u.pct, u.avgHit])).toEqual([[300, false, 200, 80, 40], [800, true, 50, 20, 5]]);
    expect(q.fightPlayerUsage(db, "F1", "Outro.9", "cast")).toEqual([]);
  });

  it("playerUsage: soma as lutas filtradas", () => {
    salvar(lutaComUso());
    db.prepare("UPDATE fights SET time_start = '2026-11-03T20:00:00.000Z', mode = 'wvw', map_id = 1, duration_ms = 60000 WHERE id = 'F1'").run();

    const usos = q.playerUsage(db, "Comandante.1111", {}, "cast");

    expect(usos.map((u) => [u.skillId, u.amount])).toEqual([[100, 4], [-2, 2]]);
  });

  it("banco antigo, sem a tabela, ganha a tabela ao abrir", () => {
    db.close();
    const file = path.join(dir, "antigo.db");
    const velho = new Database(file);
    velho.exec("CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);");
    velho.close();

    db = openDb(file);

    expect((db.pragma("table_info(player_skill_usage)") as { name: string }[]).map((c) => c.name)).toEqual(["fight_id", "account", "skill_id", "kind", "amount", "hits", "indirect"]);
  });
});

describe("rotas de usos de habilidade", () => {
  let app: App;
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-usor-"));
    app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms) VALUES ('F1', 'F1', 'done', 'x', '2026-11-03T20:00:00.000Z', 'wvw', 1, 60000)").run();
    app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms) VALUES ('F1', 'Ana.1', 'Ana', 'Firebrand', 'support', 60000)").run();
    app.db.prepare("INSERT INTO player_skill_usage (fight_id, account, skill_id, kind, amount, hits, indirect) VALUES ('F1', 'Ana.1', 100, 'cast', 4, 4, 0)").run();
  });
  afterEach(async () => {
    await app.worker.idle();
    await app.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const get = (url: string) => app.server.inject({ method: "GET", url });

  it("a rota da luta aceita kind=cast e kind=taken", async () => {
    expect((await get("/api/fights/F1/players/Ana.1/skills?kind=cast")).json().map((s: { skillId: number }) => s.skillId)).toEqual([100]);
    expect((await get("/api/fights/F1/players/Ana.1/skills?kind=taken")).json()).toEqual([]);
  });

  it("a rota do jogador devolve os usos (ou o dano recebido) nos filtros, e kind desconhecido dá 400", async () => {
    expect((await get("/api/players/Ana.1/skill-usage?kind=cast")).json().map((s: { amount: number }) => s.amount)).toEqual([4]);
    const ruim = await get("/api/players/Ana.1/skill-usage?kind=xx");
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().code).toBe("badKind");
  });
});
