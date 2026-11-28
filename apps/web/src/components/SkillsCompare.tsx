import { useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES, type Filters, type PlayerProfile, type SupportKind } from "@gw2logs/shared";
import { BuffIcon, SkillIcon } from "./MediaIcon";
import { ProfessionDot } from "./badges";
import { SERIES } from "./charts";
import { Card, ErrorBox, Loading, Segmented, cx } from "./ui";
import { usePlayersSkills, type SkillShare } from "../lib/api";
import { compact, accountShort } from "../lib/format";
import { t } from "../lib/i18n";

/** Quantas habilidades a comparação mostra: as de maior total somado entre os jogadores. */
const MAX_SKILLS = 15;

/**
 * Habilidades dos jogadores comparados lado a lado, para dano, cura ou barreira: o total de cada uma e o % que ela é do total do jogador.
 * Serve para ver, por exemplo, o que um curandeiro com dificuldade faz de diferente de quem vai melhor na mesma classe.
 */
export function SkillsCompare({ players, filters }: { players: PlayerProfile[]; filters: Filters }) {
  const [kind, setKind] = useState<"damage" | SupportKind>("heal");
  const results = usePlayersSkills(players.map((p) => p.account), filters, kind);
  const lists: SkillShare[][] = results.map((r) => r.data ?? []);
  const loading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error;

  // a união das habilidades, da de maior total somado para a de menor
  const bySkill = new Map<string, SkillShare & { sum: number }>();
  for (const s of lists.flat()) {
    const cur = bySkill.get(s.key);
    bySkill.set(s.key, { ...(cur ?? s), sum: (cur?.sum ?? 0) + s.total });
  }
  const rows = [...bySkill.values()].sort((a, b) => b.sum - a.sum).slice(0, MAX_SKILLS);

  return (
    <Card
      className="mt-6"
      title={t("compare.skills")}
      action={<Segmented size="sm" value={kind} onChange={setKind} options={(["heal", "barrier", "damage"] as const).map((k) => ({ value: k, label: t(`skills.kind.${k}`) }))} />}
    >
      {loading && <Loading />}
      {error && <div className="p-4"><ErrorBox error={error} /></div>}
      {!loading && !error && rows.length === 0 && <p className="px-5 py-6 text-sm text-faint">{t("skills.noSupport")}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 text-left font-semibold">{t("skills.col.skill")}</th>
                {players.map((p, i) => (
                  <th key={p.account} className="px-4 py-2.5 text-right font-semibold" style={{ color: SERIES[i] }}>
                    <Link to={ROUTES.player(p.account)} className="inline-flex items-center gap-1.5 hover:underline">
                      <ProfessionDot profession={p.professions[0]?.profession ?? null} />
                      {p.name ?? accountShort(p.account)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => {
                // quem usa mais a habilidade (em % do próprio total) fica em destaque
                const pcts = lists.map((l) => l.find((s) => s.key === r.key)?.pct ?? 0);
                const best = Math.max(...pcts);
                return (
                  <tr key={r.key} className="border-t border-line/60">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        {r.indirect ? <BuffIcon id={r.skillId} size={20} /> : <SkillIcon id={r.skillId} />}
                        {r.name ?? `#${r.skillId}`}
                      </span>
                    </td>
                    {lists.map((l, i) => {
                      const s = l.find((x) => x.key === r.key);
                      return (
                        <td key={players[i]!.account} className={cx("px-4 py-2 text-right", !s ? "text-faint" : s.pct === best && players.length > 1 ? "font-semibold text-gold" : "text-text")}>
                          {s ? (
                            <>
                              {s.pct.toFixed(1).replace(".", ",")}% <span className="text-xs font-normal text-faint">{compact(s.total)}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2.5 text-xs text-faint">{t("compare.skills.note")}</p>
    </Card>
  );
}
