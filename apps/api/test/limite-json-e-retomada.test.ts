import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JSON_MB } from "@gw2logs/shared";
import { loadConfig } from "../src/config.js";
import { buildApp, type App } from "../src/server.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario, multipart } from "./usuarios.js";

let app: App;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-json-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
});
afterEach(async () => {
  await app.worker.idle();
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const MB = 1024 * 1024;
const enviar = (token: string, nome: string, content: string) => {
  const m = multipart([{ name: nome, content }]);
  return app.server.inject({ method: "POST", url: "/api/upload", payload: m.payload, headers: { ...m.headers, "x-upload-key": token } });
};
const luta = (id: string, status: string, owner: number, sha = "sha-" + id) =>
  app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, ?, ?, ?, ?)").run(id, sha, status, new Date().toISOString(), owner);
const linha = (id: string) => app.db.prepare("SELECT status, error FROM fights WHERE id = ?").get(id) as { status: string; error: string | null } | undefined;

describe("um .json grande demais não entra: ele vira memória ~30 vezes maior e derrubava o servidor", () => {
  it("acima do limite próprio de .json é recusado com jsonTooBig, e nada fica guardado", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await enviar(ana.token, "grande.json", "a".repeat((MAX_JSON_MB + 1) * MB));

    expect(res.json()[0]).toMatchObject({ file: "grande.json", code: "jsonTooBig", max: MAX_JSON_MB });
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM fights").get()).toEqual({ n: 0 });
    expect(fs.readdirSync(path.join(dir, "uploads"))).toEqual([]);
  });

  it("um .json pequeno entra normalmente", async () => {
    const ana = criarUsuario(app, "1", "ana");

    expect((await enviar(ana.token, "luta.json", JSON.stringify(wvwFixture()))).json()[0].status).toBe("queued");
  });

  it("o limite é só do .json: um .zevtc do mesmo tamanho continua indo para a fila (o Elite Insights tem o próprio caminho)", async () => {
    const ana = criarUsuario(app, "1", "ana");

    const res = await enviar(ana.token, "grande.zevtc", "a".repeat((MAX_JSON_MB + 1) * MB));

    expect(res.json()[0]).toMatchObject({ status: "queued" });
  });
});

describe("resume(): o que estava em processamento quando o servidor caiu não é repetido sozinho", () => {
  it("em parsing vira erro 'interrompida' e não volta para a fila; o que estava na fila continua nela", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta("estava-processando", "parsing", ana.id);
    luta("estava-na-fila", "queued", ana.id);
    const enfileirar = vi.spyOn(app.worker, "enqueue");

    app.worker.resume();

    expect(linha("estava-processando")).toEqual({ status: "error", error: "interrupted" });
    expect(enfileirar.mock.calls.map((c) => c[0])).toEqual(["estava-na-fila"]);
  });

  it("subir de novo não o recoloca na fila (sem laço de reinício)", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta("estava-processando", "parsing", ana.id);
    app.worker.resume();
    await app.worker.idle();
    const enfileirar = vi.spyOn(app.worker, "enqueue");

    app.worker.resume();

    expect(enfileirar).not.toHaveBeenCalled();
    expect(linha("estava-processando")?.status).toBe("error");
  });
});

describe("reenviar um log que ficou com erro (por exemplo, interrompido) substitui o registro com erro", () => {
  const conteudo = JSON.stringify(wvwFixture());
  const sha = crypto.createHash("sha256").update(conteudo).digest("hex");

  it("o mesmo arquivo volta para a fila como luta nova, e o registro com erro (e o arquivo dele) sai", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta("velha-com-erro", "error", ana.id, sha);
    fs.writeFileSync(path.join(dir, "uploads", "velha-com-erro.json"), "x");

    const res = (await enviar(ana.token, "luta.json", conteudo)).json()[0];

    expect(res.duplicate).toBeUndefined();
    expect(res.status).toBe("queued");
    expect(res.id).not.toBe("velha-com-erro");
    expect(linha("velha-com-erro")).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "uploads", "velha-com-erro.json"))).toBe(false);
  });

  it("log já pronto ou ainda na fila continua sendo só ignorado como repetido", async () => {
    const ana = criarUsuario(app, "1", "ana");
    luta("pronta", "done", ana.id, sha);

    const res = (await enviar(ana.token, "luta.json", conteudo)).json()[0];

    expect(res).toMatchObject({ id: "pronta", duplicate: true });
  });
});
