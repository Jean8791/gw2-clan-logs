import { ArrowRight, Upload, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { perSecond, ROUTES, topByRate, type RankingRow, type StatKey } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { FightStatus, KillDeath, SquadVsEnemy, Won } from "../components/FightBits";
import { GuildTag, PlayerLink, Profession, ProfessionDot } from "../components/badges";
import { Button, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, cx } from "../components/ui";
import { useOverview, useRanking } from "../lib/api";
import { useFilters } from "../lib/hooks";
import { t } from "../lib/i18n";
import { accountShort, compact, dateTime, dec, duration, int, stat } from "../lib/format";

const BOARDS: { key: StatKey; title: string }[] = [
  { key: "damage", title: "Dano por minuto" },
  { key: "strips", title: "Strips por minuto" },
  { key: "cleanses", title: "Cleanses por minuto" },
  { key: "healing", title: "Cura por minuto" },
];

/** Precisa de pelo menos 2 min de luta para entrar nos destaques (evita quem apareceu 10 s). */
const MIN_ACTIVE_MS = 120_000;

function Leaderboard({ rows, k, title, open, onDetail }: { rows: RankingRow[]; k: StatKey; title: string; open: boolean; onDetail: () => void }) {
  const top = topByRate(rows, k, 5, MIN_ACTIVE_MS).map(({ row, perMin }) => ({ r: row, v: perMin }));
  const max = top[0]?.v ?? 1;
  return (
    <Card
      title={title}
      action={
        <button
          type="button"
          onClick={onDetail}
          aria-expanded={open}
          className={cx("rounded-md px-2 py-1 text-xs font-medium transition hover:bg-surface-2", open ? "bg-surface-3 text-gold" : "text-gold/80 hover:text-gold")}
        >
          {open ? "Fechar detalhe" : "Detalhar"}
        </button>
      }
    >
      {top.length === 0 ? (
        <p className="px-5 py-6 text-sm text-faint">Sem dados no período.</p>
      ) : (
        <ol className="flex flex-col gap-1 p-3">
          {top.map(({ r, v }, i) => (
            <li key={r.account}>
              <Link to={ROUTES.player(r.account)} className="relative flex items-center gap-3 overflow-hidden rounded-lg px-2.5 py-2 hover:bg-surface-2">
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

/** Os 10 melhores de um destaque, com os valores detalhados (total, por minuto, por segundo, lutas e tempo). */
function BoardDetail({ rows, k, title, onClose }: { rows: RankingRow[]; k: StatKey; title: string; onClose: () => void }) {
  const top = topByRate(rows, k, 10, MIN_ACTIVE_MS);
  const columns: Column<(typeof top)[number]>[] = [
    { id: "pos", header: "#", align: "right", cell: (_x, i) => <span className="text-faint">{i + 1}</span> },
    { id: "player", header: "Jogador", sticky: true, cell: (x) => <PlayerLink account={x.row.account} name={x.row.name} /> },
    { id: "prof", header: "Classe", sort: (x) => x.row.profession ?? "", cell: (x) => <Profession profession={x.row.profession} /> },
    { id: "guild", header: "Guilda", cell: (x) => <GuildTag id={x.row.guildId} /> },
    { id: "fights", header: "Lutas", align: "right", sort: (x) => x.row.fights, cell: (x) => x.row.fights },
    { id: "time", header: "Tempo ativo", align: "right", sort: (x) => x.row.activeMs, cell: (x) => <span className="text-muted">{duration(x.row.activeMs)}</span> },
    { id: "total", header: "Total", align: "right", sort: (x) => x.row[k], cell: (x) => compact(x.row[k]) },
    { id: "perMin", header: "Por minuto", align: "right", sort: (x) => x.perMin, cell: (x) => <span className="font-semibold">{stat(k, x.perMin, true)}</span> },
    { id: "perSec", header: "Por segundo", align: "right", sort: (x) => x.perMin, cell: (x) => stat(k, perSecond(x.row[k], x.row.activeMs), false, true) },
  ];
  return (
    <Card
      className="mt-4"
      title={`${title}: os 10 melhores`}
      action={
        <button type="button" onClick={onClose} aria-label="Fechar o detalhe" className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
          <X className="size-4" />
        </button>
      }
    >
      <DataTable rows={top} columns={columns} rowKey={(x) => x.row.account} initialSort={{ id: "perMin", desc: true }} dense />
      <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
        Só entra quem teve pelo menos 2 min de luta nos filtros escolhidos. “Por minuto” e “por segundo” dividem o total pelo tempo ativo do jogador.
      </p>
    </Card>
  );
}

export function OverviewPage() {
  const [filters, setFilters] = useFilters({ days: 30 });
  const [detail, setDetail] = useState<StatKey | null>(null);
  const ov = useOverview(filters);
  const rk = useRanking(filters);
  const nav = useNavigate();

  return (
    <>
      <PageHeader
        title={t("page.overview.title")}
        subtitle={t("page.overview.subtitle")}
        actions={
          <Link to={ROUTES.upload}>
            <Button variant="primary">
              <Upload className="size-4" /> Enviar logs
            </Button>
          </Link>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "guild", "size"]} />

      {ov.error && <ErrorBox error={ov.error} />}
      {ov.isLoading && <Loading />}
      {ov.data && ov.data.fights === 0 && (
        <Card>
          <Empty title="Nenhuma luta no período">
            Envie os logs do ArcDPS (<code>.zevtc</code>) em <Link className="text-gold" to={ROUTES.upload}>Enviar logs</Link> ou escolha outro período.
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
              <Leaderboard key={b.key} rows={rk.data?.rows ?? []} k={b.key} title={b.title} open={detail === b.key} onDetail={() => setDetail(detail === b.key ? null : b.key)} />
            ))}
          </div>
          {detail && <BoardDetail key={detail} rows={rk.data?.rows ?? []} k={detail} title={BOARDS.find((b) => b.key === detail)!.title} onClose={() => setDetail(null)} />}

          <Card
            className="mt-6"
            title="Lutas recentes"
            action={
              <Link to={ROUTES.fights} className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
                Ver todas <ArrowRight className="size-3" />
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
                    <Link key={r.account} to={ROUTES.player(r.account)} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm hover:border-gold/50">
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
