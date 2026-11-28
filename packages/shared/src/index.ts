// Tipos e metadados compartilhados entre a API e o site.

export * from "./i18n.js";
export * from "./routes.js";
export * from "./boons.js";
export * from "./upload.js";
export * from "./upload-queue.js";
export * from "./zip.js";
export * from "./pagination.js";
export * from "./fit-height.js";
export * from "./search.js";
export * from "./retention.js";
import { BOON_BASES, GROUP_UP_BASES, type BoonBase, type EffKey, type GroupUpKey, type ScopedKey } from "./boons.js";

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
  // cura e barreira só no grupo e só em si (da lista por aliado do Healing Stats), e cura em quem está caído
  "healingGroup",
  "healingSelf",
  "barrier",
  "barrierGroup",
  "barrierSelf",
  "downedHealing",
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
  // o mesmo volume gerado só para o grupo (inclui o próprio jogador) e só para si
  "stabGroup",
  "quickGroup",
  "alacGroup",
  "protGroup",
  "mightGroup",
  "aegisGroup",
  "resistGroup",
  "resolGroup",
  "furyGroup",
  "superspeedGroup",
  "stabSelf",
  "quickSelf",
  "alacSelf",
  "protSelf",
  "mightSelf",
  "aegisSelf",
  "resistSelf",
  "resolSelf",
  "furySelf",
  "superspeedSelf",
  // o volume de squad que foi útil: o gerado menos o que passou do limite de pilhas (overstack)
  "stabEff",
  "quickEff",
  "alacEff",
  "protEff",
  "mightEff",
  "aegisEff",
  "resistEff",
  "resolEff",
  "furyEff",
  "superspeedEff",
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
  // o uptime médio do grupo do jogador (quem está no mesmo grupo do squad, ele incluído), na mesma conta: ms com o boon sobre o tempo ativo dele
  "stabGroupUp",
  "quickGroupUp",
  "alacGroupUp",
  "protGroupUp",
  "mightGroupUp",
  "aegisGroupUp",
  "resistGroupUp",
  "resolGroupUp",
  "furyGroupUp",
  "swiftGroupUp",
  "vigorGroupUp",
  "regenGroupUp",
  "mightStacks",
  // posição em relação à tag (o comandante), só nos logs com o replay do Elite Insights: tempo perto (ms) e distância × tempo (ms)
  "tagNear",
  "tagDist",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

/** Para quem o boon é gerado: o squad todo (padrão, as métricas "Out"), só o grupo ou só o próprio jogador. */
/** Para quem o boon foi gerado; "useful" é o volume da squad sem o que passou do limite de pilhas (overstack). */
export type BoonScope = "squad" | "group" | "self" | "useful";
export const BOON_SCOPES: BoonScope[] = ["squad", "group", "self", "useful"];

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
  /** Só nos boons: para quem o volume é gerado. Sem isso vale "squad". */
  scope?: BoonScope;
}

const BASE_META: Record<Exclude<StatKey, ScopedKey | GroupUpKey | EffKey>, StatMeta> = {
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
  healing: { label: "Cura", short: "Cura", group: "support", higherIsBetter: true, format: "int", hint: "Cura total, inclui minions e aliados fora do squad. Só aparece se quem gravou tem o addon Healing Stats" },
  healingGroup: { label: "Cura no grupo", short: "Cura grupo", group: "support", higherIsBetter: true, format: "int", hint: "Cura nos jogadores do seu grupo no squad (inclui você). Só aparece se quem gravou tem o addon Healing Stats" },
  healingSelf: { label: "Cura em si mesmo", short: "Cura própria", group: "support", higherIsBetter: true, format: "int", hint: "Cura que o jogador deu a si mesmo. Só aparece se quem gravou tem o addon Healing Stats" },
  barrier: { label: "Barreira", short: "Barreira", group: "support", higherIsBetter: true, format: "int", hint: "Barreira total, inclui minions e aliados fora do squad. Só aparece se quem gravou tem o addon Healing Stats" },
  barrierGroup: { label: "Barreira no grupo", short: "Barr. grupo", group: "support", higherIsBetter: true, format: "int", hint: "Barreira nos jogadores do seu grupo no squad (inclui você). Só aparece se quem gravou tem o addon Healing Stats" },
  barrierSelf: { label: "Barreira em si mesmo", short: "Barr. própria", group: "support", higherIsBetter: true, format: "int", hint: "Barreira que o jogador deu a si mesmo. Só aparece se quem gravou tem o addon Healing Stats" },
  downedHealing: { label: "Cura em caídos", short: "Cura caído", group: "support", higherIsBetter: true, format: "int", hint: "Cura em jogadores caídos. Só aparece se quem gravou tem o addon Healing Stats" },
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
  tagNear: { label: "% Perto da tag", short: "Perto da tag", group: "uptime", higherIsBetter: true, format: "pct", hint: "Porcentagem do tempo vivo a até 1200 unidades do comandante. Precisa das posições do replay: só aparece em logs enviados depois que o servidor passou a lê-las" },
  tagDist: { label: "Distância da tag", short: "Dist. tag", group: "uptime", higherIsBetter: false, format: "avg", hint: "Distância média até o comandante, em unidades do jogo. Só aparece em logs enviados depois que o servidor passou a ler o replay" },
  damageTaken: { label: "Dano recebido", short: "Recebido", group: "defense", higherIsBetter: false, format: "int" },
  barrierAbsorbed: { label: "Dano absorvido por barreira", short: "Absorvido", group: "defense", higherIsBetter: true, format: "int" },
  deaths: { label: "Mortes", short: "Mortes", group: "defense", higherIsBetter: false, format: "int" },
  timesDowned: { label: "Vezes derrubado", short: "Caiu", group: "defense", higherIsBetter: false, format: "int" },
  dodges: { label: "Esquivas", short: "Esquivas", group: "defense", higherIsBetter: true, format: "int" },
  blocked: { label: "Ataques bloqueados", short: "Bloq.", group: "defense", higherIsBetter: true, format: "int" },
  evaded: { label: "Ataques evitados", short: "Evit.", group: "defense", higherIsBetter: true, format: "int" },
};

const SCOPE_HINT: Record<"group" | "self", string> = {
  group: "Volume gerado para o seu grupo (inclui você)",
  self: "Volume gerado só para você",
};

/** Cada boon "Out" (squad) ganha as versões Group e Self, com o mesmo nome e buff e a dica do alcance. */
const scopedMeta = (): Record<ScopedKey, StatMeta> =>
  Object.fromEntries(
    (["Group", "Self"] as const).flatMap((suffix) =>
      BOON_BASES.map((b) => {
        const scope = suffix === "Group" ? "group" : "self";
        return [`${b}${suffix}`, { ...BASE_META[`${b}Out`], scope, hint: SCOPE_HINT[scope] }];
      }),
    ),
  ) as Record<ScopedKey, StatMeta>;

const EFF_HINT =
  "Volume gerado para a squad sem o que passou do limite de pilhas (overstack): o que de fato valeu. Quem joga as habilidades todas de uma vez tem volume alto e geração útil baixa. Só existe para logs enviados depois que o site passou a guardá-la";

/** Cada boon "Out" (squad) ganha a geração útil, com o mesmo buff, no alcance "útil". */
const effMeta = (): Record<EffKey, StatMeta> =>
  Object.fromEntries(BOON_BASES.map((b) => [`${b}Eff`, { ...BASE_META[`${b}Out`], label: `${BASE_META[`${b}Out`].label} útil`, short: `${BASE_META[`${b}Out`].short} útil`, scope: "useful", hint: EFF_HINT }])) as Record<EffKey, StatMeta>;

const GROUP_UP_HINT =
  "Uptime médio do grupo do jogador (quem está no mesmo grupo do squad, ele incluído), sobre o tempo ativo dele. Mede o resultado do grupo, não só o que o jogador faz: dois suportes no mesmo grupo têm o mesmo valor";

/** Cada uptime ganha a versão do grupo, com o mesmo boon e ícone; fica no grupo Uptime e não conta como alcance dos boons. */
const groupUpMeta = (): Record<GroupUpKey, StatMeta> =>
  Object.fromEntries(
    GROUP_UP_BASES.map((b) => {
      const up = BASE_META[`${b}Up`];
      return [`${b}GroupUp`, { ...up, label: `${up.label} no grupo`, short: `${up.short} grupo`, scope: "group", hint: GROUP_UP_HINT }];
    }),
  ) as Record<GroupUpKey, StatMeta>;

export const STAT_META: Record<StatKey, StatMeta> = { ...BASE_META, ...scopedMeta(), ...effMeta(), ...groupUpMeta() };

export const STAT_GROUPS: { id: StatGroup; label: string }[] = [
  { id: "offense", label: "Dano" },
  { id: "support", label: "Suporte" },
  { id: "boons", label: "Boons" },
  { id: "uptime", label: "Uptime e tag" },
  { id: "defense", label: "Defesa" },
];

/**
 * Métricas da posição em relação à tag, e a coluna com o tempo (ms) que cada uma cobre: o dado só existe nos logs lidos com o replay
 * ligado, então o tempo das lutas sem ele não pode entrar na conta (as lutas antigas puxariam a porcentagem para baixo).
 */
export const TAG_COVER = { tagNear: "nearCoverMs", tagDist: "distCoverMs" } as const;
export type TagCover = { [C in (typeof TAG_COVER)[keyof typeof TAG_COVER]]: number };
export const isTagStat = (k: StatKey): k is keyof typeof TAG_COVER => k in TAG_COVER;
/** A linha tem o dado da métrica? Só as da tag podem faltar (log lido sem replay); sem dado a tela mostra traço, e não 0. */
export const hasStatData = (k: StatKey, r: Partial<TagCover>): boolean => !isTagStat(k) || (r[TAG_COVER[k]] ?? 0) > 0;

/** O melhor valor da métrica entre as linhas que têm o dado (o menor, se menos é melhor); 0 sem nenhuma. Quem não tem dado não disputa. */
export function bestValue<T extends Partial<TagCover>>(k: StatKey, rows: T[], value: (r: T) => number): number {
  const values = rows.filter((r) => hasStatData(k, r)).map(value);
  if (!values.length) return 0;
  return STAT_META[k].higherIsBetter ? Math.max(...values) : Math.min(...values);
}

/**
 * O total de uma métrica da tag numa soma de lutas, igual ao do Ranking: Σ valor ÷ Σ tempo coberto. As linhas por luta vêm da API já
 * reescaladas para o tempo ativo (valor × ativo ÷ coberto), então desfaz a escala de cada uma antes de somar. O resultado também vem
 * reescalado para o tempo ativo das lutas com dado, para a conta da tela (valor ÷ tempo ativo) dar o certo. Lutas sem o dado ficam de fora.
 */
export function tagTotal(k: keyof typeof TAG_COVER, rows: (Pick<Stats, typeof k> & TagCover & { activeMs: number })[]): number {
  const used = rows.filter((r) => r[TAG_COVER[k]] > 0 && r.activeMs > 0);
  const cover = used.reduce((a, r) => a + r[TAG_COVER[k]], 0);
  if (cover <= 0) return 0;
  const raw = used.reduce((a, r) => a + (r[k] * r[TAG_COVER[k]]) / r.activeMs, 0);
  return (raw * used.reduce((a, r) => a + r.activeMs, 0)) / cover;
}

/** Métricas de uptime (pct ou avg): o valor guardado é tempo com o boon, e o mostrado depende do tempo ativo. */
export const isUptimeStat = (k: StatKey): boolean => STAT_META[k].format === "pct" || STAT_META[k].format === "avg";

/** Valor mostrado de uma métrica de uptime: % do tempo ativo (pct, no máximo 100) ou média de pilhas (avg). */
export function uptimeValue(k: StatKey, ms: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  const r = ms / activeMs;
  return STAT_META[k].format === "pct" ? Math.min(r * 100, 100) : r;
}

/** Métricas de um grupo; na aba Boons, só as do alcance pedido (squad por padrão). */
export const statsOfGroup = (g: StatGroup, scope: BoonScope = "squad"): StatKey[] =>
  STAT_KEYS.filter((k) => STAT_META[k].group === g && (g !== "boons" || (STAT_META[k].scope ?? "squad") === scope));

/** Os boons que a aba Boons deixa escolher: os com volume gerado e os que só têm uptime (swiftness, vigor e regeneração). */
export const BOON_VIEW_BASES = [...BOON_BASES, "swift", "vigor", "regen"] as const;
export type BoonViewBase = (typeof BOON_VIEW_BASES)[number];

/** As métricas de um boon lado a lado: volume gerado (squad, grupo, si), a geração útil, uptime recebido e uptime no grupo; só as que existem. */
export function boonViewKeys(base: BoonViewBase): StatKey[] {
  const all = STAT_KEYS as readonly string[];
  return [`${base}Out`, `${base}Eff`, `${base}Group`, `${base}Self`, `${base}Up`, `${base}GroupUp`].filter((k): k is StatKey => all.includes(k));
}

/** Primeira métrica de um grupo (nos boons, no alcance pedido): para onde o gráfico vai quando o grupo muda. */
export const metricForGroup = (g: StatGroup, scope: BoonScope = "squad"): StatKey => statsOfGroup(g, scope)[0]!;

/** Parte do volume gerado de um boon que foi útil (0 a 1): a geração útil sobre o volume. Sem volume, 0. Nunca passa de 1 (arredondamento do log). */
export const boonEfficiency = (a: Stats, base: BoonBase): number => {
  const out = a[`${base}Out`];
  return out > 0 ? Math.min(1, a[`${base}Eff`] / out) : 0;
};

/** A mesma métrica de boon em outro alcance (stabOut vira stabGroup ou stabSelf); métricas que não são de boon não mudam. */
export function inScope(k: StatKey, scope: BoonScope): StatKey {
  if (STAT_META[k].group !== "boons") return k;
  const base = BOON_BASES.find((b) => k.startsWith(b));
  const suffix = { squad: "Out", group: "Group", self: "Self", useful: "Eff" }[scope];
  return base ? (`${base}${suffix}` as StatKey) : k;
}

export const emptyStats = (): Stats => Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Stats;

// ---------- Entidades da API ----------

export interface Fight {
  id: string;
  status: FightStatus;
  error: string | null;
  uploadedAt: string;
  fileName: string | null;
  mode: Mode | null;
  fightName: string | null;
  mapId: number | null;
  mapName: string | null;
  timeStart: string | null;
  durationMs: number | null;
  success: boolean;
  squadCount: number | null;
  allyCount: number | null;
  enemyCount: number | null;
  squadDamage: number | null;
  squadKills: number | null;
  squadDowns: number | null;
  squadDeaths: number | null;
  /** inimigos caídos e mortos na luta toda, de quem for o crédito (squadKills e squadDowns só contam o crédito do squad) */
  enemyDowns: number | null;
  enemyDeaths: number | null;
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
  /** tempo coberto pelo dado da tag (0 = o log não tem) */
  distCoverMs: number;
  nearCoverMs: number;
}

export interface FightDetail {
  fight: Fight;
  players: PlayerFight[];
  guilds: Guild[];
}

/** Totais de um jogador (ou de um grupo) num conjunto de lutas. */
export interface Aggregate extends Stats, TagCover {
  fights: number;
  activeMs: number;
}

/** Quantas lutas o jogador fez com uma classe. */
export interface ProfessionCount {
  profession: string;
  fights: number;
}

export interface RankingRow extends Aggregate {
  account: string;
  name: string | null;
  /** A classe que o jogador mais jogou no período (empate: a mais recente). */
  profession: string | null;
  /** Todas as classes do jogador no período, da mais jogada para a menos. Quem jogou de uma só tem uma. */
  professions: ProfessionCount[];
  guildId: string | null;
  supportFights: number;
}

export interface PlayerHistoryRow extends PlayerFight {
  timeStart: string | null;
  durationMs: number;
  mapName: string | null;
  fightName: string | null;
}

/** O que o jogador jogou, para as listas dos filtros da página dele: só funções, classes e dias que existem nos logs dele. */
export interface PlayerOptions {
  roles: Role[];
  professions: string[];
  /** Dias de batalha em que ele jogou, do mais novo para o mais antigo, com quantas lutas ELE fez em cada um. */
  days: { day: string; fights: number }[];
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

/** O que um jogador curou ou protegeu: cura ou barreira. */
export type SupportKind = "heal" | "barrier";

/** Usos de cada habilidade (rotação) ou dano recebido por habilidade. */
export type UsageKind = "cast" | "taken";
export const USAGE_KINDS: UsageKind[] = ["cast", "taken"];

/** Os tipos da tabela de habilidades: dano, cura, barreira, usos e dano recebido. */
export type SkillKind = "damage" | SupportKind | UsageKind;
export const SKILL_KINDS: SkillKind[] = ["damage", "heal", "barrier", "cast", "taken"];

/** Uma habilidade usada (`amount` = usos) ou que causou dano ao jogador (`amount` = dano recebido). */
export interface PlayerSkillUsage {
  skillId: number;
  name: string | null;
  /** o id é de um buff (condição que causou dano) */
  indirect: boolean;
  amount: number;
  /** nos usos, igual a `amount`; no dano recebido, os acertos */
  hits: number;
  /** % do total (de usos ou de dano recebido) em habilidades (0 a 100) */
  pct: number;
  /** dano médio por acerto (zero nos usos) */
  avgHit: number;
}
export const SUPPORT_KINDS: SupportKind[] = ["heal", "barrier"];

/** Cura ou barreira de um jogador por habilidade, somada nas lutas filtradas. `indirect`: o id é de um buff (cura que vem de um efeito). */
export interface PlayerSupportSkill {
  skillId: number;
  name: string | null;
  indirect: boolean;
  amount: number;
  /** parte da cura que foi em jogadores caídos (zero na barreira) */
  downedAmount: number;
  hits: number;
  /** % do total de cura (ou de barreira) em habilidades (0 a 100) */
  pct: number;
  /** cura (ou barreira) média por acerto */
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
  /** Código estável do erro (o site traduz); `max` é o limite em MB quando o arquivo é grande demais. */
  code?: string;
  max?: number;
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
  /** semana (ver weekRange): a data da sexta em que ela começa, AAAA-MM-DD */
  week?: string;
  /** id do usuário logado. Só o servidor preenche (nunca vem da query string): só ele vê as próprias lutas na fila ou com erro. */
  viewer?: number;
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
  "week",
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

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * A semana do clã vai da sexta às 23:03 até a sexta seguinte às 23:00 (horário de Brasília, UTC-3); entre 23:00 e 23:03 de sexta não há
 * semana. Ela é identificada pela data da sexta em que começa (AAAA-MM-DD). `to` é exclusivo. Data que não é sexta-feira não é semana.
 */
export function weekRange(week: string): { from: string; to: string } | null {
  if (!isValidDay(week) || new Date(`${week}T00:00:00Z`).getUTCDay() !== 5) return null;
  return {
    from: new Date(Date.parse(`${week}T23:03:00-03:00`)).toISOString(),
    to: new Date(Date.parse(`${week}T23:00:00-03:00`) + WEEK_MS).toISOString(),
  };
}

/** A semana a que um instante pertence (a data da sexta em que ela começa), ou null se ele cai na janela de 23:00 a 23:03 de sexta. */
export function weekOf(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const local = new Date(t - 3 * HOUR_MS); // o relógio de Brasília lido como UTC
  const sinceFriday = (local.getUTCDay() - 5 + 7) % 7;
  const friday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceFriday));
  for (const candidate of [friday, new Date(friday.getTime() - WEEK_MS)]) {
    const week = candidate.toISOString().slice(0, 10);
    const range = weekRange(week)!;
    if (t >= Date.parse(range.from) && t < Date.parse(range.to)) return week;
  }
  return null;
}

/** As semanas que cobrem de `first` a `last` (instantes), da mais recente para a mais antiga. Um instante na janela de sexta usa a semana que vem logo depois. */
export function weeksBetween(first: string, last: string): string[] {
  if (Number.isNaN(Date.parse(first)) || Number.isNaN(Date.parse(last))) return [];
  const start = weekOf(first) ?? weekOf(new Date(Date.parse(first) + 3 * 60_000).toISOString());
  const end = weekOf(last) ?? weekOf(new Date(Date.parse(last) + 3 * 60_000).toISOString());
  if (!start || !end || start > end) return [];
  const weeks: string[] = [];
  for (let t = Date.parse(`${end}T00:00:00Z`); t >= Date.parse(`${start}T00:00:00Z`); t -= WEEK_MS) weeks.push(new Date(t).toISOString().slice(0, 10));
  return weeks;
}

function isValidDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  // data impossível (2026-13-45) dá NaN; 2026-02-30 "rola" para março e a volta não bate
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Um mês (AAAA-MM) com resumo diário guardado: o primeiro e o último dia com dados, e se é o mês em andamento. */
export interface ArchiveMonth {
  month: string;
  days: number;
  first: string;
  last: string;
  players: number;
  current: boolean;
}

export const isMonth = (m: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

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

/**
 * Filtros com que a Visão Geral abre quando o endereço não traz nenhum: o último dia de batalha com lutas, para a pessoa não procurar
 * a data. Sem nenhum dia (banco vazio) ou sem a lista, os últimos 30 dias, como era antes.
 */
export function overviewDefaults(days: { day: string }[] | undefined): Filters {
  const last = days?.reduce<string | undefined>((max, d) => (max === undefined || d.day > max ? d.day : max), undefined);
  return last ? { day: [last] } : { days: 30 };
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
    } else if (k === "week") {
      if (weekRange(s)) f.week = s;
    } else if (k === "role") {
      if (s === "dps" || s === "support") f.role = s;
    } else if (k === "from" || k === "to") {
      const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s) ? Date.parse(s) : NaN;
      if (!Number.isNaN(instant)) f[k] = new Date(instant).toISOString();
      else if (/^\d{4}-\d{2}-\d{2}/.test(s)) f[k] = s.slice(0, 10);
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

/** Boon (média do volume ponderada pelo tempo ativo) e uptime (% do tempo ativo): valores por tempo, sem "por minuto". */
const isTimeBased = (k: StatKey): boolean => isUptimeStat(k) || STAT_META[k].format === "volume";

/**
 * Valor mostrado de uma métrica numa soma de lutas: uptime em %, boon (a média ponderada pelo tempo ativo, que a consulta já entrega em
 * `a[k]`) e o resto por minuto de tempo ativo. Tudo é soma sobre tempo, então uma luta curta pesa só o que durou. Com `adjust`, boons e
 * uptime saem ajustados pelo tempo jogado, o mesmo número do Ranking.
 */
export const statRate = (a: Aggregate, k: StatKey, adjust?: TimeAdjust): number =>
  isTimeBased(k) ? statValue(k, "total", a, adjust) : perMinute(a[k], a.activeMs);

/** Métricas que definem o papel de um jogador. Ficam de fora as raras ou de resultado (ressurreição, abates, mortes…), que dariam razões enormes por acaso. */
const ROLE_METRICS: StatKey[] = [
  "damage", "strips", "cleanses", "healing", "downedHealing", "barrier",
  "stabOut", "quickOut", "alacOut", "protOut", "mightOut", "aegisOut", "resistOut", "resolOut", "furyOut", "superspeedOut",
];

/**
 * Métrica para abrir o gráfico de um dia: aquela em que o jogador mais se destaca frente ao squad (razão entre o valor dele e o da média).
 * Só entram métricas que os dois têm; empate fica com a primeira da lista (dano). Sem média ou sem nada a comparar, dano.
 */
export function suggestMetric(player: Aggregate, squad: Aggregate | undefined): StatKey {
  if (!squad) return "damage";
  let best: StatKey = "damage";
  let bestRatio = 0;
  for (const k of ROLE_METRICS) {
    const mine = statRate(player, k);
    const theirs = statRate(squad, k);
    if (mine <= 0 || theirs <= 0) continue;
    if (mine / theirs > bestRatio) [best, bestRatio] = [k, mine / theirs];
  }
  return best;
}

/** Função principal num conjunto de lutas: suporte se passou de metade do TEMPO jogado como suporte (sem tempo, vale a contagem de lutas). */
export function mainRole(history: { role: Role; activeMs: number }[]): Role {
  const total = history.reduce((a, h) => a + h.activeMs, 0);
  if (total <= 0) return history.filter((h) => h.role === "support").length > history.length / 2 ? "support" : "dps";
  return history.reduce((a, h) => a + (h.role === "support" ? h.activeMs : 0), 0) > total / 2 ? "support" : "dps";
}

/** Abaixo disto de tempo ativo a luta é de "pouca participação" (o jogador morreu cedo): o ponto do gráfico é marcado, o valor não muda. */
export const SHORT_PARTICIPATION_MS = 30_000;
export const isShortParticipation = (activeMs: number): boolean => activeMs < SHORT_PARTICIPATION_MS;

/**
 * Abaixo disto de tempo ativo (60 s) a luta não tem sinal para estimar a função (suporte × DPS) pelo desempenho: a função vem do histórico da
 * mesma conta e classe. É outro limiar que o de cima: aquele só marca o ponto do gráfico, este decide como a função é calculada.
 */
export const ROLE_MIN_ACTIVE_MS = 60_000;

// ---------- Cards da Visão geral ----------

/** Cura + barreira: métrica só dos cards (a soma é calculada na tela, sem coluna própria), por isso vale também para lutas antigas. */
export const HEALING_BARRIER = "healingBarrier";
export type CardMetric = StatKey | typeof HEALING_BARRIER;
/** A métrica de cada card; há um card por grupo do Ranking. */
export type Cards = Record<StatGroup, CardMetric>;

/** O que cada card mostra para quem nunca escolheu: o padrão de cada grupo. */
export const DEFAULT_CARDS: Cards = { offense: "damage", support: "healing", boons: "stabOut", uptime: "stabUp", defense: "dodges" };

/** As métricas que o seletor de um card oferece: as do grupo (nos boons, as do alcance pedido) e, no Suporte, Cura + barreira no fim. */
export function cardOptions(group: StatGroup): CardMetric[] {
  const keys: CardMetric[] = group === "boons" ? [...statsOfGroup(group), ...statsOfGroup(group, "useful")] : statsOfGroup(group);
  return group === "support" ? [...keys, HEALING_BARRIER] : keys;
}

const isCardMetric = (group: StatGroup, metric: string): metric is CardMetric =>
  metric === HEALING_BARRIER ? group === "support" : (STAT_KEYS as readonly string[]).includes(metric) && STAT_META[metric as StatKey].group === group && (group !== "boons" || cardOptions(group).includes(metric as StatKey));

/** Lê o `cards` do link (`grupo:métrica,grupo:métrica`): o que for inválido, de outro grupo ou repetido de forma estranha é descartado. */
export function parseCards(raw: string | null | undefined): Partial<Cards> {
  const cards: Partial<Cards> = {};
  if (!raw || raw.length > 300) return cards;
  for (const part of raw.split(",")) {
    const [group, metric] = part.split(":");
    const known = STAT_GROUPS.find((g) => g.id === group);
    if (known && metric && isCardMetric(known.id, metric)) cards[known.id] = metric;
  }
  return cards;
}

export const resolveCards = (chosen: Partial<Cards>): Cards => ({ ...DEFAULT_CARDS, ...chosen });

/** Só o que difere do padrão: o link fica curto e quem nunca escolheu segue o padrão. */
export const serializeCards = (cards: Cards): string =>
  STAT_GROUPS.filter((g) => cards[g.id] !== DEFAULT_CARDS[g.id])
    .map((g) => `${g.id}:${cards[g.id]}`)
    .join(",");

/** Contagem (dano, cura, strips…) mostra por minuto de tempo ativo; boon e uptime já são valor por tempo. Cura + barreira é contagem. */
export const isCardRate = (metric: CardMetric): boolean => metric === HEALING_BARRIER || !isTimeBased(metric);

/** A unidade que o rodapé do card mostra: por minuto nas contagens, % do tempo no uptime em %, e média no tempo nos boons e nas médias (pilhas, distância). */
export const cardUnit = (metric: CardMetric): "perMin" | "pctTime" | "avgTime" =>
  isCardRate(metric) ? "perMin" : STAT_META[metric as StatKey].format === "pct" ? "pctTime" : "avgTime";

/** Para métricas em que menos é melhor (mortes, dano recebido) o top vai do menor para o maior. */
export const cardHigherIsBetter = (metric: CardMetric): boolean => metric === HEALING_BARRIER || STAT_META[metric].higherIsBetter;

/**
 * Os `n` do topo de um card, com o valor mostrado: por minuto nas contagens; nos boons e no uptime, o valor ajustado pelo tempo jogado
 * (o mesmo do Ranking, com `adjust`). Fica de fora quem lutou menos de `minActiveMs` e quem tem zero (sem dado, ou sem nenhuma morte
 * quando menos é melhor): zero não é um resultado a premiar.
 */
export function topByCard<T extends Stats & { activeMs: number }>(rows: T[], metric: CardMetric, n: number, minActiveMs: number, adjust?: TimeAdjust): { row: T; value: number }[] {
  const higher = cardHigherIsBetter(metric);
  return rows
    .filter((r) => r.activeMs >= minActiveMs && (metric === HEALING_BARRIER ? r.healing + r.barrier : r[metric]) > 0)
    .map((row) => ({ row, value: metric === HEALING_BARRIER ? perMinute(row.healing + row.barrier, row.activeMs) : statValue(metric, "perMin", row, adjust) }))
    .sort((a, b) => (higher ? b.value - a.value : a.value - b.value))
    .slice(0, n);
}

export const perSecond = (value: number, activeMs: number): number => (activeMs > 0 ? (value * 1000) / activeMs : 0);

/** Como mostrar uma métrica: o total, ou por minuto, ou por segundo de tempo ativo. */
export type ValueMode = "total" | "perMin" | "perSec";

/** Menor referência do ajuste por tempo (5 min): num filtro com pouco tempo de jogo ela nunca zera. */
export const MIN_REFERENCE_MS = 5 * 60_000;

/**
 * Referência do ajuste por tempo: metade do tempo mediano de jogo por jogador no filtro (mínimo 5 min). Mediana, e não média, para poucos
 * jogadores de muitas horas não esticarem a referência; metade, para quem jogou o tempo típico ficar com 2/3 do próprio valor.
 */
export function referenceTimeMs(activeMsPerPlayer: number[]): number {
  if (!activeMsPerPlayer.length) return MIN_REFERENCE_MS;
  const sorted = [...activeMsPerPlayer].sort((a, b) => a - b);
  return Math.max(MIN_REFERENCE_MS, sorted[Math.floor(sorted.length / 2)]! / 2);
}

/** Média ponderada pelo tempo ativo (Σ valor × tempo ÷ Σ tempo) de linhas de jogador; é a conta que a consulta do Ranking faz nos boons. 0 sem tempo. */
export function weightedByActive<T extends { activeMs: number }>(rows: T[], value: (r: T) => number): number {
  const active = rows.reduce((a, r) => a + r.activeMs, 0);
  return active > 0 ? rows.reduce((a, r) => a + value(r) * r.activeMs, 0) / active : 0;
}

/** Média ajustada pelo tempo jogado: quem jogou pouco é puxado para a média geral, quem jogou muito quase mantém o próprio valor. */
export const adjustedByTime = (own: number, activeMs: number, general: number, refMs: number): number =>
  activeMs + refMs > 0 ? (activeMs * own + refMs * general) / (activeMs + refMs) : general;

/** O que o Ranking envia para ajustar boons e uptime: a média geral do filtro (baseline) e a referência de tempo. */
export interface TimeAdjust {
  baseline: Aggregate;
  refMs: number;
}

/**
 * Valor de uma métrica de um jogador (ou de uma soma) no modo escolhido: o mesmo na tabela e no gráfico da luta.
 * Boons e uptime já vêm normalizados pelo tempo (o boon pelo Elite Insights e pela média ponderada pelo tempo ativo; o uptime é % do tempo
 * ativo), então o modo não se aplica a eles. Com `adjust` (Ranking), eles são puxados para a média geral conforme o tempo jogado.
 */
export function statValue(k: StatKey, mode: ValueMode, r: Stats & { activeMs: number }, adjust?: TimeAdjust): number {
  if (isTimeBased(k)) {
    const own = isUptimeStat(k) ? uptimeValue(k, r[k], r.activeMs) : r[k];
    if (!adjust) return own;
    const general = isUptimeStat(k) ? uptimeValue(k, adjust.baseline[k], adjust.baseline.activeMs) : adjust.baseline[k];
    return adjustedByTime(own, r.activeMs, general, adjust.refMs);
  }
  if (mode === "total") return r[k];
  return mode === "perSec" ? perSecond(r[k], r.activeMs) : perMinute(r[k], r.activeMs);
}

/**
 * Os jogadores do gráfico da luta: os `n` maiores valores da métrica, do maior para o menor, sem quem tem 0 (cura, por exemplo, quase
 * sempre é 0). Mesmo para métricas em que menos é melhor (mortes): o gráfico mostra quem tem mais. Cada linha leva o valor já calculado.
 */
export function topByStat<T extends Stats & { activeMs: number }>(rows: T[], k: StatKey, mode: ValueMode, n = 20): (T & { value: number })[] {
  return rows
    .map((r) => ({ ...r, value: statValue(k, mode, r) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

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
