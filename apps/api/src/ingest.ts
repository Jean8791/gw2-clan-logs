// Extrai do JSON do Elite Insights o que o site guarda: dados da luta e uma linha por jogador do squad.
// Função pura (sem banco, sem rede) para poder ser testada com JSON de exemplo.
import { emptyStats, type Mode, type Role, type Stats } from "@gw2logs/shared";

type J = Record<string, any>;

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

/** Ids dos boons (ids de buff da API do GW2) cuja geração para o squad guardamos. */
export const BOONS: Record<number, keyof Stats> = {
  1122: "stabOut",
  1187: "quickOut",
  30328: "alacOut",
  717: "protOut",
  740: "mightOut",
  743: "aegisOut",
  26980: "resistOut",
  873: "resolOut",
  725: "furyOut",
  5974: "superspeedOut",
};

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

  const all = arr(r, "players").filter((p) => !p.isFake && !p.friendlyNPC);
  const squad = all.filter((p) => !p.notInSquad);

  const players: ExtractedPlayer[] = squad.map((p) => {
    const dpsAll = phase0(p, "dpsAll");
    const statsAll = phase0(p, "statsAll");
    const def = phase0(p, "defenses");
    const sup = phase0(p, "support");

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

    const at = arr(p, "activeTimes")[0] as unknown;
    return {
      ...s,
      account: str(p, "account") ?? str(p, "name") ?? "?",
      name: str(p, "name"),
      profession: str(p, "profession"),
      guildId: str(p, "guildID"),
      group: typeof p.group === "number" ? p.group : null,
      commander: p.hasCommanderTag === true,
      role: "dps",
      activeMs: typeof at === "number" ? at : durationMs,
      distToCom: typeof statsAll.distToCom === "number" ? statsAll.distToCom : null,
    };
  });

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
    squadCount: squad.length,
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
