// Extrai do JSON do Elite Insights o que o site guarda: dados da luta e uma linha por jogador do squad.
// Função pura (sem banco, sem rede) para poder ser testada com JSON de exemplo.
import { emptyStats, STAT_KEYS, STAT_META, type BoonScope, type Mode, type Role, type Stats } from "@gw2logs/shared";

type J = Record<string, any>;

export interface ExtractedSkill {
  id: number;
  name: string | null;
  damage: number;
  hits: number;
  connectedHits: number;
}

/** Cura ou barreira de uma habilidade (Healing Stats). `indirect`: o id é de um buff (cura que vem de um efeito, como Regeneração). */
export interface ExtractedSupportSkill {
  id: number;
  name: string | null;
  kind: "heal" | "barrier";
  amount: number;
  /** parte da cura que foi em jogadores caídos (a barreira não tem) */
  downedAmount: number;
  hits: number;
  indirect: boolean;
}

export interface ExtractedPlayer extends Stats {
  account: string;
  name: string | null;
  profession: string | null;
  guildId: string | null;
  group: number | null;
  commander: boolean;
  role: Role;
  activeMs: number;
  distToCom: number | null;
  /** tempo (ms) coberto pelo dado da tag: 0 quando o log não tem replay */
  distCoverMs: number;
  nearCoverMs: number;
  skills: ExtractedSkill[];
  supportSkills: ExtractedSupportSkill[];
}

export interface ExtractedFight {
  mode: Mode;
  fightName: string;
  mapId: number | null;
  timeStart: string | null;
  durationMs: number;
  success: boolean;
  recordedBy: string | null;
  squadCount: number;
  allyCount: number;
  enemyCount: number;
  squadDamage: number;
  squadKills: number;
  squadDowns: number;
  squadDeaths: number;
  /** inimigos caídos e mortos na luta toda, de quem for o crédito (os campos squad* só contam o crédito de jogadores do squad) */
  enemyDowns: number;
  enemyDeaths: number;
  eiVersion: string | null;
  players: ExtractedPlayer[];
}

/** Boons (id do buff na API do GW2) cuja geração guardamos, por alcance; os ids ficam em STAT_META. */
const boonsOf = (scope: BoonScope): Record<number, keyof Stats> =>
  Object.fromEntries(STAT_KEYS.flatMap((k) => (STAT_META[k].group === "boons" && STAT_META[k].buffId && (STAT_META[k].scope ?? "squad") === scope ? [[STAT_META[k].buffId, k]] : [])));
export const BOONS = boonsOf("squad");
const BOON_VOLUMES: [string, Record<number, keyof Stats>][] = [
  ["selfBuffVolumes", boonsOf("self")],
  ["groupBuffVolumes", boonsOf("group")],
  ["squadBuffVolumes", BOONS],
];

/** Boons cujo uptime recebido guardamos (a média de pilhas do might, mightStacks, sai do mesmo buff). */
const UPTIME_BOONS: Record<number, keyof Stats> = Object.fromEntries(
  STAT_KEYS.flatMap((k) =>
    // a versão do grupo (`<boon>GroupUp`) tem o mesmo buff, mas não vem do log: é calculada depois, a partir do uptime de cada um
    STAT_META[k].group === "uptime" && STAT_META[k].format === "pct" && STAT_META[k].buffId && !STAT_META[k].scope ? [[STAT_META[k].buffId, k]] : [],
  ),
);
/** O uptime de cada boon e o dele no grupo: `stabUp` → `stabGroupUp`. */
const GROUP_UPTIME: [up: keyof Stats, groupUp: keyof Stats][] = STAT_KEYS.filter((k) => k.endsWith("GroupUp")).map((k) => [k.replace("GroupUp", "Up") as keyof Stats, k]);
const MIGHT_ID = STAT_META.mightStacks.buffId!;

const SUPPORT_BOONS: (keyof Stats)[] = ["stabOut", "protOut", "aegisOut", "resistOut", "resolOut", "quickOut", "alacOut"];

const arr = (o: unknown, k: string): J[] => {
  const v = (o as J | undefined)?.[k];
  return Array.isArray(v) ? v : [];
};
const num = (o: unknown, k: string): number => {
  const v = (o as J | undefined)?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};
const str = (o: unknown, k: string): string | null => {
  const v = (o as J | undefined)?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};
/**
 * Cura ou barreira dada pelo jogador `me` (posição em `players`) a si mesmo e ao seu grupo no squad. A lista do EI tem uma
 * entrada por jogador, na mesma ordem de `players`; o grupo inclui o próprio jogador e deixa de fora quem não é do squad.
 */
function healingTo(list: J[], field: string, players: J[], me: number): { self: number; group: number } {
  const group = typeof players[me]?.group === "number" ? players[me].group : null;
  let self = 0;
  let inGroup = 0;
  list.forEach((entry, i) => {
    const amount = num(Array.isArray(entry) ? entry[0] : entry, field);
    if (i === me) self = amount;
    if (group !== null && !players[i]?.notInSquad && players[i]?.group === group) inGroup += amount;
  });
  return { self, group: inGroup };
}

/** Primeira fase (a luta inteira): EI guarda as estatísticas como [fase] ou [alvo][fase]. */
const phase0 = (o: unknown, k: string): J => {
  const first = arr(o, k)[0];
  return (Array.isArray(first) ? first[0] : first) ?? {};
};

/** "2026-11-12 23:33:54 -03:00" → ISO UTC. */
export function parseEiTime(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: ([+-]\d{2})(?::?(\d{2}))?)?$/.exec(s.trim());
  const iso = m ? `${m[1]}T${m[2]}${m[3] ? `${m[3]}:${m[4] ?? "00"}` : "Z"}` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isWvW(r: J): boolean {
  const name = `${str(r, "fightName") ?? ""} ${str(r, "name") ?? ""}`;
  return num(r, "triggerID") === 1 || r.detailedWvW === true || (r.wvWMapData && typeof r.wvWMapData === "object") || /World vs World|WvW/i.test(name);
}

// ---------- Posição em relação à tag (replay do Elite Insights) ----------

/** Até onde um jogador conta como "perto da tag", em unidades do jogo (polegadas): o alcance de stack. */
export const NEAR_TAG_RADIUS = 1200;

interface Replay {
  start: number;
  /** [x, y] em pixels do mapa, uma a cada `pollingRate` ms a partir de `start`; vazio se o log não trouxe as posições */
  positions: number[][];
  /** intervalos [início, fim) em ms; o Elite Insights usa o maior e o menor inteiro de 64 bits como "para sempre" e "desde sempre" */
  dead: [number, number][];
  dc: [number, number][];
}

const intervals = (v: unknown): [number, number][] =>
  Array.isArray(v) ? v.filter((i): i is [number, number] => Array.isArray(i) && i.length === 2 && typeof i[0] === "number" && typeof i[1] === "number") : [];
const inside = (t: number, list: [number, number][]): boolean => list.some(([a, b]) => t >= a && t < b);
/** Uma posição [x, y] com os dois números válidos. Number.isFinite não converte: null e undefined, que viram 0 e NaN na conta, não passam. */
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]);

/** O replay de um jogador, ou null se o log foi lido sem replay (sem replay o EI nem grava o campo, e a distToCom vem 0). */
function replayOf(p: J | undefined): Replay | null {
  const c = p?.combatReplayData;
  if (!c || typeof c.start !== "number" || typeof c.end !== "number") return null;
  return { start: c.start, positions: Array.isArray(c.positions) ? c.positions : [], dead: intervals(c.dead), dc: intervals(c.dc) };
}

/**
 * O que o log diz da posição do jogador em relação à tag (o comandante), com a cobertura em ms: só o tempo coberto entra no denominador.
 * Com as posições (RawTimelineArrays), conta amostra a amostra o tempo vivo (fora de morto e desconectado) e quanto dele ficou a até
 * NEAR_TAG_RADIUS do comandante; a amostra sem o comandante em campo continua no tempo vivo, mas não conta como perto. Só com o replay
 * (sem as posições), usa a distância média que o próprio Elite Insights calculou. Sem replay ou sem comandante marcado, não há dado.
 */
function tagStats(own: Replay | null, cmd: Replay | null, meta: { rate: number; inch: number } | null, avgDist: unknown, activeMs: number) {
  const none = { tagNear: 0, tagDist: 0, nearCoverMs: 0, distCoverMs: 0 };
  if (!own || !cmd) return none;
  if (meta && own.positions.length && cmd.positions.length) {
    let alive = 0;
    let near = 0;
    let measured = 0;
    let distSum = 0;
    own.positions.forEach((pos, i) => {
      const t = own.start + i * meta.rate;
      if (inside(t, own.dead) || inside(t, own.dc)) return;
      alive++;
      const q = cmd.positions[Math.floor((t - cmd.start) / meta.rate)];
      // posição sem coordenada válida: continua no tempo vivo, mas não dá para medir (um NaN derrubaria a gravação da luta inteira)
      if (!isPoint(pos) || !isPoint(q) || inside(t, cmd.dead) || inside(t, cmd.dc)) return;
      const d = Math.round((Math.hypot(pos[0] - q[0], pos[1] - q[1]) / meta.inch) * 1000) / 1000;
      measured++;
      distSum += d;
      if (d <= NEAR_TAG_RADIUS) near++;
    });
    return { tagNear: near * meta.rate, nearCoverMs: alive * meta.rate, tagDist: distSum * meta.rate, distCoverMs: measured * meta.rate };
  }
  if (typeof avgDist === "number" && activeMs > 0) return { ...none, tagDist: avgDist * activeMs, distCoverMs: activeMs };
  return none;
}

export function extractFight(r: J): ExtractedFight {
  const wvw = isWvW(r);
  const targets = arr(r, "targets");
  // Em WvW os "alvos" que interessam são os jogadores inimigos; em PvE, todos os alvos (bosses).
  const targetIdx = targets.map((t, i) => (!wvw || t.enemyPlayer ? i : -1)).filter((i) => i >= 0);
  const durationMs = num(r, "durationMS");
  const skillMap = (r.skillMap ?? {}) as J;
  const buffMap = (r.buffMap ?? {}) as J;

  // as listas "por aliado" do EI são indexadas pela posição nesta lista, a original (antes de tirar NPCs e jogadores falsos)
  const rawPlayers = arr(r, "players");
  const all = rawPlayers.filter((p) => !p.isFake && !p.friendlyNPC);
  const squad = all.filter((p) => !p.notInSquad);

  // a tag: o replay do comandante é a referência de posição de todos
  const cmd = replayOf(squad.find((p) => p.hasCommanderTag === true));
  const rate = num(r.combatReplayMetaData, "pollingRate");
  const inch = num(r.combatReplayMetaData, "inchToPixel");
  const replayMeta = rate > 0 && inch > 0 ? { rate, inch } : null;

  const instances: ExtractedPlayer[] = squad.map((p) => {
    const dpsAll = phase0(p, "dpsAll");
    const statsAll = phase0(p, "statsAll");
    const def = phase0(p, "defenses");
    const sup = phase0(p, "support");

    const at = arr(p, "activeTimes")[0] as unknown;
    const activeMs = typeof at === "number" ? at : durationMs;

    const s = emptyStats();
    if (targetIdx.length && arr(p, "dpsTargets").length) {
      for (const i of targetIdx) {
        const d = (arr(p, "dpsTargets")[i] as unknown as J[] | undefined)?.[0] ?? {};
        const st = (arr(p, "statsTargets")[i] as unknown as J[] | undefined)?.[0] ?? {};
        s.damage += num(d, "damage");
        s.powerDamage += num(d, "powerDamage");
        s.condiDamage += num(d, "condiDamage");
        s.downContrib += num(st, "downContribution");
        s.kills += num(st, "killed");
        s.downs += num(st, "downed");
      }
    } else {
      s.damage = num(dpsAll, "damage");
      s.powerDamage = num(dpsAll, "powerDamage");
      s.condiDamage = num(dpsAll, "condiDamage");
      s.downContrib = num(statsAll, "downContribution");
      s.kills = num(statsAll, "killed");
      s.downs = num(statsAll, "downed");
    }
    s.cc = num(statsAll, "appliedCrowdControl");
    s.interrupts = num(statsAll, "interrupts");

    s.strips = num(sup, "boonStrips");
    s.cleanses = num(sup, "condiCleanse") + num(sup, "condiCleanseSelf");
    s.resurrects = num(sup, "resurrects");
    s.stunBreaks = num(sup, "stunBreak");
    // Cura e barreira só existem quando quem gravou usa o addon Healing Stats.
    const outgoing = phase0(p.extHealingStats, "outgoingHealing");
    s.healing = num(outgoing, "healing");
    s.downedHealing = num(outgoing, "downedHealing");
    s.barrier = num(phase0(p.extBarrierStats, "outgoingBarrier"), "barrier");
    const me = rawPlayers.indexOf(p);
    const healed = healingTo(arr(p.extHealingStats, "outgoingHealingAllies"), "healing", rawPlayers, me);
    const shielded = healingTo(arr(p.extBarrierStats, "outgoingBarrierAllies"), "barrier", rawPlayers, me);
    s.healingSelf = healed.self;
    s.healingGroup = healed.group;
    s.barrierSelf = shielded.self;
    s.barrierGroup = shielded.group;

    s.damageTaken = num(def, "damageTaken");
    s.barrierAbsorbed = num(def, "damageBarrier");
    s.deaths = num(def, "deadCount");
    s.timesDowned = num(def, "downCount");
    s.dodges = num(def, "dodgeCount");
    s.blocked = num(def, "blockedCount");
    s.evaded = num(def, "evadedCount");

    // Uptime recebido, sobre o tempo ativo do jogador (versão Active; sem ela, a da luta toda). Guardado em ms com o boon.
    const uptimes = arr(p, "buffUptimesActive").length ? arr(p, "buffUptimesActive") : arr(p, "buffUptimes");
    for (const b of uptimes) {
      const id = num(b, "id");
      const key = UPTIME_BOONS[id];
      if (!key) continue;
      const d = arr(b, "buffData")[0];
      // boon em pilha: o % é o tempo com pelo menos uma pilha (presence), e o uptime é a média de pilhas
      const presence = num(d, "presence");
      const stacking = typeof buffMap[`b${id}`]?.stacking === "boolean" ? buffMap[`b${id}`].stacking : presence > 0;
      s[key] = ((stacking ? presence : num(d, "uptime")) / 100) * activeMs;
      if (id === MIGHT_ID) s.mightStacks = num(d, "uptime") * activeMs;
    }

    // Volume de boon gerado para o squad (EI ≥ 3.x). Versões antigas usavam squadBuffs/generation.
    for (const [field, keys] of BOON_VOLUMES) {
      for (const b of arr(p, field)) {
        const key = keys[num(b, "id")];
        if (key) s[key] = num(arr(b, "buffVolumeData")[0], "outgoing");
      }
    }
    if (!arr(p, "squadBuffVolumes").length) {
      for (const b of arr(p, "squadBuffs")) {
        const key = BOONS[num(b, "id")];
        if (key) s[key] = num(arr(b, "buffData")[0], "generation");
      }
    }

    const tag = tagStats(replayOf(p), cmd, replayMeta, statsAll.distToCom, activeMs);
    s.tagNear = tag.tagNear;
    s.tagDist = tag.tagDist;

    return {
      ...s,
      account: str(p, "account") ?? str(p, "name") ?? "?",
      name: str(p, "name"),
      profession: str(p, "profession"),
      guildId: str(p, "guildID"),
      group: typeof p.group === "number" ? p.group : null,
      commander: p.hasCommanderTag === true,
      role: "dps",
      activeMs,
      distToCom: typeof statsAll.distToCom === "number" ? statsAll.distToCom : null,
      distCoverMs: tag.distCoverMs,
      nearCoverMs: tag.nearCoverMs,
      skills: skillDamage(p, targetIdx, skillMap, buffMap),
      supportSkills: supportSkills(p, skillMap, buffMap),
    };
  });

  const players = mergeSameAccount(instances);
  addGroupUptime(players);
  classifyRoles(players);

  const sum = (k: keyof Stats) => players.reduce((a, p) => a + p[k], 0);
  return {
    mode: wvw ? "wvw" : "pve",
    fightName: str(r, "fightName") ?? str(r, "name") ?? "?",
    mapId: num(r, "mapID") || null,
    timeStart: parseEiTime(str(r, "timeStartStd")),
    durationMs,
    success: r.success === true,
    recordedBy: str(r, "recordedAccountBy") ?? str(r, "recordedBy"),
    squadCount: players.length,
    allyCount: all.length - squad.length,
    enemyCount: wvw ? targets.filter((t) => t.enemyPlayer).length : targets.length,
    squadDamage: sum("damage"),
    squadKills: sum("kills"),
    squadDowns: sum("downs"),
    squadDeaths: sum("deaths"),
    enemyDowns: targetIdx.reduce((a, i) => a + num(phase0(targets[i], "defenses"), "downCount"), 0),
    enemyDeaths: targetIdx.reduce((a, i) => a + num(phase0(targets[i], "defenses"), "deadCount"), 0),
    eiVersion: str(r, "eliteInsightsVersion"),
    players,
  };
}

/**
 * O ArcDPS cria outra instância da mesma conta quando o jogador cai da luta ou reconecta.
 * Juntamos tudo numa linha por conta: estatísticas e tempo somados; classe e grupo da instância mais longa.
 */
function mergeSameAccount(players: ExtractedPlayer[]): ExtractedPlayer[] {
  const byAccount = new Map<string, ExtractedPlayer[]>();
  for (const p of players) byAccount.set(p.account, [...(byAccount.get(p.account) ?? []), p]);
  return [...byAccount.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const main = group.reduce((a, b) => (b.activeMs > a.activeMs ? b : a));
    const merged: ExtractedPlayer = { ...main, activeMs: 0, commander: group.some((p) => p.commander), skills: [], supportSkills: [] };
    for (const k of STAT_KEYS) merged[k] = group.reduce((a, p) => a + p[k], 0);
    merged.activeMs = group.reduce((a, p) => a + p.activeMs, 0);
    merged.distCoverMs = group.reduce((a, p) => a + p.distCoverMs, 0);
    merged.nearCoverMs = group.reduce((a, p) => a + p.nearCoverMs, 0);
    const skills = new Map<number, ExtractedSkill>();
    for (const sk of group.flatMap((p) => p.skills)) {
      const cur = skills.get(sk.id) ?? { ...sk, damage: 0, hits: 0, connectedHits: 0 };
      cur.damage += sk.damage;
      cur.hits += sk.hits;
      cur.connectedHits += sk.connectedHits;
      cur.name ??= sk.name;
      skills.set(sk.id, cur);
    }
    merged.skills = [...skills.values()];
    const support = new Map<string, ExtractedSupportSkill>();
    for (const sk of group.flatMap((p) => p.supportSkills)) {
      const key = `${sk.kind}:${sk.indirect}:${sk.id}`;
      const cur = support.get(key) ?? { ...sk, amount: 0, downedAmount: 0, hits: 0 };
      cur.amount += sk.amount;
      cur.downedAmount += sk.downedAmount;
      cur.hits += sk.hits;
      cur.name ??= sk.name;
      support.set(key, cur);
    }
    merged.supportSkills = [...support.values()];
    return merged;
  });
}

/**
 * Dano por habilidade nos mesmos alvos do dano total (jogadores inimigos em WvW), incluindo o de pets, clones e
 * engenhocas (minions): o dano total do jogador também os inclui. Sem dado por alvo, usa o total do jogador.
 */
function skillDamage(p: J, targetIdx: number[], skillMap: J, buffMap: J): ExtractedSkill[] {
  const lists = (owner: J): J[][] => {
    const byTarget = arr(owner, "targetDamageDist");
    if (byTarget.length && targetIdx.length) return targetIdx.map((i) => (byTarget[i] as unknown as J[][] | undefined)?.[0] ?? []);
    return [(arr(owner, "totalDamageDist")[0] as unknown as J[] | undefined) ?? []];
  };
  const sum = new Map<number, ExtractedSkill>();
  for (const list of [...lists(p), ...arr(p, "minions").flatMap(lists)]) {
    for (const d of Array.isArray(list) ? list : []) {
      const id = num(d, "id");
      const cur = sum.get(id) ?? { id, name: str(skillMap[`s${id}`], "name") ?? str(buffMap[`b${id}`], "name"), damage: 0, hits: 0, connectedHits: 0 };
      cur.damage += num(d, "totalDamage");
      cur.hits += num(d, "hits");
      cur.connectedHits += num(d, "connectedHits");
      sum.set(id, cur);
    }
  }
  return [...sum.values()].filter((s) => s.damage > 0);
}

/**
 * O uptime médio do grupo de cada jogador: a média do uptime dos jogadores do mesmo grupo do squad (ele incluído), ponderada pelo tempo
 * ativo, guardada como os outros uptimes: ms com o boon sobre o tempo ativo do próprio jogador (a % é Σ ms ÷ Σ tempo). Sem grupo no log, zero.
 * Mede o resultado do grupo, não só o que o jogador faz.
 */
function addGroupUptime(players: ExtractedPlayer[]) {
  const groups = new Map<number, ExtractedPlayer[]>();
  for (const p of players) if (p.group !== null) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  for (const members of groups.values()) {
    const active = members.reduce((a, p) => a + p.activeMs, 0);
    if (active <= 0) continue;
    for (const [up, groupUp] of GROUP_UPTIME) {
      const share = members.reduce((a, p) => a + p[up], 0) / active;
      for (const p of members) p[groupUp] = share * p.activeMs;
    }
  }
}

/**
 * Cura e barreira por habilidade, da distribuição do Healing Stats (`totalHealingDist` e `totalBarrierDist`, fase 0). A soma bate com a cura
 * e a barreira totais do jogador, que não incluem a cura dos minions: por isso eles ficam de fora aqui também (conferido em logs do EI 3.32).
 * A habilidade indireta tem id de buff, então o nome vem do `buffMap`. Sem Healing Stats o jogador não tem esses blocos e a lista sai vazia.
 */
function supportSkills(p: J, skillMap: J, buffMap: J): ExtractedSupportSkill[] {
  const nameOf = (id: number, indirect: boolean) => {
    const [first, second] = indirect ? [buffMap[`b${id}`], skillMap[`s${id}`]] : [skillMap[`s${id}`], buffMap[`b${id}`]];
    return str(first, "name") ?? str(second, "name");
  };
  const phase0 = (owner: unknown, field: string): J[] => {
    const first = arr(owner, field)[0] as unknown;
    return Array.isArray(first) ? first : [];
  };
  const heals = phase0(p.extHealingStats, "totalHealingDist").map((d): ExtractedSupportSkill => {
    const id = num(d, "id");
    const indirect = d.indirectHealing === true;
    return { id, name: nameOf(id, indirect), kind: "heal", amount: num(d, "totalHealing"), downedAmount: num(d, "totalDownedHealing"), hits: num(d, "hits"), indirect };
  });
  const barriers = phase0(p.extBarrierStats, "totalBarrierDist").map((d): ExtractedSupportSkill => {
    const id = num(d, "id");
    const indirect = d.indirectBarrier === true;
    return { id, name: nameOf(id, indirect), kind: "barrier", amount: num(d, "totalBarrier"), downedAmount: 0, hits: num(d, "hits"), indirect };
  });
  return [...heals, ...barriers].filter((s) => s.amount > 0 || s.downedAmount > 0);
}

/**
 * Suporte × DPS, por luta. Heurística:
 * - cura + barreira maiores que metade do próprio dano; ou
 * - está entre os maiores geradores de boons do squad (≥ 35% do maior); ou
 * - gera algum boon de squad e causa menos dano que a mediana do squad.
 */
export function classifyRoles(players: ExtractedPlayer[]) {
  const dmg = players.map((p) => p.damage).sort((a, b) => a - b);
  const median = dmg.length ? dmg[Math.floor(dmg.length / 2)]! : 0;
  const boonScore = (p: ExtractedPlayer) => SUPPORT_BOONS.reduce((a, k) => a + p[k], 0);
  const maxBoons = Math.max(0, ...players.map(boonScore));
  for (const p of players) {
    const boons = boonScore(p);
    const healer = p.healing + p.barrier > p.damage * 0.5 && p.healing + p.barrier > 0;
    const bigBooner = boons >= 2 && boons >= maxBoons * 0.35;
    const booner = boons >= 2 && p.damage < median;
    p.role = healer || bigBooner || booner ? "support" : "dps";
  }
}
