import { GitCompareArrows, Star, StarOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  filtersToQuery,
  perMinute,
  STAT_GROUPS,
  STAT_KEYS,
  STAT_META,
  statsOfGroup,
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
import { BaselinePicker, type BaselineRole } from "../components/BaselinePicker";
import { accountShort, axis, compact, date, dateTime, diffPct, duration, int, stat } from "../lib/format";

const pm = (a: Aggregate, k: StatKey) => (STAT_META[k].format === "volume" ? (a.fights ? a[k] / a.fights : 0) : perMinute(a[k], a.activeMs));

/** Barra comparando o jogador com a média do squad (mesmos filtros). */
function VsAverage({ k, player, avg }: { k: StatKey; player: Aggregate; avg: Aggregate }) {
  const meta = STAT_META[k];
  const a = pm(player, k);
  const b = pm(avg, k);
  const max = Math.max(a, b) || 1;
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-1.5">
      <span className="truncate text-sm text-muted" title={meta.hint}>
        {meta.label}
      </span>
      <div className="relative h-2.5 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gold/80" style={{ width: `${(a / max) * 100}%` }} />
        <div className="absolute -inset-y-1 w-0.5 rounded bg-text/70" style={{ left: `calc(${(b / max) * 100}% - 1px)` }} title={`Média: ${stat(k, b, true)}`} />
      </div>
      <div className="flex w-28 items-center justify-end gap-2">
        <span className="tabular text-sm font-medium">{stat(k, a, true)}</span>
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
        value: STAT_META[metric].format === "volume" ? h[metric] : perMinute(h[metric], h.activeMs),
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
      header: "Habilidade",
      sort: (k) => k.name ?? "",
      cell: (k) => (
        <span className="inline-flex items-center gap-2">
          <SkillIcon id={k.skillId} />
          {k.name ?? `#${k.skillId}`}
        </span>
      ),
    },
    { id: "damage", header: "Dano", align: "right", sort: (k) => k.damage, cell: (k) => compact(k.damage) },
    {
      id: "pct",
      header: "% do dano",
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
    { id: "hits", header: "Acertos", align: "right", sort: (k) => k.connectedHits, cell: (k) => int(k.connectedHits), title: "Acertos que conectaram" },
    { id: "avg", header: "Dano por acerto", align: "right", sort: (k) => k.avgHit, cell: (k) => compact(k.avgHit) },
  ];

  const histCols: Column<PlayerHistoryRow>[] = [
    { id: "when", header: "Quando", sort: (h) => h.timeStart, cell: (h) => <span className="text-muted">{dateTime(h.timeStart)}</span> },
    { id: "map", header: "Mapa", sort: (h) => h.mapName ?? "", cell: (h) => <Link className="hover:text-gold" to={`/lutas/${h.fightId}`}>{h.fightName ?? h.mapName}</Link> },
    { id: "prof", header: "Classe", sort: (h) => h.profession ?? "", cell: (h) => <Profession profession={h.profession} /> },
    { id: "role", header: "Função", sort: (h) => h.role, cell: (h) => (h.role === "support" ? <Badge tone="info">Suporte</Badge> : <Badge>DPS</Badge>) },
    { id: "guild", header: "Guilda", cell: (h) => <GuildTag id={h.guildId} /> },
    { id: "time", header: "Tempo", align: "right", sort: (h) => h.activeMs, cell: (h) => duration(h.activeMs) },
    { id: "damage", header: "Dano", align: "right", sort: (h) => h.damage, cell: (h) => compact(h.damage) },
    { id: "kills", header: "Kills", align: "right", sort: (h) => h.kills, cell: (h) => h.kills },
    { id: "strips", header: "Strips", align: "right", sort: (h) => h.strips, cell: (h) => h.strips },
    { id: "cleanses", header: "Cleanses", align: "right", sort: (h) => h.cleanses, cell: (h) => h.cleanses },
    { id: "healing", header: "Cura", align: "right", sort: (h) => h.healing, cell: (h) => compact(h.healing) },
    { id: "deaths", header: "Mortes", align: "right", sort: (h) => h.deaths, cell: (h) => <span className={h.deaths ? "text-bad" : "text-faint"}>{h.deaths}</span> },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.name ?? accountShort(account)}
            {isMe && <Badge tone="gold">você</Badge>}
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
              {isMe ? <StarOff className="size-4" /> : <Star className="size-4" />} {isMe ? "Não sou eu" : "Sou eu"}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const others = me && me !== account ? [me, account] : [account];
                const q = filtersToQuery(filters);
                nav(`/comparar?accounts=${encodeURIComponent(others.join(","))}${q ? `&${q}` : ""}`);
              }}
            >
              <GitCompareArrows className="size-4" /> {me && me !== account ? "Comparar comigo" : "Comparar"}
            </Button>
          </>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "role", "profession", "size", "map"]} />

      {data.history.length === 0 ? (
        <Card>
          <Empty title="Sem lutas com esses filtros">Este jogador existe, mas não aparece nas lutas filtradas.</Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Lutas" value={int(t.fights)} hint={`${date(data.history[0]?.timeStart)} → ${date(data.history.at(-1)?.timeStart)}`} />
            <Kpi label="Tempo de luta" value={duration(t.activeMs)} />
            <Kpi label="Dano / min" value={compact(perMinute(t.damage, t.activeMs))} accent hint={avg && <Delta pct={diffPct(pm(t, "damage"), pm(avg, "damage"))} />} />
            <Kpi label="Kills" value={int(t.kills)} hint={`${int(t.downs)} downs`} />
            <Kpi label="Strips / min" value={stat("strips", perMinute(t.strips, t.activeMs), true)} hint={avg && <Delta pct={diffPct(pm(t, "strips"), pm(avg, "strips"))} />} />
            <Kpi label="Mortes" value={int(t.deaths)} hint={`${int(t.timesDowned)} vezes derrubado`} />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card
              title="Evolução luta a luta"
              action={
                <Select className="w-52" value={metric} onChange={(e) => setMetric(e.target.value as StatKey)} aria-label="Métrica">
                  {STAT_GROUPS.map((g) => (
                    <optgroup key={g.id} label={g.label}>
                      {statsOfGroup(g.id).map((k) => (
                        <option key={k} value={k}>
                          {STAT_META[k].label}
                          {STAT_META[k].format === "volume" ? "" : " / min"}
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
                    <Tooltip {...TOOLTIP} labelFormatter={(_l, p) => p?.[0]?.payload?.label ?? ""} formatter={(v: number) => [stat(metric, v, true), STAT_META[metric].label]} />
                    {avgLine != null && <ReferenceLine y={avgLine} stroke="#8f98a8" strokeDasharray="4 4" label={{ value: effRole === "support" ? "média dos suportes" : effRole === "dps" ? "média dos DPS" : "média do squad", fill: "#8f98a8", fontSize: 11, position: "insideTopRight" }} />}
                    <Line type="monotone" dataKey="value" stroke="#e0b25a" strokeWidth={2.5} dot={{ r: 3, fill: "#e0b25a" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Classes jogadas">
              <ul className="flex flex-col gap-2 p-4">
                {data.professions.map((p) => (
                  <li key={p.profession} className="flex items-center gap-3">
                    <div className="w-32 shrink-0">
                      <Profession profession={p.profession} />
                    </div>
                    <div className="h-2 flex-1 rounded-full bg-surface-3">
                      <div className="h-2 rounded-full bg-gold/70" style={{ width: `${(p.fights / t.fights) * 100}%` }} />
                    </div>
                    <span className="tabular w-16 text-right text-sm text-muted">{p.fights} lutas</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {avg && (
            <Card
              className="mt-6"
              title="Comparado à média do squad"
              action={
                <div className="flex flex-wrap items-center gap-3">
                <BaselinePicker value={effRole} onChange={setBaseRole} />
                <div className="flex gap-1">
                  {STAT_GROUPS.map((g) => (
                    <button key={g.id} onClick={() => setGroup(g.id)} className={cx("rounded-md px-2 py-1 text-xs font-medium", group === g.id ? "bg-surface-3 text-gold" : "text-muted hover:text-text")}>
                      {g.label}
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
                Valores por minuto de luta (boons: média por luta). O traço branco é a média dos jogadores na função escolhida, com os mesmos filtros.
              </p>
            </Card>
          )}

          {skills.length > 0 && (
            <Card className="mt-6" title="Habilidades">
              <DataTable rows={skills.slice(0, 25)} columns={skillCols} rowKey={(k) => String(k.skillId)} dense />
              <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
                Dano em jogadores inimigos, nas lutas filtradas, incluindo o de pets, clones e engenhocas. As 25 habilidades que mais causam dano. Condições, como Burning, aparecem como habilidades.
              </p>
            </Card>
          )}

          <Card className="mt-6" title="Histórico">
            <DataTable rows={[...data.history].reverse()} columns={histCols} rowKey={(h) => h.fightId} dense />
          </Card>
        </>
      )}
    </>
  );
}

export function MePage() {
  const me = useMe();
  if (me) return <Navigate to={`/jogadores/${encodeURIComponent(me)}`} replace />;
  return (
    <>
      <PageHeader title="Meu perfil" subtitle="Escolha sua conta para ver só o seu histórico e se comparar com o squad." />
      <Card className="max-w-xl p-5">
        <PlayerPicker onPick={(a) => setMe(a)} button="Sou eu" />
        <p className="mt-3 text-xs text-faint">Fica salvo só neste navegador. Sua conta precisa aparecer em pelo menos um log enviado.</p>
      </Card>
    </>
  );
}
