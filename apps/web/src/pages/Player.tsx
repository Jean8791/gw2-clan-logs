import { GitCompareArrows, Star, StarOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BOON_SCOPES,
  filtersToQuery,
  inScope,
  isShortParticipation,
  adjustedByTime,
  isUptimeStat,
  metricForGroup,
  PAGE_SIZE,
  perMinute,
  ROUTES,
  STAT_GROUPS,
  STAT_META,
  statRate,
  statsOfGroup,
  statText,
  suggestMetric,
  hasStatData,
  isTagStat,
  tagTotal,
  uptimeValue,
  weightedByActive,
  type Aggregate,
  type BoonScope,
  type PlayerHistoryRow,
  type SkillKind,
  SKILL_KINDS,
  type StatGroup,
  type StatKey,
} from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { GuildTag, Profession } from "../components/badges";
import { AXIS, GRID, TOOLTIP } from "../components/charts";
import { PlayerPicker } from "../components/PlayerPicker";
import { pickerView, statColumns } from "../components/statColumns";
import { SkillsBody } from "../components/SkillTables";
import { Badge, Button, Card, Delta, Empty, ErrorBox, Kpi, Loading, PageHeader, Segmented, Select, cx } from "../components/ui";
import { usePlayer, usePlayerOptions, usePlayerSkillUsage, usePlayerSkills, usePlayerSupportSkills, useRanking } from "../lib/api";
import { setMe, useFilters, useMe } from "../lib/hooks";
import { getLang, t as tr } from "../lib/i18n"; // "t" já é o total do jogador nesta página
import { ScopeToggle } from "../components/statColumns";
import { accountShort, axis, compact, date, dateTime, diffPct, duration, int, stat } from "../lib/format";

export function PlayerPage() {
  const { account = "" } = useParams();
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const { data, error, isLoading } = usePlayer(account, filters);
  // a tabela de habilidades mostra dano, cura ou barreira; cura e barreira só buscam quando escolhidas
  const [skillKind, setSkillKind] = useState<SkillKind>("damage");
  const isSupport = skillKind === "heal" || skillKind === "barrier";
  const isUsage = skillKind === "cast" || skillKind === "taken";
  const skillsQuery = usePlayerSkills(account, filters);
  const skills = skillsQuery.data ?? [];
  const support = usePlayerSupportSkills(account, filters, isSupport ? skillKind : "heal", isSupport);
  const usage = usePlayerSkillUsage(account, filters, isUsage ? skillKind : "cast", isUsage);
  const shown = isSupport ? support : isUsage ? usage : skillsQuery;
  // a média de comparação segue os mesmos filtros da página (período, função, classe, tamanho, mapa); sem filtro de função, é a do squad todo
  const ranking = useRanking(filters).data;
  const avg = ranking?.baseline;
  const me = useMe();
  const nav = useNavigate();
  // listas dos filtros: só o que este jogador jogou (funções, classes e dias)
  const options = usePlayerOptions(account, filters).data;
  // Com UM dia escolhido, o gráfico abre na métrica em que o jogador mais se destacou naquele dia frente ao squad todo (todas as funções:
  // contra quem joga a mesma função ou classe, uma cura mínima de um DPS pareceria enorme). A escolha manual vale até trocar o dia.
  const squad = useRanking({ ...filters, role: undefined, profession: undefined }).data?.baseline;
  const dayKey = filters.day?.length === 1 ? filters.day[0]! : null;
  const [picked, setPicked] = useState<{ day: string | null; metric: StatKey } | null>(null);
  const suggested: StatKey = dayKey && data ? suggestMetric(data.totals, squad) : "damage";
  const manual = picked && picked.day === dayKey ? picked.metric : null;
  const metric = manual ?? suggested;
  const chartGroup = STAT_META[metric].group;
  // nos boons há um terceiro seletor, o alcance (para o squad, para o grupo ou só para você): sem ele a lista misturava os três
  const chartScope: BoonScope = STAT_META[metric].scope ?? "squad";
  // O cartão "vs média" e o gráfico seguem o MESMO grupo e o mesmo alcance (os dois vêm da métrica do gráfico): trocar num muda o outro.
  // O alcance escolhido fica guardado para quando se volta ao grupo Boons.
  const [boonScope, setBoonScope] = useState<BoonScope>("squad");
  const selectGroup = (g: StatGroup) => setPicked({ day: dayKey, metric: metricForGroup(g, boonScope) });
  const selectScope = (s: BoonScope) => {
    setBoonScope(s);
    setPicked({ day: dayKey, metric: inScope(metric, s) });
  };

  const series = useMemo(
    () =>
      (data?.history ?? []).filter((h) => hasStatData(metric, h)).map((h, i) => ({
        i: i + 1,
        label: dateTime(h.timeStart),
        activeMs: h.activeMs,
        // pouca participação (morreu cedo): continua no gráfico, com o valor real, mas o ponto é marcado
        short: isShortParticipation(h.activeMs),
        value: isUptimeStat(metric) ? uptimeValue(metric, h[metric], h.activeMs) : STAT_META[metric].format === "volume" ? h[metric] : perMinute(h[metric], h.activeMs),
      })),
    [data, metric],
  );
  const avgLine = avg ? statRate(avg, metric) : null;

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const t = data.totals;
  const isMe = me === account;

  // Linha "Total": cada coluna mostra o mesmo valor do Ranking. Soma das lutas filtradas; em boons e uptime, a média ponderada pelo tempo
  // ajustada pelo tempo jogado (a conta vai na dica).
  const sumOf = (rows: PlayerHistoryRow[], k: StatKey) => rows.reduce((a, r) => a + r[k], 0);
  const totalOf = (k: StatKey) => (all: PlayerHistoryRow[]) => {
    // as métricas da tag só somam as lutas que têm o dado (as lutas de logs sem replay ficam de fora, também do tempo)
    const rows = all.filter((r) => hasStatData(k, r));
    if (!rows.length) return "—";
    const active = rows.reduce((a, r) => a + r.activeMs, 0);
    if (!isUptimeStat(k) && STAT_META[k].format !== "volume") return int(sumOf(rows, k));
    const own = isTagStat(k) ? uptimeValue(k, tagTotal(k, rows), active) : isUptimeStat(k) ? uptimeValue(k, sumOf(rows, k), active) : weightedByActive(rows, (r) => r[k]);
    if (!avg || ranking?.referenceMs === undefined) return stat(k, own);
    const general = isUptimeStat(k) ? uptimeValue(k, avg[k], avg.activeMs) : avg[k];
    const adjusted = adjustedByTime(own, active, general, ranking.referenceMs);
    const tip = tr("player.historyTotalTip", { own: stat(k, own), min: duration(active), ref: duration(ranking.referenceMs), general: stat(k, general), adj: stat(k, adjusted) });
    return <span title={tip}>{stat(k, adjusted)}</span>;
  };

  const histCols: Column<PlayerHistoryRow>[] = [
    { id: "when", header: tr("hist.col.when"), fixed: true, sort: (h) => h.timeStart, cell: (h) => <span className="text-muted">{dateTime(h.timeStart)}</span> },
    { id: "map", header: tr("hist.col.map"), sort: (h) => h.mapName ?? "", cell: (h) => <Link className="hover:text-gold" to={ROUTES.fight(h.fightId)}>{h.fightName ?? h.mapName}</Link> },
    { id: "prof", header: tr("table.class"), sort: (h) => h.profession ?? "", cell: (h) => <Profession profession={h.profession} /> },
    { id: "role", header: tr("fight.col.role"), sort: (h) => h.role, cell: (h) => (h.role === "support" ? <Badge tone="info">{tr("fight.role.support")}</Badge> : <Badge>{tr("fight.role.dps")}</Badge>) },
    { id: "guild", header: tr("table.guild"), cell: (h) => <GuildTag id={h.guildId} /> },
    { id: "time", header: tr("table.time"), align: "right", sort: (h) => h.activeMs, cell: (h) => duration(h.activeMs), total: (rows) => duration(rows.reduce((a, r) => a + r.activeMs, 0)) },
    { id: "damage", header: tr("skills.col.damage"), align: "right", sort: (h) => h.damage, cell: (h) => compact(h.damage), total: totalOf("damage") },
    { id: "kills", header: tr("hist.col.kills"), align: "right", sort: (h) => h.kills, cell: (h) => h.kills, total: totalOf("kills") },
    { id: "strips", header: tr("hist.col.strips"), align: "right", sort: (h) => h.strips, cell: (h) => h.strips, total: totalOf("strips") },
    { id: "cleanses", header: tr("hist.col.cleanses"), align: "right", sort: (h) => h.cleanses, cell: (h) => h.cleanses, total: totalOf("cleanses") },
    { id: "healing", header: tr("hist.col.healing"), align: "right", sort: (h) => h.healing, cell: (h) => compact(h.healing), total: totalOf("healing") },
    { id: "deaths", header: tr("hist.col.deaths"), align: "right", sort: (h) => h.deaths, cell: (h) => <span className={h.deaths ? "text-bad" : "text-faint"}>{h.deaths}</span>, total: totalOf("deaths") },
  ];
  // o valor de cada luta nas métricas do grupo escolhido acima (as que o cartão "vs média" resume): dá para conferir a conta à mão
  const historyRows = [...data.history].reverse();
  const historyCols = [...histCols, ...statColumns(chartGroup, "total", historyRows, chartScope).filter((c) => !histCols.some((h) => h.id === c.id)).map((c) => ({ ...c, total: totalOf(c.id as StatKey) }))];

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
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "role", "profession", "size", "map"]} options={options} />

      {data.history.length === 0 ? (
        <Card>
          <Empty title={tr("player.empty.title")}>{tr("player.empty.text")}</Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label={tr("overview.kpi.fights")} value={int(t.fights)} hint={`${date(data.history[0]?.timeStart)} → ${date(data.history.at(-1)?.timeStart)}`} />
            <Kpi label={tr("overview.kpi.time")} value={duration(t.activeMs)} />
            <Kpi label={tr("player.kpi.damagePerMin")} value={compact(perMinute(t.damage, t.activeMs))} accent hint={avg && <Delta pct={diffPct(statRate(t, "damage"), statRate(avg, "damage"))} />} />
            <Kpi label={tr("hist.col.kills")} value={int(t.kills)} hint={tr("player.kpi.downs", { n: int(t.downs) })} />
            <Kpi label={tr("player.kpi.stripsPerMin")} value={stat("strips", perMinute(t.strips, t.activeMs), true)} hint={avg && <Delta pct={diffPct(statRate(t, "strips"), statRate(avg, "strips"))} />} />
            <Kpi label={tr("overview.kpi.deaths")} value={int(t.deaths)} hint={tr("player.kpi.timesDowned", { n: int(t.timesDowned) })} />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card
              title={tr("player.evolution")}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {/* dois seletores: o grupo e, dentro dele, a métrica. O grupo vem da métrica atual (inclusive a sugerida para o dia) */}
                  <Select className="w-32" value={chartGroup} onChange={(e) => selectGroup(e.target.value as StatGroup)} aria-label={tr("player.metricGroup")}>
                    {STAT_GROUPS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {tr(`group.${g.id}`)}
                      </option>
                    ))}
                  </Select>
                  {chartGroup === "boons" && (
                    <Select
                      className="w-28"
                      value={chartScope}
                      onChange={(e) => selectScope(e.target.value as BoonScope)}
                      aria-label={tr("scope.label")}
                      title={tr("player.scopeHint")}
                    >
                      {BOON_SCOPES.map((s) => (
                        <option key={s} value={s}>
                          {tr(`scope.${s}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Select className="w-52" value={metric} onChange={(e) => setPicked({ day: dayKey, metric: e.target.value as StatKey })} aria-label={tr("player.metric")}>
                    {statsOfGroup(chartGroup, chartScope).map((k) => (
                      <option key={k} value={k}>
                        {statText(k, getLang()).label}
                        {STAT_META[k].format === "volume" || isUptimeStat(k) ? "" : " / min"}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            >
              {dayKey && !manual && (
                <p className="px-5 pt-3 text-xs text-muted">{tr("player.metricSuggested", { metric: statText(metric, getLang()).label })}</p>
              )}
              <div className="h-72 px-2 py-4">
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="i" {...AXIS} />
                    <YAxis {...AXIS} width={56} tickFormatter={axis} />
                    <Tooltip {...TOOLTIP} labelFormatter={(_l, p) => {
                        const x = p?.[0]?.payload;
                        return x ? (x.short ? `${x.label} · ${tr("player.shortFight", { time: duration(x.activeMs) })}` : x.label) : "";
                      }} formatter={(v: number) => [stat(metric, v, true), statText(metric, getLang()).label]} />
                    {avgLine != null && <ReferenceLine y={avgLine} ifOverflow="extendDomain" stroke="#8f98a8" strokeDasharray="4 4" label={{ value: tr(`player.avgLine.${filters.role ?? "all"}`), fill: "#8f98a8", fontSize: 11, position: "insideTopRight" }} />}
                    <Line type="monotone" dataKey="value" stroke="#e0b25a" strokeWidth={2.5} dot={(p: { cx?: number; cy?: number; index?: number; payload?: { short?: boolean } }) =>
                        p.cx == null || p.cy == null ? <g key={p.index} /> : p.payload?.short ? (
                          <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="#0d0f14" stroke="#e0b25a" strokeWidth={2} />
                        ) : (
                          <circle key={p.index} cx={p.cx} cy={p.cy} r={3} fill="#e0b25a" />
                        )
                      }
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {series.some((x) => x.short) && <p className="border-t border-line px-5 py-2.5 text-xs text-faint">{tr("player.shortLegend")}</p>}
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

          <Card
            className="mt-6"
            title={tr("player.history")}
            action={
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1">
                  {STAT_GROUPS.map((g) => (
                    <button key={g.id} onClick={() => selectGroup(g.id)} className={cx("rounded-md px-2 py-1 text-xs font-medium", chartGroup === g.id ? "bg-surface-3 text-gold" : "text-muted hover:text-text")}>
                      {tr(`group.${g.id}`)}
                    </button>
                  ))}
                </div>
                {chartGroup === "boons" && <ScopeToggle value={chartScope} onChange={selectScope} />}
              </div>
            }
          >
            <DataTable
              key={`history-${pickerView(chartGroup, chartScope)}`}
              pickerKey={`player-history:${pickerView(chartGroup, chartScope)}`}
              rows={historyRows}
              columns={historyCols}
              totalLabel={`${tr("mode.total")} · ${tr("overview.fightsN", { n: historyRows.length })}`}
              rowKey={(h) => h.fightId}
              pageSize={PAGE_SIZE}
              dense
            />
            <p className="border-t border-line px-5 py-2.5 text-xs text-faint">{tr("player.historyNote")}</p>
          </Card>

          {(skills.length > 0 || skillKind !== "damage") && (
            <Card
              className="mt-6"
              title={tr("player.skills")}
              action={
                <Segmented
                  size="sm"
                  value={skillKind}
                  onChange={setSkillKind}
                  options={SKILL_KINDS.map((k) => ({ value: k, label: tr(`skills.kind.${k}`) }))}
                />
              }
            >
              <SkillsBody kind={skillKind} data={shown.data} isLoading={shown.isLoading} error={shown.error} scope="filters" />
            </Card>
          )}
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
