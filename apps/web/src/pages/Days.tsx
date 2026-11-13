import { Link, useNavigate } from "react-router-dom";
import { filtersToQuery, ROUTES, type DaySummary } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { KillDeath } from "../components/FightBits";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useDays } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { dayLabel, duration, int } from "../lib/format";

const link = (path: string, day: string) => `${path}?${filtersToQuery({ mode: "wvw", day: [day] })}`;

const columns = (): Column<DaySummary>[] => [
  { id: "day", header: t("days.col.day"), sort: (d) => d.day, cell: (d) => <span className="font-medium capitalize">{dayLabel(d.day)}</span> },
  { id: "fights", header: t("days.col.fights"), align: "right", sort: (d) => d.fights, cell: (d) => int(d.fights) },
  { id: "time", header: t("days.col.time"), align: "right", sort: (d) => d.durationMs, cell: (d) => duration(d.durationMs) },
  { id: "players", header: t("days.col.players"), align: "right", sort: (d) => d.players, cell: (d) => int(d.players) },
  { id: "kd", header: t("days.col.kd"), align: "right", sort: (d) => d.kills - d.deaths, cell: (d) => <KillDeath kills={d.kills} deaths={d.deaths} /> },
  {
    id: "go",
    header: t("days.col.go"),
    align: "right",
    cell: (d) => (
      <span className="inline-flex gap-3 text-gold">
        <Link to={link(ROUTES.fights, d.day)} onClick={(e) => e.stopPropagation()} className="hover:underline">
          {t("days.link.fights")}
        </Link>
        <Link to={link(ROUTES.ranking, d.day)} onClick={(e) => e.stopPropagation()} className="hover:underline">
          {t("days.link.ranking")}
        </Link>
      </span>
    ),
  },
];

export function DaysPage() {
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const { data, error, isLoading } = useDays(filters);
  const nav = useNavigate();

  return (
    <>
      <PageHeader title={t("page.days.title")} subtitle={t("page.days.subtitle")} />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "guild", "size", "map"]} />
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Card>
          {data.length === 0 ? (
            <Empty title={t("days.empty.title")}>{t("empty.changeFilters")}</Empty>
          ) : (
            <DataTable rows={data} columns={columns()} rowKey={(d) => d.day} initialSort={{ id: "day", desc: true }} onRowClick={(d) => nav(link(ROUTES.fights, d.day))} />
          )}
        </Card>
      )}
    </>
  );
}
