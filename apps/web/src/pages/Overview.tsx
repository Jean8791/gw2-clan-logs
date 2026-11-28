import { ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ARCHIVE_MONTHS, cardHigherIsBetter, cardOptions, cardUnit, HEALING_BARRIER, isCardRate, isMonth, overviewDefaults, perSecond, ROUTES, STAT_GROUPS, statText, topByCard,
  type CardMetric, type Cards, type Filters, type RankingRow, type StatGroup, type StatKey, type TimeAdjust,
} from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { FightStatus, fightKills, KillDeath, SquadVsEnemy, Won } from "../components/FightBits";
import { GuildTag, PlayerLink, Profession, ProfessionDot } from "../components/badges";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader, Select, cx } from "../components/ui";
import { useArchiveMonths, useArchiveRanking, useDays, useOverview, useRanking } from "../lib/api";
import { useCards, useFilters } from "../lib/hooks";
import { getLang, t } from "../lib/i18n";
import { accountShort, compact, dateTime, dayLabel, dec, duration, int, monthLabel, stat } from "../lib/format";

/** Precisa de pelo menos 2 min de luta para entrar nos destaques (evita quem apareceu 10 s). */
const MIN_ACTIVE_MS = 120_000;

const metricName = (m: CardMetric) => (m === HEALING_BARRIER ? t("overview.card.healingBarrier") : statText(m, getLang()).label);
/** Cura + barreira mostra os números como a cura. */
const formatKey = (m: CardMetric): StatKey => (m === HEALING_BARRIER ? "healing" : m);
const totalOf = (row: RankingRow, m: CardMetric) => (m === HEALING_BARRIER ? row.healing + row.barrier : row[m]);

const UNIT_TEXT = { perMin: "rate.perMin", pctTime: "overview.card.pctTime", avgTime: "overview.card.avgTime" } as const;

/** Um card por grupo de métricas: o top 5 da métrica escolhida no seletor do cabeçalho; o detalhe (top 10) fica no rodapé. */
function Leaderboard({ group, metric, rows, adjust, open, onMetric, onDetail }: { group: StatGroup; metric: CardMetric; rows: RankingRow[]; adjust?: TimeAdjust; open: boolean; onMetric: (m: CardMetric) => void; onDetail: () => void }) {
  const top = topByCard(rows, metric, 5, MIN_ACTIVE_MS, adjust);
  const rate = isCardRate(metric);
  const higher = cardHigherIsBetter(metric);
  const best = top[0]?.value ?? 1;
  // a barra do melhor é a mais comprida; quando menos é melhor, o menor valor é o melhor
  const width = (v: number) => (higher ? v / best : best / v) * 100;
  const groupName = t(`group.${group}`);
  const notes = [t(UNIT_TEXT[cardUnit(metric)]), !higher && t("overview.card.lessIsBetter")].filter(Boolean).join(" · ");
  return (
    <Card
      className="flex flex-col"
      title={<span className="whitespace-nowrap">{groupName}</span>}
      action={
        <Select className="w-40" aria-label={t("overview.card.metric", { group: groupName })} value={metric} onChange={(e) => onMetric(e.target.value as CardMetric)}>
          {cardOptions(group).map((m) => (
            <option key={m} value={m}>
              {metricName(m)}
            </option>
          ))}
        </Select>
      }
    >
      {top.length === 0 ? (
        <p className="px-5 py-6 text-sm text-faint">{t("overview.noData")}</p>
      ) : (
        <ol className="flex flex-col gap-1 p-3">
          {top.map(({ row: r, value: v }, i) => (
            <li key={r.account}>
              <Link to={ROUTES.player(r.account)} className="relative flex items-center gap-3 overflow-hidden rounded-lg px-2.5 py-2 hover:bg-surface-2">
                <span className="absolute inset-y-0 left-0 bg-gold/8" style={{ width: `${width(v)}%` }} />
                <span className={`relative w-4 text-center text-xs font-bold ${i === 0 ? "text-gold" : "text-faint"}`}>{i + 1}</span>
                <ProfessionDot profession={r.profession} className="relative" />
                <span className="relative min-w-0 flex-1 truncate text-sm font-medium" title={r.name ?? accountShort(r.account)}>{r.name ?? accountShort(r.account)}</span>
                <span className="tabular relative text-sm font-semibold text-text">{stat(formatKey(metric), v, rate)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
        <span className="text-faint">{notes}</span>
        <button
          type="button"
          onClick={onDetail}
          aria-expanded={open}
          className={cx("rounded-md px-2 py-1 font-medium transition hover:bg-surface-2", open ? "bg-surface-3 text-gold" : "text-gold/80 hover:text-gold")}
        >
          {open ? t("overview.detail.close") : t("overview.detail")}
        </button>
      </div>
    </Card>
  );
}

/** Os 10 melhores de um card: nas contagens, o total, o por minuto e o por segundo; nos boons e no uptime, o valor ajustado pelo tempo jogado. */
function BoardDetail({ metric, rows, adjust, onClose }: { metric: CardMetric; rows: RankingRow[]; adjust?: TimeAdjust; onClose: () => void }) {
  const top = topByCard(rows, metric, 10, MIN_ACTIVE_MS, adjust);
  const key = formatKey(metric);
  const rate = isCardRate(metric);
  const columns: Column<(typeof top)[number]>[] = [
    { id: "pos", header: "#", align: "right", cell: (_x, i) => <span className="text-faint">{i + 1}</span> },
    { id: "player", header: t("table.player"), sticky: true, cell: (x) => <PlayerLink account={x.row.account} name={x.row.name} /> },
    { id: "prof", header: t("table.class"), sort: (x) => x.row.profession ?? "", cell: (x) => <Profession profession={x.row.profession} /> },
    { id: "guild", header: t("table.guild"), cell: (x) => <GuildTag id={x.row.guildId} /> },
    { id: "fights", header: t("table.fights"), align: "right", sort: (x) => x.row.fights, cell: (x) => x.row.fights },
    { id: "time", header: t("common.activeTime"), align: "right", sort: (x) => x.row.activeMs, cell: (x) => <span className="text-muted">{duration(x.row.activeMs)}</span> },
    ...(rate
      ? ([
          { id: "total", header: t("common.total"), align: "right", sort: (x) => totalOf(x.row, metric), cell: (x) => compact(totalOf(x.row, metric)) },
          { id: "value", header: t("common.perMinute"), align: "right", sort: (x) => x.value, cell: (x) => <span className="font-semibold">{stat(key, x.value, true)}</span> },
          { id: "perSec", header: t("common.perSecond"), align: "right", sort: (x) => x.value, cell: (x) => stat(key, perSecond(totalOf(x.row, metric), x.row.activeMs), false, true) },
        ] satisfies Column<(typeof top)[number]>[])
      : ([{ id: "value", header: metricName(metric), align: "right", sort: (x) => x.value, cell: (x) => <span className="font-semibold">{stat(key, x.value)}</span> }] satisfies Column<(typeof top)[number]>[])),
  ];
  return (
    <Card
      className="mt-4"
      title={t("overview.detail.title", { title: metricName(metric) })}
      action={
        <button type="button" onClick={onClose} aria-label={t("overview.detail.closeAria")} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
          <X className="size-4" />
        </button>
      }
    >
      <DataTable rows={top} columns={columns} rowKey={(x) => x.row.account} initialSort={{ id: "value", desc: cardHigherIsBetter(metric) }} dense />
      <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
        {t("overview.detail.note")}
      </p>
    </Card>
  );
}

/** Os cinco cards (um por grupo de métricas) e o top 10 do que estiver aberto; serve para o período escolhido e para um mês arquivado. */
function CardsGrid({ rows, adjust, cards, setCard, className }: { rows: RankingRow[]; adjust?: TimeAdjust; cards: Cards; setCard: (group: StatGroup, metric: CardMetric) => void; className?: string }) {
  const [detail, setDetail] = useState<StatGroup | null>(null);
  return (
    <div className={className}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {STAT_GROUPS.map((g) => (
          <Leaderboard
            key={g.id}
            group={g.id}
            metric={cards[g.id]}
            rows={rows}
            adjust={adjust}
            open={detail === g.id}
            onMetric={(m) => setCard(g.id, m)}
            onDetail={() => setDetail(detail === g.id ? null : g.id)}
          />
        ))}
      </div>
      {detail && <BoardDetail key={`${detail}:${cards[detail]}`} metric={cards[detail]} rows={rows} adjust={adjust} onClose={() => setDetail(null)} />}
    </div>
  );
}

/**
 * Meses anteriores: o Ranking de um mês arquivado, com os mesmos cards e as mesmas métricas escolhidas acima. Aberto e com o mês no
 * endereço (`month=`), para mandar o link. Vem do resumo diário, que fica guardado depois de as lutas serem apagadas.
 */
function MonthlySection({ filters, cards, setCard }: { filters: Filters; cards: Cards; setCard: (group: StatGroup, metric: CardMetric) => void }) {
  const [params, setParams] = useSearchParams();
  const open = params.has("month");
  const months = useArchiveMonths(open);
  const list = months.data ?? [];
  const asked = params.get("month") ?? "";
  // sem mês no endereço: o mais recente que já fechou; se só existe o mês em andamento, ele
  const month = isMonth(asked) ? asked : (list.find((m) => !m.current) ?? list[0])?.month;
  const info = list.find((m) => m.month === month);
  const rk = useArchiveRanking(month, filters, open);
  const adjust: TimeAdjust | undefined = rk.data ? { baseline: rk.data.baseline, refMs: rk.data.referenceMs } : undefined;
  const setMonth = (value: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === null) p.delete("month");
        else p.set("month", value);
        return p;
      },
      { replace: true },
    );
  return (
    <Card
      className="mt-6"
      title={t("archive.title")}
      action={
        <button type="button" onClick={() => setMonth(open ? null : "")} aria-expanded={open} className="rounded-md px-2 py-1 text-xs font-medium text-gold/80 transition hover:bg-surface-2 hover:text-gold">
          {open ? t("archive.close") : t("archive.open")}
        </button>
      }
    >
      {open && (
        <div className="p-4">
          {months.error && <ErrorBox error={months.error} />}
          {months.isLoading && <Loading />}
          {months.data && list.length === 0 && <p className="text-sm text-faint">{t("archive.empty")}</p>}
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
        </div>
      )}
    </Card>
  );
}

export function OverviewPage() {
  // abre no último dia de batalha com lutas; a lista de dias é a mesma do seletor de dia (já está em cache), e as consultas esperam por
  // ela para a tela não abrir nos 30 dias e trocar de dia depois
  const days = useDays({});
  const ready = !days.isLoading;
  const [filters, setFilters] = useFilters(overviewDefaults(days.data));
  const [cards, setCard] = useCards();
  const ov = useOverview(filters, ready);
  const rk = useRanking(filters, ready);
  const nav = useNavigate();
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

          <CardsGrid className="mt-6" rows={rk.data?.rows ?? []} adjust={adjust} cards={cards} setCard={setCard} />
          <MonthlySection filters={filters} cards={cards} setCard={setCard} />

          <Card
            className="mt-6"
            title={t("overview.recent")}
            action={
              <Link to={ROUTES.fights} className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
                {t("overview.seeAll")} <ArrowRight className="size-3" />
              </Link>
            }
          >
            <ul className="divide-y divide-line/60">
              {ov.data.recent.map((f) => (
                <li key={f.id}>
                  <button onClick={() => nav(ROUTES.fight(f.id))} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface-2/60 sm:grid-cols-[auto_1.4fr_1fr_1fr_auto]">
                    <Won fight={f} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{f.fightName}</div>
                      <div className="text-xs text-faint">{dateTime(f.timeStart)} · {duration(f.durationMs)}</div>
                    </div>
                    <div className="hidden sm:block">
                      <SquadVsEnemy fight={f} />
                    </div>
                    <div className="hidden text-sm text-muted sm:block">{t("overview.damage", { value: compact(f.squadDamage) })}</div>
                    <div className="flex items-center gap-2">
                      <FightStatus fight={f} />
                      <KillDeath kills={fightKills(f)} deaths={f.squadDeaths} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

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
