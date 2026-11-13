// Consultas da API. Todas aceitam os mesmos filtros (Filters) do pacote compartilhado.
import {
  STAT_KEYS,
  type Aggregate,
  type Fight,
  type FightDetail,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerFight,
  type PlayerProfile,
  type PlayerSkill,
  type RankingRow,
} from "@gw2logs/shared";
import { STAT_COL, type DB } from "./db.js";

type Params = Record<string, string | number>;

// ---------- Filtros → SQL ----------

/** Condições sobre a luta (tabela f). */
export function fightConditions(fl: Filters, now = new Date()): { where: string[]; params: Params } {
  const where = ["f.status = 'done'"];
  const params: Params = {};
  if (fl.mode) (where.push("f.mode = @mode"), (params.mode = fl.mode));
  if (fl.days) (where.push("f.time_start >= @since"), (params.since = new Date(now.getTime() - fl.days * 86_400_000).toISOString()));
  if (fl.from) (where.push("f.time_start >= @from"), (params.from = `${fl.from}T00:00:00.000Z`));
  if (fl.to) (where.push("f.time_start < @to"), (params.to = new Date(Date.parse(`${fl.to}T00:00:00.000Z`) + 86_400_000).toISOString()));
  if (fl.map) (where.push("f.map_id = @map"), (params.map = fl.map));
  if (fl.minSquad) (where.push("f.squad_count >= @minSquad"), (params.minSquad = fl.minSquad));
  if (fl.maxSquad) (where.push("f.squad_count <= @maxSquad"), (params.maxSquad = fl.maxSquad));
  if (fl.minEnemies) (where.push("f.enemy_count >= @minEnemies"), (params.minEnemies = fl.minEnemies));
  if (fl.minDurationSec) (where.push("f.duration_ms >= @minDur"), (params.minDur = fl.minDurationSec * 1000));
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
  f.has_report AS hasReport`;

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

export function listFights(db: DB, fl: Filters, limit = 50, offset = 0): Fight[] {
  const f = fightConditions(fl);
  const p = playerConditions(fl);
  const where = [...f.where];
  if (p.where.length) where.push(`EXISTS (SELECT 1 FROM player_stats ps WHERE ps.fight_id = f.id AND ${p.where.join(" AND ")})`);
  // lutas ainda na fila ou com erro aparecem sempre no topo da primeira página
  const pending = offset === 0 ? (db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.status != 'done' ORDER BY f.uploaded_at DESC LIMIT 50`).all() as any[]) : [];
  const done = db
    .prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE ${where.join(" AND ")} ORDER BY f.time_start DESC LIMIT @limit OFFSET @offset`)
    .all({ ...f.params, ...p.params, limit, offset }) as any[];
  return [...pending, ...done].map(toFight);
}

export function fightDetail(db: DB, id: string): FightDetail | null {
  const fight = db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE f.id = ?`).get(id);
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
  const exists = history.length > 0 || db.prepare("SELECT 1 FROM player_stats WHERE account = ? LIMIT 1").get(account);
  if (!exists) return null;
  const totals = toAggregate(db.prepare(`SELECT ${AGG_SELECT} FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ${where}`).get(p));
  const professions = db
    .prepare(`SELECT ps.profession, COUNT(*) AS fights FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ${where} GROUP BY ps.profession ORDER BY fights DESC`)
    .all(p) as { profession: string; fights: number }[];
  const guilds = db
    .prepare(`SELECT ps.guild_id AS guildId, COUNT(*) AS fights FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ps.account = @account AND ps.guild_id IS NOT NULL AND ${where} GROUP BY ps.guild_id ORDER BY fights DESC`)
    .all(p) as { guildId: string; fights: number }[];
  const last = history.at(-1) ?? (db.prepare("SELECT name FROM player_stats WHERE account = ? LIMIT 1").get(account) as any);
  return { account, name: last?.name ?? null, totals, history, professions, guilds };
}

export function guildSummaries(db: DB, fl: Filters = {}): GuildSummary[] {
  const f = fightConditions(fl);
  return (
    db
      .prepare(
        `SELECT g.id, g.name, g.tag, g.in_alliance AS inAlliance,
                COUNT(DISTINCT ps.account) AS players, COUNT(DISTINCT ps.fight_id) AS fights, MAX(f.time_start) AS lastSeen
         FROM guilds g
         LEFT JOIN player_stats ps ON ps.guild_id = g.id
         LEFT JOIN fights f ON f.id = ps.fight_id AND ${f.where.join(" AND ")}
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
      `SELECT COUNT(*) AS fights, COALESCE(SUM(duration_ms),0) AS durationMs, COALESCE(SUM(squad_kills),0) AS kills,
              COALESCE(SUM(squad_deaths),0) AS deaths, MIN(time_start) AS first, MAX(time_start) AS last
       FROM fights f WHERE ${w}`,
    )
    .get(params) as any;
  const players = (db.prepare(`SELECT COUNT(DISTINCT ps.account) AS n FROM player_stats ps JOIN fights f ON f.id = ps.fight_id WHERE ${w}`).get(params) as any).n;
  const recent = (db.prepare(`SELECT ${FIGHT_COLS} FROM fights f WHERE ${w} ORDER BY f.time_start DESC LIMIT 8`).all(params) as any[]).map(toFight);
  return { ...t, players, recent };
}

export function meta(db: DB) {
  return {
    maps: db.prepare("SELECT DISTINCT map_id AS id, map_name AS name FROM fights WHERE status='done' AND map_id IS NOT NULL ORDER BY map_name").all(),
    professions: (db.prepare("SELECT DISTINCT profession FROM player_stats WHERE profession IS NOT NULL ORDER BY profession").all() as any[]).map((r) => r.profession),
    players: db
      .prepare("SELECT account, MAX(f.time_start) AS lastSeen, ps.name, ps.profession FROM player_stats ps JOIN fights f ON f.id = ps.fight_id GROUP BY account ORDER BY account COLLATE NOCASE")
      .all(),
  };
}
