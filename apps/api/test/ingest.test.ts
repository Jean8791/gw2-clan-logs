import { describe, expect, it } from "vitest";
import { extractFight, parseEiTime } from "../src/ingest.js";
import { wvwFixture } from "./fixture.js";

describe("extractFight", () => {
  const f = extractFight(wvwFixture());
  const by = (acc: string) => f.players.find((p) => p.account === acc)!;

  it("reconhece WvW e conta squad, aliados e inimigos", () => {
    expect(f.mode).toBe("wvw");
    expect(f.squadCount).toBe(3);
    expect(f.allyCount).toBe(1);
    expect(f.enemyCount).toBe(1);
    expect(f.timeStart).toBe("2026-11-13T02:33:54.000Z");
  });

  it("conta só o dano em jogadores inimigos, não em NPCs", () => {
    expect(by("Atacante.2222").damage).toBe(300000);
    expect(f.squadDamage).toBe(20000 + 300000 + 150000);
    expect(f.squadKills).toBe(4);
  });

  it("conta os inimigos caídos e mortos na luta toda, de quem for o crédito, sem NPCs", () => {
    expect(f.enemyDowns).toBe(5);
    expect(f.enemyDeaths).toBe(4);
  });

  it("lê guilda, boons gerados (squadBuffVolumes) e cleanses", () => {
    const c = by("Comandante.1111");
    expect(c.guildId).toBe("GUILD-A");
    expect(c.stabOut).toBe(3);
    expect(c.cleanses).toBe(6);
    expect(c.commander).toBe(true);
  });

  it("classifica suporte × dps", () => {
    expect(by("Comandante.1111").role).toBe("support");
    expect(by("Atacante.2222").role).toBe("dps");
    expect(by("Outro.3333").role).toBe("dps");
  });
});

describe("parseEiTime", () => {
  it("converte o horário do EI para UTC", () => {
    expect(parseEiTime("2026-11-12 23:33:54 -03:00")).toBe("2026-11-13T02:33:54.000Z");
    expect(parseEiTime("2026-11-12 23:33:54 +02")).toBe("2026-11-12T21:33:54.000Z");
    expect(parseEiTime(null)).toBeNull();
    expect(parseEiTime("lixo")).toBeNull();
  });
});
