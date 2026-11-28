import { BOON_SCOPES, bestValue, boonUtilization, type BoonBase, hasStatData, isGenStat, isUptimeStat, STAT_GROUPS, STAT_META, statsOfGroup, statText, statValue, type BoonScope, type StatGroup, type StatKey, type Stats, type Cover, type TimeAdjust, type ValueMode } from "@gw2logs/shared";
import { BuffIcon } from "./MediaIcon";
import type { Column } from "./DataTable";
import { Segmented, cx } from "./ui";
import { dec, stat } from "../lib/format";
import { getLang, t } from "../lib/i18n";

export type { ValueMode };

/**
 * Colunas de métricas de um grupo (Dano, Suporte…), em total ou por minuto, com destaque do melhor valor. Com `adjust` (Ranking), boons e
 * uptime são ajustados pelo tempo jogado (puxados para a média geral de quem jogou menos que a referência do período).
 */
export function statColumns<T extends Stats & { activeMs: number }>(group: StatGroup, mode: ValueMode, rows: T[], scope: BoonScope = "squad", adjust?: TimeAdjust): Column<T>[] {
  return statColumnsFor(statsOfGroup(group, scope), mode, rows, adjust);
}

/** As colunas de uma lista de métricas (um grupo inteiro, ou as de um boon só), na ordem dada. */
export function statColumnsFor<T extends Stats & { activeMs: number }>(keys: StatKey[], mode: ValueMode, rows: T[], adjust?: TimeAdjust): Column<T>[] {
  return keys.map((k: StatKey) => {
    const meta = STAT_META[k];
    const text = statText(k, getLang());
    // uptime é % do tempo ativo (ou média de pilhas) nos dois modos: o "por minuto" não se aplica
    const isRate = mode !== "total" && meta.format !== "volume" && !isUptimeStat(k);
    const perSec = mode === "perSec";
    // as métricas da tag faltam nos logs lidos sem replay: a linha sem dado mostra traço, vai para o fim (null) e não disputa o destaque
    const covered = (r: T) => hasStatData(k, r as unknown as Partial<Cover>);
    const value = (r: T) => statValue(k, mode, r, adjust);
    const name = text.hint ? `${text.label} — ${text.hint}` : text.label;
    // boons e uptime, quando o Ranking ajusta pelo tempo jogado
    const isAdjusted = !!adjust && (meta.format === "volume" || isUptimeStat(k));
    const best = bestValue(k, rows as unknown as (T & Partial<Cover>)[], value);
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
      title: [name, isRate && t(perSec ? "rate.titleSec" : "rate.titleMin"), isAdjusted && t("rate.titleAdjusted")].filter(Boolean).join(" · "),
      align: "right",
      sort: (r: T) => (covered(r) ? value(r) : null),
      cell: (r: T) => {
        if (!covered(r)) return <span className="text-faint" title={isGenStat(k) ? t("boon.noGeneration") : undefined}>{isGenStat(k) ? "N/D" : "—"}</span>;
        const v = value(r);
        return <span className={cx(v === best && v !== 0 && rows.length > 1 ? "font-semibold text-gold" : v === 0 ? "text-faint" : "text-text")}>{stat(k, v, mode !== "total", perSec)}</span>;
      },
    } satisfies Column<T>;
  });
}

/**
 * Aproveitamento do volume do boon: a geração efetiva sobre o volume gerado, calculado com os mesmos valores (ajustados) das colunas vizinhas.
 * N/D (com o motivo na dica) quando falta a geração efetiva, quando só parte do período a tem ou quando não há volume; acima de 100% leva um
 * aviso, porque a geração passou do volume (diferença do Elite Insights ou de arredondamento), em vez de ser limitada.
 */
export function utilizationColumn<T extends Stats & { activeMs: number }>(base: BoonBase, adjust?: TimeAdjust): Column<T> {
  const of = (r: T) => boonUtilization(r as T & { genCoverMs?: number }, base, adjust);
  return {
    id: `${base}Utilization`,
    label: t("boon.utilization"),
    header: t("boon.utilization"),
    title: t("boon.utilizationHint"),
    align: "right",
    sort: (r: T) => of(r).value,
    cell: (r: T) => {
      const u = of(r);
      if (u.value === null) return <span className="text-faint" title={t(`boon.nd.${u.reason}`)}>N/D</span>;
      const pct = `${dec(u.value * 100, 1)}%`;
      return u.exceeds ? (
        <span className="text-gold" title={t("boon.exceeds")}>
          {pct} ⚠
        </span>
      ) : (
        <span className={u.value === 0 ? "text-faint" : "text-text"}>{pct}</span>
      );
    },
  };
}

const SORT_BY_GROUP: Record<StatGroup, StatKey> = { offense: "damage", support: "strips", boons: "stabOut", uptime: "stabUp", defense: "damageTaken" };

/** Coluna pela qual a tabela de um grupo começa ordenada (nos boons, a primeira métrica do alcance escolhido). */
export const defaultSort = (group: StatGroup, scope: BoonScope): { id: StatKey; desc: boolean } => ({
  id: group === "boons" ? statsOfGroup(group, scope)[0]! : SORT_BY_GROUP[group],
  desc: group !== "defense",
});

/** Chave do seletor de colunas: nos boons, cada alcance tem a sua, e a visão de um boon só tem outra. */
export const pickerView = (group: StatGroup, scope: BoonScope, oneBoon = false) => (group === "boons" ? (oneBoon ? "boons-one" : `${group}-${scope}`) : group);

/** Abas dos grupos de métricas; na aba Boons aparece também a escolha do alcance (squad, grupo ou próprio). */
export function GroupTabs({ value, onChange, scope, onScopeChange, showScope = true }: { value: StatGroup; onChange: (g: StatGroup) => void; scope: BoonScope; onScopeChange: (s: BoonScope) => void; showScope?: boolean }) {
  return (
    <>
      <Segmented value={value} onChange={onChange} options={STAT_GROUPS.map((g) => ({ value: g.id, label: t(`group.${g.id}`) }))} />
      {value === "boons" && showScope && <ScopeToggle value={scope} onChange={onScopeChange} />}
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

/** Por minuto ou por segundo de tempo ativo (o total não se compara entre jogadores que jogaram tempos diferentes). */
export function ModeToggle({ value, onChange }: { value: ValueMode; onChange: (m: ValueMode) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "perMin", label: t("mode.perMin") },
        { value: "perSec", label: t("mode.perSec") },
      ]}
    />
  );
}
