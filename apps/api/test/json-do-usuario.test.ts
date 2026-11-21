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

const ACCOUNT = "Atacante.2222";
const ICON_ORIGINAL = "https://render.guildwars2.com/file/AAAA1111/1.png";
const ICON_TROCADO = "https://render.guildwars2.com/file/BBBB2222/2.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
const fakeFetch = (async () => new Response(PNG, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;

/** Luta com a habilidade 1 (nome e ícone dados) e o buff 1122 (ícone dado). */
function fight(skillName: string, icon: string) {
  const f: any = wvwFixture();
  const p = f.players.find((x: any) => x.account === ACCOUNT);
  p.targetDamageDist = [[[{ id: 1, totalDamage: 30, hits: 3, connectedHits: 2 }]]];
  f.skillMap = { s1: { name: skillName, icon } };
  f.buffMap = { b1122: { name: "Stability", classification: "Boon", icon } };
  return f;
}

let dir: string;
let db: DB;
let media: MediaStore;
const ingest = (id: string, json: any, trusted: boolean) => {
  db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at) VALUES (?, ?, 'parsing', ?)").run(id, "sha-" + id, new Date().toISOString());
  return ingestJson(db, new Gw2Api(db, false), media, id, json, false, trusted);
};
const skillName = () => (db.prepare("SELECT name FROM skills WHERE id = 1").get() as { name: string }).name;
const iconUrl = (key: string) => (db.prepare("SELECT source_url AS u FROM media WHERE key = ?").get(key) as { u: string }).u;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-confianca-"));
  db = openDb(paths(dir).db);
  media = new MediaStore(db, fakeFetch);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("o .json enviado pelo usuário não reescreve o que é de todos", () => {
  it("nome de habilidade diferente não altera o nome já salvo", async () => {
    await ingest("l1", fight("Skill Original", ICON_ORIGINAL), true);

    await ingest("l2", fight("Nome Forjado", ICON_ORIGINAL), false);

    expect(skillName()).toBe("Skill Original");
  });

  it("habilidade nova vinda de um .json ainda recebe o nome (só preenche o que está vazio)", async () => {
    await ingest("l1", fight("Skill Nova", ICON_ORIGINAL), false);

    expect(skillName()).toBe("Skill Nova");
  });

  it("nome vazio salvo antes é preenchido pelo .json", async () => {
    db.prepare("INSERT INTO skills (id, name) VALUES (1, NULL)").run();

    await ingest("l1", fight("Skill Nova", ICON_ORIGINAL), false);

    expect(skillName()).toBe("Skill Nova");
  });

  it("ícone diferente não troca o ícone já guardado (buff e habilidade)", async () => {
    await ingest("l1", fight("Skill", ICON_ORIGINAL), true);

    await ingest("l2", fight("Skill", ICON_TROCADO), false);

    expect(iconUrl("buff:1122")).toBe(ICON_ORIGINAL);
    expect(iconUrl("skill:1")).toBe(ICON_ORIGINAL);
  });

  it("ícone de chave que ainda não existe é gravado mesmo vindo de um .json", async () => {
    await ingest("l1", fight("Skill", ICON_ORIGINAL), false);

    expect(iconUrl("buff:1122")).toBe(ICON_ORIGINAL);
    expect(iconUrl("skill:1")).toBe(ICON_ORIGINAL);
  });
});

describe("o log processado pelo nosso Elite Insights continua atualizando", () => {
  it("renomeia a habilidade e troca o ícone", async () => {
    await ingest("l1", fight("Skill Original", ICON_ORIGINAL), true);

    await ingest("l2", fight("Skill Renomeada", ICON_TROCADO), true);

    expect(skillName()).toBe("Skill Renomeada");
    expect(iconUrl("buff:1122")).toBe(ICON_TROCADO);
    expect(iconUrl("skill:1")).toBe(ICON_TROCADO);
  });
});
