import { Link, useNavigate } from "react-router-dom";
import { filtersToQuery, type DaySummary } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { KillDeath } from "../components/FightBits";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useDays } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { dayLabel, duration, int } from "../lib/format";

const link = (page: string, day: string) => `/${page}?${filtersToQuery({ mode: "wvw", day: [day] })}`;

const columns: Column<DaySummary>[] = [
  { id: "day", header: "Dia", sort: (d) => d.day, cell: (d) => <span className="font-medium capitalize">{dayLabel(d.day)}</span> },
  { id: "fights", header: "Lutas", align: "right", sort: (d) => d.fights, cell: (d) => int(d.fights) },
  { id: "time", header: "Tempo de luta", align: "right", sort: (d) => d.durationMs, cell: (d) => duration(d.durationMs) },
  { id: "players", header: "Jogadores", align: "right", sort: (d) => d.players, cell: (d) => int(d.players) },
  { id: "kd", header: "Kills / mortes", align: "right", sort: (d) => d.kills - d.deaths, cell: (d) => <KillDeath kills={d.kills} deaths={d.deaths} /> },
  {
    id: "go",
    header: "Ver",
    align: "right",
    cell: (d) => (
      <span className="inline-flex gap-3 text-gold">
        <Link to={link("lutas", d.day)} onClick={(e) => e.stopPropagation()} className="hover:underline">
          Lutas
        </Link>
        <Link to={link("ranking", d.day)} onClick={(e) => e.stopPropagation()} className="hover:underline">
          Ranking
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
      <PageHeader title="Dias de batalha" subtitle="Cada dia vai das 06:00 às 06:00 (Brasília): a noite que passa da meia-noite continua no mesmo dia." />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "guild", "size", "map"]} />
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Card>
          {data.length === 0 ? (
            <Empty title="Nenhum dia encontrado">Mude os filtros ou envie novos logs.</Empty>
          ) : (
            <DataTable rows={data} columns={columns} rowKey={(d) => d.day} initialSort={{ id: "day", desc: true }} onRowClick={(d) => nav(link("lutas", d.day))} />
          )}
        </Card>
      )}
    </>
  );
}
