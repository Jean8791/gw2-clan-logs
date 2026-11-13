import Database from "better-sqlite3";
import { STAT_KEYS, type StatKey } from "@gw2logs/shared";

export type DB = Database.Database;

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Coluna SQL de cada métrica (damage → damage, stabOut → stab_out). */
export const STAT_COL: Record<StatKey, string> = Object.fromEntries(STAT_KEYS.map((k) => [k, snake(k)])) as Record<StatKey, string>;

/**
 * Versão do esquema. Ao mudar a extração (ingest.ts) ou as colunas, suba o número:
 * as lutas são reprocessadas a partir do JSON guardado (npm run reingest), sem reenviar logs.
 */
export const SCHEMA_VERSION = 1;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const statCols = STAT_KEYS.map((k) => `${STAT_COL[k]} REAL NOT NULL DEFAULT 0`).join(",\n      ");
  db.exec(`
    CREATE TABLE IF NOT EXISTS fights (
      id            TEXT PRIMARY KEY,
      sha256        TEXT NOT NULL UNIQUE,
      status        TEXT NOT NULL,            -- queued | parsing | done | error
      error         TEXT,
      uploaded_at   TEXT NOT NULL,
      uploader      TEXT,
      file_name     TEXT,
      mode          TEXT,                     -- wvw | pve
      fight_name    TEXT,
      map_id        INTEGER,
      map_name      TEXT,
      time_start    TEXT,                     -- ISO-8601 UTC
      duration_ms   INTEGER,
      success       INTEGER NOT NULL DEFAULT 0,
      recorded_by   TEXT,
      squad_count   INTEGER,
      ally_count    INTEGER,
      enemy_count   INTEGER,
      squad_damage  REAL,
      squad_kills   INTEGER,
      squad_downs   INTEGER,
      squad_deaths  INTEGER,
      ei_version    TEXT,
      has_report    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_fights_time ON fights(time_start);

    CREATE TABLE IF NOT EXISTS player_stats (
      fight_id      TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
      account       TEXT NOT NULL,
      name          TEXT,
      profession    TEXT,
      guild_id      TEXT,
      grp           INTEGER,
      commander     INTEGER NOT NULL DEFAULT 0,
      role          TEXT NOT NULL DEFAULT 'dps',
      active_ms     INTEGER NOT NULL DEFAULT 0,
      dist_to_com   REAL,
      ${statCols},
      PRIMARY KEY (fight_id, account)
    );
    CREATE INDEX IF NOT EXISTS ix_ps_account ON player_stats(account);
    CREATE INDEX IF NOT EXISTS ix_ps_guild ON player_stats(guild_id);

    CREATE TABLE IF NOT EXISTS guilds (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      tag         TEXT,
      in_alliance INTEGER NOT NULL DEFAULT 0,
      fetched_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS maps (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

    -- dano por habilidade de cada jogador em cada luta (some com a luta, pela retenção)
    CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE IF NOT EXISTS player_skills (
      fight_id       TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
      account        TEXT NOT NULL,
      skill_id       INTEGER NOT NULL,
      damage         REAL NOT NULL,
      hits           INTEGER NOT NULL,
      connected_hits INTEGER NOT NULL,
      PRIMARY KEY (fight_id, account, skill_id)
    );
    CREATE INDEX IF NOT EXISTS ix_pskills_account ON player_skills(account);

    -- ícones baixados uma vez (chave ex.: "buff:1122"); não são apagados com as lutas antigas
    CREATE TABLE IF NOT EXISTS media (
      key          TEXT PRIMARY KEY,
      source_url   TEXT NOT NULL,
      content_type TEXT NOT NULL,
      bytes        BLOB NOT NULL,
      sha256       TEXT NOT NULL,
      fetched_at   TEXT NOT NULL
    );
  `);
}

export const schemaVersion = (db: DB): number => db.pragma("user_version", { simple: true }) as number;
export const setSchemaVersion = (db: DB, v: number) => db.pragma(`user_version = ${Math.trunc(v)}`);
