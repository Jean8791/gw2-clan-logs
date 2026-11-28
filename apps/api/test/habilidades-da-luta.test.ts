import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import * as q from "../src/queries.js";
import { buildApp, type App } from "../src/server.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-hluta-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
  app.db.prepare("INSERT INTO skills (id, name) VALUES (1, 'Golpe'), (2, 'Rajada'), (100, 'Cura A'), (200, 'Barreira B')").run();
  luta("F1", 10);
  luta("F2", 11);
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function luta(id: string, mapa: number) {
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', 'x', '2026-11-03T20:00:00.000Z', 'wvw', ?, 120000, 10, 1000)")
    .run(id, "sha-" + id, mapa);
  app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms) VALUES (?, 'Ana.1', 'Ana', 'Firebrand', 'support', 60000)").run(id);
}
const dano = (luta: string, conta: string, skill: number, damage: number, hits: number, conectados: number) =>
  app.db.prepare("INSERT INTO player_skills (fight_id, account, skill_id, damage, hits, connected_hits) VALUES (?, ?, ?, ?, ?, ?)").run(luta, conta, skill, damage, hits, conectados);
const apoio = (luta: string, conta: string, skill: number, kind: string, amount: number, hits: number, indirect = 0) =>
  app.db.prepare("INSERT INTO player_support_skills (fight_id, account, skill_id, kind, amount, downed_amount, hits, indirect) VALUES (?, ?, ?, ?, ?, 0, ?, ?)").run(luta, conta, skill, kind, amount, hits, indirect);

describe("habilidades de um jogador em uma luta", () => {
  it("dano: só a luta pedida, da habilidade que mais causou dano para a que menos, com % e média por acerto", () => {
    dano("F1", "Ana.1", 1, 300, 5, 3);
    dano("F1", "Ana.1", 2, 100, 2, 2);
    dano("F2", "Ana.1", 1, 9999, 9, 9);

    expect(q.fightPlayerSkills(app.db, "F1", "Ana.1")).toEqual([
      { skillId: 1, name: "Golpe", damage: 300, hits: 5, connectedHits: 3, pct: 75, avgHit: 100 },
      { skillId: 2, name: "Rajada", damage: 100, hits: 2, connectedHits: 2, pct: 25, avgHit: 50 },
    ]);
  });

  it("cura e barreira não se misturam, e o % fecha em 100 dentro de cada tipo", () => {
    apoio("F1", "Ana.1", 100, "heal", 60, 3);
    apoio("F1", "Ana.1", 100, "heal", 20, 5, 1);
    apoio("F1", "Ana.1", 200, "barrier", 40, 2);
    apoio("F2", "Ana.1", 100, "heal", 5000, 1);

    const cura = q.fightPlayerSupportSkills(app.db, "F1", "Ana.1", "heal");

    expect(cura.map((s) => [s.skillId, s.indirect, s.amount, s.pct])).toEqual([[100, false, 60, 75], [100, true, 20, 25]]);
    expect(q.fightPlayerSupportSkills(app.db, "F1", "Ana.1", "barrier").map((s) => [s.skillId, s.amount, s.pct])).toEqual([[200, 40, 100]]);
  });

  it("jogador sem habilidades na luta: lista vazia", () => {
    expect(q.fightPlayerSkills(app.db, "F1", "Outro.9")).toEqual([]);
    expect(q.fightPlayerSupportSkills(app.db, "F1", "Outro.9", "heal")).toEqual([]);
  });
});

describe("GET /api/fights/:id/players/:account/skills", () => {
  const get = (url: string) => app.server.inject({ method: "GET", url });

  it("devolve o dano por padrão e a cura ou a barreira com kind", async () => {
    dano("F1", "Ana.1", 1, 300, 5, 3);
    apoio("F1", "Ana.1", 100, "heal", 60, 3);

    expect((await get("/api/fights/F1/players/Ana.1/skills")).json().map((s: { skillId: number }) => s.skillId)).toEqual([1]);
    expect((await get("/api/fights/F1/players/Ana.1/skills?kind=damage")).json()).toHaveLength(1);
    expect((await get("/api/fights/F1/players/Ana.1/skills?kind=heal")).json().map((s: { skillId: number }) => s.skillId)).toEqual([100]);
  });

  it("kind desconhecido dá 400 badKind e luta que não existe dá 404", async () => {
    const ruim = await get("/api/fights/F1/players/Ana.1/skills?kind=xx");
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().code).toBe("badKind");
    expect((await get("/api/fights/NAO/players/Ana.1/skills")).statusCode).toBe(404);
  });
});
