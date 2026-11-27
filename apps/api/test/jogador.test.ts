import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlayerOptions } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-jog-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const FULANO = "Fulano.1234";
let n = 0;

/** Uma luta do dono, às 20:00 UTC do dia dado (o dia de batalha é a data menos 9 horas, então fica no mesmo dia). */
function luta(owner: number, dia: string, jogadores: { account: string; profession: string; role: "dps" | "support"; activeMs?: number; damage?: number }[]) {
  const id = `f${++n}`;
  app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id, time_start, mode, duration_ms) VALUES (?, ?, 'done', ?, ?, ?, 'wvw', 600000)").run(
    id, "sha-" + id, new Date().toISOString(), owner, `${dia}T20:00:00.000Z`,
  );
  const ins = app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms, damage) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const j of jogadores) ins.run(id, j.account, j.account.split(".")[0], j.profession, j.role, j.activeMs ?? 600_000, j.damage ?? 1000);
  return id;
}
const jogador = (profession: string, role: "dps" | "support" = "dps", extra: { activeMs?: number; damage?: number } = {}) => ({ account: FULANO, profession, role, ...extra });
const outro = (profession: string, role: "dps" | "support" = "dps") => ({ account: "Sicrano.5678", profession, role });

const opcoes = async (publicId: string, query = "", conta = FULANO) => {
  const res = await app.server.inject(`/api/players/${conta}/options${query}`);
  return { status: res.statusCode, body: res.json() as PlayerOptions };
};

describe("opções dos filtros da página do jogador: só o que ele jogou", () => {
  it("lista só as funções e as classes do jogador, e não as dos outros jogadores das mesmas lutas", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Guardian"), outro("Firebrand", "support")]);
    luta(ana.id, "2026-11-10", [jogador("Guardian"), outro("Mesmer")]);

    const r = await opcoes(ana.publicId);

    expect(r.status).toBe(200);
    expect(r.body.roles).toEqual(["dps"]);
    expect(r.body.professions).toEqual(["Guardian"]);
  });

  it("quem jogou nas duas funções vê as duas, e escolher uma não esconde a outra (nem a classe)", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Guardian", "dps")]);
    luta(ana.id, "2026-11-11", [jogador("Firebrand", "support")]);

    const livre = await opcoes(ana.publicId);
    const comFiltro = await opcoes(ana.publicId, "?role=dps&profession=Guardian");

    expect(livre.body.roles).toEqual(["dps", "support"]);
    expect(livre.body.professions).toEqual(["Firebrand", "Guardian"]);
    expect(comFiltro.body).toEqual(livre.body);
  });

  it("escolher um dia mostra só a função e a classe daquele dia, e a lista de dias continua inteira", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Guardian", "dps")]);
    luta(ana.id, "2026-11-11", [jogador("Firebrand", "support")]);

    const r = await opcoes(ana.publicId, "?day=2026-11-11");

    expect(r.body.roles).toEqual(["support"]);
    expect(r.body.professions).toEqual(["Firebrand"]);
    expect(r.body.days.map((d) => d.day)).toEqual(["2026-11-11", "2026-11-10"]);
  });

  it("os dias são só os do jogador, com quantas lutas ELE fez em cada um, do mais novo para o mais antigo", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Guardian")]);
    luta(ana.id, "2026-11-10", [jogador("Guardian")]);
    luta(ana.id, "2026-11-11", [jogador("Guardian")]);
    luta(ana.id, "2026-11-12", [outro("Mesmer")]); // dia de batalha sem o jogador

    const r = await opcoes(ana.publicId);

    expect(r.body.days).toEqual([
      { day: "2026-11-11", fights: 1 },
      { day: "2026-11-10", fights: 2 },
    ]);
  });

  it("jogador que não está em nenhum log dá 404, como o perfil", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Guardian")]);

    expect((await opcoes(ana.publicId, "", "Ninguem.0000")).status).toBe(404);
  });
});

describe("quem jogou pouco numa luta e morreu continua no perfil", () => {
  it("o histórico e o total contam a luta curta e a de 0 ms, sem excluir nenhuma", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "2026-11-10", [jogador("Firebrand", "support", { activeMs: 600_000, damage: 100_000 })]);
    luta(ana.id, "2026-11-10", [jogador("Guardian", "dps", { activeMs: 3_000, damage: 20_000 })]); // morreu em 3 s
    luta(ana.id, "2026-11-10", [jogador("Guardian", "dps", { activeMs: 0, damage: 0 })]); // morreu no início

    const perfil = (await app.server.inject(`/api/players/${FULANO}`)).json();

    expect(perfil.history).toHaveLength(3);
    expect(perfil.totals.fights).toBe(3);
    expect(perfil.totals.activeMs).toBe(603_000);
    expect(perfil.totals.damage).toBe(120_000);
  });
});
