// Consultas da API. Todas aceitam os mesmos filtros (Filters) do pacote compartilhado.
import {
  battleDay,
  BATTLE_DAY_SHIFT_HOURS,
  FIGHT_SORT_KEYS,
  isTagStat,
  STAT_KEYS,
  STAT_META,
  TAG_COVER,
  type ArchiveMonth,
  type DaySummary,
  type Aggregate,
  type Fight,
  type FightDetail,
  type FightSortKey,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerFight,
  type PlayerOptions,
  type PlayerProfile,
  type PlayerSkill,
  type ProfessionCount,
  type RankingRow,
} from "@gw2logs/shared";
import { snake, STAT_COL, type DB } from "./db.js";

type Params = Record<string, string | number>;

/** Dia de batalha de uma luta (ver battleDay em shared): data da luta menos 9 horas. */
export const BATTLE_DAY = `date(f.time_start, '-${BATTLE_DAY_SHIFT_HOURS} hours')`;

// ---------- A mesma luta gravada por mais de uma pessoa ----------

/** Quanto do log menor precisa estar dentro do outro para as duas serem a mesma luta. */
const SAME_FIGHT_OVERLAP = 0.5;
/** Quanto do tempo do log o comandante precisa estar presente para o log valer como "acompanhou a tag". */
const COMMANDER_PRESENCE = 0.8;
/** Só se comparam logs que começam, no máximo, tantas horas antes de outro: é o que deixa o índice (mapa, início) servir. Nenhum log chega perto disso (o maior do histórico tem 13 minutos). */
const SAME_FIGHT_MAX_HOURS = 1;

const startMs = (x: string) => `(CAST(strftime('%s', ${x}.time_start) AS INTEGER) * 1000)`;
const endMs = (x: string) => `(${startMs(x)} + ${x}.duration_ms)`;
/** Um instante de `x` no mesmo formato do banco (ISO com milissegundos e Z), para comparar o texto e usar o índice. */
const startShifted = (x: string, shift: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${x}.time_start, '${shift}')`;
const endIso = (x: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${x}.time_start, '+' || (${x}.duration_ms / 1000.0) || ' seconds')`;
const commander = (x: string) => `(SELECT account FROM player_stats WHERE fight_id = ${x}.id AND commander = 1 LIMIT 1)`;
const commanderMs = (x: string) => `(SELECT active_ms FROM player_stats WHERE fight_id = ${x}.id AND commander = 1 LIMIT 1)`;
const playersOf = (x: string) => `(SELECT COUNT(*) FROM player_stats WHERE fight_id = ${x}.id)`;
/** 1 se o log acompanhou a tag: o comandante está presente em 80% ou mais do tempo (ou não há tag marcada para conferir). */
const followedTag = (x: string) => `(CASE WHEN ${commander(x)} IS NULL OR ${commanderMs(x)} >= ${COMMANDER_PRESENCE} * ${x}.duration_ms THEN 1 ELSE 0 END)`;

/**
 * `b` é a mesma luta que `a`: mesmo mapa (um mapa desconhecido nunca junta) e modo, começos próximos, tempos sobrepostos em mais da metade
 * do log menor (lutas seguidas que só encostam ficam separadas) e o mesmo grupo: o mesmo comandante ou, se um dos dois não tem tag marcada,
 * mais da metade dos jogadores do log menor em comum. Os termos mais baratos vêm primeiro.
 */
const sameFight = (a: string, b: string) => `${b}.status = 'done' AND ${b}.id <> ${a}.id AND ${b}.map_id = ${a}.map_id AND ${b}.mode IS ${a}.mode
      AND ${b}.time_start > ${startShifted(a, `-${SAME_FIGHT_MAX_HOURS} hours`)} AND ${b}.time_start < ${endIso(a)}
      AND ${b}.duration_ms IS NOT NULL
      AND MIN(${endMs(a)}, ${endMs(b)}) - MAX(${startMs(a)}, ${startMs(b)}) > ${SAME_FIGHT_OVERLAP} * MIN(${a}.duration_ms, ${b}.duration_ms)
      AND ((${commander(a)} IS NOT NULL AND ${commander(b)} IS NOT NULL AND ${commander(a)} = ${commander(b)})
        OR ((${commander(a)} IS NULL OR ${commander(b)} IS NULL)
          AND (SELECT COUNT(*) FROM player_stats x JOIN player_stats y ON y.account = x.account AND y.fight_id = ${b}.id WHERE x.fight_id = ${a}.id) > ${SAME_FIGHT_OVERLAP} * MIN(${playersOf(a)}, ${playersOf(b)})))`;

/** O que decide entre dois logs da mesma luta: acompanhou a tag, mais dano do squad, mais duração, mais jogadores e, por fim, o id menor (sempre o mesmo). */
const rank = (x: string) => `${followedTag(x)}, COALESCE(${x}.squad_damage, 0), COALESCE(${x}.duration_ms, 0), COALESCE(${x}.squad_count, 0)`;
/** `b` ganha de `a`. O id entra com os lados trocados: na comparação de tuplas o menor id é o que ganha. */
const beats = (b: string, a: string) => `(${rank(b)}, ${a}.id) > (${rank(a)}, ${b}.id)`;

/**
 * Fora as lutas escondidas por um log melhor da mesma luta. Só esconde quem também está visível: um log que perdeu para outro (`c`) não
 * esconde mais ninguém, senão uma cadeia A~B~C faria sumir A por causa de B, que já sumiu por causa de C, sem A e C serem a mesma luta.
 * Os logs escondidos continuam no banco (abrem pelo link) e voltam a aparecer sozinhos se o melhor for apagado. A subconsulta não depende
 * da linha de fora, então o SQLite a calcula uma vez por consulta (e não uma vez por jogador, que deixava o ranking lento).
 */
const MOST_COMPLETE = `f.id NOT IN (
  SELECT a.id FROM fights a
  WHERE a.status = 'done' AND a.time_start IS NOT NULL AND a.duration_ms IS NOT NULL AND a.map_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM fights b
      WHERE ${sameFight("a", "b")} AND ${beats("b", "a")}
        AND NOT EXISTS (SELECT 1 FROM fights c WHERE ${sameFight("b", "c")} AND ${beats("c", "b")})
    )
)`;

// ---------- Filtros → SQL ----------

/** Condições sobre a luta (tabela f). */
export function fightConditions(fl: Filters, now = new Date()): { where: string[]; params: Params } {
  const where = ["f.status = 'done'", MOST_COMPLETE];
  const params: Params = {};
  if (fl.mode) (where.push("f.mode = @mode"), (params.mode = fl.mode));
  if (fl.days) (where.push("f.time_start >= @since"), (params.since = new Date(now.getTime() - fl.days * 86_400_000).toISOString()));
  // "De"/"Até" chegam como dia (AAAA-MM-DD: o dia inteiro, em UTC) ou como instante com hora (já em UTC)
  if (fl.from) (where.push("f.time_start >= @from"), (params.from = fl.from.includes("T") ? fl.from : `${fl.from}T00:00:00.000Z`));
  if (fl.to) (where.push("f.time_start < @to"), (params.to = fl.to.includes("T") ? fl.to : new Date(Date.parse(`${fl.to}T00:00:00.000Z`) + 86_400_000).toISOString()));
  if (fl.map) (where.push("f.map_id = @map"), (params.map = fl.map));
  if (fl.minSquad) (where.push("f.squad_count >= @minSquad"), (params.minSquad = fl.minSquad));
  if (fl.maxSquad) (where.push("f.squad_count <= @maxSquad"), (params.maxSquad = fl.maxSquad));
  if (fl.minEnemies) (where.push("f.enemy_count >= @minEnemies"), (params.minEnemies = fl.minEnemies));
  if (fl.minDurationSec) (where.push("f.duration_ms >= @minDur"), (params.minDur = fl.minDurationSec * 1000));
  if (fl.day?.length) {
    where.push(`${BATTLE_DAY} IN (${fl.day.map((_, i) => `@day${i}`).join(", ")})`);
    fl.day.forEach((d, i) => (params[`day${i}`] = d));
  }
  return { where, params };
}

/** Condições sobre a linha do jogador (tabela ps). */
export function playerConditions(fl: Filters): { where: string[]; params: Params } {
  const where: string[] = [];
  const params: Params = {};
  if (fl.guild === "alliance") where.push("ps.guild_id IN (SELECT id FROM guilds WHERE in_alliance = 1)");
  else if (fl.guild) (where.push("ps.guild_id = @guild"), (params.guild = fl.guild));
  if (fl.role) (where.push("ps.role = @role"), (params.role = fl.role));
  if (fl.profession) (where.push("ps.profession = @profession"), (params.profession = fl.profession));
  return { where, params };
}

function combined(fl: Filters) {
  const a = fightConditions(fl);
  const b = playerConditions(fl);
  return { where: [...a.where, ...b.where].join(" AND "), params: { ...a.params, ...b.params } };
}

// ---------- Mapeamento de linhas ----------

const FIGHT_COLS = `f.id, f.status, f.error, f.uploaded_at AS uploadedAt, f.file_name AS fileName, f.mode,
  f.fight_name AS fightName, f.map_id AS mapId, f.map_name AS mapName, f.time_start AS timeStart, f.duration_ms AS durationMs,
  f.success, f.squad_count AS squadCount, f.ally_count AS allyCount, f.enemy_count AS enemyCount,
  f.squad_damage AS squadDamage, f.squad_kills AS squadKills, f.squad_downs AS squadDowns, f.squad_deaths AS squadDeaths,
  f.enemy_downs AS enemyDowns, f.enemy_deaths AS enemyDeaths, f.has_report AS hasReport`;

const toFight = (r: any): Fight => ({ ...r, success: !!r.success, hasReport: !!r.hasReport });

/**
 * A tela divide as métricas de uptime pelo tempo ativo. As da tag só existem nos logs lidos com replay, e o tempo que o dado cobre
 * (`*_cover_ms`) pode ser menor que o ativo (morto e desconectado ficam de fora): a API devolve o valor já reescalado para o tempo
 * ativo (valor × ativo ÷ coberto), e a mesma conta da tela dá o certo (valor ÷ coberto). Sem cobertura, 0.
 */
const coverCol = (k: keyof typeof TAG_COVER) => snake(TAG_COVER[k]);
const statSelect = (k: (typeof STAT_KEYS)[number]) =>
  isTagStat(k) ? `CASE WHEN ps.${coverCol(k)} > 0 THEN ps.${STAT_COL[k]} * ps.active_ms / ps.${coverCol(k)} ELSE 0 END AS "${k}"` : `ps.${STAT_COL[k]} AS "${k}"`;
const STAT_SELECT = STAT_KEYS.map(statSelect).join(", ");
const PLAYER_COLS = `ps.fight_id AS fightId, ps.account, ps.name, ps.profession, ps.guild_id AS guildId, ps.grp AS "group",
  ps.commander, ps.role, ps.active_ms AS activeMs, ps.dist_to_com AS distToCom, ps.dist_cover_ms AS distCoverMs, ps.near_cover_ms AS nearCoverMs, ${STAT_SELECT}`;
const toPlayer = <T extends PlayerFight>(r: any): T => ({ ...r, commander: !!r.commander });

/**
 * Cada métrica soma sobre as lutas, menos o boon gerado: o Elite Insights já o entrega normalizado pela duração da luta, então somar (ou
 * dividir pelas lutas) distorce. Ele vira a média ponderada pelo tempo ativo (Σ valor × tempo ÷ Σ tempo), igual ao uptime, que já é tempo
 * com o boon sobre tempo ativo. Sem tempo ativo, 0.
 */
const aggColumnOf = (k: (typeof STAT_KEYS)[number], a: "ps" | "ds") =>
  isTagStat(k)
    ? // soma sobre soma, só das lutas com o dado: Σ valor ÷ Σ coberto, reescalado para o tempo ativo (ver statSelect)
      `COALESCE(SUM(${a}.${STAT_COL[k]}) * 1.0 * SUM(${a}.active_ms) / NULLIF(SUM(${a}.${coverCol(k)}), 0), 0) AS "${k}"`
    : STAT_META[k].format === "volume"
      ? // o resumo diário (ds) já guarda o boon como Σ(valor × tempo ativo); nas lutas (ps) a conta é feita aqui
        `COALESCE(SUM(${a === "ps" ? `ps.${STAT_COL[k]} * ps.active_ms` : `ds.${STAT_COL[k]}`}) * 1.0 / NULLIF(SUM(${a}.active_ms), 0), 0) AS "${k}"`
      : `SUM(${a}.${STAT_COL[k]}) AS "${k}"`;
const aggColumn = (k: (typeof STAT_KEYS)[number]) => aggColumnOf(k, "ps");
const AGG_SELECT = `COUNT(*) AS fights, SUM(ps.active_ms) AS activeMs, SUM(ps.dist_cover_ms) AS distCoverMs, SUM(ps.near_cover_ms) AS nearCoverMs, ${STAT_KEYS.map(aggColumn).join(", ")}`;
const toAggregate = (r: any): Aggregate => {
  const a: any = { fights: r?.fights ?? 0, activeMs: r?.activeMs ?? 0, distCoverMs: r?.distCoverMs ?? 0, nearCoverMs: r?.nearCoverMs ?? 0 };
  for (const k of STAT_KEYS) a[k] = r?.[k] ?? 0;
  return a;
};

// ---------- Consultas ----------

/**
 * Expressão SQL de cada coluna ordenável da lista de lutas. A requisição só escolhe a chave (FIGHT_SORT_KEYS): o texto SQL
 * vem sempre daqui, nunca da entrada do usuário. Reproduz a ordenação que a tela fazia no navegador.
 */
const FIGHT_SORT_SQL: Record<FightSortKey, string> = {
  time: "COALESCE(f.time_start, f.uploaded_at)",
  name: "COALESCE(f.fight_name, f.file_name, '') COLLATE NOCASE",
  dur: "f.duration_ms",
  size: "f.squad_count",
  kd: "COALESCE(f.enemy_deaths, f.squad_kills, 0) - COALESCE(f.squad_deaths, 0)",
  dmg: "f.squad_damage",
};

/** Condições das lutas prontas que valem para a lista e para a contagem: o filtro define o conjunto. */
function listedFights(fl: Filters): { where: string; params: Params } {
  const f = fightConditions(fl);
  const p = playerConditions(fl);
  const where = [...f.where];
  if (p.where.length) where.push(`EXISTS (SELECT 1 FROM player_stats ps WHERE ps.fight_id = f.id AND ${p.where.join(" AND ")})`);
  return { where: where.join(" AND "), params: { ...f.params, ...p.params } };
}

/** Quantas lutas prontas o filtro alcança (o total que a paginação mostra). */
export function countFights(db: DB, fl: Filters): number {
  const { where, params } = listedFights(fl);
  return (db.prepare(`SELECT COUNT(*) AS n FROM fights f WHERE ${where}`).get(params) as { n: number }).n;
}

/** Uma página da lista de lutas. Sem coluna válida a ordem é a data, da mais nova; valor vazio fica sempre no fim. */
export function listFights(db: DB, fl: Filters, limit = 50, offset = 0, order: { sort?: string; dir?: string } = {}): Fight[] {
  const { where, params } = listedFights(fl);
  const key = (FIGHT_SORT_KEYS as readonly string[]).includes(order.sort ?? "") ? (order.sort as FightSortKey) : "time";
  const dir = order.dir === "asc" ? "ASC" : "DESC";
  const expr = FIGHT_SORT_SQL[key];
  // lutas ainda na fila ou com erro aparecem sempre no topo da primeira página
  const pending =
    offset === 0 && fl.viewer !== undefined
      ? (db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.status != 'done' AND f.owner_id = ? ORDER BY f.uploaded_at DESC LIMIT 50`).all(fl.viewer) as any[])
      : [];
  // f.id desempata: sem isso, lutas com o mesmo valor poderiam repetir ou sumir entre uma página e outra
  const done = db
    .prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE ${where} ORDER BY (${expr}) IS NULL, (${expr}) ${dir}, f.id ${dir} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as any[];
  return [...pending, ...done].map(toFight);
}

export function fightDetail(db: DB, id: string): FightDetail | null {
  const fight = db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.id = ? AND f.status = 'done'`).get(id);
  if (!fight) return null;
  const players = (db.prepare(`SELECT ${PLAYER_COLS} FROM player_stats ps WHERE ps.fight_id = ? ORDER BY ps.damage DESC`).all(id) as any[]).map(toPlayer);
  const guilds = db
    .prepare(`SELECT g.id, g.name, g.tag, g.in_alliance AS inAlliance FROM guilds g WHERE g.id IN (SELECT guild_id FROM player_stats WHERE fight_id = ?)`)
    .all(id)
    .map((g: any) => ({ ...g, inAlliance: !!g.inAlliance }));
  return { fight: toFight(fight), players, guilds };
}

export function ranking(db: DB, fl: Filters): RankingRow[] {
  const { where, params } = combined(fl);
  // SQLite: com um único MAX(), as colunas "soltas" vêm da linha da luta mais recente (nome e guilda atuais; a classe é tratada à parte, abaixo)
  const rows = db
    .prepare(
      `SELECT ps.account, MAX(f.time_start) AS lastSeen, ps.name, ps.guild_id AS guildId,
              SUM(ps.role = 'support') AS supportFights, ${AGG_SELECT}
       FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
       WHERE ${where}
       GROUP BY ps.account
       ORDER BY "damage" DESC`,
    )
    .all(params) as any[];
  // O nome e a guilda são os da luta mais recente (os atuais). A classe não: quem jogou de duas classes teria as lutas das duas somadas
  // nos totais, mas só a classe da última na linha. Por isso a linha leva todas, da mais jogada para a menos (empate: a mais recente).
  const classes = new Map<string, ProfessionCount[]>();
  const perClass = db
    .prepare(
      `SELECT ps.account, ps.profession, COUNT(*) AS fights
       FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
       WHERE ${where} AND ps.profession IS NOT NULL
       GROUP BY ps.account, ps.profession
       ORDER BY fights DESC, MAX(f.time_start) DESC`,
    )
    .all(params) as { account: string; profession: string; fights: number }[];
  for (const c of perClass) {
    if (!classes.has(c.account)) classes.set(c.account, []);
    classes.get(c.account)!.push({ profession: c.profession, fights: c.fights });
  }
  return rows.map((r) => {
    const professions = classes.get(r.account) ?? [];
    return {
      ...toAggregate(r),
      account: r.account,
      name: r.name,
      profession: professions[0]?.profession ?? null,
      professions,
      guildId: r.guildId,
      supportFights: r.supportFights,
    };
  });
}

// ---------- Arquivo mensal (resumo diário, ver archive.ts) ----------

/** Meses com resumo diário, do mais novo para o mais antigo; `current` marca o mês do dia de batalha de agora. */
export function archiveMonths(db: DB, now = new Date()): ArchiveMonth[] {
  const current = battleDay(now.toISOString())?.slice(0, 7);
  return (
    db
      .prepare(
        `SELECT substr(day, 1, 7) AS month, COUNT(DISTINCT day) AS days, MIN(day) AS first, MAX(day) AS last, COUNT(DISTINCT account) AS players
         FROM day_stats GROUP BY month ORDER BY month DESC`,
      )
      .all() as Omit<ArchiveMonth, "current">[]
  ).map((m) => ({ ...m, current: m.month === current }));
}

/** Filtros que o resumo diário entende: modo, guilda, função e classe. Dia, período, mapa e tamanho do squad não existem nele. */
function archiveConditions(month: string, fl: Filters): { where: string; params: Params } {
  const where = ["substr(ds.day, 1, 7) = @month"];
  const params: Params = { month };
  if (fl.mode) (where.push("ds.mode = @mode"), (params.mode = fl.mode));
  if (fl.guild === "alliance") where.push("ds.guild_id IN (SELECT id FROM guilds WHERE in_alliance = 1)");
  else if (fl.guild) (where.push("ds.guild_id = @guild"), (params.guild = fl.guild));
  if (fl.role) (where.push("ds.role = @role"), (params.role = fl.role));
  if (fl.profession) (where.push("ds.profession = @profession"), (params.profession = fl.profession));
  return { where: where.join(" AND "), params };
}

const ARCHIVE_AGG = `SUM(ds.fights) AS fights, SUM(ds.active_ms) AS activeMs, SUM(ds.dist_cover_ms) AS distCoverMs, SUM(ds.near_cover_ms) AS nearCoverMs, ${STAT_KEYS.map((k) => aggColumnOf(k, "ds")).join(", ")}`;

/**
 * O Ranking de um mês, somado do resumo diário (as lutas dele podem já ter sido apagadas pela retenção): as mesmas linhas, o mesmo
 * cálculo de boon e de uptime e a mesma média geral que `ranking` e `baseline` dariam com as lutas dos mesmos dias.
 */
export function archiveRanking(db: DB, month: string, fl: Filters): { rows: RankingRow[]; baseline: Aggregate } {
  const { where, params } = archiveConditions(month, fl);
  // nome e guilda são os da aparição mais recente (o único MAX da consulta); '' no resumo é "sem guilda"
  const rows = db
    .prepare(
      `SELECT ds.account, MAX(ds.last_seen) AS lastSeen, ds.name, NULLIF(ds.guild_id, '') AS guildId,
              SUM(CASE WHEN ds.role = 'support' THEN ds.fights ELSE 0 END) AS supportFights, ${ARCHIVE_AGG}
       FROM day_stats ds WHERE ${where} GROUP BY ds.account ORDER BY "damage" DESC`,
    )
    .all(params) as any[];
  const classes = new Map<string, ProfessionCount[]>();
  const perClass = db
    .prepare(
      `SELECT ds.account, ds.profession, SUM(ds.fights) AS fights FROM day_stats ds
       WHERE ${where} AND ds.profession <> '' GROUP BY ds.account, ds.profession ORDER BY fights DESC, MAX(ds.last_seen) DESC`,
    )
    .all(params) as { account: string; profession: string; fights: number }[];
  for (const c of perClass) classes.set(c.account, [...(classes.get(c.account) ?? []), { profession: c.profession, fights: c.fights }]);
  const baseline = toAggregate(db.prepare(`SELECT ${ARCHIVE_AGG} FROM day_stats ds WHERE ${where}`).get(params));
  return {
    rows: rows.map((r) => {
      const professions = classes.get(r.account) ?? [];
      return { ...toAggregate(r), account: r.account, name: r.name, profession: professions[0]?.profession ?? null, professions, guildId: r.guildId, supportFights: r.supportFights };
    }),
    baseline,
  };
}

/** Soma de todas as linhas de jogador com os filtros (base para "média do squad" por minuto). */
export function baseline(db: DB, fl: Filters): Aggregate {
  const { where, params } = combined(fl);
  return toAggregate(db.prepare(`SELECT ${AGG_SELECT} FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ${where}`).get(params));
}

/** Dano do jogador por habilidade nas lutas filtradas, da que mais causa dano para a que menos causa. */
export function playerSkills(db: DB, account: string, fl: Filters): PlayerSkill[] {
  const { where, params } = combined(fl);
  const rows = db
    .prepare(
      `SELECT sk.skill_id AS skillId, s.name AS name, SUM(sk.damage) AS damage, SUM(sk.hits) AS hits, SUM(sk.connected_hits) AS connectedHits
       FROM player_skills sk
       JOIN player_stats ps ON ps.fight_id = sk.fight_id AND ps.account = sk.account
       JOIN fights f ON f.id = sk.fight_id
       LEFT JOIN skills s ON s.id = sk.skill_id
       WHERE sk.account = @account AND ${where}
       GROUP BY sk.skill_id
       ORDER BY damage DESC`,
    )
    .all({ ...params, account }) as Omit<PlayerSkill, "pct" | "avgHit">[];
  const total = rows.reduce((a, r) => a + r.damage, 0);
  return rows.map((r) => ({ ...r, pct: total ? (r.damage / total) * 100 : 0, avgHit: r.connectedHits ? r.damage / r.connectedHits : 0 }));
}

/** Dias de batalha com lutas, do mais recente ao mais antigo. Ignora o filtro de dia, senão só sobraria o escolhido. */
export function battleDays(db: DB, fl: Filters): DaySummary[] {
  const all: Filters = { ...fl, day: undefined };
  const f = fightConditions(all);
  const days = db
    .prepare(
      `SELECT ${BATTLE_DAY} AS day, COUNT(*) AS fights, COALESCE(SUM(f.duration_ms), 0) AS durationMs,
              COALESCE(SUM(COALESCE(f.enemy_deaths, f.squad_kills)), 0) AS kills, COALESCE(SUM(f.squad_deaths), 0) AS deaths,
              MIN(f.time_start) AS first, MAX(f.time_start) AS last
       FROM fights f WHERE ${f.where.join(" AND ")} AND f.time_start IS NOT NULL
       GROUP BY day ORDER BY day DESC`,
    )
    .all(f.params) as Omit<DaySummary, "players">[];
  const c = combined(all);
  const players = new Map(
    (
      db
        .prepare(
          `SELECT ${BATTLE_DAY} AS day, COUNT(DISTINCT ps.account) AS players
           FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
           WHERE ${c.where} AND f.time_start IS NOT NULL GROUP BY day`,
        )
        .all(c.params) as { day: string; players: number }[]
    ).map((r) => [r.day, r.players]),
  );
  return days.map((d) => ({ ...d, players: players.get(d.day) ?? 0 }));
}

/**
 * O que o jogador jogou, para as listas dos filtros da página dele. Função e classe ficam fora da conta (escolher uma não pode
 * esconder a outra); o dia entra nas listas de função e de classe, mas não na de dias, para dar para trocar de dia.
 */
export function playerOptions(db: DB, account: string, fl: Filters): PlayerOptions | null {
  if (!db.prepare("SELECT 1 FROM player_stats WHERE account = ? LIMIT 1").get(account)) return null;
  const base: Filters = { ...fl, role: undefined, profession: undefined };
  const day = combined(base);
  const anyDay = combined({ ...base, day: undefined });
  const from = "FROM player_stats ps JOIN fights f ON f.id = ps.fight_id";
  const column = (col: string) =>
    (db.prepare(`SELECT DISTINCT ${col} AS v ${from} WHERE ps.account = @account AND ${col} IS NOT NULL AND ${day.where} ORDER BY ${col}`).all({ ...day.params, account }) as { v: string }[]).map((r) => r.v);
  const days = db
    .prepare(`SELECT ${BATTLE_DAY} AS day, COUNT(*) AS fights ${from} WHERE ps.account = @account AND f.time_start IS NOT NULL AND ${anyDay.where} GROUP BY day ORDER BY day DESC`)
    .all({ ...anyDay.params, account }) as { day: string; fights: number }[];
  return { roles: column("ps.role") as PlayerOptions["roles"], professions: column("ps.profession"), days };
}

export function playerProfile(db: DB, account: string, fl: Filters): PlayerProfile | null {
  const { where, params } = combined(fl);
  const p = { ...params, account };
  const history = (
    db
      .prepare(
        `SELECT ${PLAYER_COLS}, f.time_start AS timeStart, f.duration_ms AS durationMs, f.map_name AS mapName, f.fight_name AS fightName
         FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
         WHERE ps.account = @account AND ${where} ORDER BY f.time_start`,
      )
      .all(p) as any[]
  ).map((r) => toPlayer<any>(r));
  // jogador que existe nos logs mas some com os filtros ainda tem perfil (vazio)
  const anyRow = db.prepare("SELECT name FROM player_stats WHERE account = ? LIMIT 1").get(account) as { name: string | null } | undefined;
  if (!history.length && !anyRow) return null;
  const totals = toAggregate(db.prepare(`SELECT ${AGG_SELECT} FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ${where}`).get(p));
  const professions = db
    .prepare(`SELECT ps.profession, COUNT(*) AS fights FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ${where} GROUP BY ps.profession ORDER BY fights DESC`)
    .all(p) as { profession: string; fights: number }[];
  const guilds = db
    .prepare(`SELECT ps.guild_id AS guildId, COUNT(*) AS fights FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ps.guild_id IS NOT NULL AND ${where} GROUP BY ps.guild_id ORDER BY fights DESC`)
    .all(p) as { guildId: string; fights: number }[];
  const last = history.at(-1) ?? anyRow;
  return { account, name: last?.name ?? null, totals, history, professions, guilds };
}

/** Guildas que aparecem nas lutas do dono (as filtradas, se houver filtro). */
export function guildSummaries(db: DB, fl: Filters): GuildSummary[] {
  const f = fightConditions(fl);
  return (
    db
      .prepare(
        `SELECT g.id, g.name, g.tag, g.in_alliance AS inAlliance,
                COUNT(DISTINCT ps.account) AS players, COUNT(DISTINCT ps.fight_id) AS fights, MAX(f.time_start) AS lastSeen
         FROM guilds g
         JOIN player_stats ps ON ps.guild_id = g.id
         JOIN fights f ON f.id = ps.fight_id AND ${f.where.join(" AND ")}
         GROUP BY g.id
         ORDER BY g.in_alliance DESC, players DESC`,
      )
      .all(f.params) as any[]
  ).map((g) => ({ ...g, inAlliance: !!g.inAlliance }));
}

export function setGuildAlliance(db: DB, id: string, inAlliance: boolean): boolean {
  return db.prepare("UPDATE guilds SET in_alliance = ? WHERE id = ?").run(inAlliance ? 1 : 0, id).changes > 0;
}

export function overview(db: DB, fl: Filters): Overview {
  const { where, params } = fightConditions(fl);
  const w = where.join(" AND ");
  const t = db
    .prepare(
      `SELECT COUNT(*) AS fights, COALESCE(SUM(duration_ms),0) AS durationMs, COALESCE(SUM(COALESCE(enemy_deaths, squad_kills)),0) AS kills,
              COALESCE(SUM(squad_deaths),0) AS deaths, MIN(time_start) AS first, MAX(time_start) AS last
       FROM fights f WHERE ${w}`,
    )
    .get(params) as any;
  const players = (db.prepare(`SELECT COUNT(DISTINCT ps.account) AS n FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ${w}`).get(params) as any).n;
  const recent = (db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE ${w} ORDER BY f.time_start DESC LIMIT 8`).all(params) as any[]).map(toFight);
  return { ...t, players, recent };
}

/** Opções dos filtros (mapas, classes, jogadores) que existem nas lutas. */
export function meta(db: DB) {
  return {
    maps: db.prepare("SELECT DISTINCT map_id AS id, map_name AS name FROM fights WHERE status='done' AND map_id IS NOT NULL ORDER BY map_name").all(),
    professions: (db.prepare("SELECT DISTINCT profession FROM player_stats WHERE profession IS NOT NULL ORDER BY profession").all() as any[]).map((r) => r.profession),
    players: db
      .prepare(
        "SELECT account, MAX(f.time_start) AS lastSeen, ps.name, ps.profession FROM player_stats ps JOIN fights f ON f.id = ps.fight_id GROUP BY account ORDER BY account COLLATE NOCASE",
      )
      .all(),
  };
}
