import { ArrowRight, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { perMinute, STAT_META, type RankingRow, type StatKey } from "@gw2logs/shared";
import { FilterBar } from "../components/FilterBar";
import { FightStatus, KillDeath, SquadVsEnemy, Won } from "../components/FightBits";
import { GuildTag, Profession, ProfessionDot } from "../components/badges";
import { Button, Card, Empty, ErrorBox, Kpi, Loading, PageHeader } from "../components/ui";
import { useOverview, useRanking } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { accountShort, compact, dateTime, dec, duration, int, stat } from "../lib/format";

const BOARDS: { key: StatKey; title: string }[] = [
  { key: "damage", title: "Dano por minuto" },
  { key: "strips", title: "Strips por minuto" },
  { key: "cleanses", title: "Cleanses por minuto" },
  { key: "healing", title: "Cura por minuto" },
];

/** Precisa de pelo menos 2 min de luta para entrar nos destaques (evita quem apareceu 10 s). */
const MIN_ACTIVE_MS = 120_000;

function Leaderboard({ rows, k, title }: { rows: RankingRow[]; k: StatKey; title: string }) {
  const top = rows
    .filter((r) => r.activeMs >= MIN_ACTIVE_MS && r[k] > 0)
    .map((r) => ({ r, v: perMinute(r[k], r.activeMs) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const max = top[0]?.v ?? 1;
  return (
    <Card title={title} action={<span className="text-xs text-faint">{STAT_META[k].label}</span>}>
      {top.length === 0 ? (
        <p className="px-5 py-6 text-sm text-faint">Sem dados no período.</p>
      ) : (
        <ol className="flex flex-col gap-1 p-3">
          {top.map(({ r, v }, i) => (
            <li key={r.account}>
              <Link to={`/jogadores/${encodeURIComponent(r.account)}`} className="relative flex items-center gap-3 overflow-hidden rounded-lg px-2.5 py-2 hover:bg-surface-2">
                <span className="absolute inset-y-0 left-0 bg-gold/8" style={{ width: `${(v / max) * 100}%` }} />
                <span className={`relative w-4 text-center text-xs font-bold ${i === 0 ? "text-gold" : "text-faint"}`}>{i + 1}</span>
                <ProfessionDot profession={r.profession} className="relative" />
                <span className="relative min-w-0 flex-1 truncate text-sm font-medium">{r.name ?? accountShort(r.account)}</span>
                <span className="tabular relative text-sm font-semibold text-text">{stat(k, v, true)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const [filters, setFilters] = useFilters({ days: 30 });
  const ov = useOverview(filters);
  const rk = useRanking(filters);
  const nav = useNavigate();

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="O desempenho do clã e da aliança nas lutas enviadas."
        actions={
          <Link to="/enviar">
            <Button variant="primary">
              <Upload className="size-4" /> Enviar logs
            </Button>
          </Link>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "guild", "size"]} />

      {ov.error && <ErrorBox error={ov.error} />}
      {ov.isLoading && <Loading />}
      {ov.data && ov.data.fights === 0 && (
        <Card>
          <Empty title="Nenhuma luta no período">
            Envie os logs do ArcDPS (<code>.zevtc</code>) em <Link className="text-gold" to="/enviar">Enviar logs</Link> ou escolha outro período.
          </Empty>
        </Card>
      )}
      {ov.data && ov.data.fights > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Lutas" value={int(ov.data.fights)} hint={`${dateTime(ov.data.first)} → ${dateTime(ov.data.last)}`} />
            <Kpi label="Tempo de luta" value={duration(ov.data.durationMs)} />
            <Kpi label="Abates" value={int(ov.data.kills)} accent />
            <Kpi label="Mortes" value={int(ov.data.deaths)} hint={`K/D ${dec(ov.data.deaths ? ov.data.kills / ov.data.deaths : ov.data.kills, 2)}`} />
            <Kpi label="Jogadores" value={int(ov.data.players)} />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {BOARDS.map((b) => (
              <Leaderboard key={b.key} rows={rk.data?.rows ?? []} k={b.key} title={b.title} />
            ))}
          </div>

          <Card
            className="mt-6"
            title="Lutas recentes"
            action={
              <Link to="/lutas" className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
                Ver todas <ArrowRight className="size-3" />
              </Link>
            }
          >
            <ul className="divide-y divide-line/60">
              {ov.data.recent.map((f) => (
                <li key={f.id}>
                  <button onClick={() => nav(`/lutas/${f.id}`)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-surface-2/60 sm:grid-cols-[auto_1.4fr_1fr_1fr_auto]">
                    <Won fight={f} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{f.fightName}</div>
                      <div className="text-xs text-faint">{dateTime(f.timeStart)} · {duration(f.durationMs)}</div>
                    </div>
                    <div className="hidden sm:block">
                      <SquadVsEnemy fight={f} />
                    </div>
                    <div className="hidden text-sm text-muted sm:block">{compact(f.squadDamage)} dano</div>
                    <div className="flex items-center gap-2">
                      <FightStatus fight={f} />
                      <KillDeath kills={f.squadKills} deaths={f.squadDeaths} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {rk.data && rk.data.rows.length > 0 && (
            <Card className="mt-6" title="Quem mais lutou no período">
              <div className="flex flex-wrap gap-2 p-4">
                {[...rk.data.rows]
                  .sort((a, b) => b.fights - a.fights)
                  .slice(0, 16)
                  .map((r) => (
                    <Link key={r.account} to={`/jogadores/${encodeURIComponent(r.account)}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm hover:border-gold/50">
                      <Profession profession={r.profession} />
                      <span className="font-medium">{r.name ?? accountShort(r.account)}</span>
                      <GuildTag id={r.guildId} />
                      <span className="text-xs text-faint">{r.fights} lutas</span>
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
