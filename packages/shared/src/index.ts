// Tipos e metadados compartilhados entre a API e o site.

export type Mode = "wvw" | "pve";
export type Role = "dps" | "support";
export type FightStatus = "queued" | "parsing" | "done" | "error";

/** Métricas numéricas guardadas por jogador por luta (somáveis entre lutas). */
export const STAT_KEYS = [
  "damage",
  "powerDamage",
  "condiDamage",
  "downContrib",
  "kills",
  "downs",
  "strips",
  "cleanses",
  "resurrects",
  "stunBreaks",
  "healing",
  "barrier",
  "cc",
  "interrupts",
  "damageTaken",
  "barrierAbsorbed",
  "deaths",
  "timesDowned",
  "dodges",
  "blocked",
  "evaded",
  "stabOut",
  "quickOut",
  "alacOut",
  "protOut",
  "mightOut",
  "aegisOut",
  "resistOut",
  "resolOut",
  "furyOut",
  "superspeedOut",
  // uptime recebido: milissegundos com o boon (% × tempo ativo), para somar entre lutas; o % é uptimeValue
  "stabUp",
  "quickUp",
  "alacUp",
  "protUp",
  "mightUp",
  "aegisUp",
  "resistUp",
  "resolUp",
  "furyUp",
  "swiftUp",
  "vigorUp",
  "regenUp",
  "mightStacks",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export type StatGroup = "offense" | "support" | "boons" | "uptime" | "defense";

export interface StatMeta {
  label: string;
  short: string;
  group: StatGroup;
  /** false quando um número menor é melhor (mortes, dano recebido…). */
  higherIsBetter: boolean;
  /**
   * "volume" = volume de boon gerado para o squad (unidade do Elite Insights).
   * "pct" = uptime: guardado em ms com o boon, mostrado como % do tempo ativo. "avg" = média de pilhas (mesma base).
   */
  format: "int" | "volume" | "pct" | "avg";
  hint?: string;
  /** id do buff na API do GW2 (boons): liga a métrica ao ícone e ao buffMap do Elite Insights. */
  buffId?: number;
}

export const STAT_META: Record<StatKey, StatMeta> = {
  damage: { label: "Dano", short: "Dano", group: "offense", higherIsBetter: true, format: "int", hint: "Dano em jogadores inimigos (WvW) ou no alvo (PvE)" },
  powerDamage: { label: "Dano físico", short: "Físico", group: "offense", higherIsBetter: true, format: "int" },
  condiDamage: { label: "Dano de condição", short: "Condi", group: "offense", higherIsBetter: true, format: "int" },
  downContrib: { label: "Contribuição em downs", short: "Down contr.", group: "offense", higherIsBetter: true, format: "int", hint: "Dano causado em inimigos que acabaram caindo" },
  kills: { label: "Abates", short: "Kills", group: "offense", higherIsBetter: true, format: "int" },
  downs: { label: "Derrubados", short: "Downs", group: "offense", higherIsBetter: true, format: "int" },
  cc: { label: "Controle aplicado", short: "CC", group: "offense", higherIsBetter: true, format: "int" },
  interrupts: { label: "Interrupções", short: "Interr.", group: "offense", higherIsBetter: true, format: "int" },
  strips: { label: "Boons removidos", short: "Strips", group: "support", higherIsBetter: true, format: "int" },
  cleanses: { label: "Condições removidas", short: "Cleanses", group: "support", higherIsBetter: true, format: "int" },
  healing: { label: "Cura", short: "Cura", group: "support", higherIsBetter: true, format: "int", hint: "Só aparece se quem gravou tem o addon Healing Stats" },
  barrier: { label: "Barreira", short: "Barreira", group: "support", higherIsBetter: true, format: "int" },
  resurrects: { label: "Ressurreições", short: "Res", group: "support", higherIsBetter: true, format: "int" },
  stunBreaks: { label: "Quebra de atordoamento", short: "Stun br.", group: "support", higherIsBetter: true, format: "int" },
  stabOut: { label: "Estabilidade", short: "Estab.", group: "boons", buffId: 1122, higherIsBetter: true, format: "volume" },
  quickOut: { label: "Rapidez", short: "Rapidez", group: "boons", buffId: 1187, higherIsBetter: true, format: "volume" },
  alacOut: { label: "Alacridade", short: "Alac.", group: "boons", buffId: 30328, higherIsBetter: true, format: "volume" },
  protOut: { label: "Proteção", short: "Prot.", group: "boons", buffId: 717, higherIsBetter: true, format: "volume" },
  mightOut: { label: "Poder", short: "Poder", group: "boons", buffId: 740, higherIsBetter: true, format: "volume" },
  aegisOut: { label: "Égide", short: "Égide", group: "boons", buffId: 743, higherIsBetter: true, format: "volume" },
  resistOut: { label: "Resistência", short: "Resist.", group: "boons", buffId: 26980, higherIsBetter: true, format: "volume" },
  resolOut: { label: "Resolução", short: "Resol.", group: "boons", buffId: 873, higherIsBetter: true, format: "volume" },
  furyOut: { label: "Fúria", short: "Fúria", group: "boons", buffId: 725, higherIsBetter: true, format: "volume" },
  superspeedOut: { label: "Supervelocidade", short: "Superv.", group: "boons", buffId: 5974, higherIsBetter: true, format: "volume" },
  stabUp: { label: "% Estabilidade", short: "Estab.", group: "uptime", buffId: 1122, higherIsBetter: true, format: "pct" },
  quickUp: { label: "% Rapidez", short: "Rapidez", group: "uptime", buffId: 1187, higherIsBetter: true, format: "pct" },
  alacUp: { label: "% Alacridade", short: "Alac.", group: "uptime", buffId: 30328, higherIsBetter: true, format: "pct" },
  protUp: { label: "% Proteção", short: "Prot.", group: "uptime", buffId: 717, higherIsBetter: true, format: "pct" },
  mightUp: { label: "% Poder", short: "Poder", group: "uptime", buffId: 740, higherIsBetter: true, format: "pct" },
  aegisUp: { label: "% Égide", short: "Égide", group: "uptime", buffId: 743, higherIsBetter: true, format: "pct" },
  resistUp: { label: "% Resistência", short: "Resist.", group: "uptime", buffId: 26980, higherIsBetter: true, format: "pct" },
  resolUp: { label: "% Resolução", short: "Resol.", group: "uptime", buffId: 873, higherIsBetter: true, format: "pct" },
  furyUp: { label: "% Fúria", short: "Fúria", group: "uptime", buffId: 725, higherIsBetter: true, format: "pct" },
  swiftUp: { label: "% Swiftness", short: "Swift.", group: "uptime", buffId: 719, higherIsBetter: true, format: "pct" },
  vigorUp: { label: "% Vigor", short: "Vigor", group: "uptime", buffId: 726, higherIsBetter: true, format: "pct" },
  regenUp: { label: "% Regeneração", short: "Regen.", group: "uptime", buffId: 718, higherIsBetter: true, format: "pct" },
  mightStacks: { label: "Pilhas de Poder", short: "Poder (pilhas)", group: "uptime", buffId: 740, higherIsBetter: true, format: "avg", hint: "Média de pilhas de Poder sobre o tempo ativo" },
  damageTaken: { label: "Dano recebido", short: "Recebido", group: "defense", higherIsBetter: false, format: "int" },
  barrierAbsorbed: { label: "Dano absorvido por barreira", short: "Absorvido", group: "defense", higherIsBetter: true, format: "int" },
  deaths: { label: "Mortes", short: "Mortes", group: "defense", higherIsBetter: false, format: "int" },
  timesDowned: { label: "Vezes derrubado", short: "Caiu", group: "defense", higherIsBetter: false, format: "int" },
  dodges: { label: "Esquivas", short: "Esquivas", group: "defense", higherIsBetter: true, format: "int" },
  blocked: { label: "Ataques bloqueados", short: "Bloq.", group: "defense", higherIsBetter: true, format: "int" },
  evaded: { label: "Ataques evitados", short: "Evit.", group: "defense", higherIsBetter: true, format: "int" },
};

export const STAT_GROUPS: { id: StatGroup; label: string }[] = [
  { id: "offense", label: "Dano" },
  { id: "support", label: "Suporte" },
  { id: "boons", label: "Boons" },
  { id: "uptime", label: "Uptime" },
  { id: "defense", label: "Defesa" },
];

/** Métricas de uptime (pct ou avg): o valor guardado é tempo com o boon, e o mostrado depende do tempo ativo. */
export const isUptimeStat = (k: StatKey): boolean => STAT_META[k].format === "pct" || STAT_META[k].format === "avg";

/** Valor mostrado de uma métrica de uptime: % do tempo ativo (pct) ou média de pilhas (avg). */
export function uptimeValue(k: StatKey, ms: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  const r = ms / activeMs;
  return STAT_META[k].format === "pct" ? r * 100 : r;
}

export const statsOfGroup = (g: StatGroup): StatKey[] => STAT_KEYS.filter((k) => STAT_META[k].group === g);

export const emptyStats = (): Stats => Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Stats;

// ---------- Entidades da API ----------

export interface Fight {
  id: string;
  status: FightStatus;
  error: string | null;
  uploadedAt: string;
  uploader: string | null;
  fileName: string | null;
  mode: Mode | null;
  fightName: string | null;
  mapId: number | null;
  mapName: string | null;
  timeStart: string | null;
  durationMs: number | null;
  success: boolean;
  recordedBy: string | null;
  squadCount: number | null;
  allyCount: number | null;
  enemyCount: number | null;
  squadDamage: number | null;
  squadKills: number | null;
  squadDowns: number | null;
  squadDeaths: number | null;
  hasReport: boolean;
}

export interface Guild {
  id: string;
  name: string | null;
  tag: string | null;
  inAlliance: boolean;
}

export interface PlayerFight extends Stats {
  fightId: string;
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

export interface FightDetail {
  fight: Fight;
  players: PlayerFight[];
  guilds: Guild[];
}

/** Totais de um jogador (ou de um grupo) num conjunto de lutas. */
export interface Aggregate extends Stats {
  fights: number;
  activeMs: number;
}

export interface RankingRow extends Aggregate {
  account: string;
  name: string | null;
  profession: string | null;
  guildId: string | null;
  supportFights: number;
}

export interface PlayerHistoryRow extends PlayerFight {
  timeStart: string | null;
  durationMs: number;
  mapName: string | null;
  fightName: string | null;
}

export interface PlayerProfile {
  account: string;
  name: string | null;
  totals: Aggregate;
  history: PlayerHistoryRow[];
  professions: { profession: string; fights: number }[];
  guilds: { guildId: string; fights: number }[];
}

/** Dano de um jogador por habilidade, somado nas lutas filtradas (dano em jogadores inimigos). */
export interface PlayerSkill {
  skillId: number;
  name: string | null;
  damage: number;
  hits: number;
  connectedHits: number;
  /** % do dano total em habilidades (0 a 100) */
  pct: number;
  /** dano médio por acerto que conectou */
  avgHit: number;
}

export interface GuildSummary extends Guild {
  players: number;
  fights: number;
  lastSeen: string | null;
}

export interface Overview {
  fights: number;
  durationMs: number;
  kills: number;
  deaths: number;
  players: number;
  first: string | null;
  last: string | null;
  recent: Fight[];
}

export interface UploadResult {
  file: string;
  id?: string;
  status?: FightStatus;
  duplicate?: boolean;
  error?: string;
}

// ---------- Filtros (iguais na URL do site e na query da API) ----------

export interface Filters {
  mode?: Mode;
  /** últimos N dias */
  days?: number;
  from?: string;
  to?: string;
  map?: number;
  minSquad?: number;
  maxSquad?: number;
  minEnemies?: number;
  minDurationSec?: number;
  /** id da guilda ou "alliance" para todas as guildas marcadas como da aliança */
  guild?: string;
  role?: Role;
  profession?: string;
  /** dias de batalha (AAAA-MM-DD, ver battleDay): vale a união dos dias escolhidos */
  day?: string[];
}

export const FILTER_KEYS = [
  "mode",
  "days",
  "from",
  "to",
  "map",
  "minSquad",
  "maxSquad",
  "minEnemies",
  "minDurationSec",
  "guild",
  "role",
  "profession",
  "day",
] as const satisfies readonly (keyof Filters)[];

const NUMERIC_FILTERS = new Set<keyof Filters>(["days", "map", "minSquad", "maxSquad", "minEnemies", "minDurationSec"]);

// ---------- Dia de batalha ----------

/**
 * O dia de batalha vai das 06:00 às 06:00 (horário de Brasília, UTC-3): uma luta às 00:08 de 13/11 ainda é a noite de 12/11.
 * A data do dia é a do instante menos 9 horas em UTC (3 de fuso + 6 de corte).
 */
export const BATTLE_DAY_SHIFT_HOURS = 9;

export function battleDay(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : new Date(t - BATTLE_DAY_SHIFT_HOURS * 3_600_000).toISOString().slice(0, 10);
}

function isValidDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  // data impossível (2026-13-45) dá NaN; 2026-02-30 "rola" para março e a volta não bate
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Resumo de um dia de batalha. */
export interface DaySummary {
  day: string;
  fights: number;
  durationMs: number;
  players: number;
  kills: number;
  deaths: number;
  first: string;
  last: string;
}

/** Lê filtros de um objeto de query string, descartando valores inválidos. */
export function parseFilters(q: Record<string, unknown>): Filters {
  const f: Filters = {};
  for (const k of FILTER_KEYS) {
    const raw = q[k];
    if (raw === undefined || raw === null || raw === "") continue;
    const s = String(raw).trim();
    if (NUMERIC_FILTERS.has(k)) {
      const n = Number(s);
      if (Number.isFinite(n) && n > 0) (f as Record<string, unknown>)[k] = Math.floor(n);
    } else if (k === "mode") {
      if (s === "wvw" || s === "pve") f.mode = s;
    } else if (k === "day") {
      const days = [...new Set(s.split(",").map((d) => d.trim()).filter(isValidDay))].slice(0, 62);
      if (days.length) f.day = days;
    } else if (k === "role") {
      if (s === "dps" || s === "support") f.role = s;
    } else if (k === "from" || k === "to") {
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) f[k] = s.slice(0, 10);
    } else if (s.length <= 64) {
      (f as Record<string, unknown>)[k] = s;
    }
  }
  return f;
}

export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) p.set(k, String(v));
  }
  return p.toString();
}

// ---------- Profissões ----------

export const PROFESSIONS: Record<string, { base: string; color: string }> = {};
const ELITES: Record<string, [string, string[]]> = {
  Guardian: ["#72C1D9", ["Dragonhunter", "Firebrand", "Willbender", "Luminary"]],
  Warrior: ["#FFD166", ["Berserker", "Spellbreaker", "Bladesworn", "Paragon"]],
  Revenant: ["#D16E5A", ["Herald", "Renegade", "Vindicator", "Conduit"]],
  Engineer: ["#D09C59", ["Scrapper", "Holosmith", "Mechanist", "Amalgam"]],
  Ranger: ["#8CDC82", ["Druid", "Soulbeast", "Untamed", "Galeshot"]],
  Thief: ["#C08F95", ["Daredevil", "Deadeye", "Specter", "Antiquary"]],
  Elementalist: ["#F68A87", ["Tempest", "Weaver", "Catalyst", "Evoker"]],
  Mesmer: ["#B679D5", ["Chronomancer", "Mirage", "Virtuoso", "Troubadour"]],
  Necromancer: ["#52A76F", ["Reaper", "Scourge", "Harbinger", "Ritualist"]],
};
for (const [base, [color, elites]] of Object.entries(ELITES)) {
  PROFESSIONS[base] = { base, color };
  for (const e of elites) PROFESSIONS[e] = { base, color };
}

export const professionColor = (p: string | null | undefined): string =>
  (p && PROFESSIONS[p]?.color) || "#9AA4B2";

// ---------- Utilidades ----------

/** Valor por minuto de tempo ativo em luta. */
export const perMinute = (value: number, activeMs: number): number => (activeMs > 0 ? (value * 60000) / activeMs : 0);

/** Valor por segundo de tempo ativo em luta (o "DPS"). */
export const perSecond = (value: number, activeMs: number): number => (activeMs > 0 ? (value * 1000) / activeMs : 0);

// ---------- Colunas escolhidas na tabela ----------

const MAX_HIDDEN_COLUMNS = 100;
const MAX_COLUMN_ID = 64;

/**
 * Lê a lista de colunas ocultas guardada no navegador. O valor pode estar quebrado ou adulterado, então só aceita lista
 * de textos curtos, sem repetidos e com tamanho limitado; qualquer outra coisa vira "nada oculto".
 */
export function parseHiddenColumns(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_COLUMN_ID);
  return [...new Set(ids)].slice(0, MAX_HIDDEN_COLUMNS);
}

/** Colunas que aparecem: tira as ocultas, mas nunca as fixas (nome do jogador, caixa de seleção). */
export function visibleColumns<T extends { id: string; fixed?: boolean }>(columns: T[], hidden: string[]): T[] {
  const off = new Set(hidden);
  return columns.filter((c) => c.fixed || !off.has(c.id));
}
