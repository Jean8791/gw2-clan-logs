import { BOON_SCOPES, isUptimeStat, perMinute, perSecond, STAT_GROUPS, STAT_META, statsOfGroup, statText, uptimeValue, type BoonScope, type StatGroup, type StatKey, type Stats } from "@gw2logs/shared";
import { BuffIcon } from "./MediaIcon";
import type { Column } from "./DataTable";
import { Segmented, cx } from "./ui";
import { stat } from "../lib/format";
import { getLang, t } from "../lib/i18n";

export type ValueMode = "total" | "perMin" | "perSec";

/** Colunas de métricas de um grupo (Dano, Suporte…), em total ou por minuto, com destaque do melhor valor. */
export function statColumns<T extends Stats & { activeMs: number }>(group: StatGroup, mode: ValueMode, rows: T[], scope: BoonScope = "squad"): Column<T>[] {
  return statsOfGroup(group, scope).map((k: StatKey) => {
    const meta = STAT_META[k];
    const text = statText(k, getLang());
    // uptime é % do tempo ativo (ou média de pilhas) nos dois modos: o "por minuto" não se aplica
    const uptime = isUptimeStat(k);
    const isRate = mode !== "total" && meta.format !== "volume" && !uptime;
    const perSec = mode === "perSec";
    const value = (r: T) => (uptime ? uptimeValue(k, r[k], r.activeMs) : isRate ? (perSec ? perSecond(r[k], r.activeMs) : perMinute(r[k], r.activeMs)) : r[k]);
    const values = rows.map(value);
    const best = values.length ? (meta.higherIsBetter ? Math.max(...values) : Math.min(...values)) : 0;
    const label = meta.buffId ? (
      <span className="inline-flex items-center gap-1">
        <BuffIcon id={meta.buffId} />
        {text.short}
      </span>
    ) : (
      text.short
    );
    return {
      id: k,
      label: meta.label,
      header: isRate ? (
        <span className="inline-flex flex-col items-end leading-tight">
          {label}
          <span className="text-[9px] font-normal normal-case tracking-normal text-faint">{t(perSec ? "rate.perSec" : "rate.perMin")}</span>
        </span>
      ) : (
        label
      ),
      title: [text.hint ? `${text.label} — ${text.hint}` : text.label, isRate && t(perSec ? "rate.titleSec" : "rate.titleMin")].filter(Boolean).join(" · "),
      align: "right",
      sort: value,
      cell: (r: T) => {
        const v = value(r);
        return <span className={cx(v === best && v !== 0 && rows.length > 1 ? "font-semibold text-gold" : v === 0 ? "text-faint" : "text-text")}>{stat(k, v, mode !== "total", perSec)}</span>;
      },
    } satisfies Column<T>;
  });
}

const SORT_BY_GROUP: Record<StatGroup, StatKey> = { offense: "damage", support: "strips", boons: "stabOut", uptime: "stabUp", defense: "damageTaken" };

/** Coluna pela qual a tabela de um grupo começa ordenada (nos boons, a primeira métrica do alcance escolhido). */
export const defaultSort = (group: StatGroup, scope: BoonScope): { id: StatKey; desc: boolean } => ({
  id: group === "boons" ? statsOfGroup(group, scope)[0]! : SORT_BY_GROUP[group],
  desc: group !== "defense",
});

/** Chave do seletor de colunas: nos boons, cada alcance tem a sua. */
export const pickerView = (group: StatGroup, scope: BoonScope) => (group === "boons" ? `${group}-${scope}` : group);

/** Abas dos grupos de métricas; na aba Boons aparece também a escolha do alcance (squad, grupo ou próprio). */
export function GroupTabs({ value, onChange, scope, onScopeChange }: { value: StatGroup; onChange: (g: StatGroup) => void; scope: BoonScope; onScopeChange: (s: BoonScope) => void }) {
  return (
    <>
      <Segmented value={value} onChange={onChange} options={STAT_GROUPS.map((g) => ({ value: g.id, label: t(`group.${g.id}`) }))} />
      {value === "boons" && <ScopeToggle value={scope} onChange={onScopeChange} />}
    </>
  );
}

export function ScopeToggle({ value, onChange }: { value: BoonScope; onChange: (s: BoonScope) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-faint">{t("scope.label")}</span>
      <Segmented size="sm" value={value} onChange={onChange} options={BOON_SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) }))} />
    </div>
  );
}

export function ModeToggle({ value, onChange }: { value: ValueMode; onChange: (m: ValueMode) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "total", label: t("mode.total") },
        { value: "perMin", label: t("mode.perMin") },
        { value: "perSec", label: t("mode.perSec") },
      ]}
    />
  );
}
