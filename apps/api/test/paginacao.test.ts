import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAGE_SIZE, pageCount, pageSlice } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-pag-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Luta {
  id: string;
  status?: string;
  time?: string | null;
  mapId?: number;
  damage?: number | null;
  duration?: number | null;
  squad?: number | null;
  kills?: number | null;
  enemyDeaths?: number | null;
  deaths?: number | null;
  name?: string | null;
  file?: string | null;
  uploader?: string | null;
  recordedBy?: string | null;
}

/** Insere lutas direto no banco (sem passar pelo Elite Insights). Devolve os ids. */
function inserir(owner: number, lutas: Luta[]) {
  const ins = app.db.prepare(
    `INSERT INTO fights (id, sha256, status, uploaded_at, uploader, recorded_by, file_name, fight_name, map_id, time_start, duration_ms, squad_count, squad_damage, squad_kills, squad_deaths, enemy_deaths, owner_id)
     VALUES (@id, @sha, @status, @up, @uploader, @recordedBy, @file, @name, @map, @time, @dur, @squad, @damage, @kills, @deaths, @enemyDeaths, @owner)`,
  );
  app.db.transaction(() => {
    for (const l of lutas) {
      ins.run({
        id: l.id, sha: "sha-" + l.id, status: l.status ?? "done", up: new Date().toISOString(),
        uploader: l.uploader ?? null, recordedBy: l.recordedBy ?? null, file: l.file ?? null, name: l.name === undefined ? l.id : l.name,
        map: l.mapId ?? 38, time: l.time === undefined ? null : l.time, dur: l.duration ?? 60_000, squad: l.squad === undefined ? 10 : l.squad,
        damage: l.damage === undefined ? 1000 : l.damage, kills: l.kills ?? null, deaths: l.deaths ?? null, enemyDeaths: l.enemyDeaths ?? null, owner,
      });
    }
  })();
  return lutas.map((l) => l.id);
}

/** N lutas prontas, a luta i com data i minutos depois de 2026-11-01 (a de número maior é a mais nova). */
const serie = (n: number, extra: (i: number) => Partial<Luta> = () => ({})): Luta[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${String(i).padStart(4, "0")}`, time: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(), ...extra(i) }));

const listar = async (publicId: string, query = "") => {
  const res = await app.server.inject(`/api/u/${publicId}/fights${query}`);
  return { lutas: res.json() as { id: string; squadDamage: number | null }[], total: Number(res.headers["x-total-count"]), status: res.statusCode };
};
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("lutas: paginação no servidor", () => {
  it("cada página traz as suas lutas, da mais nova para a mais antiga, sem repetir, e o total vem no cabeçalho", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, serie(120));

    const p1 = await listar(ana.publicId, "?limit=50&offset=0");
    const p2 = await listar(ana.publicId, "?limit=50&offset=50");
    const p3 = await listar(ana.publicId, "?limit=50&offset=100");

    expect(p1.total).toBe(120);
    expect([p1.lutas.length, p2.lutas.length, p3.lutas.length]).toEqual([50, 50, 20]);
    expect(ids(p1.lutas)[0]).toBe("f0119"); // a mais nova primeiro
    const todas = [...ids(p1.lutas), ...ids(p2.lutas), ...ids(p3.lutas)];
    expect(new Set(todas).size).toBe(120);
    expect(todas).toEqual([...todas].sort().reverse());
  });

  it("o total respeita os filtros", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, serie(120, (i) => ({ mapId: i < 30 ? 99 : 38 })));

    const r = await listar(ana.publicId, "?map=99&limit=10");

    expect(r.total).toBe(30);
    expect(r.lutas).toHaveLength(10);
  });

  it("lutas na fila ou com erro aparecem só na primeira página, e o total conta apenas as prontas", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, [...serie(60), { id: "q1", status: "queued", time: null }, { id: "q2", status: "queued", time: null }, { id: "e1", status: "error", time: null }]);

    const p1 = await listar(ana.publicId, "?limit=50&offset=0");
    const p2 = await listar(ana.publicId, "?limit=50&offset=50");

    expect(p1.total).toBe(60);
    expect(p1.lutas).toHaveLength(53);
    expect(ids(p1.lutas)).toEqual(expect.arrayContaining(["q1", "q2", "e1"]));
    expect(p2.lutas).toHaveLength(10);
    expect(ids(p2.lutas).some((id) => ["q1", "q2", "e1"].includes(id))).toBe(false);
  });

  it("um usuário nunca vê (nem conta) as lutas do outro", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    inserir(ana.id, serie(5));
    inserir(beto.id, serie(7).map((l) => ({ ...l, id: "b" + l.id })));

    const r = await listar(ana.publicId);

    expect(r.total).toBe(5);
    expect(ids(r.lutas).every((id) => id.startsWith("f"))).toBe(true);
  });

  it("limite acima de 500 vira 500, e offset negativo vira 0", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, serie(520));

    expect((await listar(ana.publicId, "?limit=9999")).lutas).toHaveLength(500);
    const negativo = await listar(ana.publicId, "?limit=5&offset=-10");
    expect(ids(negativo.lutas)[0]).toBe("f0519");
    expect(negativo.total).toBe(520);
  });
});

describe("lutas: ordenação vale para todas as lutas, não só para a página", () => {
  it("por dano, a maior de todas vem primeiro mesmo sendo a mais antiga, e as páginas seguem a ordem sem perder nem repetir", async () => {
    const ana = criarUsuario(app, "1", "ana");
    // a luta mais antiga (i = 0) tem o maior dano; vários empates para provar que a ordem entre páginas é estável
    inserir(ana.id, serie(120, (i) => ({ damage: i === 0 ? 9_999_999 : 1000 + (i % 7) * 10 })));

    const paginas = [0, 50, 100].map((o) => listar(ana.publicId, `?sort=dmg&dir=desc&limit=50&offset=${o}`));
    const [p1, p2, p3] = await Promise.all(paginas);

    expect(ids(p1!.lutas)[0]).toBe("f0000");
    const todas = [...p1!.lutas, ...p2!.lutas, ...p3!.lutas];
    expect(new Set(ids(todas)).size).toBe(120);
    const danos = todas.map((l) => l.squadDamage ?? 0);
    expect(danos).toEqual([...danos].sort((a, b) => b - a));
  });

  it("quem define o conjunto é o filtro: a ordenação e o total valem só para as lutas filtradas, em todas as páginas", async () => {
    const ana = criarUsuario(app, "1", "ana");
    // a luta de maior dano de todas está em outro mapa e não pode aparecer quando o filtro pede o mapa 99
    inserir(ana.id, serie(80, (i) => ({ mapId: i < 60 ? 99 : 38, damage: i === 70 ? 9_999_999 : 1000 + i })));

    const p1 = await listar(ana.publicId, "?map=99&sort=dmg&dir=desc&limit=25&offset=0");
    const p3 = await listar(ana.publicId, "?map=99&sort=dmg&dir=desc&limit=25&offset=50");

    expect(p1.total).toBe(60);
    expect(ids(p1.lutas)).not.toContain("f0070");
    expect(p1.lutas[0]!.squadDamage).toBe(1059); // o maior dano DENTRO do filtro
    expect(p3.lutas).toHaveLength(10);
    expect(p3.lutas.at(-1)!.squadDamage).toBe(1000); // o menor dentro do filtro fecha a última página
  });

  it("crescente e decrescente invertem a ordem, e o valor vazio fica sempre no fim, como na tela de hoje", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, [
      { id: "a", time: "2026-11-01T00:00:00Z", damage: 300 },
      { id: "b", time: "2026-11-02T00:00:00Z", damage: null },
      { id: "c", time: "2026-11-03T00:00:00Z", damage: 100 },
      { id: "d", time: "2026-11-04T00:00:00Z", damage: 200 },
    ]);

    expect(ids((await listar(ana.publicId, "?sort=dmg&dir=desc")).lutas)).toEqual(["a", "d", "c", "b"]);
    expect(ids((await listar(ana.publicId, "?sort=dmg&dir=asc")).lutas)).toEqual(["c", "d", "a", "b"]);
  });

  it.each([
    ["dur", "duration", [30_000, 90_000, 60_000]],
    ["size", "squad", [5, 50, 20]],
  ])("coluna %s ordena pelo valor certo", async (chave, campo, valores) => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, valores.map((v, i) => ({ id: `x${i}`, time: `2026-11-0${i + 1}T00:00:00Z`, [campo]: v })));

    const r = await listar(ana.publicId, `?sort=${chave}&dir=desc`);

    expect(ids(r.lutas)).toEqual(["x1", "x2", "x0"]);
  });

  it("kd é kills menos mortes (kills = inimigos mortos, ou os do squad se faltar)", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, [
      { id: "k0", time: "2026-11-01T00:00:00Z", enemyDeaths: 10, deaths: 2 }, // +8
      { id: "k1", time: "2026-11-02T00:00:00Z", enemyDeaths: null, kills: 30, deaths: 5 }, // +25
      { id: "k2", time: "2026-11-03T00:00:00Z", enemyDeaths: 3, deaths: 9 }, // -6
    ]);

    expect(ids((await listar(ana.publicId, "?sort=kd&dir=desc")).lutas)).toEqual(["k1", "k0", "k2"]);
  });

  it("nome e quem enviou ordenam como texto, sem diferenciar maiúsculas", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, [
      { id: "n0", time: "2026-11-01T00:00:00Z", name: "borderlands", uploader: "carla" },
      { id: "n1", time: "2026-11-02T00:00:00Z", name: "Alpine", uploader: "Bruno" },
      { id: "n2", time: "2026-11-03T00:00:00Z", name: "Eternal", uploader: "ana" },
    ]);

    expect(ids((await listar(ana.publicId, "?sort=name&dir=asc")).lutas)).toEqual(["n1", "n0", "n2"]);
    expect(ids((await listar(ana.publicId, "?sort=up&dir=asc")).lutas)).toEqual(["n2", "n1", "n0"]);
  });

  it("quem gravou o log ordena como texto, sem diferenciar maiúsculas, e sem gravador vem antes na ordem crescente", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, [
      { id: "r0", time: "2026-11-01T00:00:00Z", recordedBy: "Zeta Char" },
      { id: "r1", time: "2026-11-02T00:00:00Z", recordedBy: "alfa char" },
      { id: "r2", time: "2026-11-03T00:00:00Z", recordedBy: null },
    ]);

    expect(ids((await listar(ana.publicId, "?sort=rec&dir=asc")).lutas)).toEqual(["r2", "r1", "r0"]);
    expect(ids((await listar(ana.publicId, "?sort=rec&dir=desc")).lutas)).toEqual(["r0", "r1", "r2"]);
  });

  it("coluna desconhecida ou com cara de SQL cai na ordem padrão (data, da mais nova), sem erro e sem tocar no banco", async () => {
    const ana = criarUsuario(app, "1", "ana");
    inserir(ana.id, serie(3));

    for (const s of ["inventada", "dmg; DROP TABLE fights", "f.id", "1"]) {
      const r = await listar(ana.publicId, `?sort=${encodeURIComponent(s)}&dir=${encodeURIComponent("desc; DROP TABLE fights")}`);
      expect(r.status).toBe(200);
      expect(ids(r.lutas)).toEqual(["f0002", "f0001", "f0000"]);
    }
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights").get()).toEqual({ n: 3 });
  });
});

describe("regra de paginação (usada pela tela)", () => {
  it("a página padrão é de 20 e o número de páginas arredonda para cima", () => {
    expect(PAGE_SIZE).toBe(20);
    expect([0, 1, 20, 21, 230].map((n) => pageCount(n))).toEqual([1, 1, 1, 2, 12]);
  });

  it("fatia a lista mantendo a ordem, e página fora do intervalo cai na última ou na primeira", () => {
    const linhas = Array.from({ length: 230 }, (_, i) => i);

    expect(pageSlice(linhas, 1)).toEqual(linhas.slice(0, 20));
    expect(pageSlice(linhas, 12)).toEqual(linhas.slice(220));
    expect(pageSlice(linhas, 99)).toEqual(linhas.slice(220));
    expect(pageSlice(linhas, 0)).toEqual(linhas.slice(0, 20));
    expect(pageSlice([], 3)).toEqual([]);
  });
});
