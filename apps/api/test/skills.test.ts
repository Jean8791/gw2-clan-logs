import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { extractFight } from "../src/ingest.js";
import { MediaStore } from "../src/media.js";
import * as q from "../src/queries.js";
import { buildApp } from "../src/server.js";
import { ingestJson } from "../src/worker.js";
import { wvwFixture } from "./fixture.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
const ACCOUNT = "Atacante.2222";

/** Luta de teste: o Atacante causa dano com 2 habilidades em jogadores inimigos e 500 num NPC (guarda). */
function fightWithSkills(opts: { start?: string; damageA?: number } = {}) {
  const f: any = wvwFixture();
  if (opts.start) f.timeStartStd = opts.start;
  const skill = (id: number, totalDamage: number, hits: number, connectedHits: number) => ({ id, totalDamage, hits, connectedHits });
  const p = f.players.find((x: any) => x.account === ACCOUNT);
  // targetDamageDist[alvo][fase][habilidade]: alvo 0 = jogador inimigo, alvo 1 = NPC
  p.targetDamageDist = [[[skill(1, opts.damageA ?? 30, 3, 2), skill(2, 70, 5, 5)]], [[skill(1, 500, 9, 9)]]];
  f.skillMap = {
    s1: { name: "Skill A", icon: "https://render.guildwars2.com/file/AAA/1.png" },
    s2: { name: "Skill B", icon: "https://wiki.guildwars2.com/images/x.png" },
  };
  return f;
}

const fakeFetch = (async () => new Response(PNG, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;

let dir: string;
let db: DB;
let api: Gw2Api;
let media: MediaStore;
const newFight = (id: string) => db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, 'parsing', ?)").run(id, "sha-" + id, new Date().toISOString());
const ingest = (id: string, json: any) => {
  newFight(id);
  return ingestJson(db, api, media, id, json, false);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-skills-"));
  db = openDb(paths(dir).db);
  api = new Gw2Api(db, false);
  media = new MediaStore(db, fakeFetch);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("extractFight: dano por habilidade", () => {
  it("soma só o dano em jogadores inimigos e ignora o NPC", () => {
    const p = extractFight(fightWithSkills()).players.find((x) => x.account === ACCOUNT)!;

    const by = (id: number) => p.skills.find((s) => s.id === id)!;
    expect(by(1)).toEqual({ id: 1, name: "Skill A", damage: 30, hits: 3, connectedHits: 2 });
    expect(by(2)).toEqual({ id: 2, name: "Skill B", damage: 70, hits: 5, connectedHits: 5 });
    expect(p.skills).toHaveLength(2);
  });

  it("inclui o dano de pets, clones e engenhocas (minions), que também conta no dano total", () => {
    const json = fightWithSkills();
    const p = json.players.find((x: any) => x.account === ACCOUNT);
    // clone: 15 de dano com uma habilidade nova (id 3) e 10 com a habilidade 2, que o jogador também usa
    p.minions = [{ name: "Clone", targetDamageDist: [[[{ id: 3, totalDamage: 15, hits: 1, connectedHits: 1 }, { id: 2, totalDamage: 10, hits: 2, connectedHits: 2 }]], [[{ id: 3, totalDamage: 999, hits: 1, connectedHits: 1 }]]] }];

    const skills = extractFight(json).players.find((x) => x.account === ACCOUNT)!.skills;

    expect(skills.find((s) => s.id === 3)).toMatchObject({ damage: 15, hits: 1 });
    expect(skills.find((s) => s.id === 2)).toMatchObject({ damage: 70 + 10, hits: 5 + 2 });
  });

  it("usa o buffMap para nome e ícone quando o id (ex.: aura) não está no skillMap", async () => {
    const json = fightWithSkills();
    json.buffMap = { b30285: { name: "Vampiric Aura", classification: "Defensive", icon: "https://render.guildwars2.com/file/V/1.png" } };
    json.players.find((x: any) => x.account === ACCOUNT).targetDamageDist[0][0].push({ id: 30285, totalDamage: 5, hits: 1, connectedHits: 1 });

    const skills = extractFight(json).players.find((x) => x.account === ACCOUNT)!.skills;
    await ingest("luta1", json);

    expect(skills.find((s) => s.id === 30285)?.name).toBe("Vampiric Aura");
    expect(media.get("skill:30285")).not.toBeNull();
  });

  it("jogador sem dano por habilidade fica com lista vazia", () => {
    const p = extractFight(fightWithSkills()).players.find((x) => x.account === "Comandante.1111")!;
    expect(p.skills).toEqual([]);
  });
});

describe("extractFight: mesma conta em mais de uma instância", () => {
  /** O ArcDPS cria outra instância quando o jogador cai da luta ou reconecta: a conta aparece duas vezes. */
  function withSecondInstance() {
    const f = fightWithSkills();
    const first = f.players.find((x: any) => x.account === ACCOUNT);
    const second = JSON.parse(JSON.stringify(first));
    second.profession = "Scourge";
    second.group = 5;
    second.activeTimes = [30000];
    second.dpsTargets[0][0].damage = 1000;
    second.targetDamageDist = [[[{ id: 1, totalDamage: 20, hits: 2, connectedHits: 1 }]], [[]]];
    f.players.push(second);
    return f;
  }

  it("junta as instâncias numa linha só, somando dano, tempo ativo e habilidades", () => {
    const f = extractFight(withSecondInstance());

    const mine = f.players.filter((x) => x.account === ACCOUNT);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.damage).toBe(300000 + 1000);
    expect(mine[0]!.activeMs).toBe(60000 + 30000);
    expect(mine[0]!.skills.find((s) => s.id === 1)).toMatchObject({ damage: 30 + 20, hits: 3 + 2, connectedHits: 2 + 1 });
  });

  it("classe e grupo vêm da instância com mais tempo ativo", () => {
    const mine = extractFight(withSecondInstance()).players.find((x) => x.account === ACCOUNT)!;

    expect(mine.profession).toBe("Reaper");
    expect(mine.group).toBe(1);
  });

  it("a contagem do squad conta pessoas, não instâncias", () => {
    expect(extractFight(withSecondInstance()).squadCount).toBe(3);
  });

  it("reprocessa sem erro e a soma das habilidades bate com o dano guardado", async () => {
    const json = withSecondInstance();
    json.players.find((x: any) => x.account === ACCOUNT).dpsTargets[0][0].damage = 100; // dano = soma das habilidades (30 + 70)
    json.players[json.players.length - 1].dpsTargets[0][0].damage = 20;
    await ingest("luta1", json);

    const row = db.prepare("SELECT ps.damage AS dmg, SUM(sk.damage) AS sk FROM player_stats ps JOIN player_skills sk ON sk.fight_id = ps.fight_id AND sk.account = ps.account WHERE ps.account = ? GROUP BY ps.account").get(ACCOUNT) as { dmg: number; sk: number };
    expect(row.sk).toBe(30 + 70 + 20);
    expect(row.dmg).toBe(120);
  });
});

describe("ingestJson: habilidades e ícones", () => {
  it("guarda o ícone de host permitido; o da wiki não é baixado, mas o nome aparece", async () => {
    await ingest("luta1", fightWithSkills());

    expect(media.get("skill:1")).not.toBeNull();
    expect(media.get("skill:2")).toBeNull();
    expect((db.prepare("SELECT name FROM skills WHERE id = 2").get() as { name: string }).name).toBe("Skill B");
  });

  it("reprocessar a mesma luta não duplica linhas", async () => {
    await ingest("luta1", fightWithSkills());
    await ingestJson(db, api, media, "luta1", fightWithSkills(), false);

    expect((db.prepare("SELECT COUNT(*) AS n FROM player_skills WHERE fight_id = 'luta1'").get() as { n: number }).n).toBe(2);
  });

  it("apagar a luta apaga as habilidades dela (retenção)", async () => {
    await ingest("luta1", fightWithSkills());

    db.prepare("DELETE FROM fights WHERE id = 'luta1'").run();

    expect((db.prepare("SELECT COUNT(*) AS n FROM player_skills").get() as { n: number }).n).toBe(0);
  });
});

describe("playerSkills: consulta do perfil", () => {
  it("soma a mesma habilidade em duas lutas e calcula a % sobre o total", async () => {
    await ingest("luta1", fightWithSkills({ damageA: 100 }));
    await ingest("luta2", fightWithSkills({ damageA: 300, start: "2026-11-12 23:40:00 -03:00" }));

    const rows = q.playerSkills(db, ACCOUNT, {});

    // Skill A: 100 + 300 = 400; Skill B: 70 + 70 = 140; total 540
    expect(rows.map((r) => r.skillId)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ skillId: 1, name: "Skill A", damage: 400, hits: 6, connectedHits: 4 });
    expect(rows[0]!.pct).toBeCloseTo((400 / 540) * 100, 5);
    expect(rows[0]!.avgHit).toBeCloseTo(400 / 4, 5);
  });

  it("respeita o filtro de período", async () => {
    await ingest("luta1", fightWithSkills({ damageA: 100, start: "2026-11-10 20:00:00 -03:00" }));
    // o filtro de período é por dia UTC; 18h em Brasília = 21h UTC do mesmo dia
    await ingest("luta2", fightWithSkills({ damageA: 300, start: "2026-11-12 18:00:00 -03:00" }));

    const rows = q.playerSkills(db, ACCOUNT, { from: "2026-11-12", to: "2026-11-12" });

    expect(rows.find((r) => r.skillId === 1)!.damage).toBe(300);
  });

  it("conta sem habilidades devolve lista vazia", () => {
    expect(q.playerSkills(db, "Ninguem.0000", {})).toEqual([]);
  });
});

describe("GET /api/players/:account/skills", () => {
  it("devolve as habilidades do jogador", async () => {
    const app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
    const appApi = new Gw2Api(app.db, false);
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('l1', 's1', 'parsing', ?)").run(new Date().toISOString());
    await ingestJson(app.db, appApi, new MediaStore(app.db, fakeFetch), "l1", fightWithSkills(), false);

    const res = await app.server.inject({ url: `/api/players/${ACCOUNT}/skills` });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: any) => r.name)).toEqual(["Skill B", "Skill A"]);
    await app.server.close();
  });
});
