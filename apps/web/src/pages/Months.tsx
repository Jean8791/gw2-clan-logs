import { useSearchParams } from "react-router-dom";
import { ARCHIVE_MONTHS, isMonth, type TimeAdjust } from "@gw2logs/shared";
import { CardsGrid } from "../components/CardsGrid";
import { FilterBar } from "../components/FilterBar";
import { Card, ErrorBox, Loading, PageHeader, Select } from "../components/ui";
import { useArchiveMonths, useArchiveRanking } from "../lib/api";
import { useCards, useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { dayLabel, monthLabel } from "../lib/format";

/**
 * Meses anteriores: o Ranking de um mês arquivado, com os mesmos cards da Visão geral e as mesmas métricas escolhidas. O mês vai no endereço
 * (`month=`), para mandar o link. Vem do resumo diário, que fica guardado depois de as lutas serem apagadas.
 */
export function MonthsPage() {
  const [filters, setFilters] = useFilters({});
  const [cards, setCard] = useCards();
  const [params, setParams] = useSearchParams();
  const months = useArchiveMonths(true);
  const list = months.data ?? [];
  const asked = params.get("month") ?? "";
  // sem mês no endereço: o mais recente que já fechou; se só existe o mês em andamento, ele
  const month = isMonth(asked) ? asked : (list.find((m) => !m.current) ?? list[0])?.month;
  const info = list.find((m) => m.month === month);
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
      {month && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select className="w-64" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("archive.month")}>
              {list.map((m) => (
                <option key={m.month} value={m.month}>
                  {monthLabel(m.month)}
                  {m.current ? ` (${t("archive.inProgress")})` : ""}
                </option>
              ))}
            </Select>
            {info && <span className="text-xs text-muted">{t("archive.days", { n: info.days, from: dayLabel(info.first), to: dayLabel(info.last) })}</span>}
          </div>
          {rk.error && <ErrorBox error={rk.error} />}
          {rk.isLoading && <Loading />}
          {rk.data && <CardsGrid rows={rk.data.rows} adjust={adjust} cards={cards} setCard={setCard} />}
          <p className="mt-4 text-xs text-faint">{t("archive.note", { n: ARCHIVE_MONTHS })}</p>
        </>
      )}
    </>
  );
}
