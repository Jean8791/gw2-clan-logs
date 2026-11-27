import { describe, expect, it } from "vitest";
import { extractFight } from "../src/ingest.js";
import { wvwFixture } from "./fixture.js";

const RATE = 300; // ms entre uma posição e a seguinte (combatReplayMetaData.pollingRate)
const IN_TO_PX = 0.028; // polegadas do jogo → pixels do mapa (inchToPixel)
const SEM_FIM = 9223372036854775807; // o EI usa o maior e o menor inteiro de 64 bits como "para sempre" e "desde sempre"

/** Uma posição a `polegadas` do comandante, que fica parado na origem. */
const px = (polegadas: number): [number, number] => [polegadas * IN_TO_PX, 0];

interface Replay {
  start?: number;
  /** distância ao comandante em polegadas, uma por amostra de 300 ms */
  dist?: number[];
  dead?: [number, number][];
  dc?: [number, number][];
}

const replayData = (r: Replay) => ({
  start: r.start ?? 0,
  end: (r.start ?? 0) + (r.dist?.length ?? 0) * RATE,
  iconURL: "x",
  ...(r.dist ? { positions: r.dist.map(px) } : {}),
  down: [] as [number, number][],
  dead: r.dead ?? [],
  dc: r.dc ?? [],
});

/**
 * O fixture com o replay do Elite Insights ligado: o comandante parado na origem e o Atacante nas distâncias dadas.
 * `positions: false` deixa só start/end (replay ligado, mas sem as posições, como com RawTimelineArrays desligado).
 */
function comReplay(atacante: Replay, o: { comandante?: Replay; semTag?: boolean; positions?: boolean } = {}) {
  const j = wvwFixture() as any;
  const n = atacante.dist?.length ?? 8;
  const comandante: Replay = o.comandante ?? { dist: Array(n).fill(0) };
  const sem = o.positions === false;
  j.combatReplayMetaData = { inchToPixel: IN_TO_PX, pollingRate: RATE, sizes: [100, 100], maps: [] };
  for (const p of j.players) {
    if (p.account === "Comandante.1111") p.combatReplayData = replayData(sem ? { dist: undefined } : comandante);
    else if (p.account === "Atacante.2222") p.combatReplayData = replayData(sem ? { dist: undefined } : atacante);
    if (o.semTag) p.hasCommanderTag = false;
  }
  return extractFight(j);
}
const jogador = (f: ReturnType<typeof extractFight>, conta: string) => f.players.find((p) => p.account === conta)!;

describe("porcentagem do tempo perto da tag (com as posições do replay)", () => {
  it("conta o tempo a até 1200 unidades do comandante, sobre o tempo vivo do jogador", () => {
    // 8 amostras de 300 ms: perto, perto (1200 exato), longe, longe, perto, perto, longe, perto
    const f = comReplay({ dist: [500, 1200, 1201, 3000, 100, 900, 5000, 1000] });

    const a = jogador(f, "Atacante.2222");
    expect(a.tagNear).toBe(5 * RATE); // 1500 ms perto
    expect(a.nearCoverMs).toBe(8 * RATE); // 2400 ms vivo
  });

  it("o comandante está sempre perto de si mesmo", () => {
    const f = comReplay({ dist: [10, 10, 10, 10] }, { comandante: { dist: [0, 0, 0, 0] } });

    const c = jogador(f, "Comandante.1111");
    expect(c.tagNear).toBe(4 * RATE);
    expect(c.nearCoverMs).toBe(4 * RATE);
  });

  it("o tempo morto não entra: nem no que ficou perto, nem no tempo vivo", () => {
    // morto de 600 a 1200 ms: some as amostras de 600 e de 900
    const f = comReplay({ dist: [100, 100, 100, 100, 5000, 5000, 100, 100], dead: [[600, 1200]] });

    const a = jogador(f, "Atacante.2222");
    expect(a.nearCoverMs).toBe(6 * RATE);
    expect(a.tagNear).toBe(4 * RATE); // as 4 amostras perto que sobraram (as duas longe, em 1200 e 1500, estão depois do trecho morto)
  });

  it("desconectado desde sempre até entrar na luta, e morto para sempre depois de sair (valores de 64 bits do EI)", () => {
    const f = comReplay({ start: 3000, dist: [100, 100, 100, 100], dc: [[-SEM_FIM - 1, 3000]], dead: [[3900, SEM_FIM]] }, { comandante: { dist: Array(20).fill(0) } });

    const a = jogador(f, "Atacante.2222");
    // amostras em 3000, 3300, 3600 (vivo) e 3900 (morto)
    expect(a.nearCoverMs).toBe(3 * RATE);
    expect(a.tagNear).toBe(3 * RATE);
  });

  it("sem o comandante na posição (morto), a amostra continua no tempo vivo mas não conta como perto", () => {
    const f = comReplay({ dist: [100, 100, 100, 100] }, { comandante: { dist: [0, 0, 0, 0], dead: [[300, 900]] } });

    const a = jogador(f, "Atacante.2222");
    expect(a.nearCoverMs).toBe(4 * RATE);
    expect(a.tagNear).toBe(2 * RATE); // só as amostras de 0 e de 900
  });

  it("a distância média é a média das amostras vivas, guardada como distância × tempo", () => {
    const f = comReplay({ dist: [1000, 2000, 3000, 4000] });

    const a = jogador(f, "Atacante.2222");
    expect(a.distCoverMs).toBe(4 * RATE);
    expect(a.tagDist / a.distCoverMs).toBeCloseTo(2500, 5);
  });

  it("sem nenhum comandante marcado no log, não há tag para medir: nada é guardado", () => {
    const f = comReplay({ dist: [100, 100, 100, 100] }, { semTag: true });

    const a = jogador(f, "Atacante.2222");
    expect([a.tagNear, a.nearCoverMs, a.tagDist, a.distCoverMs]).toEqual([0, 0, 0, 0]);
  });
});

describe("distância média até a tag, sem as posições (só o replay ligado)", () => {
  it("usa a distToCom do Elite Insights, ponderada pelo tempo ativo, e não há dado de 'perto'", () => {
    const f = comReplay({}, { positions: false }); // o fixture traz distToCom 300 e tempo ativo de 60 s

    const a = jogador(f, "Atacante.2222");
    expect(a.distCoverMs).toBe(60_000);
    expect(a.tagDist / a.distCoverMs).toBeCloseTo(300, 5);
    expect([a.tagNear, a.nearCoverMs]).toEqual([0, 0]);
  });
});

describe("log sem replay (o padrão de antes): sem dado nenhum, e o 0 do Elite Insights não vale como distância", () => {
  it("o EI grava distToCom 0 quando o replay está desligado; isso não é uma distância de 0", () => {
    const j = wvwFixture() as any;
    for (const p of j.players) p.statsAll[0].distToCom = 0; // como no log real sem replay: sem combatReplayData e sem metadados

    const f = extractFight(j);

    for (const p of f.players) expect([p.tagDist, p.distCoverMs, p.tagNear, p.nearCoverMs]).toEqual([0, 0, 0, 0]);
  });
});

describe("a mesma conta com mais de uma instância na luta", () => {
  it("soma o que ficou perto e o tempo coberto das instâncias", () => {
    const j = wvwFixture() as any;
    j.combatReplayMetaData = { inchToPixel: IN_TO_PX, pollingRate: RATE, sizes: [], maps: [] };
    const base = j.players.find((p: any) => p.account === "Atacante.2222");
    j.players.find((p: any) => p.account === "Comandante.1111").combatReplayData = replayData({ dist: Array(8).fill(0) });
    base.combatReplayData = replayData({ dist: [100, 100, 100, 100] });
    j.players.push({ ...structuredClone(base), combatReplayData: replayData({ start: 1200, dist: [100, 5000, 100, 100] }) });

    const a = jogador(extractFight(j), "Atacante.2222");

    expect(a.nearCoverMs).toBe(8 * RATE);
    expect(a.tagNear).toBe(7 * RATE);
  });
});

describe("dado ruim no log não derruba a luta", () => {
  it("uma posição sem coordenada conta como tempo vivo, mas não como perto nem entra na distância, e nada vira NaN", () => {
    const j = wvwFixture() as any;
    j.combatReplayMetaData = { inchToPixel: IN_TO_PX, pollingRate: RATE, sizes: [], maps: [] };
    j.players.find((p: any) => p.account === "Comandante.1111").combatReplayData = replayData({ dist: [0, 0, 0, 0] });
    const atacante = j.players.find((p: any) => p.account === "Atacante.2222");
    atacante.combatReplayData = replayData({ dist: [100, 100, 100, 100] });
    atacante.combatReplayData.positions[1] = [null, null]; // o JSON pode trazer null onde faltou o valor
    atacante.combatReplayData.positions[2] = [10];

    const a = jogador(extractFight(j), "Atacante.2222");

    expect(a.nearCoverMs).toBe(4 * RATE);
    expect(a.tagNear).toBe(2 * RATE);
    expect(a.distCoverMs).toBe(2 * RATE);
    for (const v of [a.tagNear, a.tagDist, a.nearCoverMs, a.distCoverMs]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("o jogador tem posições, mas o comandante não", () => {
  it("sem as posições do comandante não dá para medir o perto: cai na distância média do Elite Insights", () => {
    const f = comReplay({ dist: [100, 100, 100, 100] }, { comandante: {} }); // o replay do comandante só tem start/end

    const a = jogador(f, "Atacante.2222");
    expect([a.tagNear, a.nearCoverMs]).toEqual([0, 0]);
    expect(a.distCoverMs).toBe(60_000);
    expect(a.tagDist / a.distCoverMs).toBeCloseTo(300, 5);
  });
});

