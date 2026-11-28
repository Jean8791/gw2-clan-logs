import { Link } from "react-router-dom";
import { overviewDefaults, ROUTES, type TimeAdjust } from "@gw2logs/shared";
import { FilterBar } from "../components/FilterBar";
import { CardsGrid } from "../components/CardsGrid";
import { GuildTag, Profession } from "../components/badges";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader } from "../components/ui";
import { useDays, useOverview, useRanking } from "../lib/api";
import { useCards, useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { accountShort, dateTime, dec, duration, int } from "../lib/format";

export function OverviewPage() {
  // abre no último dia de batalha com lutas; a lista de dias é a mesma do seletor de dia (já está em cache), e as consultas esperam por
  // ela para a tela não abrir nos 30 dias e trocar de dia depois
  const days = useDays({});
  const ready = !days.isLoading;
  const [filters, setFilters] = useFilters(overviewDefaults(days.data));
  const [cards, setCard] = useCards();
  const ov = useOverview(filters, ready);
  const rk = useRanking(filters, ready);
    // boons e uptime saem ajustados pelo tempo jogado, o mesmo número do Ranking com estes filtros
  const adjust: TimeAdjust | undefined = rk.data ? { baseline: rk.data.baseline, refMs: rk.data.referenceMs } : undefined;

  return (
    <>
      <PageHeader
        title={t("page.overview.title")}
        subtitle={t("page.overview.subtitle")}
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "guild", "role", "size"]} />

      {ov.error && <ErrorBox error={ov.error} />}
      {(!ready || ov.isLoading) && <Loading />}
      {ov.data && ov.data.fights === 0 && (
        <Card>
          <Empty title={t("overview.empty.title")}>
            {t("empty.changeFilters")}
          </Empty>
        </Card>
      )}
      {ov.data && ov.data.fights > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label={t("overview.kpi.fights")} value={int(ov.data.fights)} hint={`${dateTime(ov.data.first)} → ${dateTime(ov.data.last)}`} />
            <Kpi label={t("overview.kpi.time")} value={duration(ov.data.durationMs)} />
            <Kpi label={t("overview.kpi.kills")} value={int(ov.data.kills)} accent />
            <Kpi label={t("overview.kpi.deaths")} value={int(ov.data.deaths)} hint={`K/D ${dec(ov.data.deaths ? ov.data.kills / ov.data.deaths : ov.data.kills, 2)}`} />
            <Kpi label={t("overview.kpi.players")} value={int(ov.data.players)} />
          </div>

          <CardsGrid className="mt-6" initialDetail="offense" rows={rk.data?.rows ?? []} adjust={adjust} cards={cards} setCard={setCard} />
          
          {rk.data && rk.data.rows.length > 0 && (
            <Card className="mt-6" title={t("overview.mostActive")}>
              <div className="flex flex-wrap gap-2 p-4">
                {[...rk.data.rows]
                  .sort((a, b) => b.fights - a.fights)
                  .slice(0, 16)
                  .map((r) => (
                    <Link key={r.account} to={ROUTES.player(r.account)} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm hover:border-gold/50">
                      <Profession profession={r.profession} />
                      <span className="font-medium">{r.name ?? accountShort(r.account)}</span>
                      <GuildTag id={r.guildId} />
                      <span className="text-xs text-faint">{t("overview.fightsN", { n: r.fights })}</span>
                    </Link>
                  ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
