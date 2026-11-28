import { X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  cardHigherIsBetter, cardOptions, cardUnit, HEALING_BARRIER, isCardRate, perSecond, ROUTES, STAT_GROUPS, statText, topByCard,
  type CardMetric, type Cards, type RankingRow, type StatGroup, type StatKey, type TimeAdjust,
} from "@gw2logs/shared";
import { DataTable, type Column } from "./DataTable";
import { GuildTag, PlayerLink, Profession, ProfessionDot } from "./badges";
import { Card, Select, cx } from "./ui";
import { getLang, t } from "../lib/i18n";
import { accountShort, compact, duration, stat } from "../lib/format";

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

/** Os cinco cards (um por grupo de métricas) e o top 10 do que estiver aberto; serve para a Visão geral e para os meses anteriores. */
export function CardsGrid({ rows, adjust, cards, setCard, className, initialDetail = null }: { rows: RankingRow[]; adjust?: TimeAdjust; cards: Cards; setCard: (group: StatGroup, metric: CardMetric) => void; className?: string; initialDetail?: StatGroup | null }) {
  const [detail, setDetail] = useState<StatGroup | null>(initialDetail);
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
