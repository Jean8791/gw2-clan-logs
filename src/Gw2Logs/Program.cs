using System.Security.Cryptography;
using Gw2Logs;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder(args);

// Configuração (variáveis de ambiente ou appsettings.json):
//   DATA_DIR    pasta onde ficam banco, uploads e relatórios   (padrão: ./data)
//   EI_DIR      pasta do Elite Insights CLI                      (padrão: ../../tools/GW2EICLI)
//   UPLOAD_KEY  senha do clã para enviar logs (vazio = qualquer um pode enviar)
var dataDir = Path.GetFullPath(builder.Configuration["DATA_DIR"] ?? "data");
var eiDir = Path.GetFullPath(builder.Configuration["EI_DIR"] ?? Path.Combine("..", "..", "tools", "GW2EICLI"));
var uploadKey = builder.Configuration["UPLOAD_KEY"] ?? "";
const long MaxUpload = 60L * 1024 * 1024; // logs de WvW grandes passam fácil de 20 MB

var paths = new AppPaths(dataDir, eiDir);
Directory.CreateDirectory(paths.Uploads);
Directory.CreateDirectory(paths.Fights);

builder.Services.AddSingleton(paths);
builder.Services.AddSingleton(new Db(Path.Combine(dataDir, "gw2logs.db")));
builder.Services.AddSingleton<MapNames>();
builder.Services.AddSingleton<LogProcessor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<LogProcessor>());
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = MaxUpload);
builder.Services.Configure<KestrelServerOptions>(o => o.Limits.MaxRequestBodySize = MaxUpload);

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

string[] allowedExt = [".zevtc", ".evtc", ".zip", ".json"];

// ---------- Upload ----------
app.MapPost("/api/upload", async (HttpRequest req, Db db, LogProcessor proc) =>
{
    if (uploadKey != "" && req.Headers["X-Upload-Key"] != uploadKey)
        return Results.Json(new { error = "Senha de envio incorreta." }, statusCode: 401);

    var form = await req.ReadFormAsync();
    var uploader = (form["uploader"].ToString() ?? "").Trim();
    if (uploader.Length > 60) uploader = uploader[..60];
    var results = new List<object>();

    foreach (var file in form.Files)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExt.Contains(ext)) { results.Add(new { file = file.FileName, error = "Formato inválido (use .zevtc, .evtc ou o .json do Elite Insights)." }); continue; }

        // Grava num arquivo temporário calculando o hash, para não aceitar o mesmo log duas vezes.
        var tmp = Path.Combine(paths.Uploads, "tmp-" + Guid.NewGuid().ToString("N"));
        string sha;
        await using (var fs = File.Create(tmp))
        {
            using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using var s = file.OpenReadStream();
            var buf = new byte[81920]; int n;
            while ((n = await s.ReadAsync(buf)) > 0) { hasher.AppendData(buf, 0, n); await fs.WriteAsync(buf.AsMemory(0, n)); }
            sha = Convert.ToHexStringLower(hasher.GetHashAndReset());
        }

        var existing = db.Query("SELECT id, status FROM fights WHERE sha256=$h", ("$h", sha)).FirstOrDefault();
        if (existing != null)
        {
            File.Delete(tmp);
            results.Add(new { file = file.FileName, id = existing["id"], status = existing["status"], duplicate = true });
            continue;
        }

        var id = DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "-" + sha[..8];
        File.Move(tmp, Path.Combine(paths.Uploads, id + ext));
        using (var c = db.Open())
            Db.Exec(c, "INSERT INTO fights (id, sha256, status, uploaded_at, uploader, file_name) VALUES ($id,$h,'queued',$at,$u,$f)",
                ("$id", id), ("$h", sha), ("$at", DateTime.UtcNow.ToString("o")), ("$u", uploader == "" ? null : uploader), ("$f", file.FileName));
        proc.Enqueue(id);
        results.Add(new { file = file.FileName, id, status = "queued" });
    }
    return Results.Ok(results);
}).DisableAntiforgery();

app.MapGet("/api/config", () => new { uploadKeyRequired = uploadKey != "" });

// ---------- Lutas ----------
app.MapGet("/api/fights", (Db db, string? mode, int? limit, int? offset) =>
{
    var where = mode is "wvw" or "pve" ? "WHERE mode=$m OR status!='done'" : "";
    return db.Query($"""
        SELECT id, status, error, uploaded_at, uploader, file_name, mode, fight_name, fight_icon, map_name, time_start, duration_ms,
               success, is_cm, recorded_by, squad_count, enemy_count, squad_dps, squad_damage, squad_kills, squad_downs, squad_deaths
        FROM fights {where}
        ORDER BY COALESCE(time_start, uploaded_at) DESC LIMIT $l OFFSET $o
        """, ("$m", mode), ("$l", Math.Clamp(limit ?? 50, 1, 500)), ("$o", Math.Max(offset ?? 0, 0)));
});

app.MapGet("/api/fights/{id}", (Db db, string id) =>
{
    var f = db.Query("SELECT * FROM fights WHERE id=$id", ("$id", id)).FirstOrDefault();
    if (f == null) return Results.NotFound();
    f.Remove("sha256");
    var players = db.Query("SELECT * FROM player_stats WHERE fight_id=$id ORDER BY damage DESC", ("$id", id));
    return Results.Ok(new { fight = f, players });
});

// Relatório HTML completo do Elite Insights (gráficos, rotação, replay da luta etc.)
app.MapGet("/api/fights/{id}/report", (AppPaths p, string id) =>
{
    if (id.Contains("..") || id.Contains('/') || id.Contains('\\')) return Results.BadRequest();
    var f = Path.Combine(p.FightDir(id), "report.html");
    return File.Exists(f) ? Results.File(f, "text/html; charset=utf-8") : Results.NotFound();
});

// ---------- Ranking e histórico ----------
const string AggCols = """
    COUNT(*) AS fights, SUM(ps.active_ms) AS active_ms,
    SUM(ps.damage) AS damage, SUM(ps.down_contrib) AS down_contrib, SUM(ps.kills) AS kills, SUM(ps.downs) AS downs,
    SUM(ps.strips) AS strips, SUM(ps.cleanses) AS cleanses, SUM(ps.resurrects) AS resurrects, SUM(ps.stun_breaks) AS stun_breaks,
    SUM(ps.healing) AS healing, SUM(ps.barrier) AS barrier, SUM(ps.damage_taken) AS damage_taken,
    SUM(ps.deaths) AS deaths, SUM(ps.times_downed) AS times_downed, SUM(ps.dodges) AS dodges,
    CAST(SUM(ps.damage) * 1000 / NULLIF(SUM(f.duration_ms),0) AS INTEGER) AS dps,
    AVG(ps.stab_gen) AS stab_gen, AVG(ps.quick_gen) AS quick_gen, AVG(ps.alac_gen) AS alac_gen, AVG(ps.prot_gen) AS prot_gen,
    AVG(ps.might_gen) AS might_gen, AVG(ps.aegis_gen) AS aegis_gen, AVG(ps.resist_gen) AS resist_gen, AVG(ps.dist_to_com) AS dist_to_com
    """;

app.MapGet("/api/ranking", (Db db, string? mode, int? days) =>
{
    var since = DateTime.UtcNow.AddDays(-(days is > 0 ? days.Value : 36500)).ToString("o");
    return db.Query($"""
        SELECT ps.account,
               (SELECT name FROM player_stats x JOIN fights y ON y.id=x.fight_id WHERE x.account=ps.account ORDER BY y.time_start DESC LIMIT 1) AS name,
               (SELECT profession FROM player_stats x JOIN fights y ON y.id=x.fight_id WHERE x.account=ps.account ORDER BY y.time_start DESC LIMIT 1) AS profession,
               {AggCols}
        FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
        WHERE f.status='done' AND f.mode=$m AND f.time_start >= $since
        GROUP BY ps.account ORDER BY damage DESC
        """, ("$m", mode is "pve" ? "pve" : "wvw"), ("$since", since));
});

app.MapGet("/api/players/{account}", (Db db, string account) =>
{
    var history = db.Query("""
        SELECT f.id, f.mode, f.fight_name, f.time_start, f.duration_ms, f.success, ps.*
        FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
        WHERE ps.account=$a AND f.status='done' ORDER BY f.time_start
        """, ("$a", account));
    if (history.Count == 0) return Results.NotFound();
    var totals = db.Query($"""
        SELECT f.mode, {AggCols} FROM player_stats ps JOIN fights f ON f.id=ps.fight_id
        WHERE ps.account=$a AND f.status='done' GROUP BY f.mode
        """, ("$a", account));
    var profs = db.Query("""
        SELECT profession, COUNT(*) AS fights FROM player_stats WHERE account=$a GROUP BY profession ORDER BY fights DESC
        """, ("$a", account));
    return Results.Ok(new { account, history, totals, professions = profs });
});

app.MapGet("/api/stats", (Db db) => db.Query("""
    SELECT mode, COUNT(*) AS fights, SUM(duration_ms) AS duration_ms, SUM(squad_kills) AS kills, SUM(squad_deaths) AS deaths,
           MIN(time_start) AS first, MAX(time_start) AS last,
           (SELECT COUNT(DISTINCT account) FROM player_stats ps JOIN fights f2 ON f2.id=ps.fight_id WHERE f2.mode=f.mode) AS players
    FROM fights f WHERE status='done' GROUP BY mode
    """));

app.MapFallbackToFile("index.html");
app.Run();
