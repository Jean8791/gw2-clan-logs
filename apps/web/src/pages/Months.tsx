import { useSearchParams } from "react-router-dom";
import { ARCHIVE_MONTHS, isMonth, ROUTES, type TimeAdjust } from "@gw2logs/shared";
import { CardsGrid } from "../components/CardsGrid";
import { FilterBar } from "../components/FilterBar";
import { Card, ErrorBox, Loading, PageHeader, Segmented, Select } from "../components/ui";
import { useArchiveMonths, useArchiveRanking, useArchiveWeeks } from "../lib/api";
import { useCards, useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { dayLabel, monthLabel, weekLabel } from "../lib/format";

/**
 * Meses anteriores: o Ranking de um mês ou de uma semana arquivados (sexta 23:03 a sexta 23:00), com os mesmos cards da Visão geral e as mesmas
 * métricas escolhidas. O mês (`month=`) ou a semana (`week=`) vai no endereço, para mandar o link. Vem do resumo diário, que fica guardado depois de as lutas serem apagadas.
 */
export function MonthsPage() {
  const [filters, setFilters] = useFilters({});
  const [cards, setCard] = useCards();
  const [params, setParams] = useSearchParams();
  const months = useArchiveMonths(true);
  const weeks = useArchiveWeeks(true);
  const list = months.data ?? [];
  const weekList = weeks.data ?? [];
  const asked = params.get("month") ?? "";
  // sem mês no endereço: o mais recente que já fechou; se só existe o mês em andamento, ele
  const month = isMonth(asked) ? asked : (list.find((m) => !m.current) ?? list[0])?.month;
  const info = list.find((m) => m.month === month);
  // com semana no filtro, a página mostra a semana (no endereço, `week=`); sem ela, o mês
  const week = filters.week;
  const weekInfo = weekList.find((w) => w.week === week);
  const rk = useArchiveRanking(month, filters, true);
  const adjust: TimeAdjust | undefined = rk.data ? { baseline: rk.data.baseline, refMs: rk.data.referenceMs } : undefined;
  const setMonth = (value: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("month", value);
        return p;
      },
      { replace: true },
    );
  // o clique no jogador abre o perfil do mês (ou da semana) mostrado, com os mesmos filtros de guilda e função
  const periodQuery = () => {
    const p = new URLSearchParams();
    if (week) p.set("week", week);
    else if (month) p.set("month", month);
    if (filters.guild) p.set("guild", filters.guild);
    if (filters.role) p.set("role", filters.role);
    return p.toString();
  };
  const playerLink = (account: string) => `${ROUTES.monthPlayer(account)}?${periodQuery()}`;
  const setView = (view: "month" | "week") => setFilters({ ...filters, week: view === "week" ? (weekList.find((w) => !w.current) ?? weekList[0])?.week : undefined });
  return (
    <>
      <PageHeader title={t("page.months.title")} subtitle={t("page.months.subtitle")} />
      <FilterBar value={filters} onChange={setFilters} fields={["guild"]} />
      {months.error && <ErrorBox error={months.error} />}
      {months.isLoading && <Loading />}
      {months.data && list.length === 0 && (
        <Card>
          <p className="px-5 py-6 text-sm text-faint">{t("archive.empty")}</p>
        </Card>
      )}
      {(month || week) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              size="sm"
              value={week ? "week" : "month"}
              onChange={setView}
              options={[
                { value: "month", label: t("months.view.month") },
                { value: "week", label: t("months.view.week") },
              ]}
            />
            {week ? (
              <>
                <Select className="w-72" value={week} onChange={(e) => setFilters({ ...filters, week: e.target.value })} aria-label={t("months.view.week")}>
                  {!weekInfo && <option value={week}>{weekLabel(week)}</option>}
                  {weekList.map((w) => (
                    <option key={w.week} value={w.week}>
                      {weekLabel(w.week)}
                      {w.current ? ` (${t("archive.inProgress")})` : ""}
                    </option>
                  ))}
                </Select>
                {weekInfo && <span className="text-xs text-muted">{t("archive.days", { n: weekInfo.days, from: dayLabel(weekInfo.first), to: dayLabel(weekInfo.last) })}</span>}
              </>
            ) : (
              <>
                <Select className="w-64" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("archive.month")}>
                  {list.map((m) => (
                    <option key={m.month} value={m.month}>
                      {monthLabel(m.month)}
                      {m.current ? ` (${t("archive.inProgress")})` : ""}
                    </option>
                  ))}
                </Select>
                {info && <span className="text-xs text-muted">{t("archive.days", { n: info.days, from: dayLabel(info.first), to: dayLabel(info.last) })}</span>}
              </>
            )}
          </div>
          {rk.error && <ErrorBox error={rk.error} />}
          {rk.isLoading && <Loading />}
          {rk.data && <CardsGrid initialDetail="offense" playerLink={playerLink} rows={rk.data.rows} adjust={adjust} cards={cards} setCard={setCard} />}
          <p className="mt-4 text-xs text-faint">{t("archive.note", { n: ARCHIVE_MONTHS })}</p>
          {week && <p className="mt-1 text-xs text-faint">{t("archive.weekNote")}</p>}
        </>
      )}
    </>
  );
}
