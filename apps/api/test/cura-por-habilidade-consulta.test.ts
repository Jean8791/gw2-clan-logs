import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlayerSupportSkill } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import * as q from "../src/queries.js";
import { buildApp, type App } from "../src/server.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-curaq-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
  app.db.prepare("INSERT INTO skills (id, name) VALUES (100, 'Cura A'), (200, 'Barreira B'), (700, 'Regeneração')").run();
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let mapa = 50;
type Habilidade = { id: number; kind: "heal" | "barrier"; amount: number; downed?: number; hits?: number; indirect?: boolean };
/** Luta pronta com um jogador e as habilidades de cura e barreira dele. */
function luta(id: string, inicio: string, conta: string, habilidades: Habilidade[], o: { classe?: string } = {}) {
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', 'x', ?, 'wvw', ?, 120000, 10, 1000)")
    .run(id, "sha-" + id, inicio, mapa++);
  app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms) VALUES (?, ?, ?, ?, 'support', 60000)").run(id, conta, conta.split(".")[0], o.classe ?? "Firebrand");
  for (const h of habilidades) {
    app.db
      .prepare("INSERT INTO player_support_skills (fight_id, account, skill_id, kind, amount, downed_amount, hits, indirect) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, conta, h.id, h.kind, h.amount, h.downed ?? 0, h.hits ?? 1, h.indirect ? 1 : 0);
  }
}
const noite = (dia: string) => `${dia}T20:00:00.000Z`;
const heal = (id: number, amount: number, o: Partial<Habilidade> = {}): Habilidade => ({ id, kind: "heal", amount, ...o });
const shield = (id: number, amount: number, o: Partial<Habilidade> = {}): Habilidade => ({ id, kind: "barrier", amount, ...o });

describe("playerSupportSkills: cura e barreira por habilidade, somadas nas lutas filtradas", () => {
  it("soma a mesma habilidade entre as lutas, da que mais curou para a que menos curou, com % e média por acerto", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 100, { downed: 20, hits: 4 }), heal(700, 50, { hits: 10, indirect: true })]);
    luta("b", noite("2026-11-04"), "Ana.1", [heal(100, 50, { downed: 5, hits: 6 })]);

    const skills = q.playerSupportSkills(app.db, "Ana.1", {}, "heal");

    expect(skills).toEqual([
      { skillId: 100, name: "Cura A", indirect: false, amount: 150, downedAmount: 25, hits: 10, pct: 75, avgHit: 15 },
      { skillId: 700, name: "Regeneração", indirect: true, amount: 50, downedAmount: 0, hits: 10, pct: 25, avgHit: 5 },
    ]);
    expect(skills.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 9);
  });

  it("cura e barreira não se misturam", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 80), shield(200, 20)]);

    expect(q.playerSupportSkills(app.db, "Ana.1", {}, "heal").map((s) => s.skillId)).toEqual([100]);
    expect(q.playerSupportSkills(app.db, "Ana.1", {}, "barrier").map((s) => [s.skillId, s.amount, s.pct, s.downedAmount])).toEqual([[200, 20, 100, 0]]);
  });

  it("só as lutas dos filtros entram", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 100)]);
    luta("b", noite("2026-11-04"), "Ana.1", [heal(100, 900)]);

    expect(q.playerSupportSkills(app.db, "Ana.1", { day: ["2026-11-03"] }, "heal")[0]).toMatchObject({ amount: 100 });
    expect(q.playerSupportSkills(app.db, "Ana.1", { profession: "Mesmer" }, "heal")).toEqual([]);
  });

  it("não mistura jogadores, e quem não tem dado de cura recebe lista vazia", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 100)]);
    luta("b", noite("2026-11-04"), "Beto.2", [heal(100, 7)]);
    luta("c", noite("2026-11-05"), "Cris.3", []);

    expect(q.playerSupportSkills(app.db, "Ana.1", {}, "heal")[0]).toMatchObject({ amount: 100 });
    expect(q.playerSupportSkills(app.db, "Cris.3", {}, "heal")).toEqual([]);
    expect(q.playerSupportSkills(app.db, "Ninguem.9", {}, "heal")).toEqual([]);
  });

  it("habilidade sem nome conhecido volta com nome nulo", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(999, 10)]);

    expect(q.playerSupportSkills(app.db, "Ana.1", {}, "heal")[0]).toMatchObject({ skillId: 999, name: null });
  });

  it("a mesma id como habilidade direta e como buff são duas linhas", () => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 60), heal(100, 40, { indirect: true })]);

    expect(q.playerSupportSkills(app.db, "Ana.1", {}, "heal").map((s) => [s.indirect, s.amount])).toEqual([[false, 60], [true, 40]]);
  });
});

describe("rota das habilidades de cura e barreira do jogador", () => {
  beforeEach(() => {
    luta("a", noite("2026-11-03"), "Ana.1", [heal(100, 80, { downed: 8, hits: 4 }), shield(200, 20, { hits: 2 })]);
  });
  const rota = async (query: string) => {
    const r = await app.server.inject(`/api/players/Ana.1/support-skills${query}`);
    return { status: r.statusCode, body: r.json() as PlayerSupportSkill[] & { code?: string } };
  };

  it("sem kind devolve a cura", async () => {
    const r = await rota("");

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject([{ skillId: 100, amount: 80, downedAmount: 8, pct: 100 }]);
  });

  it("kind=barrier devolve a barreira, e respeita os filtros do endereço", async () => {
    expect((await rota("?kind=barrier")).body).toMatchObject([{ skillId: 200, amount: 20 }]);
    expect((await rota("?kind=heal&day=2026-11-09")).body).toEqual([]);
  });

  it.each(["damage", "x", "HEAL"])("kind inválido (%j) responde 400 com o código badKind", async (kind) => {
    const r = await rota(`?kind=${kind}`);

    expect(r.status).toBe(400);
    expect(r.body.code).toBe("badKind");
  });

  it("kind vazio vale como sem kind: a cura", async () => {
    expect((await rota("?kind=")).body).toMatchObject([{ skillId: 100 }]);
  });
});
