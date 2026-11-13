import { perMinute, STAT_GROUPS, STAT_META, statsOfGroup, type StatGroup, type StatKey, type Stats } from "@gw2logs/shared";
import { BuffIcon } from "./BuffIcon";
import type { Column } from "./DataTable";
import { Segmented, cx } from "./ui";
import { stat } from "../lib/format";

export type ValueMode = "total" | "perMin";

/** Colunas de métricas de um grupo (Dano, Suporte…), em total ou por minuto, com destaque do melhor valor. */
export function statColumns<T extends Stats & { activeMs: number }>(group: StatGroup, mode: ValueMode, rows: T[]): Column<T>[] {
  return statsOfGroup(group).map((k: StatKey) => {
    const meta = STAT_META[k];
    const isRate = mode === "perMin" && meta.format !== "volume";
    const value = (r: T) => (isRate ? perMinute(r[k], r.activeMs) : r[k]);
    const values = rows.map(value);
    const best = values.length ? (meta.higherIsBetter ? Math.max(...values) : Math.min(...values)) : 0;
    const label = meta.buffId ? (
      <span className="inline-flex items-center gap-1">
        <BuffIcon id={meta.buffId} />
        {meta.short}
      </span>
    ) : (
      meta.short
    );
    return {
      id: k,
      header: isRate ? (
        <span className="inline-flex flex-col items-end leading-tight">
          {label}
          <span className="text-[9px] font-normal normal-case tracking-normal text-faint">por min</span>
        </span>
      ) : (
        label
      ),
      title: [meta.hint ? `${meta.label} — ${meta.hint}` : meta.label, isRate && "por minuto de luta"].filter(Boolean).join(" · "),
      align: "right",
      sort: value,
      cell: (r: T) => {
        const v = value(r);
        return <span className={cx(v === best && v !== 0 && rows.length > 1 ? "font-semibold text-gold" : v === 0 ? "text-faint" : "text-text")}>{stat(k, v, mode === "perMin")}</span>;
      },
    } satisfies Column<T>;
  });
}

export function GroupTabs({ value, onChange }: { value: StatGroup; onChange: (g: StatGroup) => void }) {
  return <Segmented value={value} onChange={onChange} options={STAT_GROUPS.map((g) => ({ value: g.id, label: g.label }))} />;
}

export function ModeToggle({ value, onChange }: { value: ValueMode; onChange: (m: ValueMode) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "total", label: "Total" },
        { value: "perMin", label: "Por minuto" },
      ]}
    />
  );
}
