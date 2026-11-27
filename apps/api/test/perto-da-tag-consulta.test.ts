import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bestValue, hasStatData, statValue, tagTotal, uptimeValue, type RankingRow } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import { buildApp, type App } from "../src/server.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-tag-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 26, 20, 0, 0);
let n = 0;

interface Linha {
  conta?: string;
  /** tempo ativo, em segundos */
  ativo?: number;
  /** o que o log guarda: tempo perto (s) e o tempo vivo coberto pelo dado (s); 0 = o log não tem o dado */
  perto?: number;
  coberto?: number;
  /** distância média (unidades) sobre o tempo coberto pela distância (s) */
  dist?: number;
  distCoberto?: number;
}

/** Uma luta pronta de 10 em 10 minutos, com a linha de um jogador (com ou sem o dado da tag). */
function luta(l: Linha) {
  const id = `f${++n}`;
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms) VALUES (?, ?, 'done', ?, ?, 'wvw', 38, 120000)")
    .run(id, "sha-" + id, new Date().toISOString(), new Date(T0 + n * 600_000).toISOString());
  app.db
    .prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms, damage, tag_near, near_cover_ms, tag_dist, dist_cover_ms) VALUES (?, ?, 'Fulano', 'Guardian', 'dps', ?, 100, ?, ?, ?, ?)")
    .run(id, l.conta ?? "Fulano.1111", (l.ativo ?? 60) * 1000, (l.perto ?? 0) * 1000, (l.coberto ?? 0) * 1000, (l.dist ?? 0) * (l.distCoberto ?? 0) * 1000, (l.distCoberto ?? 0) * 1000);
  return id;
}

const ranking = async () => ((await app.server.inject("/api/ranking")).json().rows as RankingRow[]).find((r) => r.account === "Fulano.1111")!;
const pct = (r: RankingRow) => uptimeValue("tagNear", r.tagNear, r.activeMs);
const dist = (r: RankingRow) => uptimeValue("tagDist", r.tagDist, r.activeMs);

describe("o banco ganha as colunas da tag, também nos bancos antigos", () => {
  it("banco antigo (sem as colunas) ganha as de métrica e as de cobertura, sem perder as lutas", () => {
    const file = path.join(dir, "antigo.db");
    const old = new Database(file);
    old.exec(`
      CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER, owner_id INTEGER);
      CREATE TABLE player_stats (fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE, account TEXT NOT NULL, name TEXT, profession TEXT, guild_id TEXT,
        grp INTEGER, commander INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'dps', active_ms INTEGER NOT NULL DEFAULT 0, dist_to_com REAL, PRIMARY KEY (fight_id, account));
      INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('f1', 's', 'done', '2026-11-01');
      INSERT INTO player_stats (fight_id, account) VALUES ('f1', 'Velho.1');
    `);
    old.close();

    const db = openDb(file);
    const cols = (db.pragma("table_info(player_stats)") as { name: string }[]).map((c) => c.name);

    expect(cols).toEqual(expect.arrayContaining(["tag_near", "tag_dist", "near_cover_ms", "dist_cover_ms"]));
    expect(db.prepare("SELECT tag_near, near_cover_ms, dist_cover_ms FROM player_stats WHERE account = 'Velho.1'").get()).toEqual({ tag_near: 0, near_cover_ms: 0, dist_cover_ms: 0 });
    db.close();
  });
});

describe("o que a extração achou vai para o banco", () => {
  it("grava a métrica e a cobertura de cada jogador", () => {
    const j = wvwFixture() as any;
    j.combatReplayMetaData = { inchToPixel: 0.028, pollingRate: 300, sizes: [], maps: [] };
    const replay = (dist: number[]) => ({ start: 0, end: dist.length * 300, positions: dist.map((d) => [d * 0.028, 0]), down: [], dead: [], dc: [] });
    j.players.find((p: any) => p.account === "Comandante.1111").combatReplayData = replay([0, 0, 0, 0]);
    j.players.find((p: any) => p.account === "Atacante.2222").combatReplayData = replay([100, 100, 5000, 5000]);
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('x', 'sx', 'queued', ?)").run(new Date().toISOString());

    saveFight(app.db, "x", extractFight(j), null, false, true);

    expect(app.db.prepare("SELECT tag_near, near_cover_ms, dist_cover_ms FROM player_stats WHERE fight_id = 'x' AND account = 'Atacante.2222'").get()).toEqual({ tag_near: 600, near_cover_ms: 1200, dist_cover_ms: 1200 });
    expect(app.db.prepare("SELECT near_cover_ms, dist_cover_ms FROM player_stats WHERE fight_id = 'x' AND account = 'Outro.3333'").get()).toEqual({ near_cover_ms: 0, dist_cover_ms: 0 });
  });
});

describe("a porcentagem soma só as lutas que têm o dado", () => {
  it("uma luta com o dado (50%) e uma sem não dão 25%: a sem dado não entra na conta", async () => {
    luta({ ativo: 60, perto: 30, coberto: 60 });
    luta({ ativo: 60 }); // log antigo, sem replay

    expect(pct(await ranking())).toBeCloseTo(50, 5);
  });

  it("o tempo coberto pode ser menor que o tempo ativo (morto e desconectado não contam): o % é perto ÷ coberto", async () => {
    luta({ ativo: 60, perto: 20, coberto: 40 });

    expect(pct(await ranking())).toBeCloseTo(50, 5);
  });

  it("várias lutas com dado pesam pelo tempo coberto de cada uma (soma sobre soma, não média das porcentagens)", async () => {
    luta({ ativo: 60, perto: 60, coberto: 60 }); // 100% em 60 s
    luta({ ativo: 180, perto: 0, coberto: 180 }); // 0% em 180 s

    expect(pct(await ranking())).toBeCloseTo(25, 5);
  });

  it("sem nenhuma luta com o dado, a porcentagem é 0 e a cobertura também (a tela mostra traço)", async () => {
    luta({ ativo: 60 });

    const r = await ranking();
    expect(pct(r)).toBe(0);
    expect(r.nearCoverMs).toBe(0);
  });

  it("a distância média também ignora as lutas sem o dado", async () => {
    luta({ ativo: 60, dist: 800, distCoberto: 60 });
    luta({ ativo: 60 });

    expect(dist(await ranking())).toBeCloseTo(800, 5);
  });
});

describe("a luta mostra o valor da tag de cada jogador", () => {
  it("o detalhe da luta traz a porcentagem do jogador e a cobertura", async () => {
    const id = luta({ ativo: 60, perto: 20, coberto: 40 });

    const d = (await app.server.inject(`/api/fights/${id}`)).json();
    const p = d.players.find((x: { account: string }) => x.account === "Fulano.1111");

    expect(uptimeValue("tagNear", p.tagNear, p.activeMs)).toBeCloseTo(50, 5);
    expect(p.nearCoverMs).toBe(40_000);
  });

  it("numa luta sem o dado a cobertura é 0, para a tela mostrar traço e não 0%", async () => {
    const id = luta({ ativo: 60 });

    const p = (await app.server.inject(`/api/fights/${id}`)).json().players[0];

    expect(p.nearCoverMs).toBe(0);
    expect(p.distCoverMs).toBe(0);
  });
});

describe("o valor mostrado usa a mesma conta da tabela", () => {
  it("statValue de uma métrica da tag é a porcentagem (ou a distância) sobre o tempo ativo", () => {
    const linha = { activeMs: 60_000, tagNear: 30_000, tagDist: 800 * 60_000 } as never;

    expect(statValue("tagNear", "total", linha)).toBe(50);
    expect(statValue("tagDist", "total", linha)).toBe(800);
  });
});

describe("quando mostrar o valor e quando mostrar traço", () => {
  it("as métricas da tag só têm dado quando o log cobre algum tempo; as outras sempre têm", () => {
    expect(hasStatData("tagNear", { nearCoverMs: 1000, distCoverMs: 0 })).toBe(true);
    expect(hasStatData("tagNear", { nearCoverMs: 0, distCoverMs: 60_000 })).toBe(false); // só a distância: sem posições, sem "perto"
    expect(hasStatData("tagDist", { nearCoverMs: 0, distCoverMs: 60_000 })).toBe(true);
    expect(hasStatData("tagDist", {})).toBe(false);
    expect(hasStatData("damage", {})).toBe(true);
    expect(hasStatData("stabUp", { nearCoverMs: 0, distCoverMs: 0 })).toBe(true);
  });
});

describe("o melhor valor entre quem tem o dado", () => {
  const com = (dist: number) => ({ distCoverMs: 60_000, nearCoverMs: 0, dist });
  const sem = { distCoverMs: 0, nearCoverMs: 0, dist: 0 };

  it("distância (menos é melhor): o menor entre os que têm dado, e quem não tem não vira o melhor com 0", () => {
    const linhas = [com(900), sem, com(400)];

    expect(bestValue("tagDist", linhas, (r) => r.dist)).toBe(400);
  });

  it("porcentagem (mais é melhor): o maior entre os que têm dado", () => {
    const linhas = [{ nearCoverMs: 1000, distCoverMs: 0, v: 40 }, { nearCoverMs: 0, distCoverMs: 0, v: 99 }, { nearCoverMs: 500, distCoverMs: 0, v: 70 }];

    expect(bestValue("tagNear", linhas, (r) => r.v)).toBe(70);
  });

  it("sem nenhuma linha com dado, 0; e métricas comuns ignoram a cobertura", () => {
    expect(bestValue("tagNear", [sem], () => 5)).toBe(0);
    expect(bestValue("damage", [sem, sem], (r) => r.dist + 7)).toBe(7);
  });
});

describe("o total do jogador é a conta do Ranking: soma do tempo perto ÷ soma do tempo coberto", () => {
  // linhas por luta como a API devolve: o valor já reescalado para o tempo ativo (valor × ativo ÷ coberto)
  const linha = (ativo: number, perto: number, coberto: number) => ({
    activeMs: ativo * 1000,
    tagNear: coberto > 0 ? (perto * ativo * 1000) / coberto : 0,
    nearCoverMs: coberto * 1000,
  });

  it("quando a cobertura varia entre as lutas, não é a média pelo tempo ativo", () => {
    // 60 s vivo e 60 s perto; 180 s ativo mas só 90 s vivos (morreu), 0 s perto: 60 ÷ 150 = 40%
    const linhas = [linha(60, 60, 60), linha(180, 0, 90)];

    const total = tagTotal("tagNear", linhas as never);

    expect(uptimeValue("tagNear", total, 240_000)).toBeCloseTo(40, 5);
  });

  it("ignora as lutas sem o dado", () => {
    const linhas = [linha(60, 30, 60), linha(600, 0, 0)];

    expect(uptimeValue("tagNear", tagTotal("tagNear", linhas as never), 60_000)).toBeCloseTo(50, 5);
  });

  it("sem lutas com dado, 0", () => {
    expect(tagTotal("tagNear", [linha(60, 0, 0)] as never)).toBe(0);
  });
});

