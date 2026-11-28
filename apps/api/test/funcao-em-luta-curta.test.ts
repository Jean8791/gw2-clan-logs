import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyStats, type Role } from "@gw2logs/shared";
import { upsertDiscordUser } from "../src/auth.js";
import { openDb, type DB } from "../src/db.js";
import type { ExtractedFight, ExtractedPlayer } from "../src/ingest.js";
import { saveFight } from "../src/store.js";

// Com menos de 60 s de tempo ativo a função não tem sinal para ser estimada pelo que o jogador fez.
// Nesse caso ela vem do histórico da mesma conta, na mesma classe, no espaço do mesmo dono.

let db: DB;
let dir: string;
let dono: number;
let outroDono: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-funcao-"));
  db = openDb(path.join(dir, "t.db"));
  dono = upsertDiscordUser(db, { id: "1", username: "ana", avatar: null }).id;
  outroDono = upsertDiscordUser(db, { id: "2", username: "bia", avatar: null }).id;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const jogador = (account: string, role: Role, activeSeg: number, profession: string | null = "Druid"): ExtractedPlayer => ({
  ...emptyStats(),
  account,
  name: account,
  profession,
  guildId: null,
  group: null,
  commander: false,
  role,
  activeMs: activeSeg * 1000,
  distToCom: null,
  distCoverMs: 0,
  nearCoverMs: 0,
  skills: [],
});

const luta = (players: ExtractedPlayer[]): ExtractedFight => ({
  mode: "wvw",
  fightName: "WvW",
  mapId: null,
  timeStart: null,
  durationMs: 300_000,
  success: true,
  recordedBy: null,
  squadCount: players.length,
  allyCount: 0,
  enemyCount: 0,
  squadDamage: 0,
  squadKills: 0,
  squadDowns: 0,
  squadDeaths: 0,
  enemyDowns: 0,
  enemyDeaths: 0,
  eiVersion: null,
  players,
});

let n = 0;
/** Grava uma luta pronta de um dono, com o jogador já com a função que veio da classificação pelo desempenho. */
function gravar(owner: number, player: ExtractedPlayer): string {
  const id = `L${++n}`;
  db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, ?, 'queued', ?, ?)").run(id, id, new Date().toISOString(), owner);
  saveFight(db, id, luta([player]), null, false, true);
  return id;
}

const funcaoGravada = (fightId: string, account: string) => (db.prepare("SELECT role FROM player_stats WHERE fight_id = ? AND account = ?").get(fightId, account) as { role: Role }).role;

describe("função em luta curta: herda da mesma conta e classe", () => {
  it("Dado histórico de suporte na mesma classe, quando a luta tem menos de 60 s ativos, então a função é suporte", () => {
    gravar(dono, jogador("A.1", "support", 200));
    gravar(dono, jogador("A.1", "support", 150));

    const curta = gravar(dono, jogador("A.1", "dps", 24));

    expect(funcaoGravada(curta, "A.1")).toBe("support");
  });

  it("Dado histórico de DPS, quando a luta curta veio como suporte, então a função vira DPS", () => {
    gravar(dono, jogador("A.1", "dps", 200));

    const curta = gravar(dono, jogador("A.1", "support", 10));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });

  it("Dado histórico misto, então vale a maioria pelo tempo ativo e não pela contagem de lutas", () => {
    gravar(dono, jogador("A.1", "support", 600));
    gravar(dono, jogador("A.1", "dps", 70));
    gravar(dono, jogador("A.1", "dps", 70));

    const curta = gravar(dono, jogador("A.1", "dps", 20));

    expect(funcaoGravada(curta, "A.1")).toBe("support");
  });

  it("Dado histórico só em outra classe, então a função fica como veio (histórico de outra classe não vale)", () => {
    gravar(dono, jogador("A.1", "support", 300, "Firebrand"));

    const curta = gravar(dono, jogador("A.1", "dps", 24, "Reaper"));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });

  it("Dado nenhum histórico, então a função fica como veio da classificação", () => {
    expect(funcaoGravada(gravar(dono, jogador("A.1", "dps", 24)), "A.1")).toBe("dps");
    expect(funcaoGravada(gravar(dono, jogador("B.2", "support", 24)), "B.2")).toBe("support");
  });

  it("Dado histórico só de lutas curtas, então ele não conta (só lutas com 60 s ou mais valem)", () => {
    gravar(dono, jogador("A.1", "support", 30));

    const curta = gravar(dono, jogador("A.1", "dps", 24));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });

  it("Dado histórico no espaço de outro dono, então ele não vale", () => {
    gravar(outroDono, jogador("A.1", "support", 300));

    const curta = gravar(dono, jogador("A.1", "dps", 24));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });

  it("Dado histórico de suporte, quando a luta tem 59,999 s ativos (logo abaixo do corte), então ainda herda", () => {
    gravar(dono, jogador("A.1", "support", 300));

    expect(funcaoGravada(gravar(dono, jogador("A.1", "dps", 59.999)), "A.1")).toBe("support");
  });

  it("Dado uma luta anterior com 59,999 s ativos, então ela não conta no histórico (o corte é 60 s)", () => {
    gravar(dono, jogador("A.1", "support", 59.999));

    expect(funcaoGravada(gravar(dono, jogador("A.1", "dps", 24)), "A.1")).toBe("dps");
  });

  it("Dado a conta \"?\" (log sem conta nem nome), então não herda: são pessoas diferentes", () => {
    gravar(dono, jogador("?", "support", 300));

    expect(funcaoGravada(gravar(dono, jogador("?", "dps", 24)), "?")).toBe("dps");
  });

  it("Dado jogador sem classe, então a função fica como veio", () => {
    gravar(dono, jogador("A.1", "support", 300, null));

    const curta = gravar(dono, jogador("A.1", "dps", 24, null));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });
});

describe("função com 60 s ou mais de tempo ativo: nada muda", () => {
  it("Dado histórico de suporte, quando a luta tem 60 s ativos, então vale a função da classificação", () => {
    gravar(dono, jogador("A.1", "support", 300));

    const longa = gravar(dono, jogador("A.1", "dps", 60));

    expect(funcaoGravada(longa, "A.1")).toBe("dps");
  });

  it("Dado a mesma luta regravada (reprocessada), então o histórico não conta a própria luta", () => {
    const id = gravar(dono, jogador("A.1", "dps", 24));

    saveFight(db, id, luta([jogador("A.1", "support", 24)]), null, false, true);

    expect(funcaoGravada(id, "A.1")).toBe("support");
  });
});

describe("luta longa nova recalcula as curtas já gravadas da mesma conta e classe", () => {
  it("Dado uma luta curta já gravada como DPS, quando entra uma longa de suporte da mesma conta e classe, então a curta vira suporte", () => {
    const curta = gravar(dono, jogador("A.1", "dps", 24));

    gravar(dono, jogador("A.1", "support", 300));

    expect(funcaoGravada(curta, "A.1")).toBe("support");
  });

  it("Dado curtas já gravadas, quando entram longas, então vale a maioria pelo tempo ativo de todas as longas", () => {
    const curta = gravar(dono, jogador("A.1", "dps", 24));
    gravar(dono, jogador("A.1", "support", 100));
    expect(funcaoGravada(curta, "A.1")).toBe("support");

    gravar(dono, jogador("A.1", "dps", 400));

    expect(funcaoGravada(curta, "A.1")).toBe("dps");
  });

  it("Dado uma luta curta já gravada, quando entra outra curta, então nada muda (curta não vira histórico)", () => {
    const primeira = gravar(dono, jogador("A.1", "support", 24));

    gravar(dono, jogador("A.1", "dps", 20));

    expect(funcaoGravada(primeira, "A.1")).toBe("support");
  });

  it("Dado uma curta de outra classe, de outro dono ou de outra conta, quando entra a longa, então elas não mudam", () => {
    const outraClasse = gravar(dono, jogador("A.1", "dps", 24, "Reaper"));
    const outroDonoCurta = gravar(outroDono, jogador("A.1", "dps", 24));
    const outraConta = gravar(dono, jogador("B.2", "dps", 24));

    gravar(dono, jogador("A.1", "support", 300));

    expect(funcaoGravada(outraClasse, "A.1")).toBe("dps");
    expect(funcaoGravada(outroDonoCurta, "A.1")).toBe("dps");
    expect(funcaoGravada(outraConta, "B.2")).toBe("dps");
  });

  it("Dado lutas longas já gravadas, quando entra outra longa, então as longas anteriores não mudam", () => {
    const antiga = gravar(dono, jogador("A.1", "dps", 120));

    gravar(dono, jogador("A.1", "support", 600));

    expect(funcaoGravada(antiga, "A.1")).toBe("dps");
  });

  it("Dado a conta \"?\", quando entra uma longa dela, então as curtas dela não mudam", () => {
    const curta = gravar(dono, jogador("?", "dps", 24));

    gravar(dono, jogador("?", "support", 300));

    expect(funcaoGravada(curta, "?")).toBe("dps");
  });
});
