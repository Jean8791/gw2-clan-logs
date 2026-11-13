import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import { purgeOldFights } from "../src/retention.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString();

let dir: string;
let db: DB;
const p = () => paths(dir);

function addFight(id: string, timeStart: string | null, uploadedAt = daysAgo(0)) {
  db.prepare("INSERT INTO fights (id, sha256, status, uploaded_at, time_start) VALUES (?, ?, 'done', ?, ?)").run(id, "sha-" + id, uploadedAt, timeStart);
  db.prepare("INSERT INTO player_stats (fight_id, account, name, profession) VALUES (?, 'conta.1234', 'nome', 'Guardian')").run(id);
  fs.mkdirSync(p().fightDir(id), { recursive: true });
  fs.writeFileSync(path.join(p().fightDir(id), "ei.json.gz"), "x");
  fs.writeFileSync(path.join(p().uploads, id + ".zevtc"), "x");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-ret-"));
  fs.mkdirSync(p().uploads, { recursive: true });
  db = openDb(p().db);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("purgeOldFights", () => {
  it("apaga só as lutas mais antigas que o prazo, com estatísticas e arquivos", async () => {
    addFight("antiga", daysAgo(10));
    addFight("recente", daysAgo(2));

    const apagadas = await purgeOldFights(db, p(), 7, now);

    expect(apagadas).toBe(1);
    expect(db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "recente" }]);
    expect(db.prepare("SELECT count(*) AS n FROM player_stats WHERE fight_id = 'antiga'").get()).toEqual({ n: 0 });
    expect(fs.existsSync(p().fightDir("antiga"))).toBe(false);
    expect(fs.existsSync(path.join(p().uploads, "antiga.zevtc"))).toBe(false);
    expect(fs.existsSync(p().fightDir("recente"))).toBe(true);
    expect(fs.existsSync(path.join(p().uploads, "recente.zevtc"))).toBe(true);
  });

  it("sem data da luta (ainda na fila ou com erro), usa a data do envio", async () => {
    addFight("fila-velha", null, daysAgo(9));
    addFight("fila-nova", null, daysAgo(1));

    await purgeOldFights(db, p(), 7, now);

    expect(db.prepare("SELECT id FROM fights").all()).toEqual([{ id: "fila-nova" }]);
  });
});
