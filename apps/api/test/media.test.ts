import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, paths } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import { collectBuffIcons, isAllowedIconUrl, MediaStore } from "../src/media.js";
import { buildApp } from "../src/server.js";

const ICON = "https://render.guildwars2.com/file/AAAA1111/102835.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** fetch de mentira: devolve a resposta combinada e conta as chamadas. */
function fakeFetch(res: { ok?: boolean; type?: string; body?: Buffer } = {}) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(String(url));
    const body = res.body ?? PNG;
    return new Response(body, { status: res.ok === false ? 404 : 200, headers: { "content-type": res.type ?? "image/png" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

let dir: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw2logs-media-"));
  db = openDb(paths(dir).db);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isAllowedIconUrl", () => {
  it("aceita só https na render.guildwars2.com", () => {
    expect(isAllowedIconUrl(ICON)).toBe(true);
  });

  it.each([
    "http://render.guildwars2.com/file/A/1.png",
    "https://render.guildwars2.com.evil.com/file/A/1.png",
    "https://evil.com/render.guildwars2.com/file/A/1.png",
    "https://user@render.guildwars2.com@evil.com/file/A/1.png",
    "https://render.guildwars2.com:8443/file/A/1.png",
    "http://169.254.169.254/latest/meta-data",
    "https://localhost/file/A/1.png",
    "file:///etc/passwd",
    "não é url",
  ])("recusa %s", (url) => {
    expect(isAllowedIconUrl(url)).toBe(false);
  });
});

describe("MediaStore", () => {
  it("baixa o ícone uma vez e não baixa de novo", async () => {
    const f = fakeFetch();
    const store = new MediaStore(db, f.fn);

    expect(await store.ensure("buff:1122", ICON)).toBe(true);
    expect(await store.ensure("buff:1122", ICON)).toBe(true);

    expect(f.calls).toEqual([ICON]);
    expect(store.get("buff:1122")?.contentType).toBe("image/png");
    expect(store.get("buff:1122")?.bytes.equals(PNG)).toBe(true);
  });

  it("baixa de novo e troca o ícone quando o link mudou", async () => {
    const f = fakeFetch();
    const store = new MediaStore(db, f.fn);
    const NOVO = "https://render.guildwars2.com/file/BBBB2222/102835.png";
    await store.ensure("buff:1122", ICON);

    expect(await store.ensure("buff:1122", NOVO)).toBe(true);

    expect(f.calls).toEqual([ICON, NOVO]);
    expect((db.prepare("SELECT source_url AS u FROM media WHERE key = 'buff:1122'").get() as { u: string }).u).toBe(NOVO);
  });

  it("se o link novo falhar, mantém o ícone antigo", async () => {
    await new MediaStore(db, fakeFetch().fn).ensure("buff:1122", ICON);

    const ok = await new MediaStore(db, fakeFetch({ ok: false }).fn).ensure("buff:1122", "https://render.guildwars2.com/file/BBBB2222/1.png");

    expect(ok).toBe(false);
    expect(new MediaStore(db).get("buff:1122")?.bytes.equals(PNG)).toBe(true);
  });

  it("não baixa URL fora da lista permitida e não lança erro", async () => {
    const f = fakeFetch();
    const store = new MediaStore(db, f.fn);

    expect(await store.ensure("buff:1", "http://169.254.169.254/x.png")).toBe(false);

    expect(f.calls).toEqual([]);
    expect(store.get("buff:1")).toBeNull();
  });

  it.each([
    ["resposta com erro", { ok: false }],
    ["tipo que não é imagem", { type: "text/html" }],
    ["SVG (pode ter script)", { type: "image/svg+xml" }],
    ["arquivo grande demais", { body: Buffer.alloc(300 * 1024) }],
  ])("não guarda quando há %s", async (_nome, res) => {
    const store = new MediaStore(db, fakeFetch(res).fn);

    expect(await store.ensure("buff:2", ICON)).toBe(false);

    expect(store.get("buff:2")).toBeNull();
  });

  it("não lança erro se a rede falhar", async () => {
    const store = new MediaStore(db, (async () => {
      throw new Error("sem rede");
    }) as unknown as typeof fetch);

    expect(await store.ensure("buff:3", ICON)).toBe(false);
  });
});

describe("collectBuffIcons", () => {
  const json = {
    buffMap: {
      b1122: { name: "Stability", classification: "Boon", icon: ICON },
      b737: { name: "Burning", classification: "Condition", icon: "https://render.guildwars2.com/file/B/1.png" },
      b999: { name: "Malicioso", classification: "Boon", icon: "http://169.254.169.254/x.png" },
      b5: { name: "Sem ícone", classification: "Boon" },
    },
  };

  it("pega só boons com ícone em URL permitida", () => {
    expect(collectBuffIcons(json)).toEqual([{ key: "buff:1122", url: ICON }]);
  });

  it("ignora JSON sem buffMap", () => {
    expect(collectBuffIcons({})).toEqual([]);
  });
});

describe("GET /api/media/:key", () => {
  it("serve a imagem guardada com tipo fixo e nosniff", async () => {
    const app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
    await new MediaStore(app.db, fakeFetch().fn).ensure("buff:1122", ICON);

    const res = await app.server.inject({ url: "/api/media/buff:1122" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.rawPayload.equals(PNG)).toBe(true);
    await app.server.close();
  });

  it("manda ETag, sempre revalida, e responde 304 se a imagem não mudou", async () => {
    const app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));
    await new MediaStore(app.db, fakeFetch().fn).ensure("buff:1122", ICON);

    const first = await app.server.inject({ url: "/api/media/buff:1122" });
    const etag = String(first.headers.etag);
    const again = await app.server.inject({ url: "/api/media/buff:1122", headers: { "if-none-match": etag } });

    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(String(first.headers["cache-control"])).toContain("no-cache");
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
    await app.server.close();
  });

  it("responde 404 para chave desconhecida e 400 para chave inválida", async () => {
    const app = await buildApp(loadConfig({ DATA_DIR: dir, GW2_API: "off", WEB_DIR: path.join(dir, "sem-site") }));

    expect((await app.server.inject({ url: "/api/media/buff:999" })).statusCode).toBe(404);
    expect((await app.server.inject({ url: "/api/media/..%2F..%2Fetc%2Fpasswd" })).statusCode).toBe(400);
    await app.server.close();
  });
});
