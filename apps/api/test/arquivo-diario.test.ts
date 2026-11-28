import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotDays } from "../src/archive.js";
import { paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import * as q from "../src/queries.js";
import { purgeOldFights } from "../src/retention.js";

const now = new Date("2026-11-13T12:00:00Z");
/** 20:00 UTC de uma data: o dia de batalha é a própria data (a data menos 9 horas). */
const noite = (dia: string, hora = "20:00") => `${dia}T${hora}:00.000Z`;

let dir: string;
let db: DB;
const p = () => paths(dir);

interface Luta {
  id: string;
  inicio: string | null;
  mapa?: number;
  duracaoS?: number;
  dano?: number;
  status?: string;
  enviadaEm?: string;
}
/** Insere uma luta pronta direto no banco. */
function luta(l: Luta) {
  db.prepare(
    "INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage) VALUES (?, ?, ?, ?, ?, 'wvw', ?, ?, 10, ?)",
  ).run(l.id, "sha-" + l.id, l.status ?? "done", l.enviadaEm ?? "2026-11-13T00:00:00.000Z", l.inicio, l.mapa ?? 38, (l.duracaoS ?? 100) * 1000, l.dano ?? 1000);
  fs.mkdirSync(p().fightDir(l.id), { recursive: true });
}

interface Jogador {
  conta: string;
  nome?: string;
  classe?: string;
  funcao?: "dps" | "support";
  guilda?: string | null;
  comandante?: boolean;
  ativoS?: number;
  dano?: number;
  cura?: number;
  /** boon gerado: o banco guarda o valor normalizado pela luta (média ponderada pelo tempo ativo no Ranking) */
  estabOut?: number;
  estabUp?: number;
}
function jogador(lutaId: string, j: Jogador) {
  db.prepare(
    "INSERT INTO player_stats (fight_id, account, name, profession, guild_id, role, commander, active_ms, damage, healing, stab_out, stab_up) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(lutaId, j.conta, j.nome ?? j.conta.split(".")[0], j.classe ?? "Guardian", j.guilda ?? null, j.funcao ?? "dps", j.comandante ? 1 : 0, (j.ativoS ?? 60) * 1000, j.dano ?? 0, j.cura ?? 0, j.estabOut ?? 0, j.estabUp ?? 0);
}

const linhas = (dia?: string) =>
  db.prepare(`SELECT * FROM day_stats ${dia ? "WHERE day = ?" : ""} ORDER BY day, account, profession, role`).all(...(dia ? [dia] : [])) as Record<string, any>[];
const congelado = (dia: string) => (db.prepare("SELECT frozen FROM day_snapshots WHERE day = ?").get(dia) as { frozen: number } | undefined)?.frozen;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-arq-"));
  fs.mkdirSync(p().uploads, { recursive: true });
  db = openDb(p().db);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("arquivo diário: soma por dia de batalha", () => {
  it("guarda as mesmas somas que o Ranking daria para o dia (boon como média ponderada pelo tempo)", () => {
    luta({ id: "a", inicio: noite("2026-11-05"), mapa: 1 });
    luta({ id: "b", inicio: noite("2026-11-05", "22:00"), mapa: 2 });
    jogador("a", { conta: "Ana.1111", dano: 1000, cura: 50, ativoS: 60, estabOut: 10, estabUp: 30_000 });
    jogador("b", { conta: "Ana.1111", dano: 3000, cura: 150, ativoS: 120, estabOut: 40, estabUp: 60_000 });

    snapshotDays(db, now);

    const [ana] = linhas("2026-11-05");
    const ranking = q.ranking(db, { day: ["2026-11-05"] }).find((r) => r.account === "Ana.1111")!;
    expect(ana).toMatchObject({ day: "2026-11-05", mode: "wvw", account: "Ana.1111", profession: "Guardian", role: "dps", fights: 2, active_ms: 180_000, damage: 4000, healing: 200, stab_up: 90_000 });
    expect(ana!.damage).toBe(ranking.damage);
    expect(ana!.fights).toBe(ranking.fights);
    // volume de boon: guardado como Σ(valor × tempo ativo); dividido pelo tempo dá a média do Ranking
    expect(ana!.stab_out).toBe(10 * 60_000 + 40 * 120_000);
    expect(ana!.stab_out / ana!.active_ms).toBeCloseTo(ranking.stabOut, 9);
  });

  it("o nome é o da luta mais recente do dia", () => {
    luta({ id: "a", inicio: noite("2026-11-05"), mapa: 1 });
    luta({ id: "b", inicio: noite("2026-11-05", "22:00"), mapa: 2 });
    jogador("a", { conta: "Ana.1111", nome: "Nome Velho" });
    jogador("b", { conta: "Ana.1111", nome: "Nome Novo" });

    snapshotDays(db, now);

    expect(linhas("2026-11-05")).toMatchObject([{ name: "Nome Novo", last_seen: noite("2026-11-05", "22:00") }]);
  });

  it("classe ou função diferentes no mesmo dia viram linhas separadas", () => {
    luta({ id: "a", inicio: noite("2026-11-05"), mapa: 1 });
    luta({ id: "b", inicio: noite("2026-11-05", "22:00"), mapa: 2 });
    jogador("a", { conta: "Ana.1111", classe: "Guardian", funcao: "dps" });
    jogador("b", { conta: "Ana.1111", classe: "Mesmer", funcao: "support" });

    snapshotDays(db, now);

    expect(linhas("2026-11-05").map((r) => [r.profession, r.role])).toEqual([["Guardian", "dps"], ["Mesmer", "support"]]);
  });

  it("a mesma luta gravada por duas pessoas conta uma vez, pelo log de maior dano", () => {
    luta({ id: "g1", inicio: noite("2026-11-05"), dano: 2_000 });
    luta({ id: "g2", inicio: noite("2026-11-05"), dano: 3_000 });
    for (const id of ["g1", "g2"]) {
      jogador(id, { conta: "Cmd.0001", comandante: true, ativoS: 100, dano: id === "g1" ? 111 : 222 });
      jogador(id, { conta: "Ana.1111", ativoS: 100, dano: 10 });
    }

    snapshotDays(db, now);

    const ana = linhas("2026-11-05").find((r) => r.account === "Ana.1111")!;
    expect(ana.fights).toBe(1);
    expect(linhas("2026-11-05").find((r) => r.account === "Cmd.0001")!.damage).toBe(222);
  });

  it("luta sem data, ainda na fila ou com erro não entra", () => {
    luta({ id: "sem-data", inicio: null });
    luta({ id: "fila", inicio: noite("2026-11-05"), status: "queued" });
    luta({ id: "erro", inicio: noite("2026-11-05"), status: "error" });
    for (const id of ["sem-data", "fila", "erro"]) jogador(id, { conta: "Ana.1111" });

    expect(snapshotDays(db, now).rebuilt).toEqual([]);
    expect(linhas()).toEqual([]);
  });

  it("jogador sem guilda nem classe fica com texto vazio na chave (a chave composta não aceita nulo como valor igual)", () => {
    luta({ id: "a", inicio: noite("2026-11-05") });
    db.prepare("INSERT INTO player_stats (fight_id, account, active_ms, damage) VALUES ('a', 'Ana.1111', 60000, 5)").run();

    snapshotDays(db, now);

    expect(linhas()).toMatchObject([{ account: "Ana.1111", profession: "", guild_id: "", damage: 5 }]);
  });
});

describe("arquivo diário: quando refaz", () => {
  it("rodar de novo sem mudança não refaz nada e não muda as linhas", () => {
    luta({ id: "a", inicio: noite("2026-11-05") });
    jogador("a", { conta: "Ana.1111", dano: 7 });

    expect(snapshotDays(db, now).rebuilt).toEqual(["2026-11-05"]);
    const antes = linhas();
    expect(snapshotDays(db, now).rebuilt).toEqual([]);
    expect(linhas()).toEqual(antes);
  });

  it("luta que termina de processar depois do arquivo entra na rodada seguinte, mesmo enviada antes dele", () => {
    luta({ id: "a", inicio: noite("2026-11-05"), mapa: 1, enviadaEm: "2026-11-05T21:00:00.000Z" });
    jogador("a", { conta: "Ana.1111", dano: 100 });
    snapshotDays(db, now);

    // enviada às 20:30 (antes do arquivo), mas só ficou pronta depois: o envio não diz quando ela entrou no conjunto
    luta({ id: "b", inicio: noite("2026-11-05", "22:00"), mapa: 2, enviadaEm: "2026-11-05T20:30:00.000Z" });
    jogador("b", { conta: "Ana.1111", dano: 50 });

    expect(snapshotDays(db, now).rebuilt).toEqual(["2026-11-05"]);
    expect(linhas("2026-11-05")[0]).toMatchObject({ fights: 2, damage: 150 });
  });

  it("um log melhor da mesma luta (mesmo número de lutas visíveis) também refaz o dia", () => {
    luta({ id: "ruim", inicio: noite("2026-11-05"), dano: 1_000 });
    for (const c of ["Cmd.0001", "Ana.1111"]) jogador("ruim", { conta: c, comandante: c === "Cmd.0001", ativoS: 100, dano: 5 });
    snapshotDays(db, now);

    luta({ id: "bom", inicio: noite("2026-11-05"), dano: 9_000 });
    for (const c of ["Cmd.0001", "Ana.1111"]) jogador("bom", { conta: c, comandante: c === "Cmd.0001", ativoS: 100, dano: 8 });

    expect(snapshotDays(db, now).rebuilt).toEqual(["2026-11-05"]);
    expect(linhas("2026-11-05").find((r) => r.account === "Ana.1111")).toMatchObject({ fights: 1, damage: 8 });
  });
});

describe("arquivo diário e a retenção", () => {
  it("a retenção apaga as lutas e o resumo do dia continua igual; o dia que ela alcançou fica congelado", async () => {
    luta({ id: "velha", inicio: noite("2026-11-03") });
    jogador("velha", { conta: "Ana.1111", dano: 700, cura: 30 });
    luta({ id: "recente", inicio: noite("2026-11-11") });
    jogador("recente", { conta: "Ana.1111", dano: 400 });

    const apagadas = await purgeOldFights(db, p(), 7, now);

    expect(apagadas).toBe(1);
    expect(db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "recente" }]);
    expect(linhas("2026-11-03")).toMatchObject([{ account: "Ana.1111", fights: 1, damage: 700, healing: 30 }]);
    expect(linhas("2026-11-11")).toMatchObject([{ damage: 400 }]);
    expect(congelado("2026-11-03")).toBe(1);
    expect(congelado("2026-11-11")).toBe(0);
  });

  it("dia congelado não muda, nem com um log antigo reenviado", () => {
    luta({ id: "velha", inicio: noite("2026-11-03") });
    jogador("velha", { conta: "Ana.1111", dano: 700 });
    snapshotDays(db, now, 7);
    expect(congelado("2026-11-03")).toBe(1);

    luta({ id: "reenviada", inicio: noite("2026-11-03", "22:00"), mapa: 2 });
    jogador("reenviada", { conta: "Ana.1111", dano: 999 });

    expect(snapshotDays(db, now, 7).rebuilt).toEqual([]);
    expect(linhas("2026-11-03")).toMatchObject([{ fights: 1, damage: 700 }]);
  });

  it("sem retenção (0 dias) nada é congelado: um log atrasado ainda entra no dia", () => {
    luta({ id: "velha", inicio: noite("2026-01-03") });
    jogador("velha", { conta: "Ana.1111", dano: 1 });
    snapshotDays(db, now, 0);
    expect(congelado("2026-01-03")).toBe(0);

    luta({ id: "tarde", inicio: noite("2026-01-03", "22:00"), mapa: 2 });
    jogador("tarde", { conta: "Ana.1111", dano: 2 });
    snapshotDays(db, now, 0);

    expect(linhas("2026-01-03")).toMatchObject([{ fights: 2, damage: 3 }]);
  });

  it("o resumo fica guardado por 12 meses: o dia mais antigo que isso sai e não volta, mesmo sem retenção", () => {
    for (const [dia, id] of [["2025-10-31", "fora"], ["2025-11-01", "dentro"]] as const) {
      luta({ id, inicio: noite(dia) });
      jogador(id, { conta: "Ana.1111", dano: 1 });
    }
    // um resumo antigo que já estava no banco
    db.prepare("INSERT INTO day_stats (day, mode, account, profession, role, guild_id) VALUES ('2025-03-01', 'wvw', 'Velho.1', '', 'dps', '')").run();
    db.prepare("INSERT INTO day_snapshots (day, built_at, signature, frozen) VALUES ('2025-03-01', 'x', 'y', 1)").run();

    expect(snapshotDays(db, now).rebuilt).toEqual(["2025-11-01"]);
    expect(snapshotDays(db, now).rebuilt).toEqual([]); // o dia fora do prazo não é refeito a cada rodada

    expect(linhas().map((r) => r.day)).toEqual(["2025-11-01"]);
    expect(db.prepare("SELECT day FROM day_snapshots").all()).toEqual([{ day: "2025-11-01" }]);
  });

  it("o dia de batalha vai das 06:00 às 06:00 de Brasília: uma luta de 00:30 pertence ao dia anterior", () => {
    luta({ id: "madrugada", inicio: "2026-11-06T03:30:00.000Z" }); // 00:30 em Brasília de 06/11 → dia de batalha 05/11
    jogador("madrugada", { conta: "Ana.1111", dano: 1 });

    snapshotDays(db, now);

    expect(linhas().map((r) => r.day)).toEqual(["2026-11-05"]);
  });
});
