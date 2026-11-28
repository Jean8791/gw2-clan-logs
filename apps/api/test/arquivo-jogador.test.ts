import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Aggregate, RankingRow } from "@gw2logs/shared";
import { snapshotDays } from "../src/archive.js";
import { loadConfig } from "../src/config.js";
import * as q from "../src/queries.js";
import { buildApp, type App } from "../src/server.js";

// O perfil do mês: o desempenho de um jogador num mês (ou numa semana) arquivados, somado do resumo diário. Vale depois de as lutas serem apagadas.

let app: App;
let dir: string;
const now = new Date("2026-12-10T12:00:00Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-perfilmes-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let mapa = 500;
function luta(id: string, inicio: string, conta: string, o: { damage?: number; healing?: number; active?: number; profession?: string } = {}) {
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', 'x', ?, 'wvw', ?, 120000, 10, 1000)")
    .run(id, "sha-" + id, inicio, mapa++);
  app.db
    .prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, guild_id, active_ms, damage, healing) VALUES (?, ?, ?, ?, 'dps', 'G1', ?, ?, ?)")
    .run(id, conta, conta.split(".")[0], o.profession ?? "Guardian", o.active ?? 60_000, o.damage ?? 0, o.healing ?? 0);
}
const noite = (dia: string) => `${dia}T20:00:00.000Z`;

describe("archivePlayer: o jogador no mês arquivado", () => {
  beforeEach(() => {
    luta("a", noite("2026-11-03"), "Ana.1", { damage: 1000, healing: 10 });
    luta("b", noite("2026-11-03"), "Beto.2", { damage: 50 });
    luta("c", noite("2026-11-04"), "Ana.1", { damage: 3000, active: 180_000, profession: "Firebrand" });
    luta("d", noite("2026-12-01"), "Ana.1", { damage: 7 });
    snapshotDays(app.db, now);
  });

  it("a linha do jogador é a mesma do Ranking do mês, e a média do clã (baseline) também", () => {
    const p = q.archivePlayer(app.db, "2026-11", "Ana.1", {})!;
    const rank = q.archiveRanking(app.db, "2026-11", {});

    expect(p.row).toEqual(rank.rows.find((r: RankingRow) => r.account === "Ana.1"));
    expect(p.baseline).toEqual(rank.baseline);
    expect(p.row.damage).toBe(4000);
    expect(p.row.fights).toBe(2);
    expect(p.row.professions.map((c) => c.profession).sort()).toEqual(["Firebrand", "Guardian"]);
  });

  it("o dia a dia traz uma linha por dia de batalha em que ele jogou, do mais antigo ao mais novo, e soma o mês", () => {
    const p = q.archivePlayer(app.db, "2026-11", "Ana.1", {})!;

    expect(p.days.map((d: Aggregate & { day: string }) => [d.day, d.fights, d.damage, d.activeMs])).toEqual([
      ["2026-11-03", 1, 1000, 60_000],
      ["2026-11-04", 1, 3000, 180_000],
    ]);
    expect(p.days.reduce((a: number, d: Aggregate) => a + d.damage, 0)).toBe(p.row.damage);
  });

  it("quem não jogou no período não tem perfil", () => {
    expect(q.archivePlayer(app.db, "2026-11", "Ninguem.9", {})).toBeNull();
    expect(q.archivePlayer(app.db, "2026-10", "Ana.1", {})).toBeNull();
  });

  it("com week, vale a semana no lugar do mês", () => {
    // 03/11 e 04/11 são da semana que começou em 30/10; 01/12 é da semana de 27/11
    expect(q.archivePlayer(app.db, "2026-11", "Ana.1", { week: "2026-10-30" })!.row.damage).toBe(4000);
    expect(q.archivePlayer(app.db, "2026-11", "Ana.1", { week: "2026-11-27" })!.row.damage).toBe(7);
    expect(q.archivePlayer(app.db, "2026-11", "Beto.2", { week: "2026-11-27" })).toBeNull();
  });

  it("continua igual depois de as lutas serem apagadas pela retenção", () => {
    const antes = q.archivePlayer(app.db, "2026-11", "Ana.1", {});

    app.db.prepare("DELETE FROM fights").run();

    expect(q.archivePlayer(app.db, "2026-11", "Ana.1", {})).toEqual(antes);
  });
});

describe("GET /api/archive/players/:account", () => {
  beforeEach(() => {
    luta("a", noite("2026-11-03"), "Ana.1", { damage: 1000 });
    snapshotDays(app.db, now);
  });
  const get = (url: string) => app.server.inject({ method: "GET", url });

  it("devolve a linha, a média do clã, o tempo de referência e o dia a dia", async () => {
    const res = await get("/api/archive/players/Ana.1?month=2026-11");

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.row.damage).toBe(1000);
    expect(body.baseline.damage).toBe(1000);
    expect(body.days).toHaveLength(1);
    expect(typeof body.referenceMs).toBe("number");
  });

  it("aceita week no lugar de month; sem nenhum dos dois dá 400 badMonth; sem o jogador dá 404", async () => {
    expect((await get("/api/archive/players/Ana.1?week=2026-10-30")).statusCode).toBe(200);
    const sem = await get("/api/archive/players/Ana.1");
    expect(sem.statusCode).toBe(400);
    expect(sem.json().code).toBe("badMonth");
    const nao = await get("/api/archive/players/Ninguem.9?month=2026-11");
    expect(nao.statusCode).toBe(404);
    expect(nao.json().code).toBe("playerNotFound");
  });
});
