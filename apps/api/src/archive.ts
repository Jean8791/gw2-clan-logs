import { createHash } from "node:crypto";
import { ARCHIVE_MONTHS, BATTLE_DAY_SHIFT_HOURS, retentionCutoff, STAT_KEYS, STAT_META } from "@gw2logs/shared";
import { STAT_COL, type DB } from "./db.js";
import { BATTLE_DAY, fightConditions } from "./queries.js";

const HOUR_MS = 3_600_000;

/** Primeiro dia do resumo que ainda vale: o dia 1 do mês de ARCHIVE_MONTHS meses atrás. */
export function archiveStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ARCHIVE_MONTHS, 1));
  return d.toISOString().slice(0, 10);
}

/** Boon em volume é uma média ponderada pelo tempo ativo (ver aggColumn em queries.ts): o resumo guarda a soma do valor × tempo, que dá a mesma média ao somar dias. */
const sumOf = (k: (typeof STAT_KEYS)[number]) =>
  STAT_META[k].format === "volume" ? `SUM(ps.${STAT_COL[k]} * ps.active_ms)` : `SUM(ps.${STAT_COL[k]})`;

const STAT_COLUMNS = STAT_KEYS.map((k) => STAT_COL[k]).join(", ");

/**
 * Resume um dia de batalha por jogador, classe, função e guilda. Vale só as lutas visíveis (as mesmas condições do Ranking, inclusive a regra
 * do log mais completo), então a mesma luta gravada por duas pessoas conta uma vez. Nome e guilda são os da luta mais recente do dia. Um dia que
 * atravessa o corte de sexta (23:03) gera uma linha por semana.
 */
const SUMMARIZE_DAY = (where: string) => `
  INSERT INTO day_stats (day, mode, account, profession, role, guild_id, week, name, last_seen, fights, active_ms, dist_cover_ms, near_cover_ms, gen_cover_ms, ${STAT_COLUMNS})
  SELECT ${BATTLE_DAY}, COALESCE(f.mode, ''), ps.account, COALESCE(ps.profession, ''), ps.role, COALESCE(ps.guild_id, ''), week_of(f.time_start), ps.name, MAX(f.time_start),
         COUNT(*), SUM(ps.active_ms), SUM(ps.dist_cover_ms), SUM(ps.near_cover_ms), SUM(ps.gen_cover_ms), ${STAT_KEYS.map(sumOf).join(", ")}
  FROM player_stats ps JOIN fights f ON f.id = ps.fight_id
  WHERE ${where} AND f.time_start IS NOT NULL AND ${BATTLE_DAY} = @day
  GROUP BY ${BATTLE_DAY}, COALESCE(f.mode, ''), ps.account, COALESCE(ps.profession, ''), ps.role, COALESCE(ps.guild_id, ''), week_of(f.time_start)`;

/**
 * Guarda o resumo de cada dia de batalha antes de a retenção apagar as lutas (o top 10 de um mês não existe mais quando o mês fecha).
 *
 * Refaz um dia quando as lutas visíveis dele mudaram desde o último resumo (assinatura dos ids: pega a luta que ficou pronta depois, a que
 * entrou e a que um log melhor escondeu). Com retenção, o dia que ela já alcançou (o começo dele passou do prazo) é refeito uma última vez e
 * congelado: dali em diante nada o muda, nem um log antigo reenviado. Sem retenção (0 dias) nada é congelado.
 *
 * Não pega mudança dentro da mesma luta (o `reingest` regrava estatísticas sem trocar o id): para refazer um dia assim, apague a linha dele
 * em day_snapshots.
 */
export function snapshotDays(db: DB, now = new Date(), retentionDays = 0): { rebuilt: string[]; frozen: string[] } {
  const keepFrom = archiveStart(now);
  const { where, params } = fightConditions({}, now);
  const idsByDay = new Map<string, string[]>();
  const rows = db
    .prepare(`SELECT ${BATTLE_DAY} AS day, f.id AS id FROM fights f WHERE ${where.join(" AND ")} AND f.time_start IS NOT NULL ORDER BY day, f.id`)
    .all(params) as { day: string; id: string }[];
  for (const r of rows) idsByDay.set(r.day, [...(idsByDay.get(r.day) ?? []), r.id]);

  const snapshots = new Map(
    (db.prepare("SELECT day, signature, frozen FROM day_snapshots").all() as { day: string; signature: string; frozen: number }[]).map((s) => [s.day, s]),
  );
  const summarize = db.prepare(SUMMARIZE_DAY(where.join(" AND ")));
  const upsert = db.prepare(
    "INSERT INTO day_snapshots (day, built_at, signature, frozen) VALUES (@day, @builtAt, @signature, 0) ON CONFLICT(day) DO UPDATE SET built_at = @builtAt, signature = @signature",
  );
  const rebuilt: string[] = [];
  const frozen: string[] = [];

  db.transaction(() => {
    db.prepare("DELETE FROM day_stats WHERE day < ?").run(keepFrom);
    db.prepare("DELETE FROM day_snapshots WHERE day < ?").run(keepFrom);
    for (const [day, ids] of idsByDay) {
      if (day < keepFrom) continue; // fora do prazo do resumo: não refaz, senão ele voltaria a cada rodada
      const signature = createHash("sha1").update(ids.join(",")).digest("hex");
      const known = snapshots.get(day);
      if (known?.frozen || known?.signature === signature) continue;
      db.prepare("DELETE FROM day_stats WHERE day = ?").run(day);
      summarize.run({ ...params, day });
      upsert.run({ day, builtAt: now.toISOString(), signature });
      snapshots.set(day, { day, signature, frozen: 0 });
      rebuilt.push(day);
    }
    if (retentionDays > 0) {
      const cutoff = Date.parse(retentionCutoff(now, retentionDays));
      for (const s of snapshots.values()) {
        if (s.frozen || Date.parse(`${s.day}T00:00:00Z`) + BATTLE_DAY_SHIFT_HOURS * HOUR_MS >= cutoff) continue;
        db.prepare("UPDATE day_snapshots SET frozen = 1 WHERE day = ?").run(s.day);
        frozen.push(s.day);
      }
    }
  })();
  return { rebuilt, frozen };
}
