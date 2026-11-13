import { useNavigate } from "react-router-dom";
import { ROUTES, type Fight } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { FightStatus, KillDeath, SquadVsEnemy, Won } from "../components/FightBits";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useFights } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { compact, dateTime, duration } from "../lib/format";

const columns: Column<Fight>[] = [
  { id: "result", header: "", cell: (f) => <Won fight={f} />, align: "center" },
  {
    id: "time",
    header: "Quando",
    fixed: true,
    sort: (f) => f.timeStart ?? f.uploadedAt,
    cell: (f) => <span className="text-muted">{dateTime(f.timeStart ?? f.uploadedAt)}</span>,
  },
  {
    id: "name",
    header: "Luta",
    sort: (f) => f.fightName ?? f.fileName ?? "",
    cell: (f) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{f.fightName ?? f.fileName}</span>
        <FightStatus fight={f} />
      </div>
    ),
  },
  { id: "dur", header: "Duração", align: "right", sort: (f) => f.durationMs, cell: (f) => duration(f.durationMs) },
  { id: "size", header: "Squad vs inimigos", align: "right", sort: (f) => f.squadCount, cell: (f) => <SquadVsEnemy fight={f} /> },
  { id: "kd", header: "Kills / mortes", align: "right", sort: (f) => (f.squadKills ?? 0) - (f.squadDeaths ?? 0), cell: (f) => <KillDeath kills={f.squadKills} deaths={f.squadDeaths} /> },
  { id: "dmg", header: "Dano do squad", align: "right", sort: (f) => f.squadDamage, cell: (f) => compact(f.squadDamage) },
  { id: "up", header: "Enviado por", sort: (f) => f.uploader ?? "", cell: (f) => <span className="text-muted">{f.uploader ?? f.recordedBy ?? "—"}</span> },
];

export function FightsPage() {
  const [filters, setFilters] = useFilters();
  const { data, error, isLoading } = useFights(filters, 300);
  const nav = useNavigate();

  return (
    <>
      <PageHeader title={t("page.fights.title")} subtitle={t("page.fights.subtitle")} />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "map", "size", "duration", "guild"]} />
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Card>
          {data.length === 0 ? (
            <Empty title="Nenhuma luta encontrada">Mude os filtros ou envie novos logs.</Empty>
          ) : (
            <DataTable pickerKey="fights" rows={data} columns={columns} rowKey={(f) => f.id} onRowClick={(f) => f.status === "done" && nav(ROUTES.fight(f.id))} />
          )}
        </Card>
      )}
    </>
  );
}
