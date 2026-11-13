// Extrai do JSON do Elite Insights o que o site guarda: dados da luta e uma linha por jogador do squad.
// Função pura (sem banco, sem rede) para poder ser testada com JSON de exemplo.
import { emptyStats, STAT_KEYS, STAT_META, type Mode, type Role, type Stats } from "@gw2logs/shared";

type J = Record<string, any>;

export interface ExtractedSkill {
  id: number;
  name: string | null;
  damage: number;
  hits: number;
  connectedHits: number;
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
  skills: ExtractedSkill[];
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
  eiVersion: string | null;
  players: ExtractedPlayer[];
}

/** Boons (id do buff na API do GW2) cuja geração para o squad guardamos; os ids ficam em STAT_META. */
export const BOONS: Record<number, keyof Stats> = Object.fromEntries(
  STAT_KEYS.flatMap((k) => (STAT_META[k].group === "boons" && STAT_META[k].buffId ? [[STAT_META[k].buffId, k]] : [])),
);

/** Boons cujo uptime recebido guardamos (a média de pilhas do might, mightStacks, sai do mesmo buff). */
const UPTIME_BOONS: Record<number, keyof Stats> = Object.fromEntries(
  STAT_KEYS.flatMap((k) => (STAT_META[k].group === "uptime" && STAT_META[k].format === "pct" && STAT_META[k].buffId ? [[STAT_META[k].buffId, k]] : [])),
);
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

export function extractFight(r: J): ExtractedFight {
  const wvw = isWvW(r);
  const targets = arr(r, "targets");
  // Em WvW os "alvos" que interessam são os jogadores inimigos; em PvE, todos os alvos (bosses).
  const targetIdx = targets.map((t, i) => (!wvw || t.enemyPlayer ? i : -1)).filter((i) => i >= 0);
  const durationMs = num(r, "durationMS");
  const skillMap = (r.skillMap ?? {}) as J;
  const buffMap = (r.buffMap ?? {}) as J;

  const all = arr(r, "players").filter((p) => !p.isFake && !p.friendlyNPC);
  const squad = all.filter((p) => !p.notInSquad);

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
    s.healing = num(phase0(p.extHealingStats, "outgoingHealing"), "healing");
    s.barrier = num(phase0(p.extBarrierStats, "outgoingBarrier"), "barrier");

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
    for (const b of arr(p, "squadBuffVolumes")) {
      const key = BOONS[num(b, "id")];
      if (key) s[key] = num(arr(b, "buffVolumeData")[0], "outgoing");
    }
    if (!arr(p, "squadBuffVolumes").length) {
      for (const b of arr(p, "squadBuffs")) {
        const key = BOONS[num(b, "id")];
        if (key) s[key] = num(arr(b, "buffData")[0], "generation");
      }
    }

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
      skills: skillDamage(p, targetIdx, skillMap, buffMap),
    };
  });

  const players = mergeSameAccount(instances);
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
    const merged: ExtractedPlayer = { ...main, activeMs: 0, commander: group.some((p) => p.commander), skills: [] };
    for (const k of STAT_KEYS) merged[k] = group.reduce((a, p) => a + p[k], 0);
    merged.activeMs = group.reduce((a, p) => a + p.activeMs, 0);
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
