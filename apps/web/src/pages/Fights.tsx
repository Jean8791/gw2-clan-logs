import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FIGHT_SORT_KEYS, PAGE_SIZE, pageCount, ROUTES, type Fight } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { Pagination } from "../components/Pagination";
import { FightStatus, fightKills, KillDeath, SquadVsEnemy, Won } from "../components/FightBits";
import { NoAllianceNote } from "../components/badges";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { useFightsPage } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { compact, dateTimeSeconds, duration } from "../lib/format";

const columns = (): Column<Fight>[] => [
  { id: "result", header: "", cell: (f) => <Won fight={f} />, align: "center" },
  {
    id: "time",
    header: t("fights.col.when"),
    fixed: true,
    sort: (f) => f.timeStart ?? f.uploadedAt,
    cell: (f) => <span className="text-muted">{dateTimeSeconds(f.timeStart ?? f.uploadedAt)}</span>,
  },
  {
    id: "name",
    header: t("fights.col.name"),
    sort: (f) => f.fightName ?? f.fileName ?? "",
    cell: (f) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{f.fightName ?? f.fileName}</span>
        <FightStatus fight={f} />
      </div>
    ),
  },
  { id: "dur", header: t("fights.col.duration"), align: "right", sort: (f) => f.durationMs, cell: (f) => duration(f.durationMs) },
  { id: "size", header: t("fights.col.size"), align: "right", sort: (f) => f.squadCount, cell: (f) => <SquadVsEnemy fight={f} /> },
  { id: "kd", header: t("fights.col.kd"), align: "right", sort: (f) => (fightKills(f) ?? 0) - (f.squadDeaths ?? 0), cell: (f) => <KillDeath kills={fightKills(f)} deaths={f.squadDeaths} /> },
  { id: "dmg", header: t("fights.col.damage"), align: "right", sort: (f) => f.squadDamage, cell: (f) => compact(f.squadDamage) },
];

export function FightsPage() {
  const [filters, setFilters] = useFilters();
  // página, coluna e sentido ficam na URL, junto dos filtros: o link compartilhado abre na mesma página e na mesma ordem
  const [params, setParams] = useSearchParams();
  const page = Math.max(Math.floor(Number(params.get("page"))) || 1, 1);
  const sortParam = params.get("sort") ?? "";
  const sort = (FIGHT_SORT_KEYS as readonly string[]).includes(sortParam) ? { id: sortParam, desc: params.get("dir") !== "asc" } : { id: "time", desc: true };
  const { data, error, isLoading } = useFightsPage(filters, { page, sort: sort.id, dir: sort.desc ? "desc" : "asc" });
  const nav = useNavigate();

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
        return p;
      },
      { replace: true },
    );
  const pages = pageCount(data?.total ?? 0, PAGE_SIZE);
  // link com página além da última (ou lutas apagadas depois): cai na última página, em vez de mostrar "nenhuma luta"
  useEffect(() => {
    if (data && data.total > 0 && page > pages) update({ page: pages <= 1 ? null : String(pages) });
  });

  return (
    <>
      <PageHeader title={t("page.fights.title")} subtitle={t("page.fights.subtitle")} />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "week", "map", "size", "duration", "guild"]} />
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Card className="flex min-h-0 flex-1 flex-col">
          {data.rows.length === 0 ? (
            <Empty title={t("fights.empty.title")}>
              {t("empty.changeFilters")}
              <NoAllianceNote guild={filters.guild} />
            </Empty>
          ) : (
            <>
              {/* a ordenação é do servidor: vale para todas as lutas do filtro, não só para esta página */}
              <DataTable
                pickerKey="fights"
                fill
                rows={data.rows}
                columns={columns()}
                rowKey={(f) => f.id}
                sort={sort}
                onSortChange={(s) => update({ sort: s.id, dir: s.desc ? "desc" : "asc", page: null })}
                onRowClick={(f) => f.status === "done" && nav(ROUTES.fight(f.id))}
                bar={(picker) =>
                  data.total > PAGE_SIZE ? (
                    <Pagination page={Math.min(page, pages)} pages={pages} total={data.total} onPage={(p) => update({ page: p <= 1 ? null : String(p) })} extra={picker} />
                  ) : null
                }
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
