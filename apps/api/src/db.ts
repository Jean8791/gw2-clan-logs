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
export const SCHEMA_VERSION = 5;

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
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      public_id  TEXT NOT NULL UNIQUE,        -- vai na URL de compartilhar (não é o id do Discord)
      discord_id TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      avatar     TEXT,
      created_at TEXT NOT NULL
    );

    -- kind: web (cookie do navegador, expira) | api (token pessoal do script de envio, um por usuário)
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fights (
      id            TEXT PRIMARY KEY,
      sha256        TEXT NOT NULL,            -- único por dono (índice ux_fights_owner_sha), não no banco todo
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
      enemy_downs   INTEGER,                  -- inimigos caídos na luta toda (de quem for o crédito)
      enemy_deaths  INTEGER,                  -- inimigos mortos na luta toda (de quem for o crédito)
      ei_version    TEXT,
      has_report    INTEGER NOT NULL DEFAULT 0,
      process_ms    INTEGER                   -- tempo total do processamento (EI + gravação); vazio nas lutas copiadas e nas antigas
    );

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

  // CREATE TABLE IF NOT EXISTS não mexe numa tabela que já existe: métricas novas precisam de ALTER TABLE.
  // Os nomes das colunas vêm de STAT_KEYS (código), nunca de entrada do usuário.
  const have = new Set((db.pragma("table_info(player_stats)") as { name: string }[]).map((c) => c.name));
  for (const k of STAT_KEYS) {
    if (!have.has(STAT_COL[k])) db.exec(`ALTER TABLE player_stats ADD COLUMN ${STAT_COL[k]} REAL NOT NULL DEFAULT 0`);
  }
  const haveFights = new Set((db.pragma("table_info(fights)") as { name: string }[]).map((c) => c.name));
  for (const col of ["enemy_downs", "enemy_deaths"]) {
    if (!haveFights.has(col)) db.exec(`ALTER TABLE fights ADD COLUMN ${col} INTEGER`);
  }
  if (!haveFights.has("process_ms")) db.exec("ALTER TABLE fights ADD COLUMN process_ms INTEGER");
  // dono da luta; as lutas anteriores ao login ficam sem dono até o primeiro usuário entrar
  if (!haveFights.has("owner_id")) db.exec("ALTER TABLE fights ADD COLUMN owner_id INTEGER REFERENCES users(id)");
  // última vez que o login conferiu o Discord (listas de usuários e servidores); quem já existe começa a contar da migração
  const haveUsers = new Set((db.pragma("table_info(users)") as { name: string }[]).map((c) => c.name));
  if (!haveUsers.has("verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN verified_at TEXT");
    db.prepare("UPDATE users SET verified_at = ?").run(new Date().toISOString());
  }
  dropGlobalShaUnique(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_fights_time ON fights(time_start);
    CREATE INDEX IF NOT EXISTS ix_fights_map_time ON fights(map_id, time_start);
    CREATE INDEX IF NOT EXISTS ix_fights_owner ON fights(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fights_owner_sha ON fights(owner_id, sha256);
  `);
}

/**
 * Bancos antigos têm `sha256 UNIQUE` no banco todo: o log que um usuário enviou impedia os outros de enviar o mesmo.
 * O SQLite não remove essa restrição com ALTER, então a tabela é refeita (roteiro oficial: sqlite.org/lang_altertable.html, item 7).
 */
function dropGlobalShaUnique(db: DB) {
  const shaOnly = (db.pragma("index_list(fights)") as { name: string; unique: number; origin: string }[]).some(
    (i) => i.unique && i.origin === "u" && (db.pragma(`index_info(${i.name})`) as unknown[]).length === 1,
  );
  if (!shaOnly) return;
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fights'").get() as { sql: string };
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(sql.replace("CREATE TABLE fights", "CREATE TABLE fights_novo").replace(/(sha256\s+TEXT NOT NULL)\s+UNIQUE/, "$1"));
      db.exec("INSERT INTO fights_novo SELECT * FROM fights");
      db.exec("DROP TABLE fights");
      db.exec("ALTER TABLE fights_novo RENAME TO fights");
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Migração do índice de sha256 deixou referências quebradas.");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export const schemaVersion = (db: DB): number => db.pragma("user_version", { simple: true }) as number;
export const setSchemaVersion = (db: DB, v: number) => db.pragma(`user_version = ${Math.trunc(v)}`);
