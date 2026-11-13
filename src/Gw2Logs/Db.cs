using Microsoft.Data.Sqlite;

namespace Gw2Logs;

/// <summary>SQLite storage: one row per fight, one row per squad player per fight.</summary>
public sealed class Db
{
    private readonly string _cs;

    public Db(string path)
    {
        _cs = new SqliteConnectionStringBuilder { DataSource = path, Cache = SqliteCacheMode.Shared }.ToString();
        using var c = Open();
        Exec(c, """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS fights (
              id            TEXT PRIMARY KEY,
              sha256        TEXT NOT NULL UNIQUE,
              status        TEXT NOT NULL,          -- queued | parsing | done | error
              error         TEXT,
              uploaded_at   TEXT NOT NULL,
              uploader      TEXT,
              file_name     TEXT,
              mode          TEXT,                   -- wvw | pve
              fight_name    TEXT,
              fight_icon    TEXT,
              map_id        INTEGER,
              time_start    TEXT,                   -- ISO-8601 (from timeStartStd)
              duration_ms   INTEGER,
              success       INTEGER,
              is_cm         INTEGER,
              recorded_by   TEXT,
              squad_count   INTEGER,
              enemy_count   INTEGER,
              squad_dps     INTEGER,
              squad_damage  INTEGER,
              squad_kills   INTEGER,
              squad_downs   INTEGER,
              squad_deaths  INTEGER,
              ei_version    TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_fights_time ON fights(time_start);
            CREATE TABLE IF NOT EXISTS player_stats (
              fight_id      TEXT NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
              account       TEXT NOT NULL,
              name          TEXT,
              profession    TEXT,
              grp           INTEGER,
              commander     INTEGER,
              active_ms     INTEGER,
              damage        INTEGER, dps INTEGER, power_dps INTEGER, condi_dps INTEGER,
              down_contrib  INTEGER,
              kills         INTEGER, downs INTEGER,
              strips        INTEGER, cleanses INTEGER, resurrects INTEGER, stun_breaks INTEGER,
              healing       INTEGER, barrier INTEGER,
              damage_taken  INTEGER, deaths INTEGER, times_downed INTEGER, dodges INTEGER, blocked INTEGER,
              dist_to_com   REAL,
              stab_gen REAL, quick_gen REAL, alac_gen REAL, prot_gen REAL, might_gen REAL,
              aegis_gen REAL, resist_gen REAL, resol_gen REAL, fury_gen REAL, superspeed_gen REAL,
              PRIMARY KEY (fight_id, account)
            );
            CREATE INDEX IF NOT EXISTS ix_ps_account ON player_stats(account);
            CREATE TABLE IF NOT EXISTS maps (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            """);
        AddColumnIfMissing(c, "fights", "map_name", "TEXT");
    }

    private static void AddColumnIfMissing(SqliteConnection c, string table, string column, string type)
    {
        using var cmd = Cmd(c, $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name=$n", ("$n", column));
        if (Convert.ToInt64(cmd.ExecuteScalar()) == 0) Exec(c, $"ALTER TABLE {table} ADD COLUMN {column} {type}");
    }

    /// <summary>Versão da extração de dados gravada no banco (PRAGMA user_version).</summary>
    public long IngestVersion
    {
        get { using var c = Open(); using var cmd = Cmd(c, "PRAGMA user_version"); return Convert.ToInt64(cmd.ExecuteScalar()); }
        set { using var c = Open(); Exec(c, $"PRAGMA user_version={value}"); }
    }

    public SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        Exec(c, "PRAGMA foreign_keys=ON;");
        return c;
    }

    public static void Exec(SqliteConnection c, string sql, params (string, object?)[] p)
    {
        using var cmd = Cmd(c, sql, p);
        cmd.ExecuteNonQuery();
    }

    public static SqliteCommand Cmd(SqliteConnection c, string sql, params (string, object?)[] p)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in p) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return cmd;
    }

    /// <summary>Runs a query and returns rows as dictionaries (column name → value), ready for JSON.</summary>
    public List<Dictionary<string, object?>> Query(string sql, params (string, object?)[] p)
    {
        using var c = Open();
        using var cmd = Cmd(c, sql, p);
        using var r = cmd.ExecuteReader();
        var rows = new List<Dictionary<string, object?>>();
        while (r.Read())
        {
            var row = new Dictionary<string, object?>(r.FieldCount);
            for (int i = 0; i < r.FieldCount; i++) row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }
}
