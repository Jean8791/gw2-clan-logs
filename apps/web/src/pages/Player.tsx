import { GitCompareArrows, Star, StarOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  filtersToQuery,
  isUptimeStat,
  perMinute,
  ROUTES,
  STAT_GROUPS,
  STAT_KEYS,
  STAT_META,
  statsOfGroup,
  statText,
  uptimeValue,
  type Aggregate,
  type PlayerHistoryRow,
  type PlayerSkill,
  type StatKey,
} from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { GuildTag, Profession } from "../components/badges";
import { AXIS, GRID, TOOLTIP } from "../components/charts";
import { PlayerPicker } from "../components/PlayerPicker";
import { SkillIcon } from "../components/MediaIcon";
import { Badge, Button, Card, Delta, Empty, ErrorBox, Kpi, Loading, PageHeader, Select, cx } from "../components/ui";
import { usePlayer, usePlayerSkills, useRanking } from "../lib/api";
import { mainRole, setMe, useFilters, useMe } from "../lib/hooks";
import { getLang, t as tr } from "../lib/i18n"; // "t" já é o total do jogador nesta página
import { BaselinePicker, type BaselineRole } from "../components/BaselinePicker";
import { accountShort, axis, compact, date, dateTime, diffPct, duration, int, stat } from "../lib/format";

const pm = (a: Aggregate, k: StatKey) => (isUptimeStat(k) ? uptimeValue(k, a[k], a.activeMs) : STAT_META[k].format === "volume" ? (a.fights ? a[k] / a.fights : 0) : perMinute(a[k], a.activeMs));

/** Barra comparando o jogador com a média do squad (mesmos filtros). */
function VsAverage({ k, player, avg }: { k: StatKey; player: Aggregate; avg: Aggregate }) {
  const meta = STAT_META[k];
  const a = pm(player, k);
  const b = pm(avg, k);
  const max = Math.max(a, b) || 1;
  // a unidade vem escrita: sem ela, "26,5 mil" de dano recebido parecia o total, e é por minuto
  const unit = isUptimeStat(k) ? "" : meta.format === "volume" ? tr("unit.perFight") : "/min";
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 py-1.5">
      <span className="truncate text-sm text-muted" title={statText(k, getLang()).hint}>
        {statText(k, getLang()).label}
      </span>
      <div className="relative h-2.5 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gold/80" style={{ width: `${(a / max) * 100}%` }} />
        <div className="absolute -inset-y-1 w-0.5 rounded bg-text/70" style={{ left: `calc(${(b / max) * 100}% - 1px)` }} title={tr("player.avgTip", { value: stat(k, b, true) })} />
      </div>
      <div className="flex w-40 items-center justify-end gap-2">
        <span className="tabular text-sm font-medium">
          {stat(k, a, true)}
          {unit && <span className="ml-0.5 text-xs font-normal text-faint">{unit}</span>}
        </span>
        <Delta pct={diffPct(a, b)} higherIsBetter={meta.higherIsBetter} />
      </div>
    </div>
  );
}

export function PlayerPage() {
  const { account = "" } = useParams();
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const { data, error, isLoading } = usePlayer(account, filters);
  const skills = usePlayerSkills(account, filters).data ?? [];
  // por padrão compara com a média de quem joga na mesma função (suporte com suporte, DPS com DPS)
  const [baseRole, setBaseRole] = useState<BaselineRole | null>(null);
  const effRole: BaselineRole = baseRole ?? (data ? mainRole(data.history) : "dps");
  const avg = useRanking({ ...filters, role: effRole === "all" ? filters.role : effRole }).data?.baseline;
  const me = useMe();
  const nav = useNavigate();
  const [metric, setMetric] = useState<StatKey>("damage");
  const [group, setGroup] = useState(STAT_GROUPS[0]!.id);

  const series = useMemo(
    () =>
      (data?.history ?? []).map((h, i) => ({
        i: i + 1,
        label: dateTime(h.timeStart),
        value: isUptimeStat(metric) ? uptimeValue(metric, h[metric], h.activeMs) : STAT_META[metric].format === "volume" ? h[metric] : perMinute(h[metric], h.activeMs),
      })),
    [data, metric],
  );
  const avgLine = avg ? pm(avg, metric) : null;

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const t = data.totals;
  const isMe = me === account;

  const skillCols: Column<PlayerSkill>[] = [
    {
      id: "skill",
      header: tr("skills.col.skill"),
      sort: (k) => k.name ?? "",
      cell: (k) => (
        <span className="inline-flex items-center gap-2">
          <SkillIcon id={k.skillId} />
          {k.name ?? `#${k.skillId}`}
        </span>
      ),
    },
    { id: "damage", header: tr("skills.col.damage"), align: "right", sort: (k) => k.damage, cell: (k) => compact(k.damage) },
    {
      id: "pct",
      header: tr("skills.col.pct"),
      align: "right",
      sort: (k) => k.pct,
      cell: (k) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="h-1.5 w-16 rounded-full bg-surface-3">
            <span className="block h-1.5 rounded-full bg-gold/70" style={{ width: `${Math.min(100, k.pct)}%` }} />
          </span>
          <span className="w-12 text-right">{k.pct.toFixed(1).replace(".", ",")}%</span>
        </span>
      ),
    },
    { id: "hits", header: tr("skills.col.hits"), align: "right", sort: (k) => k.connectedHits, cell: (k) => int(k.connectedHits), title: tr("skills.col.hitsTitle") },
    { id: "avg", header: tr("skills.col.avg"), align: "right", sort: (k) => k.avgHit, cell: (k) => compact(k.avgHit) },
  ];

  const histCols: Column<PlayerHistoryRow>[] = [
    { id: "when", header: tr("hist.col.when"), fixed: true, sort: (h) => h.timeStart, cell: (h) => <span className="text-muted">{dateTime(h.timeStart)}</span> },
    { id: "map", header: tr("hist.col.map"), sort: (h) => h.mapName ?? "", cell: (h) => <Link className="hover:text-gold" to={ROUTES.fight(h.fightId)}>{h.fightName ?? h.mapName}</Link> },
    { id: "prof", header: tr("table.class"), sort: (h) => h.profession ?? "", cell: (h) => <Profession profession={h.profession} /> },
    { id: "role", header: tr("fight.col.role"), sort: (h) => h.role, cell: (h) => (h.role === "support" ? <Badge tone="info">{tr("fight.role.support")}</Badge> : <Badge>{tr("fight.role.dps")}</Badge>) },
    { id: "guild", header: tr("table.guild"), cell: (h) => <GuildTag id={h.guildId} /> },
    { id: "time", header: tr("table.time"), align: "right", sort: (h) => h.activeMs, cell: (h) => duration(h.activeMs) },
    { id: "damage", header: tr("skills.col.damage"), align: "right", sort: (h) => h.damage, cell: (h) => compact(h.damage) },
    { id: "kills", header: tr("hist.col.kills"), align: "right", sort: (h) => h.kills, cell: (h) => h.kills },
    { id: "strips", header: tr("hist.col.strips"), align: "right", sort: (h) => h.strips, cell: (h) => h.strips },
    { id: "cleanses", header: tr("hist.col.cleanses"), align: "right", sort: (h) => h.cleanses, cell: (h) => h.cleanses },
    { id: "healing", header: tr("hist.col.healing"), align: "right", sort: (h) => h.healing, cell: (h) => compact(h.healing) },
    { id: "deaths", header: tr("hist.col.deaths"), align: "right", sort: (h) => h.deaths, cell: (h) => <span className={h.deaths ? "text-bad" : "text-faint"}>{h.deaths}</span> },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.name ?? accountShort(account)}
            {isMe && <Badge tone="gold">{tr("common.you")}</Badge>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{account}</span>
            {data.guilds.slice(0, 3).map((g) => (
              <GuildTag key={g.guildId} id={g.guildId} withName />
            ))}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setMe(isMe ? null : account)}>
              {isMe ? <StarOff className="size-4" /> : <Star className="size-4" />} {isMe ? tr("common.notMe") : tr("common.me")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const others = me && me !== account ? [me, account] : [account];
                const q = filtersToQuery(filters);
                nav(`${ROUTES.compare}?accounts=${encodeURIComponent(others.join(","))}${q ? `&${q}` : ""}`);
              }}
            >
              <GitCompareArrows className="size-4" /> {me && me !== account ? tr("player.compareWithMe") : tr("common.compare")}
            </Button>
          </>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "role", "profession", "size", "map"]} />

      {data.history.length === 0 ? (
        <Card>
          <Empty title={tr("player.empty.title")}>{tr("player.empty.text")}</Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label={tr("overview.kpi.fights")} value={int(t.fights)} hint={`${date(data.history[0]?.timeStart)} → ${date(data.history.at(-1)?.timeStart)}`} />
            <Kpi label={tr("overview.kpi.time")} value={duration(t.activeMs)} />
            <Kpi label={tr("player.kpi.damagePerMin")} value={compact(perMinute(t.damage, t.activeMs))} accent hint={avg && <Delta pct={diffPct(pm(t, "damage"), pm(avg, "damage"))} />} />
            <Kpi label={tr("hist.col.kills")} value={int(t.kills)} hint={tr("player.kpi.downs", { n: int(t.downs) })} />
            <Kpi label={tr("player.kpi.stripsPerMin")} value={stat("strips", perMinute(t.strips, t.activeMs), true)} hint={avg && <Delta pct={diffPct(pm(t, "strips"), pm(avg, "strips"))} />} />
            <Kpi label={tr("overview.kpi.deaths")} value={int(t.deaths)} hint={tr("player.kpi.timesDowned", { n: int(t.timesDowned) })} />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card
              title={tr("player.evolution")}
              action={
                <Select className="w-52" value={metric} onChange={(e) => setMetric(e.target.value as StatKey)} aria-label={tr("player.metric")}>
                  {STAT_GROUPS.map((g) => (
                    <optgroup key={g.id} label={tr(`group.${g.id}`)}>
                      {statsOfGroup(g.id).map((k) => (
                        <option key={k} value={k}>
                          {statText(k, getLang()).label}
                          {STAT_META[k].format === "volume" || isUptimeStat(k) ? "" : " / min"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              }
            >
              <div className="h-72 px-2 py-4">
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="i" {...AXIS} />
                    <YAxis {...AXIS} width={56} tickFormatter={axis} />
                    <Tooltip {...TOOLTIP} labelFormatter={(_l, p) => p?.[0]?.payload?.label ?? ""} formatter={(v: number) => [stat(metric, v, true), statText(metric, getLang()).label]} />
                    {avgLine != null && <ReferenceLine y={avgLine} stroke="#8f98a8" strokeDasharray="4 4" label={{ value: tr(`player.avgLine.${effRole}`), fill: "#8f98a8", fontSize: 11, position: "insideTopRight" }} />}
                    <Line type="monotone" dataKey="value" stroke="#e0b25a" strokeWidth={2.5} dot={{ r: 3, fill: "#e0b25a" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title={tr("player.classes")}>
              <ul className="flex flex-col gap-2 p-4">
                {data.professions.map((p) => (
                  <li key={p.profession} className="flex items-center gap-3">
                    <div className="w-32 shrink-0">
                      <Profession profession={p.profession} />
                    </div>
                    <div className="h-2 flex-1 rounded-full bg-surface-3">
                      <div className="h-2 rounded-full bg-gold/70" style={{ width: `${(p.fights / t.fights) * 100}%` }} />
                    </div>
                    <span className="tabular w-16 text-right text-sm text-muted">{tr("overview.fightsN", { n: p.fights })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {avg && (
            <Card
              className="mt-6"
              title={tr("player.vsAverage")}
              action={
                <div className="flex flex-wrap items-center gap-3">
                <BaselinePicker value={effRole} onChange={setBaseRole} />
                <div className="flex gap-1">
                  {STAT_GROUPS.map((g) => (
                    <button key={g.id} onClick={() => setGroup(g.id)} className={cx("rounded-md px-2 py-1 text-xs font-medium", group === g.id ? "bg-surface-3 text-gold" : "text-muted hover:text-text")}>
                      {tr(`group.${g.id}`)}
                    </button>
                  ))}
                </div>
                </div>
              }
            >
              <div className="grid gap-x-10 px-5 py-3 lg:grid-cols-2">
                {STAT_KEYS.filter((k) => STAT_META[k].group === group).map((k) => (
                  <VsAverage key={k} k={k} player={t} avg={avg} />
                ))}
              </div>
              <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
                {tr("player.vsNote")}
              </p>
            </Card>
          )}

          {skills.length > 0 && (
            <Card className="mt-6" title={tr("player.skills")}>
              <DataTable rows={skills.slice(0, 25)} columns={skillCols} rowKey={(k) => String(k.skillId)} dense />
              <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
                {tr("player.skillsNote")}
              </p>
            </Card>
          )}

          <Card className="mt-6" title={tr("player.history")}>
            <DataTable pickerKey="player-history" rows={[...data.history].reverse()} columns={histCols} rowKey={(h) => h.fightId} dense />
          </Card>
        </>
      )}
    </>
  );
}

export function MePage() {
  const me = useMe();
  if (me) return <Navigate to={ROUTES.player(me)} replace />;
  return (
    <>
      <PageHeader title={tr("page.me.title")} subtitle={tr("page.me.subtitle")} />
      <Card className="max-w-xl p-5">
        <PlayerPicker onPick={(a) => setMe(a)} button={tr("common.me")} />
        <p className="mt-3 text-xs text-faint">{tr("me.note")}</p>
      </Card>
    </>
  );
}
