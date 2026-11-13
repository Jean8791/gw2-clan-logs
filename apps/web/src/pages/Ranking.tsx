import { GitCompareArrows, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { filtersToQuery, type RankingRow, type StatGroup } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { GroupTabs, ModeToggle, statColumns, type ValueMode } from "../components/statColumns";
import { GuildTag, PlayerLink, Profession } from "../components/badges";
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Select, cx } from "../components/ui";
import { useRanking } from "../lib/api";
import { useFilters, useMe } from "../lib/hooks";
import { duration } from "../lib/format";

const SORT_BY_GROUP: Record<StatGroup, string> = { offense: "damage", support: "strips", boons: "stabOut", uptime: "stabUp", defense: "damageTaken" };

export function RankingPage() {
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const { data, error, isLoading } = useRanking(filters);
  const [group, setGroup] = useState<StatGroup>("offense");
  const [mode, setMode] = useState<ValueMode>("total");
  const [minMinutes, setMinMinutes] = useState(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const me = useMe();
  const nav = useNavigate();

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.activeMs >= minMinutes * 60000), [data, minMinutes]);

  const toggle = (account: string) =>
    setSelected((s) => (s.includes(account) ? s.filter((a) => a !== account) : s.length >= 4 ? s : [...s, account]));

  const columns: Column<RankingRow>[] = [
    {
      id: "sel",
      header: "",
      align: "center",
      cell: (r) => (
        <input
          type="checkbox"
          aria-label="Selecionar para comparar"
          className="size-4 cursor-pointer accent-[#e0b25a]"
          checked={selected.includes(r.account)}
          onChange={() => toggle(r.account)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    { id: "pos", header: "#", align: "right", cell: (_r, i) => <span className="text-faint">{i + 1}</span> },
    { id: "player", header: "Jogador", sticky: true, sort: (r) => r.name ?? r.account, cell: (r) => <PlayerLink account={r.account} name={r.name} /> },
    { id: "prof", header: "Classe", sort: (r) => r.profession ?? "", cell: (r) => <Profession profession={r.profession} /> },
    { id: "guild", header: "Guilda", cell: (r) => <GuildTag id={r.guildId} /> },
    { id: "fights", header: "Lutas", align: "right", sort: (r) => r.fights, cell: (r) => r.fights },
    { id: "time", header: "Tempo", align: "right", sort: (r) => r.activeMs, cell: (r) => <span className="text-muted">{duration(r.activeMs)}</span> },
    {
      id: "sup",
      header: "Suporte",
      title: "Em quantas lutas jogou como suporte",
      align: "right",
      sort: (r) => r.supportFights / r.fights,
      cell: (r) => <span className="text-muted">{Math.round((r.supportFights / r.fights) * 100)}%</span>,
    },
    ...statColumns(group, mode, rows),
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem permissão de área de transferência */
    }
  };

  return (
    <>
      <PageHeader
        title="Ranking"
        subtitle="Some as lutas por período, guilda, função ou classe. Os filtros ficam no link: dá para mandar no Discord."
        actions={
          <Button onClick={copyLink}>
            <Link2 className="size-4" /> {copied ? "Link copiado!" : "Copiar link"}
          </Button>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "guild", "role", "profession", "size", "duration", "map"]} />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <GroupTabs value={group} onChange={setGroup} />
          <ModeToggle value={mode} onChange={setMode} />
          <Select className="w-44" value={String(minMinutes)} onChange={(e) => setMinMinutes(Number(e.target.value))} aria-label="Tempo mínimo de luta">
            <option value="0">Qualquer tempo</option>
            <option value="2">Mín. 2 min de luta</option>
            <option value="5">Mín. 5 min de luta</option>
            <option value="15">Mín. 15 min de luta</option>
            <option value="60">Mín. 1 h de luta</option>
          </Select>
          <div className={cx("ml-auto flex items-center gap-2 transition", selected.length ? "opacity-100" : "pointer-events-none opacity-0")}>
            <span className="text-xs text-muted">{selected.length}/4 selecionados</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Limpar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const q = filtersToQuery(filters);
                nav(`/comparar?accounts=${encodeURIComponent(selected.join(","))}${q ? `&${q}` : ""}`);
              }}
            >
              <GitCompareArrows className="size-4" /> Comparar
            </Button>
          </div>
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        )}
        {isLoading && <Loading />}
        {data && rows.length === 0 && <Empty title="Ninguém com esses filtros">Tente outro período, guilda ou um tempo mínimo menor.</Empty>}
        {data && rows.length > 0 && (
          <DataTable
            key={group}
            rows={rows}
            columns={columns}
            rowKey={(r) => r.account}
            initialSort={{ id: SORT_BY_GROUP[group], desc: group !== "defense" }}
            rowClassName={(r) => (r.account === me ? "bg-gold/5" : selected.includes(r.account) ? "bg-info/5" : undefined)}
            onRowClick={(r) => toggle(r.account)}
            dense
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-faint">
        “Total” soma todas as lutas do filtro. “Por minuto” divide pelo tempo ativo de cada jogador (0,74 em Kills = 0,74 abate por minuto) e serve
        para comparar quem jogou mais ou menos lutas. “Por segundo” é a mesma conta por segundo (o DPS). Suporte é a parcela das lutas em que a pessoa jogou de suporte. Boons mostram o volume gerado
        para o squad (unidade do Elite Insights). Uptime é a % do tempo ativo do jogador com o boon (em Estab. e Poder, o tempo com pelo menos uma
        pilha; “Poder (pilhas)” é a média de pilhas). A função (DPS/suporte) é estimada por luta, pela cura, barreira e boons gerados.
      </p>
    </>
  );
}
