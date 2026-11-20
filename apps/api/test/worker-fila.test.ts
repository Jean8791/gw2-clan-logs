import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-fila-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const enviar = (token: string, n: number) => {
  const m = multipart([{ name: `luta${n}.json`, content: JSON.stringify({ ...wvwFixture(), fightName: `Luta ${n}` }) }]);
  return app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": token } });
};
const status = (id: string) => (app.db.prepare("SELECT status FROM fights WHERE id = ?").get(id) as { status: string }).status;

/**
 * Segura o worker na consulta dos nomes das guildas (o que o laço faz depois de esvaziar a fila). Devolve uma promessa que diz
 * "o worker já está lá" e a função que o solta.
 */
function segurarNasGuildas() {
  const api = (app.worker as unknown as { api: { resolvePendingGuilds: () => Promise<unknown> } }).api;
  let soltar!: () => void;
  const porta = new Promise<void>((r) => (soltar = r));
  const chegou = new Promise<void>((r) => {
    api.resolvePendingGuilds = () => (r(), porta);
  });
  return { chegou, soltar };
}

describe("worker: um log que chega durante a consulta de guildas não pode ficar esquecido na fila", () => {
  it("o log enviado nessa janela é processado, sem precisar de outro envio nem de reiniciar o servidor", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const guildas = segurarNasGuildas();

    const primeiro = (await enviar(ana.token, 1)).json()[0].id;
    await guildas.chegou; // a fila esvaziou e o worker está esperando as guildas
    expect(status(primeiro)).toBe("done");

    const segundo = (await enviar(ana.token, 2)).json()[0].id; // chega justo nessa janela
    guildas.soltar();
    await app.worker.idle();

    expect(status(segundo)).toBe("done");
  });

  it("vários logs na janela são processados todos, na ordem em que chegaram", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const guildas = segurarNasGuildas();
    await enviar(ana.token, 1);
    await guildas.chegou;

    const ids = [(await enviar(ana.token, 2)).json()[0].id, (await enviar(ana.token, 3)).json()[0].id, (await enviar(ana.token, 4)).json()[0].id];
    guildas.soltar();
    await app.worker.idle();

    expect(ids.map(status)).toEqual(["done", "done", "done"]);
  });

  it("sem nada chegando na janela, o worker termina normalmente e avisa quem espera", async () => {
    const ana = criarUsuario(app, "1", "ana");
    const id = (await enviar(ana.token, 1)).json()[0].id;

    await app.worker.idle();

    expect(status(id)).toBe("done");
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights WHERE status IN ('queued','parsing')").get()).toEqual({ n: 0 });
  });
});
