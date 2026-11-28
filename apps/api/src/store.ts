import { mainRole, ROLE_MIN_ACTIVE_MS, STAT_KEYS, type Role } from "@gw2logs/shared";
import { STAT_COL, type DB } from "./db.js";
import type { ExtractedFight, ExtractedPlayer } from "./ingest.js";

/**
 * Grava (ou regrava) o resultado da extração de uma luta. `trusted`: o JSON saiu do nosso Elite Insights; só então um nome diferente
 * substitui o nome de habilidade já salvo. Num .json enviado pelo usuário o nome só entra se ainda estiver vazio (a tabela é de todos).
 */
export function saveFight(db: DB, id: string, f: ExtractedFight, mapName: string | null, hasReport: boolean, trusted: boolean) {
  const cols = ["fight_id", "account", "name", "profession", "guild_id", "grp", "commander", "role", "active_ms", "dist_to_com", "dist_cover_ms", "near_cover_ms", ...STAT_KEYS.map((k) => STAT_COL[k])];
  const insertPlayer = db.prepare(`INSERT OR REPLACE INTO player_stats (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  const insertGuild = db.prepare("INSERT OR IGNORE INTO guilds (id) VALUES (?)");

  const insertSkill = db.prepare("INSERT INTO player_skills (fight_id, account, skill_id, damage, hits, connected_hits) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertSkillName = db.prepare(
    `INSERT INTO skills (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = ${trusted ? "COALESCE(excluded.name, name)" : "COALESCE(NULLIF(name, ''), excluded.name)"}`,
  );

  // lutas longas da mesma conta e classe, no espaço do mesmo dono
  const roleHistory = db.prepare(
    `SELECT ps.role, ps.active_ms AS activeMs FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
     WHERE ps.account = ? AND ps.profession = ? AND ps.active_ms >= ? AND f.owner_id = (SELECT owner_id FROM fights WHERE id = ?)`,
  );
  // conta "?" é a de quem veio sem conta nem nome no log: são pessoas diferentes, então não há histórico a herdar
  const hasHistory = (p: ExtractedPlayer) => !!p.profession && p.account !== "?";
  const isShort = (p: ExtractedPlayer) => Math.round(p.activeMs) < ROLE_MIN_ACTIVE_MS;
  const historyRole = (p: ExtractedPlayer): Role | null => {
    const history = roleHistory.all(p.account, p.profession, ROLE_MIN_ACTIVE_MS, id) as { role: Role; activeMs: number }[];
    return history.length ? mainRole(history) : null;
  };
  /** Em luta curta a função vem do histórico (a maioria pelo tempo ativo); sem histórico, fica a da classificação. */
  const roleOf = (p: ExtractedPlayer): Role => (isShort(p) && hasHistory(p) ? (historyRole(p) ?? p.role) : p.role);
  // uma luta longa nova muda o histórico: as curtas já gravadas da mesma conta e classe, do mesmo dono, são recalculadas
  const updateShortRoles = db.prepare(
    `UPDATE player_stats SET role = ? WHERE account = ? AND profession = ? AND active_ms < ?
       AND fight_id IN (SELECT id FROM fights WHERE owner_id = (SELECT owner_id FROM fights WHERE id = ?))`,
  );

  db.transaction(() => {
    db.prepare("DELETE FROM player_stats WHERE fight_id = ?").run(id);
    db.prepare("DELETE FROM player_skills WHERE fight_id = ?").run(id);
    for (const p of f.players) {
      if (p.guildId) insertGuild.run(p.guildId);
      insertPlayer.run(
        id, p.account, p.name, p.profession, p.guildId, p.group, p.commander ? 1 : 0, roleOf(p), Math.round(p.activeMs), p.distToCom, p.distCoverMs, p.nearCoverMs,
        ...STAT_KEYS.map((k) => p[k]),
      );
      for (const sk of p.skills) {
        upsertSkillName.run(sk.id, sk.name?.slice(0, 100) ?? null);
        insertSkill.run(id, p.account, sk.id, sk.damage, sk.hits, sk.connectedHits);
      }
    }
    for (const p of f.players) {
      const role = !isShort(p) && hasHistory(p) ? historyRole(p) : null;
      if (role) updateShortRoles.run(role, p.account, p.profession, ROLE_MIN_ACTIVE_MS, id);
    }
    db.prepare(
      `UPDATE fights SET status='done', error=NULL, mode=@mode, fight_name=@fightName, map_id=@mapId, map_name=@mapName,
         time_start=@timeStart, duration_ms=@durationMs, success=@success, recorded_by=@recordedBy, squad_count=@squadCount,
         ally_count=@allyCount, enemy_count=@enemyCount, squad_damage=@squadDamage, squad_kills=@squadKills,
         squad_downs=@squadDowns, squad_deaths=@squadDeaths, enemy_downs=@enemyDowns, enemy_deaths=@enemyDeaths,
         ei_version=@eiVersion, has_report=@hasReport
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
      enemyDowns: f.enemyDowns,
      enemyDeaths: f.enemyDeaths,
      eiVersion: f.eiVersion,
      hasReport: hasReport ? 1 : 0,
    });
  })();
}

export function setStatus(db: DB, id: string, status: string, error: string | null = null) {
  db.prepare("UPDATE fights SET status = ?, error = ? WHERE id = ?").run(status, error?.slice(0, 500) ?? null, id);
}
