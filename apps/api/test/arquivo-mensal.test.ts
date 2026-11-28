import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotDays } from "../src/archive.js";
import { loadConfig, paths } from "../src/config.js";
import * as q from "../src/queries.js";
import { purgeOldFights } from "../src/retention.js";
import { buildApp, type App } from "../src/server.js";
import type { RankingRow } from "@gw2logs/shared";

let app: App;
let dir: string;
const now = new Date("2026-12-10T12:00:00Z");
/** 20:00 UTC: o dia de batalha é a própria data (a data menos 9 horas). */
const noite = (dia: string, hora = "20:00") => `${dia}T${hora}:00.000Z`;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-mensal-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
  fs.mkdirSync(paths(dir).uploads, { recursive: true });
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let mapa = 100;
/** Insere uma luta pronta com os jogadores dados; cada luta num mapa próprio, para nunca ser tomada pela mesma luta de outro log. */
function luta(id: string, inicio: string, jogadores: Record<string, unknown>[], o: { modo?: string } = {}) {
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, 'done', '2026-11-30T00:00:00.000Z', ?, ?, ?, 120000, 10, 1000)")
    .run(id, "sha-" + id, inicio, o.modo ?? "wvw", mapa++);
  fs.mkdirSync(paths(dir).fightDir(id), { recursive: true });
  for (const j of jogadores) {
    const cols = ["fight_id", ...Object.keys(j)];
    app.db.prepare(`INSERT INTO player_stats (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(id, ...Object.values(j));
  }
}
const ana = (o: Record<string, unknown> = {}) => ({ account: "Ana.1111", name: "Ana", profession: "Guardian", role: "dps", guild_id: "G1", active_ms: 60_000, damage: 1000, healing: 10, stab_out: 0.5, stab_up: 30_000, ...o });
const beto = (o: Record<string, unknown> = {}) => ({ account: "Beto.2222", name: "Beto", profession: "Firebrand", role: "support", guild_id: "G2", active_ms: 120_000, damage: 300, healing: 9000, stab_out: 2, stab_up: 100_000, ...o });

const mes = async (month: string, query = "") => {
  const res = await app.server.inject(`/api/archive/ranking?month=${month}${query}`);
  return { status: res.statusCode, body: res.json() as { rows: RankingRow[]; baseline: RankingRow; referenceMs: number } & { code?: string } };
};
const linha = (rows: RankingRow[], conta: string) => rows.find((r) => r.account === conta)!;

describe("arquivo mensal: a soma do mês", () => {
  it("dá o mesmo que o Ranking dos mesmos dias (contagens, boon em volume, uptime e baseline)", async () => {
    luta("a", noite("2026-11-03"), [ana({ damage: 1000, stab_out: 0.4 }), beto()]);
    luta("b", noite("2026-11-04"), [ana({ damage: 3000, stab_out: 0.1, active_ms: 180_000 }), beto({ healing: 5000 })]);
    luta("c", noite("2026-11-05"), [ana({ damage: 500 })]);
    snapshotDays(app.db, now);

    const { rows, baseline } = (await mes("2026-11")).body;
    const rank = q.ranking(app.db, { day: ["2026-11-03", "2026-11-04", "2026-11-05"] });

    for (const conta of ["Ana.1111", "Beto.2222"]) {
      const a = linha(rows, conta);
      const b = linha(rank, conta);
      expect(a).toMatchObject({ fights: b.fights, activeMs: b.activeMs, damage: b.damage, healing: b.healing, stabUp: b.stabUp, supportFights: b.supportFights, name: b.name, profession: b.profession, guildId: b.guildId });
      expect(a.stabOut).toBeCloseTo(b.stabOut, 9);
    }
    expect(linha(rows, "Ana.1111").stabOut).toBeCloseTo((0.4 * 60_000 + 0.1 * 180_000 + 0.5 * 60_000) / 300_000, 9);
    const geral = q.baseline(app.db, { day: ["2026-11-03", "2026-11-04", "2026-11-05"] });
    expect(baseline).toMatchObject({ fights: geral.fights, activeMs: geral.activeMs, damage: geral.damage, healing: geral.healing, stabUp: geral.stabUp });
    expect(baseline.stabOut).toBeCloseTo(geral.stabOut, 9);
    expect(baseline.damage).toBe(1000 + 3000 + 500 + 300 + 300);
  });

  it("a posição perto da tag, guardada crua no dia, sai igual ao Ranking", async () => {
    luta("a", noite("2026-11-03"), [ana({ tag_near: 40_000, tag_dist: 6_000_000, near_cover_ms: 50_000, dist_cover_ms: 60_000 })]);
    luta("b", noite("2026-11-04"), [ana({ tag_near: 0, near_cover_ms: 0, dist_cover_ms: 0, active_ms: 60_000 })]);
    snapshotDays(app.db, now);

    const a = linha((await mes("2026-11")).body.rows, "Ana.1111");
    const b = linha(q.ranking(app.db, { day: ["2026-11-03", "2026-11-04"] }), "Ana.1111");

    expect(a.tagNear).toBeCloseTo(b.tagNear, 9);
    expect(a.tagDist).toBeCloseTo(b.tagDist, 9);
    expect(a.tagNear).toBeGreaterThan(0);
  });

  it("só entra o mês pedido", async () => {
    luta("out", noite("2026-10-30"), [ana({ account: "Outubro.1", name: "Outubro" })]);
    luta("nov", noite("2026-11-02"), [ana({ account: "Novembro.1", name: "Novembro" })]);
    snapshotDays(app.db, now);

    expect((await mes("2026-10")).body.rows.map((r) => r.account)).toEqual(["Outubro.1"]);
    expect((await mes("2026-11")).body.rows.map((r) => r.account)).toEqual(["Novembro.1"]);
  });

  it("o dia de batalha decide o mês: uma luta de 00:30 de 1º de dezembro (Brasília) conta em novembro", async () => {
    luta("virada", "2026-12-01T03:30:00.000Z", [ana({ account: "Virada.1", name: "Virada" })]);
    snapshotDays(app.db, now);

    expect((await mes("2026-11")).body.rows.map((r) => r.account)).toEqual(["Virada.1"]);
    expect((await mes("2026-12")).body.rows).toEqual([]);
  });

  it("a classe mais jogada do mês vem primeiro, com todas as classes da pessoa", async () => {
    luta("a", noite("2026-11-03"), [ana({ profession: "Guardian" })]);
    luta("b", noite("2026-11-04"), [ana({ profession: "Mesmer" })]);
    luta("c", noite("2026-11-05"), [ana({ profession: "Mesmer" })]);
    snapshotDays(app.db, now);

    const a = linha((await mes("2026-11")).body.rows, "Ana.1111");

    expect(a.profession).toBe("Mesmer");
    expect(a.professions).toEqual([{ profession: "Mesmer", fights: 2 }, { profession: "Guardian", fights: 1 }]);
  });
});

describe("arquivo mensal: filtros", () => {
  beforeEach(() => {
    luta("a", noite("2026-11-03"), [ana(), beto()], { modo: "wvw" });
    luta("b", noite("2026-11-04"), [ana({ account: "Pve.3333", name: "Pve", guild_id: "G1" })], { modo: "pve" });
    app.db.prepare("INSERT OR REPLACE INTO guilds (id, name, tag, in_alliance) VALUES ('G1', 'Um', 'UM', 1), ('G2', 'Dois', 'DOIS', 0)").run();
    snapshotDays(app.db, now);
  });

  it("função", async () => {
    expect((await mes("2026-11", "&role=support")).body.rows.map((r) => r.account)).toEqual(["Beto.2222"]);
  });
  it("classe", async () => {
    expect((await mes("2026-11", "&profession=Firebrand")).body.rows.map((r) => r.account)).toEqual(["Beto.2222"]);
  });
  it("guilda e aliança", async () => {
    expect((await mes("2026-11", "&guild=G2")).body.rows.map((r) => r.account)).toEqual(["Beto.2222"]);
    expect((await mes("2026-11", "&guild=alliance")).body.rows.map((r) => r.account).sort()).toEqual(["Ana.1111", "Pve.3333"]);
  });
  it("modo", async () => {
    expect((await mes("2026-11", "&mode=pve")).body.rows.map((r) => r.account)).toEqual(["Pve.3333"]);
  });
  it("filtros que não valem no arquivo (dia, período) são ignorados, sem erro", async () => {
    expect((await mes("2026-11", "&day=2026-11-03&days=1&minSquad=99")).body.rows).toHaveLength(3);
  });
});

describe("arquivo mensal: a retenção e o mês", () => {
  it("depois de as lutas serem apagadas pela retenção, o mês continua o mesmo", async () => {
    luta("a", noite("2026-11-03"), [ana(), beto()]);
    luta("b", noite("2026-11-09"), [ana({ damage: 7 })]);
    // a retenção de 7 dias, em 12/11, alcança 03/11 (que é congelado) e deixa 09/11
    const tarde = new Date("2026-11-12T12:00:00Z");
    snapshotDays(app.db, tarde, 7);
    const antes = q.archiveRanking(app.db, "2026-11", {});

    await purgeOldFights(app.db, paths(dir), 7, tarde);

    expect(app.db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "b" }]);
    const depois = q.archiveRanking(app.db, "2026-11", {});
    expect(depois).toEqual(antes);
    expect(linha(depois.rows, "Ana.1111").damage).toBe(1007);
    expect(linha(depois.rows, "Beto.2222").healing).toBe(9000);
  });
});

describe("arquivo mensal: lista de meses e rotas", () => {
  it("lista os meses do mais novo para o mais antigo, com os dias e quantos jogadores, e marca o mês em andamento", () => {
    luta("a", noite("2026-10-30"), [ana()]);
    luta("b", noite("2026-11-03"), [ana(), beto()]);
    luta("c", noite("2026-11-20"), [ana()]);
    luta("d", noite("2026-12-08"), [beto()]);
    snapshotDays(app.db, now);

    expect(q.archiveMonths(app.db, now)).toEqual([
      { month: "2026-12", days: 1, first: "2026-12-08", last: "2026-12-08", players: 1, current: true },
      { month: "2026-11", days: 2, first: "2026-11-03", last: "2026-11-20", players: 2, current: false },
      { month: "2026-10", days: 1, first: "2026-10-30", last: "2026-10-30", players: 1, current: false },
    ]);
  });

  it("a rota de meses responde a lista, e vazia quando ainda não há resumo", async () => {
    expect((await app.server.inject("/api/archive/months")).json()).toEqual([]);
    luta("a", noite("2026-11-03"), [ana()]);
    snapshotDays(app.db, now);

    const lista = (await app.server.inject("/api/archive/months")).json() as { month: string }[];
    expect(lista.map((m) => m.month)).toEqual(["2026-11"]);
  });

  it.each(["", "2026-13", "2026-1", "202611", "2026-11-01", "abc", "2026-00"])("mês inválido (%j) responde 400 com o código badMonth", async (m) => {
    const r = await mes(m);

    expect(r.status).toBe(400);
    expect(r.body.code).toBe("badMonth");
  });

  it("mês sem resumo responde lista vazia e a média geral zerada", async () => {
    const r = await mes("2026-05");

    expect(r.status).toBe(200);
    expect(r.body.rows).toEqual([]);
    expect(r.body.baseline).toMatchObject({ fights: 0, activeMs: 0, damage: 0 });
  });

  it("devolve a referência de tempo do ajuste, como o Ranking", async () => {
    luta("a", noite("2026-11-03"), [ana({ active_ms: 600_000 }), beto({ active_ms: 1_200_000 })]);
    snapshotDays(app.db, now);

    const { referenceMs } = (await mes("2026-11")).body;

    expect(referenceMs).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
