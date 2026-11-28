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
      dist_cover_ms REAL NOT NULL DEFAULT 0,   -- tempo (ms) que o dado da tag cobre: 0 nos logs lidos sem replay
      near_cover_ms REAL NOT NULL DEFAULT 0,   -- idem, para o tempo perto da tag (precisa das posições)
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

    -- cura e barreira por habilidade de cada jogador em cada luta (Healing Stats; some com a luta, pela retenção).
    -- kind: heal | barrier; indirect: 1 quando skill_id é de um buff (o nome está na mesma tabela skills)
    CREATE TABLE IF NOT EXISTS player_support_skills (
      fight_id      TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
      account       TEXT NOT NULL,
      skill_id      INTEGER NOT NULL,
      kind          TEXT NOT NULL,
      amount        REAL NOT NULL,
      downed_amount REAL NOT NULL,
      hits          INTEGER NOT NULL,
      indirect      INTEGER NOT NULL,
      PRIMARY KEY (fight_id, account, skill_id, kind, indirect)
    );
    CREATE INDEX IF NOT EXISTS ix_psupskills_account ON player_support_skills(account);

    -- usos de cada habilidade (rotação) e dano recebido por habilidade, de cada jogador em cada luta (some com a luta, pela retenção).
    -- kind: cast (amount = usos) | taken (amount = dano recebido); indirect: 1 quando skill_id é de um buff (condição)
    CREATE TABLE IF NOT EXISTS player_skill_usage (
      fight_id TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
      account  TEXT NOT NULL,
      skill_id INTEGER NOT NULL,
      kind     TEXT NOT NULL,
      amount   REAL NOT NULL,
      hits     INTEGER NOT NULL,
      indirect INTEGER NOT NULL,
      PRIMARY KEY (fight_id, account, skill_id, kind, indirect)
    );
    CREATE INDEX IF NOT EXISTS ix_pskillusage_account ON player_skill_usage(account);

    -- resumo de cada dia de batalha, guardado antes de a retenção apagar as lutas (ver archive.ts). Uma linha por jogador, classe, função e guilda.
    -- As métricas são somas, para a soma de vários dias dar o mesmo valor do Ranking; o boon em volume guarda Σ(valor × active_ms).
    -- profession e guild_id são '' quando não há (uma chave composta não trata dois NULL como iguais).
    CREATE TABLE IF NOT EXISTS day_stats (
      day           TEXT NOT NULL,
      mode          TEXT NOT NULL,
      account       TEXT NOT NULL,
      profession    TEXT NOT NULL,
      role          TEXT NOT NULL,
      guild_id      TEXT NOT NULL,
      name          TEXT,
      last_seen     TEXT,
      fights        INTEGER NOT NULL DEFAULT 0,
      active_ms     INTEGER NOT NULL DEFAULT 0,
      dist_cover_ms REAL NOT NULL DEFAULT 0,
      near_cover_ms REAL NOT NULL DEFAULT 0,
      ${statCols},
      PRIMARY KEY (day, mode, account, profession, role, guild_id)
    );
    -- signature: quais lutas o dia tinha quando foi resumido (muda quando entra, sai ou troca uma luta); frozen: a retenção já o alcançou
    CREATE TABLE IF NOT EXISTS day_snapshots (
      day       TEXT PRIMARY KEY,
      built_at  TEXT NOT NULL,
      signature TEXT NOT NULL,
      frozen    INTEGER NOT NULL DEFAULT 0
    );

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
  let addedGroupUptime = false;
  for (const k of STAT_KEYS) {
    if (have.has(STAT_COL[k])) continue;
    db.exec(`ALTER TABLE player_stats ADD COLUMN ${STAT_COL[k]} REAL NOT NULL DEFAULT 0`);
    if (k.endsWith("GroupUp")) addedGroupUptime = true;
  }
  for (const col of ["dist_cover_ms", "near_cover_ms"]) {
    if (!have.has(col)) db.exec(`ALTER TABLE player_stats ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`);
  }
  // o resumo diário tem as mesmas colunas de métrica: métrica nova entra nas duas tabelas
  const haveDay = new Set((db.pragma("table_info(day_stats)") as { name: string }[]).map((c) => c.name));
  for (const k of STAT_KEYS) {
    if (!haveDay.has(STAT_COL[k])) db.exec(`ALTER TABLE day_stats ADD COLUMN ${STAT_COL[k]} REAL NOT NULL DEFAULT 0`);
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
  if (addedGroupUptime) backfillGroupUptime(db);
  dropGlobalShaUnique(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_fights_time ON fights(time_start);
    CREATE INDEX IF NOT EXISTS ix_fights_map_time ON fights(map_id, time_start);
    CREATE INDEX IF NOT EXISTS ix_fights_owner ON fights(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fights_owner_sha ON fights(owner_id, sha256);
  `);
}

/**
 * O uptime no grupo (`<boon>GroupUp`) sai do uptime e do grupo de cada jogador, que já estavam no banco: as lutas anteriores à métrica são
 * preenchidas uma vez, quando as colunas nascem. Os dias ainda abertos do resumo diário são refeitos com a métrica; os congelados não (as
 * lutas deles já foram apagadas). A conta é a mesma de ingest.ts: Σ uptime do grupo ÷ Σ tempo ativo do grupo × tempo ativo do jogador.
 */
function backfillGroupUptime(db: DB) {
  const pairs = STAT_KEYS.filter((k) => k.endsWith("GroupUp")).map((k) => ({ up: STAT_COL[k.replace("GroupUp", "Up") as StatKey], groupUp: STAT_COL[k] }));
  db.transaction(() => {
    db.exec(
      `CREATE TEMP TABLE grupo_uptime AS SELECT fight_id, grp, SUM(active_ms) AS active, ${pairs.map((p) => `SUM(${p.up}) AS ${p.up}`).join(", ")}
       FROM player_stats WHERE grp IS NOT NULL GROUP BY fight_id, grp`,
    );
    db.exec(
      `UPDATE player_stats SET ${pairs.map((p) => `${p.groupUp} = g.${p.up} * 1.0 / g.active * player_stats.active_ms`).join(", ")}
       FROM grupo_uptime g WHERE g.fight_id = player_stats.fight_id AND g.grp = player_stats.grp AND g.active > 0`,
    );
    db.exec("DROP TABLE grupo_uptime");
    db.exec("DELETE FROM day_snapshots WHERE frozen = 0");
  })();
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
