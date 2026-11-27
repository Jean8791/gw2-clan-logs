import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { Gw2Api } from "../src/gw2api.js";
import { MediaStore } from "../src/media.js";
import { buildApp, type App } from "../src/server.js";
import { ingestJson } from "../src/worker.js";
import { wvwFixture } from "./fixture.js";
import { criarUsuario } from "./usuarios.js";

/** Quem joga de mais de uma classe aparece no ranking com todas elas, não só a da última luta (caso real: 11 lutas de Druid e 24 de Untamed). */
let app: App;
let dir: string;
let ana: ReturnType<typeof criarUsuario>;
let n = 0;
const ATACANTE = "Atacante.2222";

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-classes-"));
  app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
  ana = criarUsuario(app, "1", "ana");
  n = 0;
});
afterEach(async () => {
  await app.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Uma luta do `dono` (padrão: a Ana) em que o Atacante joga de `classe`, no horário `quando`. */
async function luta(classe: string, quando: string, dono = ana) {
  const id = `luta-${++n}`;
  app.db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, owner_id) VALUES (?, ?, 'parsing', ?, ?)").run(id, "sha-" + id, new Date().toISOString(), dono.id);
  const json: any = wvwFixture();
  json.timeStartStd = quando;
  json.players.find((p: any) => p.account === ATACANTE).profession = classe;
  await ingestJson(app.db, new Gw2Api(app.db, false), new MediaStore(app.db, (async () => new Response("")) as unknown as typeof fetch), id, json, false, true);
}
const linha = async (conta = ATACANTE, query = "", dono = ana) => {
  const res = (await app.server.inject(`/api/ranking${query}`)).json();
  return res.rows.find((r: { account: string }) => r.account === conta);
};

describe("ranking de quem jogou de mais de uma classe", () => {
  it("mostra as duas classes com a contagem de lutas, da mais jogada para a menos, e os totais somam as lutas todas", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:30:00 -03:00");

    const r = await linha();

    expect(r.professions).toEqual([
      { profession: "Untamed", fights: 2 },
      { profession: "Druid", fights: 1 },
    ]);
    expect(r.fights).toBe(3);
    expect(r.profession).toBe("Untamed");
  });

  it("a classe principal é a mais jogada, não a da última luta", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    await luta("Druid", "2026-11-19 22:30:00 -03:00");
    await luta("Untamed", "2026-11-20 22:00:00 -03:00"); // a mais recente, mas só uma

    const r = await linha();

    expect(r.profession).toBe("Druid");
    expect(r.professions.map((p: { profession: string }) => p.profession)).toEqual(["Druid", "Untamed"]);
  });

  it("empate de lutas: a classe mais recente vem primeiro", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:00:00 -03:00");

    const r = await linha();

    expect(r.professions.map((p: { profession: string }) => p.profession)).toEqual(["Untamed", "Druid"]);
    expect(r.profession).toBe("Untamed");
  });

  it("filtrando por classe, a linha mostra só essa classe e só as lutas dela (o contorno que já existia)", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:30:00 -03:00");

    const r = await linha(ATACANTE, "?profession=Druid");

    expect(r.professions).toEqual([{ profession: "Druid", fights: 1 }]);
    expect(r.fights).toBe(1);
    expect(r.profession).toBe("Druid");
  });

  it("quem jogou de uma classe só continua com uma classe", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    await luta("Untamed", "2026-11-20 22:00:00 -03:00");

    const comandante = await linha("Comandante.1111");

    expect(comandante.professions).toEqual([{ profession: "Firebrand", fights: 2 }]);
    expect(comandante.profession).toBe("Firebrand");
  });

  it("linha sem classe (o log não trouxe) não vira uma classe vazia", async () => {
    await luta("Druid", "2026-11-19 22:00:00 -03:00");
    app.db.prepare("UPDATE player_stats SET profession = NULL WHERE account = 'Outro.3333'").run();

    const semClasse = await linha("Outro.3333");

    expect(semClasse.professions).toEqual([]);
    expect(semClasse.profession).toBeNull();
  });
});
