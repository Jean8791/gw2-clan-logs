import { describe, expect, it } from "vitest";
import { overviewDefaults } from "@gw2logs/shared";

describe("a Visão Geral abre no último dia de batalha com lutas", () => {
  it("com vários dias, escolhe o mais recente, mesmo que a lista venha fora de ordem", () => {
    const dias = [{ day: "2026-11-21" }, { day: "2026-11-26" }, { day: "2026-11-12" }];

    expect(overviewDefaults(dias)).toEqual({ day: ["2026-11-26"] });
  });

  it("com um dia só, é o dia", () => {
    expect(overviewDefaults([{ day: "2026-11-12" }])).toEqual({ day: ["2026-11-12"] });
  });

  it("sem nenhum dia com luta (ou sem a lista), cai nos últimos 30 dias, como antes", () => {
    expect(overviewDefaults([])).toEqual({ days: 30 });
    expect(overviewDefaults(undefined)).toEqual({ days: 30 });
  });

  it("não devolve o período junto com o dia: o seletor de período fica em 'Todos'", () => {
    expect(overviewDefaults([{ day: "2026-11-26" }])).not.toHaveProperty("days");
  });
});
