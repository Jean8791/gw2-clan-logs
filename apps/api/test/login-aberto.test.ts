import { describe, expect, it } from "vitest";
import { assertLoginRestricted, loadConfig } from "../src/config.js";

const login = { DISCORD_CLIENT_ID: "id", DISCORD_CLIENT_SECRET: "segredo" };

describe("login do Discord não pode ficar aberto a qualquer conta sem querer", () => {
  it("login configurado e as duas listas vazias: recusa, dizendo o que fazer", () => {
    expect(() => assertLoginRestricted(loadConfig(login))).toThrow(/DISCORD_USER_IDS.*DISCORD_GUILD_IDS.*ALLOW_ANY_DISCORD/s);
  });

  it("ALLOW_ANY_DISCORD=true liberou de propósito: passa", () => {
    expect(() => assertLoginRestricted(loadConfig({ ...login, ALLOW_ANY_DISCORD: "true" }))).not.toThrow();
  });

  it("só valer ALLOW_ANY_DISCORD com o texto exato true", () => {
    expect(() => assertLoginRestricted(loadConfig({ ...login, ALLOW_ANY_DISCORD: "1" }))).toThrow();
  });

  it("com a lista de usuários ou a de servidores preenchida: passa", () => {
    expect(() => assertLoginRestricted(loadConfig({ ...login, DISCORD_USER_IDS: "123" }))).not.toThrow();
    expect(() => assertLoginRestricted(loadConfig({ ...login, DISCORD_GUILD_IDS: "456" }))).not.toThrow();
  });

  it("login não configurado (desenvolvimento, testes): passa", () => {
    expect(() => assertLoginRestricted(loadConfig({}))).not.toThrow();
    expect(() => assertLoginRestricted(loadConfig({ DISCORD_CLIENT_ID: "id" }))).not.toThrow();
  });

  it("lista só com vírgulas e espaços conta como vazia", () => {
    expect(() => assertLoginRestricted(loadConfig({ ...login, DISCORD_USER_IDS: " , " }))).toThrow();
  });
});
