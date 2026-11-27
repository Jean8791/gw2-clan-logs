import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createSession } from "../src/auth.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-completa-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 26, 20, 0, 0); // 20:00 UTC; o dia de batalha é o mesmo (a data menos 9 horas)

interface Luta {
  id: string;
  /** segundos depois das 20:00 UTC em que a luta começou */
  inicio: number;
  /** duração em segundos */
  dur: number;
  dano?: number;
  squad?: number;
  /** null = mapa desconhecido */
  mapa?: number | null;
  /** null = modo desconhecido */
  modo?: string | null;
  /** guilda de todos os jogadores do log */
  guilda?: string;
  /** conta de quem levou a tag; null = ninguém marcado */
  cmd?: string | null;
  /** quanto do tempo o comandante aparece ativo no log (padrão: o tempo todo) */
  cmdPresenteS?: number;
  /** contas dos jogadores (além do comandante) */
  jogadores?: string[];
  semData?: boolean;
}

/** Insere uma luta pronta direto no banco, com o comandante e os jogadores. */
function luta(l: Luta) {
  const start = l.semData ? null : new Date(T0 + l.inicio * 1000).toISOString();
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start, mode, map_id, duration_ms, squad_count, squad_damage, squad_kills, squad_deaths, enemy_deaths) VALUES (?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, 3, 1, 5)")
    .run(l.id, "sha-" + l.id, new Date().toISOString(), start, l.modo === undefined ? "wvw" : l.modo, l.mapa === undefined ? 38 : l.mapa, l.dur * 1000, l.squad ?? 20, l.dano ?? 1000);
  const ins = app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms, damage, commander, guild_id) VALUES (?, ?, ?, 'Guardian', 'dps', ?, 100, ?, ?)");
  const cmd = l.cmd === undefined ? "Cmd.0001" : l.cmd;
  if (cmd) ins.run(l.id, cmd, "Cmd", (l.cmdPresenteS ?? l.dur) * 1000, 1, l.guilda ?? null);
  for (const j of l.jogadores ?? ["Jog.0001", "Jog.0002"]) ins.run(l.id, j, j.split(".")[0], l.dur * 1000, 0, l.guilda ?? null);
  return l.id;
}

const visiveis = async () => ((await app.server.inject("/api/fights")).json() as { id: string }[]).map((f) => f.id).sort();

describe("a mesma luta gravada por mais de uma pessoa aparece uma vez só, pelo log com mais dano do squad", () => {
  it("três gravadores da mesma luta: fica o de maior dano, mesmo que não seja o mais longo", async () => {
    luta({ id: "g1", inicio: 0, dur: 228, dano: 2_761_000 });
    luta({ id: "g2", inicio: 0, dur: 221, dano: 3_137_000 });
    luta({ id: "g3", inicio: 0, dur: 231, dano: 3_091_000 });

    expect(await visiveis()).toEqual(["g2"]);
  });

  it("o resultado não depende da ordem em que os logs chegaram", async () => {
    luta({ id: "g3", inicio: 0, dur: 231, dano: 3_091_000 });
    luta({ id: "g2", inicio: 0, dur: 221, dano: 3_137_000 });
    luta({ id: "g1", inicio: 0, dur: 228, dano: 2_761_000 });

    expect(await visiveis()).toEqual(["g2"]);
  });

  it("começos um pouco diferentes (cada gravador entra na luta num instante) ainda são a mesma luta", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "b", inicio: 20, dur: 90, dano: 520_000 });

    expect(await visiveis()).toEqual(["b"]);
  });

  it("os totais contam a luta uma vez: visão geral, ranking e dias", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "b", inicio: 0, dur: 100, dano: 510_000 });
    luta({ id: "c", inicio: 0, dur: 100, dano: 505_000 });

    const geral = (await app.server.inject("/api/overview")).json();
    const ranking = (await app.server.inject("/api/ranking")).json().rows as { account: string; fights: number }[];
    const dias = (await app.server.inject("/api/days")).json() as { fights: number }[];

    expect(geral.fights).toBe(1);
    expect(geral.kills).toBe(5);
    expect(ranking.find((r) => r.account === "Jog.0001")?.fights).toBe(1);
    expect(dias.map((d) => d.fights)).toEqual([1]);
  });

  it("a luta escondida continua abrindo pelo link direto", async () => {
    luta({ id: "boa", inicio: 0, dur: 100, dano: 900_000 });
    luta({ id: "fraca", inicio: 0, dur: 100, dano: 100_000 });

    expect(await visiveis()).toEqual(["boa"]);
    expect((await app.server.inject("/api/fights/fraca")).statusCode).toBe(200);
  });
});

describe("empates entre logs da mesma luta", () => {
  it("com o mesmo dano, vence o mais longo", async () => {
    luta({ id: "curto", inicio: 0, dur: 80, dano: 700_000 });
    luta({ id: "longo", inicio: 0, dur: 90, dano: 700_000 });

    expect(await visiveis()).toEqual(["longo"]);
  });

  it("com o mesmo dano e a mesma duração, vence o que viu mais jogadores", async () => {
    luta({ id: "a", inicio: 0, dur: 90, dano: 700_000, squad: 18 });
    luta({ id: "b", inicio: 0, dur: 90, dano: 700_000, squad: 22 });

    expect(await visiveis()).toEqual(["b"]);
  });

  it("empate total: fica o de id menor, sempre o mesmo", async () => {
    luta({ id: "b", inicio: 0, dur: 90, dano: 700_000 });
    luta({ id: "a", inicio: 0, dur: 90, dano: 700_000 });

    expect(await visiveis()).toEqual(["a"]);
  });
});

describe("o que NÃO é a mesma luta continua separado", () => {
  it("lutas seguidas que só encostam (o fim de uma é o começo da outra) ficam as duas", async () => {
    luta({ id: "primeira", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "segunda", inicio: 100, dur: 80, dano: 400_000 });

    expect(await visiveis()).toEqual(["primeira", "segunda"]);
  });

  it("sobreposição pequena (menos da metade do log menor) não junta", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "b", inicio: 80, dur: 100, dano: 400_000 }); // 20 s de 100 s

    expect(await visiveis()).toEqual(["a", "b"]);
  });

  it("mapa diferente ou modo diferente não junta", async () => {
    luta({ id: "mapa-a", inicio: 0, dur: 100, dano: 500_000, mapa: 38 });
    luta({ id: "mapa-b", inicio: 0, dur: 100, dano: 400_000, mapa: 95 });
    luta({ id: "pve", inicio: 0, dur: 100, dano: 300_000, mapa: 38, modo: "pve" });

    expect(await visiveis()).toEqual(["mapa-a", "mapa-b", "pve"]);
  });

  it("comandantes diferentes (dois grupos lutando juntos no mesmo mapa) não juntam", async () => {
    luta({ id: "grupo-a", inicio: 0, dur: 100, dano: 500_000, cmd: "Cmd.0001" });
    luta({ id: "grupo-b", inicio: 0, dur: 100, dano: 400_000, cmd: "Outro.0002" });

    expect(await visiveis()).toEqual(["grupo-a", "grupo-b"]);
  });

  it("datas ausentes não quebram nem juntam", async () => {
    luta({ id: "sem-data-1", inicio: 0, dur: 100, semData: true });
    luta({ id: "sem-data-2", inicio: 0, dur: 100, semData: true });

    expect(await visiveis()).toEqual(["sem-data-1", "sem-data-2"]);
  });
});

describe("sem comandante marcado, vale quem estava na luta", () => {
  const grupo = (de: number) => Array.from({ length: 10 }, (_, i) => `P${de + i}.0001`);

  it("com mais da metade dos jogadores em comum, é a mesma luta", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000, cmd: null, jogadores: grupo(0) });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000, cmd: null, jogadores: grupo(2) }); // 8 em comum de 10

    expect(await visiveis()).toEqual(["b"]);
  });

  it("com menos da metade em comum, são grupos diferentes", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000, cmd: null, jogadores: grupo(0) });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000, cmd: null, jogadores: grupo(7) }); // 3 em comum de 10

    expect(await visiveis()).toEqual(["a", "b"]);
  });

  it("um log com tag e outro sem tag também se comparam pelos jogadores", async () => {
    luta({ id: "com-tag", inicio: 0, dur: 100, dano: 500_000, jogadores: grupo(0) });
    luta({ id: "sem-tag", inicio: 0, dur: 100, dano: 600_000, cmd: null, jogadores: grupo(0) });

    expect(await visiveis()).toEqual(["sem-tag"]);
  });
});

describe("o log precisa ter acompanhado a tag (comandante presente em 80% ou mais do tempo)", () => {
  it("um log com mais dano mas longe da tag perde para o que ficou com a tag", async () => {
    luta({ id: "longe", inicio: 0, dur: 100, dano: 900_000, cmdPresenteS: 50 });
    luta({ id: "junto", inicio: 0, dur: 100, dano: 500_000, cmdPresenteS: 100 });

    expect(await visiveis()).toEqual(["junto"]);
  });

  it("exatamente 80% ainda vale", async () => {
    luta({ id: "oitenta", inicio: 0, dur: 100, dano: 900_000, cmdPresenteS: 80 });
    luta({ id: "inteiro", inicio: 0, dur: 100, dano: 500_000, cmdPresenteS: 100 });

    expect(await visiveis()).toEqual(["oitenta"]);
  });

  it("se nenhum log acompanhou a tag, vale o de maior dano", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 900_000, cmdPresenteS: 40 });
    luta({ id: "b", inicio: 0, dur: 100, dano: 500_000, cmdPresenteS: 30 });

    expect(await visiveis()).toEqual(["a"]);
  });
});

describe("mapa e modo desconhecidos", () => {
  it("mapa desconhecido nunca junta: sem saber o mapa, não dá para afirmar que é a mesma luta", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000, mapa: null });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000, mapa: null });

    expect(await visiveis()).toEqual(["a", "b"]);
  });

  it("modo desconhecido nos dois logs, com o resto igual, é a mesma luta", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000, modo: null });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000, modo: null });

    expect(await visiveis()).toEqual(["b"]);
  });
});

describe("cadeia de logs que se sobrepõem (A com B, B com C, mas A não com C)", () => {
  it("só esconde quem também está visível: B some por causa de C, e A continua, porque B não esconde mais ninguém", async () => {
    luta({ id: "A", inicio: 0, dur: 100, dano: 100_000 });
    luta({ id: "B", inicio: 40, dur: 100, dano: 200_000 }); // 60 s de A: mais da metade
    luta({ id: "C", inicio: 80, dur: 100, dano: 300_000 }); // 60 s de B, só 20 s de A

    expect(await visiveis()).toEqual(["A", "C"]);
  });

  it("o resultado é o mesmo se os logs chegam em outra ordem", async () => {
    luta({ id: "C", inicio: 80, dur: 100, dano: 300_000 });
    luta({ id: "A", inicio: 0, dur: 100, dano: 100_000 });
    luta({ id: "B", inicio: 40, dur: 100, dano: 200_000 });

    expect(await visiveis()).toEqual(["A", "C"]);
  });
});

describe("a regra junto com os filtros", () => {
  it("filtro de guilda: a luta conta uma vez, na lista e no ranking", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000, guilda: "G1" });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000, guilda: "G1" });

    const lista = (await app.server.inject("/api/fights?guild=G1")).json() as { id: string }[];
    const ranking = (await app.server.inject("/api/ranking?guild=G1")).json().rows as { account: string; fights: number }[];

    expect(lista.map((f) => f.id)).toEqual(["b"]);
    expect(ranking.find((r) => r.account === "Jog.0001")?.fights).toBe(1);
  });

  it("filtro de dia: a luta aparece uma vez no dia dela e em nenhum outro", async () => {
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000 });

    expect(((await app.server.inject("/api/fights?day=2026-11-26")).json() as unknown[]).length).toBe(1);
    expect(((await app.server.inject("/api/fights?day=2026-11-25")).json() as unknown[]).length).toBe(0);
  });

  it("quem enviou continua vendo a própria fila e os erros, junto das lutas já sem repetição", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta({ id: "a", inicio: 0, dur: 100, dano: 500_000 });
    luta({ id: "b", inicio: 0, dur: 100, dano: 600_000 });
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('na-fila', 's', 'queued', ?, ?)").run(new Date().toISOString(), ana.id);
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const ids = ((await app.server.inject({ url: "/api/fights", headers: { cookie } })).json() as { id: string }[]).map((f) => f.id).sort();

    expect(ids).toEqual(["b", "na-fila"]);
  });
});

