import { GitCompareArrows, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boonViewKeys, BOON_VIEW_BASES, filtersToQuery, PAGE_SIZE, ROUTES, statsOfGroup, statText, STAT_KEYS, type BoonBase, type BoonScope, type BoonViewBase, type RankingRow, type StatGroup, type StatKey } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { FilterBar } from "../components/FilterBar";
import { defaultSort, efficiencyColumn, GroupTabs, pickerView, ModeToggle, statColumnsFor, type ValueMode } from "../components/statColumns";
import { GuildTag, NoAllianceNote, PlayerLink, Profession } from "../components/badges";
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Select } from "../components/ui";
import { useRanking } from "../lib/api";
import { useFilters, useMe } from "../lib/hooks";
import { duration } from "../lib/format";
import { getLang, t } from "../lib/i18n";

/** Nome do boon sem o "% " dos uptimes (swiftness, vigor e regeneração só têm a métrica de uptime). */
const boonName = (b: BoonViewBase) => statText(((STAT_KEYS as readonly string[]).includes(`${b}Out`) ? `${b}Out` : `${b}Up`) as StatKey, getLang()).label.replace(/^% /, "");

export function RankingPage() {
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const { data, error, isLoading } = useRanking(filters);
  const [group, setGroup] = useState<StatGroup>("offense");
  const [scope, setScope] = useState<BoonScope>("squad");
  const [boon, setBoon] = useState<BoonViewBase | "all">("all");
  const [mode, setMode] = useState<ValueMode>("total");
  const [minMinutes, setMinMinutes] = useState(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const me = useMe();
  const nav = useNavigate();

  // com um boon escolhido, a tabela mostra as métricas dele lado a lado (volume para squad, grupo e si, uptime e uptime no grupo)
  const oneBoon = group === "boons" && boon !== "all";
  const keys: StatKey[] = oneBoon ? boonViewKeys(boon) : statsOfGroup(group, scope);
  const effKey = oneBoon ? keys.find((k) => k.endsWith("Eff")) : undefined;
  const sort = oneBoon ? { id: (keys.find((k) => k.endsWith("GroupUp")) ?? keys[0]!) as StatKey, desc: true } : defaultSort(group, scope);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.activeMs >= minMinutes * 60000), [data, minMinutes]);

  const toggle = (account: string) =>
    setSelected((s) => (s.includes(account) ? s.filter((a) => a !== account) : s.length >= 4 ? s : [...s, account]));

  const columns: Column<RankingRow>[] = [
    {
      id: "sel",
      header: "",
      fixed: true,
      align: "center",
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={t("ranking.selectToCompare")}
          className="size-4 cursor-pointer accent-[#e0b25a]"
          checked={selected.includes(r.account)}
          onChange={() => toggle(r.account)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    { id: "pos", header: "#", align: "right", cell: (_r, i) => <span className="text-faint">{i + 1}</span> },
    { id: "player", header: t("table.player"), sticky: true, fixed: true, sort: (r) => r.name ?? r.account, cell: (r) => <PlayerLink account={r.account} name={r.name} /> },
    {
      id: "prof",
      header: t("table.class"),
      sort: (r) => r.profession ?? "",
      // quem jogou de mais de uma classe no período mostra todas, com as lutas de cada uma (a primeira é a mais jogada); a coluna cabe 3 e rola para o lado nas demais
      cell: (r) =>
        r.professions.length > 1 ? (
          <span className="flex max-w-[22rem] items-center gap-x-3 overflow-x-auto [scrollbar-width:thin]">
            {r.professions.map((p) => (
              <span key={p.profession} className="inline-flex shrink-0 items-center gap-1">
                <Profession profession={p.profession} />
                <span className="tabular text-xs text-faint" title={t("ranking.classFights", { n: p.fights })}>
                  {p.fights}
                </span>
              </span>
            ))}
          </span>
        ) : (
          <Profession profession={r.profession} />
        ),
    },
    { id: "guild", header: t("table.guild"), cell: (r) => <GuildTag id={r.guildId} /> },
    { id: "fights", header: t("table.fights"), align: "right", sort: (r) => r.fights, cell: (r) => r.fights },
    { id: "time", header: t("table.time"), align: "right", sort: (r) => r.activeMs, cell: (r) => <span className="text-muted">{duration(r.activeMs)}</span> },
    {
      id: "sup",
      header: t("table.support"),
      title: t("table.supportTitle"),
      align: "right",
      sort: (r) => r.supportFights / r.fights,
      cell: (r) => <span className="text-muted">{Math.round((r.supportFights / r.fights) * 100)}%</span>,
    },
    ...statColumnsFor(keys, mode, rows, data ? { baseline: data.baseline, refMs: data.referenceMs } : undefined),
    ...(effKey ? [efficiencyColumn<RankingRow>(effKey.slice(0, -3) as BoonBase)] : []),
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
        title={t("page.ranking.title")}
        subtitle={t("page.ranking.subtitle")}
        actions={
          <Button onClick={copyLink}>
            <Link2 className="size-4" /> {copied ? t("common.linkCopied") : t("common.copyLink")}
          </Button>
        }
      />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "day", "week", "guild", "role", "profession", "size", "duration", "map"]} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <GroupTabs value={group} onChange={setGroup} scope={scope} onScopeChange={setScope} showScope={!oneBoon} />
          {group === "boons" && (
            <Select className="w-48" value={boon} onChange={(e) => setBoon(e.target.value as BoonViewBase | "all")} aria-label={t("ranking.boon.label")}>
              <option value="all">{t("ranking.boon.all")}</option>
              {BOON_VIEW_BASES.map((b) => (
                <option key={b} value={b}>
                  {boonName(b)}
                </option>
              ))}
            </Select>
          )}
          {group !== "boons" && group !== "uptime" && <ModeToggle value={mode} onChange={setMode} />}
          <Select className="w-56" value={String(minMinutes)} onChange={(e) => setMinMinutes(Number(e.target.value))} aria-label={t("ranking.minTime")}>
            <option value="0">{t("ranking.minTime.any")}</option>
            <option value="2">{t("ranking.minTime.2")}</option>
            <option value="5">{t("ranking.minTime.5")}</option>
            <option value="15">{t("ranking.minTime.15")}</option>
            <option value="60">{t("ranking.minTime.60")}</option>
          </Select>
          {selected.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted">{t("ranking.selected", { n: selected.length })}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                {t("common.clear")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const q = filtersToQuery(filters);
                  nav(`${ROUTES.compare}?accounts=${encodeURIComponent(selected.join(","))}${q ? `&${q}` : ""}`);
                }}
              >
                <GitCompareArrows className="size-4" /> {t("common.compare")}
              </Button>
            </div>
          )}
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        )}
        {isLoading && <Loading />}
        {data && rows.length === 0 && <Empty title={t("ranking.empty.title")}>
            {t("ranking.empty.text")}
            <NoAllianceNote guild={filters.guild} />
          </Empty>}
        {data && rows.length > 0 && (
          <DataTable
            key={`${group}-${scope}-${oneBoon ? boon : "all"}`}
            pickerKey={`ranking:${pickerView(group, scope, oneBoon)}`}
            rows={rows}
            columns={columns}
            rowKey={(r) => r.account}
            initialSort={sort}
            pageSize={PAGE_SIZE}
            fill
            rowClassName={(r) => (r.account === me ? "bg-gold/5" : selected.includes(r.account) ? "bg-info/5" : undefined)}
            onRowClick={(r) => toggle(r.account)}
            dense
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-faint">{t("ranking.note")}</p>
    </>
  );
}
