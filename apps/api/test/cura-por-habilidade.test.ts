import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { extractFight } from "../src/ingest.js";
import { saveFight } from "../src/store.js";
import { wvwFixture } from "./fixture.js";

const heal = (id: number, total: number, o: { downed?: number; hits?: number; indirect?: boolean } = {}) => ({
  id, totalHealing: total, totalDownedHealing: o.downed ?? 0, hits: o.hits ?? 1, min: 1, max: total, indirectHealing: o.indirect ?? false,
});
const shield = (id: number, total: number, o: { hits?: number; indirect?: boolean } = {}) => ({ id, totalBarrier: total, hits: o.hits ?? 1, min: 1, max: total, indirectBarrier: o.indirect ?? false });

/** Luta com o Comandante curando e protegendo, com a distribuição por habilidade do Healing Stats (EI 3.32). */
function lutaComCura() {
  const f: any = wvwFixture();
  f.skillMap = { s100: { name: "Cura A" }, s200: { name: "Barreira B" }, s300: { name: "Sem uso" } };
  f.buffMap = { b700: { name: "Regeneração" } };
  const cmd = f.players[0];
  cmd.extHealingStats = {
    outgoingHealing: [{ healing: 150, downedHealing: 20 }],
    totalHealingDist: [[heal(100, 100, { downed: 20, hits: 4 }), heal(700, 50, { hits: 10, indirect: true }), heal(300, 0, { hits: 0 })]],
  };
  cmd.extBarrierStats = {
    outgoingBarrier: [{ barrier: 60 }],
    totalBarrierDist: [[shield(200, 60, { hits: 3 })]],
  };
  return f;
}
const comandante = (json: any) => extractFight(json).players.find((p) => p.account === "Comandante.1111")!;

describe("extractFight: cura e barreira por habilidade (Healing Stats)", () => {
  it("lista cada habilidade com o total, o total em caídos e os acertos; a indireta (id de buff) leva o nome do buff", () => {
    const p = comandante(lutaComCura());

    expect(p.supportSkills).toEqual([
      { id: 100, name: "Cura A", kind: "heal", amount: 100, downedAmount: 20, hits: 4, indirect: false },
      { id: 700, name: "Regeneração", kind: "heal", amount: 50, downedAmount: 0, hits: 10, indirect: true },
      { id: 200, name: "Barreira B", kind: "barrier", amount: 60, downedAmount: 0, hits: 3, indirect: false },
    ]);
  });

  it("a soma das habilidades é a cura e a barreira que o jogador já tinha (o % de cada uma fecha em 100)", () => {
    const p = comandante(lutaComCura());
    const soma = (kind: string) => p.supportSkills.filter((s) => s.kind === kind).reduce((a, s) => a + s.amount, 0);

    expect(soma("heal")).toBe(p.healing);
    expect(soma("barrier")).toBe(p.barrier);
    expect(p.supportSkills.filter((s) => s.kind === "heal").reduce((a, s) => a + s.downedAmount, 0)).toBe(p.downedHealing);
  });

  it("a cura dos minions fica de fora: o total do jogador também não a inclui", () => {
    const json = lutaComCura();
    json.players[0].minions = [{ extHealingStats: { totalHealingDist: [[heal(900, 999)]] }, extBarrierStats: { totalBarrierDist: [[shield(901, 888)]] } }];

    const p = comandante(json);

    expect(p.supportSkills.map((s) => s.id)).toEqual([100, 700, 200]);
  });

  it("habilidade sem cura, sem barreira e sem acertos não vira linha", () => {
    expect(comandante(lutaComCura()).supportSkills.some((s) => s.id === 300)).toBe(false);
  });

  it("sem Healing Stats nenhuma linha é gerada, sem erro", () => {
    const json = lutaComCura();
    delete json.players[0].extHealingStats;
    delete json.players[0].extBarrierStats;

    expect(comandante(json).supportSkills).toEqual([]);
  });

  it("habilidade sem nome no log fica com nome nulo (a tela mostra o número)", () => {
    const json = lutaComCura();
    json.skillMap = {};
    json.buffMap = {};

    expect(comandante(json).supportSkills.map((s) => s.name)).toEqual([null, null, null]);
  });

  it("a mesma conta em duas instâncias na luta soma as habilidades iguais (como o dano por habilidade)", () => {
    const json = lutaComCura();
    const segunda = JSON.parse(JSON.stringify(json.players[0]));
    segunda.hasCommanderTag = false;
    segunda.extHealingStats = { outgoingHealing: [{ healing: 30, downedHealing: 0 }], totalHealingDist: [[heal(100, 30, { hits: 2 })]] };
    segunda.extBarrierStats = { outgoingBarrier: [{ barrier: 0 }], totalBarrierDist: [[]] };
    json.players.push(segunda);

    const p = comandante(json);

    expect(p.healing).toBe(180);
    expect(p.supportSkills.find((s) => s.id === 100 && s.kind === "heal")).toMatchObject({ amount: 130, hits: 6, downedAmount: 20 });
    expect(p.supportSkills.filter((s) => s.id === 100)).toHaveLength(1);
  });
});

describe("saveFight: cura e barreira por habilidade no banco", () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-cura-"));
    db = openDb(path.join(dir, "t.db"));
    db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES ('F1', 'F1', 'queued', ?)").run(new Date().toISOString());
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const salvar = (json: any) => saveFight(db, "F1", extractFight(json), null, false, true);
  const linhas = () => db.prepare("SELECT account, skill_id, kind, amount, downed_amount, hits, indirect FROM player_support_skills ORDER BY kind, skill_id").all();

  it("grava uma linha por habilidade e tipo, com o nome na tabela de habilidades", () => {
    salvar(lutaComCura());

    expect(linhas()).toEqual([
      { account: "Comandante.1111", skill_id: 200, kind: "barrier", amount: 60, downed_amount: 0, hits: 3, indirect: 0 },
      { account: "Comandante.1111", skill_id: 100, kind: "heal", amount: 100, downed_amount: 20, hits: 4, indirect: 0 },
      { account: "Comandante.1111", skill_id: 700, kind: "heal", amount: 50, downed_amount: 0, hits: 10, indirect: 1 },
    ]);
    expect(db.prepare("SELECT name FROM skills WHERE id IN (100, 200, 700) ORDER BY id").all()).toEqual([{ name: "Cura A" }, { name: "Barreira B" }, { name: "Regeneração" }]);
  });

  it("gravar a mesma luta de novo troca as linhas em vez de repetir", () => {
    salvar(lutaComCura());
    const json = lutaComCura();
    json.players[0].extHealingStats.totalHealingDist = [[heal(100, 150, { downed: 20, hits: 5 })]];
    salvar(json);

    expect(linhas()).toHaveLength(2);
    expect(db.prepare("SELECT amount FROM player_support_skills WHERE kind = 'heal'").all()).toEqual([{ amount: 150 }]);
  });

  it("apagar a luta apaga as habilidades dela (a retenção)", () => {
    salvar(lutaComCura());

    db.prepare("DELETE FROM fights WHERE id = 'F1'").run();

    expect(linhas()).toEqual([]);
  });

  it("banco antigo, sem a tabela, ganha a tabela ao abrir", () => {
    db.close();
    const file = path.join(dir, "antigo.db");
    const velho = new Database(file);
    velho.exec("CREATE TABLE fights (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, status TEXT NOT NULL, uploaded_at TEXT NOT NULL, time_start TEXT, map_id INTEGER);");
    velho.close();

    db = openDb(file);

    expect((db.pragma("table_info(player_support_skills)") as { name: string }[]).map((c) => c.name)).toEqual(["fight_id", "account", "skill_id", "kind", "amount", "downed_amount", "hits", "indirect"]);
  });
});
