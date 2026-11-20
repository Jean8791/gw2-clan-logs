import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, paths } from "../src/config.js";
import { removeFights } from "../src/retention.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;
const conteudo = JSON.stringify(wvwFixture());

async function start(env: Record<string, string> = {}) {
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site"), ...env }));
}
const enviar = (token: string, content = conteudo) => {
  const m = multipart([{ name: "luta.json", content }]);
  return app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": token } });
};
const sha = (content: string) => crypto.createHash("sha256").update(content).digest("hex");
const ranking = async (publicId: string) => (await app.server.inject(`/api/u/${publicId}/ranking`)).json().rows;
const contar = (tabela: "player_stats" | "player_skills", fightId: string) =>
  (app.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE fight_id = ?`).get(fightId) as { n: number }).n;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-copia-"));
  await start();
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("o mesmo arquivo enviado por outro usuário", () => {
  it("copia a luta já pronta sem passar pelo worker, e os números ficam iguais aos da original", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    const daAna = (await enviar(ana.token)).json()[0];
    await app.worker.idle();
    const enfileirar = vi.spyOn(app.worker, "enqueue");

    const doBeto = (await enviar(beto.token)).json()[0];

    expect(doBeto).toMatchObject({ status: "done" });
    expect(doBeto.id).not.toBe(daAna.id);
    expect(doBeto.duplicate).toBeUndefined();
    expect(enfileirar).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(dir, "uploads"))).toEqual([]);

    const copia = app.db.prepare("SELECT * FROM fights WHERE id = ?").get(doBeto.id) as any;
    const original = app.db.prepare("SELECT * FROM fights WHERE id = ?").get(daAna.id) as any;
    expect(copia).toMatchObject({ status: "done", owner_id: beto.id, uploader: "beto", sha256: sha(conteudo), has_report: 0 });
    expect(copia.time_start).toBe(original.time_start);
    expect(copia.squad_damage).toBe(original.squad_damage);
    expect(contar("player_stats", doBeto.id)).toBe(contar("player_stats", daAna.id));
    expect(contar("player_skills", doBeto.id)).toBe(contar("player_skills", daAna.id));
    expect(await ranking(beto.publicId)).toEqual(await ranking(ana.publicId));
  });

  it("a cópia é independente: apagar a luta da original não mexe na do outro usuário", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    const daAna = (await enviar(ana.token)).json()[0];
    await app.worker.idle();
    const doBeto = (await enviar(beto.token)).json()[0];
    const jogadores = contar("player_stats", doBeto.id);
    const habilidades = contar("player_skills", doBeto.id);

    await removeFights(app.db, paths(dir), [daAna.id]);

    expect(app.db.prepare("SELECT status FROM fights WHERE id = ?").get(doBeto.id)).toEqual({ status: "done" });
    expect(contar("player_stats", doBeto.id)).toBe(jogadores);
    expect(contar("player_skills", doBeto.id)).toBe(habilidades);
    expect((await app.server.inject(`/api/u/${beto.publicId}/fights/${doBeto.id}`)).statusCode).toBe(200);
  });

  it.each(["queued", "parsing", "error"])("original em '%s': processa normalmente, sem copiar", async (status) => {
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('orig', ?, ?, ?, ?)").run(sha(conteudo), status, new Date().toISOString(), ana.id);

    const doBeto = (await enviar(beto.token)).json()[0];

    expect(doBeto).toMatchObject({ status: "queued" });
  });

  it("o mesmo usuário reenviando continua sendo só ignorado", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const primeira = (await enviar(ana.token)).json()[0];
    await app.worker.idle();

    expect((await enviar(ana.token)).json()[0]).toMatchObject({ id: primeira.id, duplicate: true });
  });
});

describe("limites no envio copiado", () => {
  it("o limite por hora vale também para a cópia", async () => {
    await app.server.close();
    await start({ UPLOAD_MAX_PER_HOUR_USER: "1" });
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    await enviar(ana.token);
    await app.worker.idle();
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('antes', 'x', 'done', ?, ?)").run(new Date().toISOString(), beto.id);

    const res = (await enviar(beto.token)).json()[0];

    expect(res).toMatchObject({ code: "hourlyLimit" });
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights WHERE owner_id = ?").get(beto.id)).toEqual({ n: 1 });
  });

  it("fila cheia e disco cheio não barram a cópia, porque ela não usa nenhum dos dois", async () => {
    await app.server.close();
    await start({ UPLOAD_MAX_QUEUE: "1", UPLOAD_MAX_DISK_MB: "0.0005" });
    const ana = criarUsuario(app, "1", "ana");
    const beto = criarUsuario(app, "2", "beto");
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('orig', ?, 'done', ?, ?)").run(sha(conteudo), new Date().toISOString(), ana.id);
    app.db.prepare("INSERT INTO player_stats (fight_id, account) VALUES ('orig', 'Fulano.1234')").run();
    app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES ('fila', 'y', 'queued', ?, ?)").run(new Date().toISOString(), ana.id);
    fs.writeFileSync(path.join(dir, "uploads", "antigo.zevtc"), Buffer.alloc(2048));

    const res = (await enviar(beto.token)).json()[0];

    expect(res).toMatchObject({ status: "done" });
  });
});
