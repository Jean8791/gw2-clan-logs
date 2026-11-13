import { STAT_KEYS } from "@gw2logs/shared";
import { STAT_COL, type DB } from "./db.js";
import type { ExtractedFight } from "./ingest.js";

/** Grava (ou regrava) o resultado da extração de uma luta. */
export function saveFight(db: DB, id: string, f: ExtractedFight, mapName: string | null, hasReport: boolean) {
  const cols = ["fight_id", "account", "name", "profession", "guild_id", "grp", "commander", "role", "active_ms", "dist_to_com", ...STAT_KEYS.map((k) => STAT_COL[k])];
  const insertPlayer = db.prepare(`INSERT OR REPLACE INTO player_stats (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  const insertGuild = db.prepare("INSERT OR IGNORE INTO guilds (id) VALUES (?)");

  const insertSkill = db.prepare("INSERT INTO player_skills (fight_id, account, skill_id, damage, hits, connected_hits) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertSkillName = db.prepare("INSERT INTO skills (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, name)");

  db.transaction(() => {
    db.prepare("DELETE FROM player_stats WHERE fight_id = ?").run(id);
    db.prepare("DELETE FROM player_skills WHERE fight_id = ?").run(id);
    for (const p of f.players) {
      if (p.guildId) insertGuild.run(p.guildId);
      insertPlayer.run(
        id, p.account, p.name, p.profession, p.guildId, p.group, p.commander ? 1 : 0, p.role, Math.round(p.activeMs), p.distToCom,
        ...STAT_KEYS.map((k) => p[k]),
      );
      for (const sk of p.skills) {
        upsertSkillName.run(sk.id, sk.name?.slice(0, 100) ?? null);
        insertSkill.run(id, p.account, sk.id, sk.damage, sk.hits, sk.connectedHits);
      }
    }
    db.prepare(
      `UPDATE fights SET status='done', error=NULL, mode=@mode, fight_name=@fightName, map_id=@mapId, map_name=@mapName,
         time_start=@timeStart, duration_ms=@durationMs, success=@success, recorded_by=@recordedBy, squad_count=@squadCount,
         ally_count=@allyCount, enemy_count=@enemyCount, squad_damage=@squadDamage, squad_kills=@squadKills,
         squad_downs=@squadDowns, squad_deaths=@squadDeaths, ei_version=@eiVersion, has_report=@hasReport
       WHERE id=@id`,
    ).run({
      id,
      mode: f.mode,
      // em WvW o EI dá um nome genérico ("Detailed WvW"); o nome do mapa diz muito mais
      fightName: f.mode === "wvw" ? (mapName ?? "WvW") : f.fightName,
      mapId: f.mapId,
      mapName,
      timeStart: f.timeStart,
      durationMs: f.durationMs,
      success: f.success ? 1 : 0,
      recordedBy: f.recordedBy,
      squadCount: f.squadCount,
      allyCount: f.allyCount,
      enemyCount: f.enemyCount,
      squadDamage: f.squadDamage,
      squadKills: f.squadKills,
      squadDowns: f.squadDowns,
      squadDeaths: f.squadDeaths,
      eiVersion: f.eiVersion,
      hasReport: hasReport ? 1 : 0,
    });
  })();
}

export function setStatus(db: DB, id: string, status: string, error: string | null = null) {
  db.prepare("UPDATE fights SET status = ?, error = ? WHERE id = ?").run(status, error?.slice(0, 500) ?? null, id);
}
