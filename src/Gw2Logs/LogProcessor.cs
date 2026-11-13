using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Threading.Channels;

namespace Gw2Logs;

public sealed record AppPaths(string Data, string EiDir)
{
    public string Uploads => Path.Combine(Data, "uploads");
    public string Fights => Path.Combine(Data, "fights");
    public string FightDir(string id) => Path.Combine(Fights, id);
}

/// <summary>Background worker: takes uploaded logs from a queue, runs Elite Insights on them, stores the results.</summary>
public sealed class LogProcessor : BackgroundService
{
    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>();
    private readonly Db _db;
    private readonly AppPaths _paths;
    private readonly ILogger<LogProcessor> _log;
    private readonly MapNames _maps;

    /// <summary>
    /// Suba este número sempre que a extração (Ingest) mudar: ao iniciar, as lutas já salvas
    /// são reprocessadas a partir do JSON guardado, sem precisar reenviar os logs.
    /// </summary>
    private const int IngestVersion = 2;

    // Boon ids (GW2 API buff ids) whose squad generation we keep per player.
    private static readonly (int Id, string Col)[] Boons =
    [
        (1122, "stab_gen"), (1187, "quick_gen"), (30328, "alac_gen"), (717, "prot_gen"), (740, "might_gen"),
        (743, "aegis_gen"), (26980, "resist_gen"), (873, "resol_gen"), (725, "fury_gen"), (5974, "superspeed_gen"),
    ];

    public LogProcessor(Db db, AppPaths paths, MapNames maps, ILogger<LogProcessor> log)
    {
        _db = db; _paths = paths; _maps = maps; _log = log;
    }

    public void Enqueue(string fightId) => _queue.Writer.TryWrite(fightId);

    private async Task ReingestOutdatedAsync(CancellationToken ct)
    {
        if (_db.IngestVersion >= IngestVersion) return;
        var ids = _db.Query("SELECT id FROM fights WHERE status='done'").Select(r => (string)r["id"]!).ToList();
        int ok = 0;
        foreach (var id in ids)
        {
            var gz = Path.Combine(_paths.FightDir(id), "ei.json.gz");
            if (!File.Exists(gz)) continue;
            try
            {
                await using var fs = File.OpenRead(gz);
                await using var z = new GZipStream(fs, CompressionMode.Decompress);
                using var ms = new MemoryStream();
                await z.CopyToAsync(ms, ct);
                await IngestBytesAsync(id, ms.ToArray(), ct);
                ok++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Falha ao reprocessar {Id}", id); }
        }
        _db.IngestVersion = IngestVersion;
        _log.LogInformation("Reprocessadas {Ok} de {Total} lutas (versão de extração {V}).", ok, ids.Count, IngestVersion);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await ReingestOutdatedAsync(ct);

        // Re-queue anything left unfinished by a previous run.
        foreach (var row in _db.Query("SELECT id FROM fights WHERE status IN ('queued','parsing') ORDER BY uploaded_at"))
            Enqueue((string)row["id"]!);

        await foreach (var id in _queue.Reader.ReadAllAsync(ct))
        {
            try
            {
                SetStatus(id, "parsing", null);
                await ProcessAsync(id, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Falha ao processar {Id}", id);
                SetStatus(id, "error", ex.Message.Length > 500 ? ex.Message[..500] : ex.Message);
            }
        }
    }

    private void SetStatus(string id, string status, string? error)
    {
        using var c = _db.Open();
        Db.Exec(c, "UPDATE fights SET status=$s, error=$e WHERE id=$id", ("$s", status), ("$e", error), ("$id", id));
    }

    private async Task ProcessAsync(string id, CancellationToken ct)
    {
        var src = Directory.GetFiles(_paths.Uploads, id + ".*").FirstOrDefault()
                  ?? throw new FileNotFoundException("Arquivo do log não encontrado.");
        var outDir = _paths.FightDir(id);
        var work = Path.Combine(outDir, "work");
        Directory.CreateDirectory(work);

        string json; string? html = null;
        if (src.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            // JSON já processado pelo Elite Insights (ex.: baixado do dps.report): não precisa rodar o parser.
            json = Path.Combine(work, "ei.json");
            File.Copy(src, json, true);
        }
        else
        {
            var reason = await RunEliteInsightsAsync(src, work, ct);
            json = Directory.GetFiles(work, "*.json").FirstOrDefault()
                   ?? throw new InvalidOperationException("O Elite Insights não conseguiu ler este log" + (reason != null ? $": {reason}" : " (muito curto, corrompido ou versão não suportada)."));
            html = Directory.GetFiles(work, "*.html").FirstOrDefault();
        }

        await IngestBytesAsync(id, await File.ReadAllBytesAsync(json, ct), ct);

        // Keep a gzipped copy of the full EI JSON (for future features) and the EI HTML report.
        await using (var inFs = File.OpenRead(json))
        await using (var outFs = File.Create(Path.Combine(outDir, "ei.json.gz")))
        await using (var gz = new GZipStream(outFs, CompressionLevel.Optimal))
            await inFs.CopyToAsync(gz, ct);
        if (html != null) File.Move(html, Path.Combine(outDir, "report.html"), true);
        Directory.Delete(work, true);
    }

    /// <summary>Runs the EI CLI. Returns EI's failure reason when it reports one (null otherwise).</summary>
    private async Task<string?> RunEliteInsightsAsync(string logFile, string outDir, CancellationToken ct)
    {
        var conf = Path.Combine(outDir, "ei.conf");
        await File.WriteAllLinesAsync(conf,
        [
            "SaveAtOut=false", $"OutLocation={outDir}",
            "SaveOutHTML=true", "SaveOutJSON=true", "SaveOutCSV=false", "IndentJSON=false", "CompressRaw=false",
            "ParsePhases=true", "ParseCombatReplay=true", "DetailledWvW=true", "ComputeDamageModifiers=true",
            "RawTimelineArrays=true", "HtmlExternalScripts=false", "SkipFailedTries=false",
            "UploadToDPSReports=false", "UploadToWingman=false", "SaveOutTrace=false",
            "SingleThreaded=false", "AddPoVProf=false", "AddDuration=false",
        ], ct);

        var dll = Path.Combine(_paths.EiDir, "GuildWars2EliteInsights-CLI.dll");
        if (!File.Exists(dll)) throw new FileNotFoundException("Elite Insights não encontrado em " + _paths.EiDir);

        var psi = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
            WorkingDirectory = _paths.EiDir,
        };
        foreach (var a in new[] { dll, "-c", conf, logFile }) psi.ArgumentList.Add(a);

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Não foi possível iniciar o Elite Insights.");
        var stdout = p.StandardOutput.ReadToEndAsync(ct);
        var stderr = p.StandardError.ReadToEndAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        try { await p.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch { } throw new TimeoutException("Elite Insights demorou mais de 5 minutos."); }
        var output = await stdout;
        _log.LogInformation("EI saída ({Code}): {Out} {Err}", p.ExitCode, output.Trim(), (await stderr).Trim());

        // EI prints one line per log: "Processed - {json}" with parsed/status fields.
        var line = output.Split('\n').FirstOrDefault(l => l.StartsWith("Processed - "));
        if (line == null) return null;
        try
        {
            using var d = JsonDocument.Parse(line["Processed - ".Length..]);
            return d.RootElement.TryGetProperty("parsed", out var ok) && ok.ValueKind == JsonValueKind.False ? Str(d.RootElement, "status") : null;
        }
        catch (JsonException) { return null; }
    }

    // ---------- JSON → banco ----------

    private async Task IngestBytesAsync(string id, byte[] bytes, CancellationToken ct)
    {
        var body = bytes.AsMemory();
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) body = body[3..]; // UTF-8 BOM
        using var doc = JsonDocument.Parse(body);
        var mapName = await _maps.GetAsync(Int(doc.RootElement, "mapID"), ct);
        Ingest(id, doc.RootElement, mapName);
    }

    private void Ingest(string id, JsonElement r, string? mapName)
    {
        var fightName = Str(r, "fightName") ?? Str(r, "name") ?? "?";
        bool wvw = Int(r, "triggerID") == 1
                   || (r.TryGetProperty("wvWMapData", out var wm) && wm.ValueKind == JsonValueKind.Object)
                   || fightName.Contains("World vs World", StringComparison.OrdinalIgnoreCase)
                   || fightName.Contains("WvW", StringComparison.OrdinalIgnoreCase);
        // Em WvW o Elite Insights dá um nome genérico ("Detailed WvW"); o mapa diz muito mais.
        if (wvw) fightName = mapName ?? "WvW";

        var squad = Arr(r, "players")
            .Where(p => !Bool(p, "notInSquad") && !Bool(p, "friendlyNPC") && !Bool(p, "isFake"))
            .ToList();

        int enemies = Arr(r, "targets").Count(t => Bool(t, "enemyPlayer"));
        long durationMs = Long(r, "durationMS");

        using var c = _db.Open();
        using var tx = c.BeginTransaction();
        Db.Exec(c, "DELETE FROM player_stats WHERE fight_id=$id", ("$id", id));

        long tDmg = 0, tKills = 0, tDowns = 0, tDeaths = 0;
        foreach (var p in squad)
        {
            var dps = Phase0(p, "dpsAll");
            var stats = Phase0(p, "statsAll");
            var def = Phase0(p, "defenses");
            var sup = Phase0(p, "support");
            var heal = p.TryGetProperty("extHealingStats", out var eh) && eh.ValueKind == JsonValueKind.Object ? Phase0(eh, "outgoingHealing") : default;
            var bar = p.TryGetProperty("extBarrierStats", out var eb) && eb.ValueKind == JsonValueKind.Object ? Phase0(eb, "outgoingBarrier") : default;

            // In WvW the relevant damage is against enemy players; dpsAll includes everything (also NPCs/structures).
            long damage = Long(dps, "damage");
            long kills = Long(stats, "killed"), downs = Long(stats, "downed"), deaths = Long(def, "deadCount");
            tDmg += damage; tKills += kills; tDowns += downs; tDeaths += deaths;

            var boonGen = Boons.ToDictionary(b => b.Col, _ => (double?)null);
            foreach (var sb in Arr(p, "squadBuffs"))
            {
                int bid = Int(sb, "id");
                var match = Boons.FirstOrDefault(b => b.Id == bid);
                if (match.Col == null) continue;
                var bd = Arr(sb, "buffData").FirstOrDefault();
                if (bd.ValueKind == JsonValueKind.Object) boonGen[match.Col] = Dbl(bd, "generation");
            }

            long activeMs = Arr(p, "activeTimes").Select(a => a.ValueKind == JsonValueKind.Number ? a.GetInt64() : 0).FirstOrDefault();
            var acct = Str(p, "account") ?? Str(p, "name") ?? "?";

            var cols = new List<(string, object?)>
            {
                ("$fight_id", id), ("$account", acct), ("$name", Str(p, "name")), ("$profession", Str(p, "profession")),
                ("$grp", Int(p, "group")), ("$commander", Bool(p, "hasCommanderTag") ? 1 : 0), ("$active_ms", activeMs),
                ("$damage", damage), ("$dps", Long(dps, "dps")), ("$power_dps", Long(dps, "powerDps")), ("$condi_dps", Long(dps, "condiDps")),
                ("$down_contrib", Long(stats, "downContribution")), ("$kills", kills), ("$downs", downs),
                ("$strips", Long(sup, "boonStrips")), ("$cleanses", Long(sup, "condiCleanse") + Long(sup, "condiCleanseSelf")),
                ("$resurrects", Long(sup, "resurrects")), ("$stun_breaks", Long(sup, "stunBreak")),
                ("$healing", Long(heal, "healing")), ("$barrier", Long(bar, "barrier")),
                ("$damage_taken", Long(def, "damageTaken")), ("$deaths", deaths), ("$times_downed", Long(def, "downCount")),
                ("$dodges", Long(def, "dodgeCount")), ("$blocked", Long(def, "blockedCount")),
                ("$dist_to_com", Dbl(stats, "distToCom")),
            };
            cols.AddRange(boonGen.Select(kv => ("$" + kv.Key, (object?)kv.Value)));
            var names = string.Join(",", cols.Select(x => x.Item1[1..]));
            var vals = string.Join(",", cols.Select(x => x.Item1));
            Db.Exec(c, $"INSERT OR REPLACE INTO player_stats ({names}) VALUES ({vals})", cols.ToArray());
        }

        Db.Exec(c, """
            UPDATE fights SET status='done', error=NULL, mode=$mode, fight_name=$fn, fight_icon=$icon, map_id=$map, map_name=$mapn,
              time_start=$ts, duration_ms=$dur, success=$ok, is_cm=$cm, recorded_by=$rec, squad_count=$sc, enemy_count=$ec,
              squad_dps=$sdps, squad_damage=$sdmg, squad_kills=$sk, squad_downs=$sd, squad_deaths=$sde, ei_version=$ei
            WHERE id=$id
            """,
            ("$mode", wvw ? "wvw" : "pve"), ("$fn", fightName), ("$icon", Str(r, "fightIcon") ?? Str(r, "icon")),
            ("$map", Int(r, "mapID")), ("$mapn", mapName), ("$ts", ParseTime(Str(r, "timeStartStd"))), ("$dur", durationMs),
            ("$ok", Bool(r, "success") ? 1 : 0), ("$cm", Bool(r, "isCM") ? 1 : 0), ("$rec", Str(r, "recordedAccountBy") ?? Str(r, "recordedBy")),
            ("$sc", squad.Count), ("$ec", enemies), ("$sdps", durationMs > 0 ? tDmg * 1000 / durationMs : 0), ("$sdmg", tDmg),
            ("$sk", tKills), ("$sd", tDowns), ("$sde", tDeaths), ("$ei", Str(r, "eliteInsightsVersion")), ("$id", id));
        tx.Commit();
    }

    private static string? ParseTime(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        string[] fmts = ["yyyy-MM-dd HH:mm:ss zzz", "yyyy-MM-dd HH:mm:ss zz", "yyyy-MM-dd HH:mm:ss"];
        return DateTimeOffset.TryParseExact(s, fmts, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d)
               || DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out d)
            ? d.UtcDateTime.ToString("o") : null;
    }

    // ---------- helpers tolerantes a campos ausentes ----------
    private static JsonElement Phase0(JsonElement o, string prop)
    {
        foreach (var e in Arr(o, prop)) return e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().FirstOrDefault() : e;
        return default;
    }
    private static IEnumerable<JsonElement> Arr(JsonElement o, string prop) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(prop, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : [];
    private static string? Str(JsonElement o, string p) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static bool Bool(JsonElement o, string p) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.True;
    private static long Long(JsonElement o, string p) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number
            ? (v.TryGetInt64(out var l) ? l : (long)v.GetDouble()) : 0;
    private static int Int(JsonElement o, string p) => (int)Long(o, p);
    private static double? Dbl(JsonElement o, string p) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
}
