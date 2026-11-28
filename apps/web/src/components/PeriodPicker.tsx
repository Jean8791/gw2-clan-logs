import type { ArchiveMonth, ArchiveWeek } from "@gw2logs/shared";
import { dayLabel, monthLabel, weekLabel } from "../lib/format";
import { t } from "../lib/i18n";
import { Segmented, Select } from "./ui";

/**
 * O filtro de período do arquivo: mês ou semana (sexta 23:03 a sexta 23:00), com o seletor do mês ou da semana e os dias com dados.
 * Trocar para o outro tipo escolhe o mais recente que já fechou (ou o em andamento, se só existe ele).
 */
export function PeriodPicker({ months, weeks, month, week, onChange }: { months: ArchiveMonth[]; weeks: ArchiveWeek[]; month?: string; week?: string; onChange: (p: { month?: string; week?: string }) => void }) {
  const latest = <T extends { current: boolean }>(list: T[]) => list.find((x) => !x.current) ?? list[0];
  const monthInfo = months.find((m) => m.month === month);
  const weekInfo = weeks.find((w) => w.week === week);
  const info = week ? weekInfo : monthInfo;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Segmented
        size="sm"
        value={week ? "week" : "month"}
        onChange={(v) => onChange(v === "week" ? { week: latest(weeks)?.week } : { month: latest(months)?.month })}
        options={[
          { value: "month", label: t("months.view.month") },
          { value: "week", label: t("months.view.week") },
        ]}
      />
      {week ? (
        <Select className="w-72" value={week} onChange={(e) => onChange({ week: e.target.value })} aria-label={t("months.view.week")}>
          {!weekInfo && <option value={week}>{weekLabel(week)}</option>}
          {weeks.map((w) => (
            <option key={w.week} value={w.week}>
              {weekLabel(w.week)}
              {w.current ? ` (${t("archive.inProgress")})` : ""}
            </option>
          ))}
        </Select>
      ) : (
        <Select className="w-64" value={month ?? ""} onChange={(e) => onChange({ month: e.target.value })} aria-label={t("archive.month")}>
          {month && !monthInfo && <option value={month}>{monthLabel(month)}</option>}
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {monthLabel(m.month)}
              {m.current ? ` (${t("archive.inProgress")})` : ""}
            </option>
          ))}
        </Select>
      )}
      {info && <span className="text-xs text-muted">{t("archive.days", { n: info.days, from: dayLabel(info.first), to: dayLabel(info.last) })}</span>}
    </div>
  );
}
