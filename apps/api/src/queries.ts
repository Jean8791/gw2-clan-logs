// Consultas da API. Todas aceitam os mesmos filtros (Filters) do pacote compartilhado.
import {
  BATTLE_DAY_SHIFT_HOURS,
  FIGHT_SORT_KEYS,
  STAT_KEYS,
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
  type RankingRow,
} from "@gw2logs/shared";
import { STAT_COL, type DB } from "./db.js";

type Params = Record<string, string | number>;

/** Dia de batalha de uma luta (ver battleDay em shared): data da luta menos 9 horas. */
const BATTLE_DAY = `date(f.time_start, '-${BATTLE_DAY_SHIFT_HOURS} hours')`;

// ---------- Filtros → SQL ----------

/** Condições sobre a luta (tabela f). */
export function fightConditions(fl: Filters, now = new Date()): { where: string[]; params: Params } {
  const where = ["f.status = 'done'"];
  const params: Params = {};
  if (fl.owner !== undefined) (where.push("f.owner_id = @owner"), (params.owner = fl.owner));
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

const FIGHT_COLS = `f.id, f.status, f.error, f.uploaded_at AS uploadedAt, f.uploader, f.file_name AS fileName, f.mode,
  f.fight_name AS fightName, f.map_id AS mapId, f.map_name AS mapName, f.time_start AS timeStart, f.duration_ms AS durationMs,
  f.success, f.recorded_by AS recordedBy, f.squad_count AS squadCount, f.ally_count AS allyCount, f.enemy_count AS enemyCount,
  f.squad_damage AS squadDamage, f.squad_kills AS squadKills, f.squad_downs AS squadDowns, f.squad_deaths AS squadDeaths,
  f.enemy_downs AS enemyDowns, f.enemy_deaths AS enemyDeaths, f.has_report AS hasReport`;

const toFight = (r: any): Fight => ({ ...r, success: !!r.success, hasReport: !!r.hasReport });

const STAT_SELECT = STAT_KEYS.map((k) => `ps.${STAT_COL[k]} AS "${k}"`).join(", ");
const PLAYER_COLS = `ps.fight_id AS fightId, ps.account, ps.name, ps.profession, ps.guild_id AS guildId, ps.grp AS "group",
  ps.commander, ps.role, ps.active_ms AS activeMs, ps.dist_to_com AS distToCom, ${STAT_SELECT}`;
const toPlayer = <T extends PlayerFight>(r: any): T => ({ ...r, commander: !!r.commander });

const AGG_SELECT = `COUNT(*) AS fights, SUM(ps.active_ms) AS activeMs, ${STAT_KEYS.map((k) => `SUM(ps.${STAT_COL[k]}) AS "${k}"`).join(", ")}`;
const toAggregate = (r: any): Aggregate => {
  const a: any = { fights: r?.fights ?? 0, activeMs: r?.activeMs ?? 0 };
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
  up: "COALESCE(f.uploader, '') COLLATE NOCASE",
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
    offset === 0
      ? (db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.status != 'done' AND f.owner_id = ? ORDER BY f.uploaded_at DESC LIMIT 50`).all(fl.owner) as any[])
      : [];
  // f.id desempata: sem isso, lutas com o mesmo valor poderiam repetir ou sumir entre uma página e outra
  const done = db
    .prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE ${where} ORDER BY (${expr}) IS NULL, (${expr}) ${dir}, f.id ${dir} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as any[];
  return [...pending, ...done].map(toFight);
}

export function fightDetail(db: DB, id: string, owner: number): FightDetail | null {
  const fight = db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.id = ? AND f.owner_id = ?`).get(id, owner);
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
  // SQLite: com um único MAX(), as colunas "soltas" vêm da linha da luta mais recente (nome, classe e guilda atuais)
  const rows = db
    .prepare(
      `SELECT ps.account, MAX(f.time_start) AS lastSeen, ps.name, ps.profession, ps.guild_id AS guildId,
              SUM(ps.role = 'support') AS supportFights, ${AGG_SELECT}
       FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
       WHERE ${where}
       GROUP BY ps.account
       ORDER BY "damage" DESC`,
    )
    .all(params) as any[];
  return rows.map((r) => ({ ...toAggregate(r), account: r.account, name: r.name, profession: r.profession, guildId: r.guildId, supportFights: r.supportFights }));
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
 * Tudo dentro do espaço do dono (Filters.owner): o mesmo jogador nos logs de outro usuário não entra.
 */
export function playerOptions(db: DB, account: string, fl: Filters): PlayerOptions | null {
  const inSpace = db.prepare("SELECT 1 FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = ? AND f.owner_id = ? LIMIT 1").get(account, fl.owner);
  if (!inSpace) return null;
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
  // jogador que existe no espaço do dono mas some com os filtros ainda tem perfil (vazio)
  const anyRow = db
    .prepare("SELECT ps.name FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = ? AND f.owner_id = ? LIMIT 1")
    .get(account, fl.owner) as { name: string | null } | undefined;
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

/** Opções dos filtros (mapas, classes, jogadores) que existem nas lutas do dono. */
export function meta(db: DB, owner: number) {
  return {
    maps: db.prepare("SELECT DISTINCT map_id AS id, map_name AS name FROM fights WHERE status='done' AND map_id IS NOT NULL AND owner_id = ? ORDER BY map_name").all(owner),
    professions: (
      db
        .prepare("SELECT DISTINCT ps.profession FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.profession IS NOT NULL AND f.owner_id = ? ORDER BY ps.profession")
        .all(owner) as any[]
    ).map((r) => r.profession),
    players: db
      .prepare(
        "SELECT account, MAX(f.time_start) AS lastSeen, ps.name, ps.profession FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE f.owner_id = ? GROUP BY account ORDER BY account COLLATE NOCASE",
      )
      .all(owner),
  };
}
