import { useSearchParams } from "react-router-dom";
import { ARCHIVE_MONTHS, isMonth, ROUTES, type TimeAdjust } from "@gw2logs/shared";
import { CardsGrid } from "../components/CardsGrid";
import { FilterBar } from "../components/FilterBar";
import { PeriodPicker } from "../components/PeriodPicker";
import { Card, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useArchiveMonths, useArchiveRanking, useArchiveWeeks } from "../lib/api";
import { useCards, useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";

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
  // com semana no filtro, a página mostra a semana (no endereço, `week=`); sem ela, o mês
  const week = filters.week;
  const rk = useArchiveRanking(month, filters, true);
  const adjust: TimeAdjust | undefined = rk.data ? { baseline: rk.data.baseline, refMs: rk.data.referenceMs } : undefined;
  const setPeriod = (p: { month?: string; week?: string }) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p.month) next.set("month", p.month);
        if (p.week) next.set("week", p.week);
        else next.delete("week");
        return next;
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
          <PeriodPicker months={list} weeks={weekList} month={month} week={week} onChange={setPeriod} />
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
