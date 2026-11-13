using System.Collections.Concurrent;
using System.Text.Json;

namespace Gw2Logs;

/// <summary>
/// Resolve o nome de um mapa pelo id: primeiro o cache no banco, depois a lista que vem com o Elite Insights,
/// e por último a API oficial do GW2 (para mapas novos que o Elite Insights ainda não conhece).
/// </summary>
public sealed class MapNames
{
    private readonly Db _db;
    private readonly ILogger<MapNames> _log;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(8), BaseAddress = new Uri("https://api.guildwars2.com/") };
    private readonly ConcurrentDictionary<int, string> _cache = new();
    private readonly Lazy<Dictionary<int, string>> _eiList;

    public MapNames(Db db, AppPaths paths, ILogger<MapNames> log)
    {
        _db = db; _log = log;
        _eiList = new(() => LoadEiList(Path.Combine(paths.EiDir, "Content", "MapList.json")));
        foreach (var r in _db.Query("SELECT id, name FROM maps")) _cache[Convert.ToInt32(r["id"])] = (string)r["name"]!;
    }

    public async Task<string?> GetAsync(int id, CancellationToken ct)
    {
        if (id <= 0) return null;
        if (_cache.TryGetValue(id, out var n)) return n;
        if (!_eiList.Value.TryGetValue(id, out n))
        {
            try
            {
                using var doc = JsonDocument.Parse(await _http.GetStringAsync($"v2/maps/{id}", ct));
                n = doc.RootElement.TryGetProperty("name", out var v) ? v.GetString() : null;
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _log.LogWarning("Não foi possível buscar o nome do mapa {Id}: {Msg}", id, ex.Message);
                return null; // tenta de novo numa próxima vez
            }
        }
        if (string.IsNullOrWhiteSpace(n)) return null;
        _cache[id] = n;
        using var c = _db.Open();
        Db.Exec(c, "INSERT OR REPLACE INTO maps (id, name) VALUES ($i, $n)", ("$i", id), ("$n", n));
        return n;
    }

    private Dictionary<int, string> LoadEiList(string file)
    {
        var d = new Dictionary<int, string>();
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(file));
            foreach (var m in doc.RootElement.EnumerateArray())
                if (m.TryGetProperty("id", out var i) && m.TryGetProperty("name", out var nm) && nm.GetString() is { Length: > 0 } s)
                    d[i.GetInt32()] = s;
        }
        catch (Exception ex) { _log.LogWarning("MapList do Elite Insights indisponível: {Msg}", ex.Message); }
        return d;
    }
}
