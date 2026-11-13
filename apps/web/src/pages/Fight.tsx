import { ArrowLeft, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { emptyStats, professionColor, STAT_KEYS, type PlayerFight, type StatGroup, type Stats } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { GroupTabs, ModeToggle, statColumns, type ValueMode } from "../components/statColumns";
import { GuildTag, PlayerLink, Profession } from "../components/badges";
import { AXIS, GRID, TOOLTIP } from "../components/charts";
import { KillDeath } from "../components/FightBits";
import { Badge, Button, Card, ErrorBox, Kpi, Loading, PageHeader, Segmented, Select } from "../components/ui";
import { useFight } from "../lib/api";
import { useMe } from "../lib/hooks";
import { accountShort, axis, compact, dateTime, duration, int } from "../lib/format";

interface GroupRow extends Stats {
  id: string;
  label: string;
  players: number;
  activeMs: number;
}

interface GuildRow extends Stats {
  id: string;
  guildId: string | null;
  players: number;
  activeMs: number;
}

export function FightPage() {
  const { id = "" } = useParams();
  const { data, error, isLoading } = useFight(id);
  const [group, setGroup] = useState<StatGroup>("offense");
  const [mode, setMode] = useState<ValueMode>("total");
  const [view, setView] = useState<"players" | "guilds" | "groups">("players");
  const [guild, setGuild] = useState("");
  const me = useMe();
  const nav = useNavigate();

  const players = useMemo(() => {
    if (!data) return [];
    if (guild === "alliance") {
      const ids = new Set(data.guilds.filter((g) => g.inAlliance).map((g) => g.id));
      return data.players.filter((p) => p.guildId && ids.has(p.guildId));
    }
    return guild ? data.players.filter((p) => p.guildId === guild) : data.players;
  }, [data, guild]);

  const guildRows = useMemo<GuildRow[]>(() => {
    const m = new Map<string, GuildRow>();
    for (const p of data?.players ?? []) {
      const key = p.guildId ?? "none";
      const g = m.get(key) ?? { ...emptyStats(), id: key, guildId: p.guildId, players: 0, activeMs: 0 };
      g.players++;
      g.activeMs += p.activeMs;
      for (const k of STAT_KEYS) g[k] += p[k];
      m.set(key, g);
    }
    return [...m.values()];
  }, [data]);

  // uma linha por grupo do squad e, no fim, o squad todo (a média do uptime sai ponderada pelo tempo ativo)
  const groupRows = useMemo<GroupRow[]>(() => {
    const m = new Map<string, GroupRow>();
    const add = (id: string, label: string, p: PlayerFight) => {
      const g = m.get(id) ?? { ...emptyStats(), id, label, players: 0, activeMs: 0 };
      g.players++;
      g.activeMs += p.activeMs;
      for (const k of STAT_KEYS) g[k] += p[k];
      m.set(id, g);
    };
    for (const p of data?.players ?? []) {
      add(p.group != null ? `g${p.group}` : "g-", p.group != null ? `Grupo ${p.group}` : "Sem grupo", p);
      add("squad", "Squad todo", p);
    }
    const squad = m.get("squad");
    m.delete("squad");
    return [...[...m.values()].sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true })), ...(squad ? [squad] : [])];
  }, [data]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const f = data.fight;
  const durMin = (f.durationMs ?? 0) / 60000;

  const playerCols: Column<PlayerFight>[] = [
    { id: "player", header: "Jogador", sticky: true, sort: (p) => p.name ?? p.account, cell: (p) => <PlayerLink account={p.account} name={p.name} /> },
    { id: "prof", header: "Classe", sort: (p) => p.profession ?? "", cell: (p) => <Profession profession={p.profession} /> },
    { id: "guild", header: "Guilda", cell: (p) => <GuildTag id={p.guildId} /> },
    { id: "grp", header: "Gr.", align: "center", sort: (p) => p.group, cell: (p) => <span className="text-muted">{p.group ?? "—"}</span> },
    {
      id: "role",
      header: "Função",
      sort: (p) => p.role,
      cell: (p) => (p.role === "support" ? <Badge tone="info">Suporte</Badge> : <Badge>DPS</Badge>),
    },
    ...statColumns(group, mode, players),
  ];

  const guildCols: Column<GuildRow>[] = [
    { id: "guild", header: "Guilda", sticky: true, sort: (g) => g.players, cell: (g) => <GuildTag id={g.guildId} withName /> },
    { id: "players", header: "Jogadores", align: "right", sort: (g) => g.players, cell: (g) => g.players },
    ...statColumns(group, mode, guildRows),
  ];

  // o destaque do melhor valor ignora a linha do squad todo, que sempre ganharia nos totais
  const groupCols: Column<GroupRow>[] = [
    { id: "group", header: "Grupo", sticky: true, sort: (g) => g.id, cell: (g) => <span className={g.id === "squad" ? "font-semibold text-gold" : "font-medium"}>{g.label}</span> },
    { id: "players", header: "Jogadores", align: "right", sort: (g) => g.players, cell: (g) => g.players },
    ...statColumns(group, mode, groupRows.filter((g) => g.id !== "squad")),
  ];

  const chart = [...players]
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 20)
    .map((p) => ({ name: p.name ?? accountShort(p.account), damage: p.damage, color: professionColor(p.profession), account: p.account }));

  return (
    <>
      <Link to="/lutas" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Lutas
      </Link>
      <PageHeader
        title={f.fightName}
        subtitle={`${dateTime(f.timeStart)} · ${duration(f.durationMs)}${f.recordedBy ? ` · gravado por ${f.recordedBy}` : ""}${f.uploader ? ` · enviado por ${f.uploader}` : ""}`}
        actions={
          f.hasReport && (
            <a href={`/api/fights/${f.id}/report`} target="_blank" rel="noreferrer">
              <Button>
                Relatório completo do Elite Insights <ExternalLink className="size-3.5" />
              </Button>
            </a>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Squad" value={int(f.squadCount)} hint={f.allyCount ? `+${f.allyCount} aliados fora do squad` : undefined} />
        <Kpi label="Inimigos" value={int(f.enemyCount)} />
        <Kpi label="Kills / mortes" value={<KillDeath kills={f.squadKills} deaths={f.squadDeaths} />} accent />
        <Kpi label="Dano do squad" value={compact(f.squadDamage)} hint={durMin > 0 ? `${compact((f.squadDamage ?? 0) / durMin / 60)} DPS` : undefined} />
        <Kpi label="Derrubados" value={int(f.squadDowns)} />
      </div>

      <Card className="mt-6" title="Dano por jogador">
        <div className="h-72 px-2 py-4">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: 8, right: 8 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="name" {...AXIS} interval={0} angle={-35} textAnchor="end" height={70} />
              <YAxis {...AXIS} tickFormatter={axis} width={56} />
              <Tooltip {...TOOLTIP} formatter={(v: number) => [compact(v), "Dano"]} />
              <Bar dataKey="damage" radius={[6, 6, 0, 0]} onClick={(d: any) => nav(`/jogadores/${encodeURIComponent(d.account)}`)} className="cursor-pointer">
                {chart.map((c) => (
                  <Cell key={c.account} fill={c.color} fillOpacity={c.account === me ? 1 : 0.75} stroke={c.account === me ? "#e0b25a" : undefined} strokeWidth={2} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "players", label: "Jogadores" },
              { value: "guilds", label: "Por guilda" },
              { value: "groups", label: "Por grupo" },
            ]}
          />
          <GroupTabs value={group} onChange={setGroup} />
          <ModeToggle value={mode} onChange={setMode} />
          {view === "players" && (
            <Select className="ml-auto w-56" value={guild} onChange={(e) => setGuild(e.target.value)} aria-label="Filtrar por guilda">
              <option value="">Todas as guildas</option>
              <option value="alliance">★ Só a aliança</option>
              {data.guilds.map((g) => (
                <option key={g.id} value={g.id}>
                  [{g.tag ?? "?"}] {g.name ?? g.id}
                </option>
              ))}
            </Select>
          )}
        </div>
        {view === "players" ? (
          <DataTable
            key={`players-${group}`}
            rows={players}
            columns={playerCols}
            rowKey={(p) => p.account}
            initialSort={{ id: group === "offense" ? "damage" : group === "support" ? "strips" : group === "boons" ? "stabOut" : group === "uptime" ? "stabUp" : "damageTaken", desc: true }}
            rowClassName={(p) => (p.account === me ? "bg-gold/5" : undefined)}
            dense
          />
        ) : view === "guilds" ? (
          <DataTable key={`guilds-${group}`} rows={guildRows} columns={guildCols} rowKey={(g) => g.id} initialSort={{ id: "players", desc: true }} dense />
        ) : (
          <DataTable key={`groups-${group}`} rows={groupRows} columns={groupCols} rowKey={(g) => g.id} initialSort={{ id: "group", desc: false }} dense />
        )}
        {group === "uptime" && (
          <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
            Uptime sobre o tempo ativo de cada jogador. Em Estab. e Poder, é o tempo com pelo menos uma pilha; “Poder (pilhas)” é a média de pilhas. Na visão por grupo, “Squad todo” é a média do squad, ponderada pelo tempo ativo.
          </p>
        )}
      </Card>
    </>
  );
}
