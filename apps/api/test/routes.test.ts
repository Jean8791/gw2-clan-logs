import { describe, expect, it } from "vitest";
import { ROUTES, legacyRoute } from "@gw2logs/shared";

describe("legacyRoute: links antigos em português levam às rotas em inglês", () => {
  it.each([
    ["/dias", "/days"],
    ["/lutas", "/fights"],
    ["/lutas/20261113180823-360aae1f", "/fights/20261113180823-360aae1f"],
    ["/jogadores/Nome.1234", "/players/Nome.1234"],
    ["/comparar", "/compare"],
    ["/guildas", "/guilds"],
    ["/eu", "/me"],
  ])("%s vira %s", (antigo, novo) => {
    expect(legacyRoute(antigo)).toBe(novo);
  });

  it("conta com acento ou símbolo no link continua intacta", () => {
    expect(legacyRoute("/jogadores/Conta%20Com%20Espa%C3%A7o.1234")).toBe("/players/Conta%20Com%20Espa%C3%A7o.1234");
  });

  it.each(["/", "/ranking", "/days", "/fights", "/players/Nome.1234", "/qualquer-coisa", "/lutasx", "/lutas/a/b", "/enviar", "/upload", ""])("%j não é rota antiga", (caminho) => {
    expect(legacyRoute(caminho)).toBeNull();
  });
});

describe("ROUTES: as rotas do site, todas em inglês", () => {
  it("monta os caminhos", () => {
    expect(ROUTES.overview).toBe("/");
    expect(ROUTES.days).toBe("/days");
    expect(ROUTES.fights).toBe("/fights");
    expect(ROUTES.fight("abc")).toBe("/fights/abc");
    expect(ROUTES.ranking).toBe("/ranking");
    expect(ROUTES.player("Nome.1234")).toBe("/players/Nome.1234");
    expect(ROUTES.compare).toBe("/compare");
    expect(ROUTES.guilds).toBe("/guilds");
    expect(ROUTES.me).toBe("/me");
  });

  it("codifica a conta no caminho (espaço, barra e acento não quebram a rota)", () => {
    expect(ROUTES.player("Ana Maria.1234")).toBe("/players/Ana%20Maria.1234");
    expect(ROUTES.player("a/b")).toBe("/players/a%2Fb");
  });

  it("nenhuma rota nova tem palavra em português", () => {
    const todas = [ROUTES.days, ROUTES.fights, ROUTES.ranking, ROUTES.compare, ROUTES.guilds, ROUTES.me, ROUTES.fight("x"), ROUTES.player("x")];
    expect(todas.filter((r) => /dias|lutas|jogadores|comparar|guildas|enviar|\/eu\b/.test(r))).toEqual([]);
  });
});
