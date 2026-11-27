import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { criarUsuario } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-publica-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** Uma luta pronta de um dono, com um jogador, gravada por "Gravador.1" e enviada por "Enviador". */
function luta(owner: number, jogador: string) {
  const id = `f${++n}`;
  app.db
    .prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id, uploader, recorded_by, time_start, mode, duration_ms) VALUES (?, ?, 'done', ?, ?, 'Enviador', 'Gravador.1', '2026-11-20T20:00:00.000Z', 'wvw', 600000)")
    .run(id, "sha-" + id, new Date().toISOString(), owner);
  app.db.prepare("INSERT INTO player_stats (fight_id, account, name, profession, role, active_ms, damage) VALUES (?, ?, ?, 'Guardian', 'dps', 600000, 1000)").run(id, jogador, jogador.split(".")[0]);
  return id;
}

describe("leitura aberta: um conjunto único de logs, sem login", () => {
  it("quem não está logado vê as lutas de todos os usuários juntas", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const bia = criarUsuario(app, "2", "bia");
    const daAna = luta(ana.id, "Fulano.1111");
    const daBia = luta(bia.id, "Sicrano.2222");

    const res = await app.server.inject("/api/fights");

    expect(res.statusCode).toBe(200);
    expect(res.json().map((f: { id: string }) => f.id).sort()).toEqual([daAna, daBia].sort());
    expect(res.headers["x-total-count"]).toBe("2");
  });

  it("o ranking junta os jogadores de todos os usuários, sem login", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const bia = criarUsuario(app, "2", "bia");
    luta(ana.id, "Fulano.1111");
    luta(bia.id, "Sicrano.2222");

    const res = await app.server.inject("/api/ranking");

    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { account: string }) => r.account).sort()).toEqual(["Fulano.1111", "Sicrano.2222"]);
  });

  it("a lista e o detalhe da luta não dizem quem enviou nem quem gravou", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = luta(ana.id, "Fulano.1111");

    const lista = (await app.server.inject("/api/fights")).json();
    const detalhe = (await app.server.inject(`/api/fights/${id}`)).json();

    for (const f of [lista[0], detalhe.fight ?? detalhe]) {
      expect(f).not.toHaveProperty("uploader");
      expect(f).not.toHaveProperty("recordedBy");
    }
    expect(JSON.stringify([lista, detalhe])).not.toContain("Enviador");
    expect(JSON.stringify([lista, detalhe])).not.toContain("Gravador.1");
  });

  it("o espaço por usuário deixou de existir: /api/u/:id dá 404", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta(ana.id, "Fulano.1111");

    expect((await app.server.inject(`/api/u/${ana.publicId}/fights`)).statusCode).toBe(404);
    expect((await app.server.inject(`/api/u/${ana.publicId}`)).statusCode).toBe(404);
  });

  it("não existe mais a rota de trocar o link de compartilhar", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const res = await app.server.inject({ method: "POST", url: "/api/auth/share-link/rotate", headers: { cookie } });

    expect(res.statusCode).toBe(404);
  });
});

describe("apagar a conta não apaga os logs", () => {
  it("a conta e as sessões somem, mas as lutas continuam no conjunto único", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = luta(ana.id, "Fulano.1111");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const res = await app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { cookie, "content-type": "application/json" }, payload: { confirm: "ana" } });

    expect(res.statusCode).toBe(200);
    expect(app.db.prepare("SELECT COUNT(*) n FROM users WHERE id = ?").get(ana.id)).toEqual({ n: 0 });
    expect((await app.server.inject("/api/fights")).json().map((f: { id: string }) => f.id)).toEqual([id]);
  });
});

describe("o que ainda não está pronto não é público", () => {
  /** Uma luta que não está pronta (fila ou erro), de um usuário. */
  const pendente = (owner: number, id: string, status: "queued" | "error") =>
    app.db.prepare("INSERT INTO fights (id, sha256, status, error, uploaded_at, owner_id) VALUES (?, ?, ?, ?, ?, ?)").run(id, "sha-" + id, status, status === "error" ? "boom" : null, new Date().toISOString(), owner);

  it("o detalhe e o relatório de uma luta na fila ou com erro dão 404 para qualquer um", async () => {
    const ana = criarUsuario(app, "1", "ana");
    pendente(ana.id, "na-fila", "queued");
    pendente(ana.id, "com-erro", "error");

    for (const id of ["na-fila", "com-erro"]) {
      expect((await app.server.inject(`/api/fights/${id}`)).statusCode, id).toBe(404);
      expect((await app.server.inject(`/api/fights/${id}/report`)).statusCode, id).toBe(404);
    }
  });

  it("a fila e os erros aparecem só para quem enviou", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const bia = criarUsuario(app, "2", "bia");
    pendente(ana.id, "da-ana", "queued");
    const cookie = (u: { id: number }) => ({ cookie: `session=${createSession(app.db, u.id, "web")}` });
    const ids = async (headers: Record<string, string> = {}) => (await app.server.inject({ url: "/api/fights", headers })).json().map((f: { id: string }) => f.id);

    expect(await ids()).toEqual([]);
    expect(await ids(cookie(bia))).toEqual([]);
    expect(await ids(cookie(ana))).toEqual(["da-ana"]);
  });

  it("o usuário logado não é escolhido pela query: ?viewer=1 não mostra a fila de ninguém", async () => {
    const ana = criarUsuario(app, "1", "ana");
    pendente(ana.id, "da-ana", "queued");

    expect((await app.server.inject(`/api/fights?viewer=${ana.id}&owner=${ana.id}`)).json()).toEqual([]);
  });

  it("apagar a conta com luta na fila ou com erro: ela fica sem dono e continua fora da lista pública", async () => {
    const ana = criarUsuario(app, "1", "ana");
    pendente(ana.id, "na-fila", "queued");
    pendente(ana.id, "com-erro", "error");
    const cookie = `session=${createSession(app.db, ana.id, "web")}`;

    const res = await app.server.inject({ method: "DELETE", url: "/api/auth/account", headers: { cookie, "content-type": "application/json" }, payload: { confirm: "ana" } });

    expect(res.statusCode).toBe(200);
    expect(app.db.prepare("SELECT id, owner_id FROM fights ORDER BY id").all()).toEqual([
      { id: "com-erro", owner_id: null },
      { id: "na-fila", owner_id: null },
    ]);
    expect((await app.server.inject("/api/fights")).json()).toEqual([]);
  });
});

describe("ordenação por coluna que saiu da tela", () => {
  it.each(["up", "rec", "uploader; DROP TABLE fights"])("?sort=%s cai na ordem padrão (data, da mais nova), sem erro", async (coluna) => {
    const ana = criarUsuario(app, "1", "ana");
    const velha = luta(ana.id, "Fulano.1111");
    const nova = luta(ana.id, "Sicrano.2222");
    app.db.prepare("UPDATE fights SET time_start = '2026-11-21T20:00:00.000Z' WHERE id = ?").run(nova);

    const res = await app.server.inject(`/api/fights?sort=${encodeURIComponent(coluna)}&dir=asc`);

    expect(res.statusCode).toBe(200);
    expect(res.json().map((f: { id: string }) => f.id)).toEqual([velha, nova]);
  });
});
