import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import { Gw2Api } from "../src/gw2api.js";
import { MediaStore } from "../src/media.js";
import { ingestJson } from "../src/worker.js";
import { wvwFixture } from "./fixture.js";

const icon = (n: string) => `https://render.guildwars2.com/file/${n}/1.png`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);

/** fetch de mentira: a API devolve profissões/especializações; qualquer outra URL devolve um PNG. */
function fakeFetch(opts: { apiDown?: boolean; extra?: any[] } = {}) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    if (opts.apiDown) throw new Error("API fora do ar");
    if (String(url).includes("/v2/professions"))
      return Response.json([{ name: "Guardian", icon: icon("GUARD") }, { name: "Necromancer", icon: icon("NECRO") }]);
    if (String(url).includes("/v2/specializations"))
      return Response.json([
        // elite: o emblema da classe é profession_icon; icon é a imagem da linha de talentos
        { name: "Firebrand", elite: true, icon: icon("FIRE-LINHA"), profession_icon: icon("FIRE") },
        { name: "Reaper", elite: true, icon: icon("REAPER-LINHA"), profession_icon: icon("REAPER") },
        { name: "Tempest", elite: true, icon: icon("TEMPEST-LINHA"), profession_icon: icon("TEMPEST") },
        { name: "Zeal", elite: false, icon: icon("ZEAL") },
        ...(opts.extra ?? []),
      ]);
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

let dir: string;
let db: DB;
const newFight = (id: string) => db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, 'parsing', ?)").run(id, "sha-" + id, new Date().toISOString());

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-prof-"));
  db = openDb(paths(dir).db);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Gw2Api.professionIcons", () => {
  it("monta nome → ícone com profissões e especializações", async () => {
    const api = new Gw2Api(db, true, fakeFetch().fn);

    const icons = await api.professionIcons();

    expect(icons).toMatchObject({ Guardian: icon("GUARD"), Necromancer: icon("NECRO"), Firebrand: icon("FIRE"), Tempest: icon("TEMPEST") });
  });

  it("usa o emblema da classe (profession_icon) das elites e ignora especializações sem elite", async () => {
    const icons = await new Gw2Api(db, true, fakeFetch().fn).professionIcons();

    expect(icons.Firebrand).toBe(icon("FIRE"));
    expect(icons).not.toHaveProperty("Zeal");
  });

  it("ignora ícone de fora da lista permitida", async () => {
    const api = new Gw2Api(db, true, fakeFetch({ extra: [{ name: "Malicioso", elite: true, profession_icon: "http://169.254.169.254/x.png" }] }).fn);

    expect(await api.professionIcons()).not.toHaveProperty("Malicioso");
  });

  it("devolve vazio, sem lançar erro, se a API falhar ou estiver desligada", async () => {
    expect(await new Gw2Api(db, true, fakeFetch({ apiDown: true }).fn).professionIcons()).toEqual({});
    expect(await new Gw2Api(db, false, fakeFetch().fn).professionIcons()).toEqual({});
  });
});

describe("ingestJson guarda os ícones das classes da luta", () => {
  it("baixa o ícone de cada classe do squad (não de quem está fora do squad)", async () => {
    const f = fakeFetch();
    const media = new MediaStore(db, f.fn);
    newFight("luta1");

    await ingestJson(db, new Gw2Api(db, true, f.fn), media, "luta1", wvwFixture(), false);

    expect(media.get("prof:Firebrand")).not.toBeNull();
    expect(media.get("prof:Reaper")).not.toBeNull();
    expect(media.get("prof:Tempest")).not.toBeNull();
    expect(media.get("prof:Scrapper")).toBeNull();
  });

  it("troca o ícone antigo guardado quando a API aponta outro", async () => {
    const f = fakeFetch();
    const media = new MediaStore(db, f.fn);
    await media.ensure("prof:Firebrand", icon("FIRE-LINHA")); // ícone errado, de uma versão anterior
    newFight("luta1");

    await ingestJson(db, new Gw2Api(db, true, f.fn), media, "luta1", wvwFixture(), false);

    expect((db.prepare("SELECT source_url AS u FROM media WHERE key = 'prof:Firebrand'").get() as { u: string }).u).toBe(icon("FIRE"));
  });

  it("não consulta a API de novo quando os ícones já estão guardados", async () => {
    const f = fakeFetch();
    const media = new MediaStore(db, f.fn);
    const api = new Gw2Api(db, true, f.fn);
    newFight("luta1");
    newFight("luta2");
    await ingestJson(db, api, media, "luta1", wvwFixture(), false);
    const consultas = () => f.calls.filter((u) => /\/v2\/(professions|specializations)/.test(u)).length;
    const antes = consultas();

    await ingestJson(db, api, media, "luta2", wvwFixture(), false);

    expect(antes).toBeGreaterThan(0);
    expect(consultas()).toBe(antes);
  });

  it("a luta é gravada mesmo se a API de classes estiver fora do ar", async () => {
    const f = fakeFetch({ apiDown: true });
    newFight("luta1");

    await ingestJson(db, new Gw2Api(db, true, f.fn), new MediaStore(db, f.fn), "luta1", wvwFixture(), false);

    expect((db.prepare("SELECT status FROM fights WHERE id = 'luta1'").get() as { status: string }).status).toBe("done");
  });
});
