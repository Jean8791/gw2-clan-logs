import { useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { guildMatches, PAGE_SIZE, ROUTES, type GuildSummary } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { Badge, Card, Empty, ErrorBox, Input, Loading, PageHeader, cx } from "../components/ui";
import { setGuildAlliance, useGuilds, useViewer } from "../lib/api";
import { date } from "../lib/format";
import { t } from "../lib/i18n";

export function GuildsPage() {
  const { data, error, isLoading } = useGuilds();
  const isAdmin = useViewer().data?.isAdmin === true;
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const qc = useQueryClient();

  const toggle = async (g: GuildSummary) => {
    setBusy(g.id);
    setErr(null);
    try {
      await setGuildAlliance(g.id, !g.inAlliance);
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  // a busca define o conjunto: a ordenação, o total e as páginas valem só para as guildas que batem com ela
  const rows = useMemo(() => (data ?? []).filter((g) => guildMatches(g, search)), [data, search]);

  const columns: Column<GuildSummary>[] = [
    {
      id: "ally",
      header: t("guilds.col.alliance"),
      align: "center",
      sort: (g) => (g.inAlliance ? 1 : 0),
      // quem não administra vê a estrela, sem o botão
      cell: (g) =>
        isAdmin ? (
          <button
            disabled={busy === g.id}
            onClick={() => toggle(g)}
            aria-label={g.inAlliance ? t("guilds.removeAlliance") : t("guilds.addAlliance")}
            className={cx("rounded-md p-1.5 transition", g.inAlliance ? "text-gold hover:bg-gold-soft" : "text-faint hover:bg-surface-3 hover:text-text")}
          >
            <Star className={cx("size-4", g.inAlliance && "fill-gold")} />
          </button>
        ) : (
          <Star className={cx("mx-auto size-4", g.inAlliance ? "fill-gold text-gold" : "text-faint")} />
        ),
    },
    { id: "tag", header: t("guilds.col.tag"), sort: (g) => g.tag ?? "", cell: (g) => <Badge tone={g.inAlliance ? "gold" : "neutral"}>[{g.tag ?? "?"}]</Badge> },
    {
      id: "name",
      header: t("table.guild"),
      sort: (g) => g.name ?? "",
      cell: (g) => (
        <Link to={`${ROUTES.ranking}?guild=${encodeURIComponent(g.id)}`} className="font-medium hover:text-gold">
          {g.name ?? <span className="text-faint">{t("guilds.noName")}</span>}
        </Link>
      ),
    },
    { id: "players", header: t("fight.col.players"), align: "right", sort: (g) => g.players, cell: (g) => g.players },
    { id: "fights", header: t("table.fights"), align: "right", sort: (g) => g.fights, cell: (g) => g.fights },
    { id: "last", header: t("guilds.col.last"), align: "right", sort: (g) => g.lastSeen, cell: (g) => <span className="text-muted">{date(g.lastSeen)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t("page.guilds.title")}
        subtitle={t("page.guilds.subtitle")}
      />
      {err != null && (
        <div className="mb-4">
          <ErrorBox error={err} />
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <>
          <Input className="mb-3 max-w-sm shrink-0" label={t("guilds.search")} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("guilds.searchHint")} />
          <Card className="flex min-h-0 flex-1 flex-col">
            {rows.length === 0 && search.trim() !== "" ? (
              <Empty title={t("guilds.noMatch")} />
            ) : (
              <DataTable fill rows={rows} columns={columns} rowKey={(g) => g.id} initialSort={{ id: "players", desc: true }} pageSize={PAGE_SIZE} />
            )}
          </Card>
        </>
      )}
      <p className="mt-3 shrink-0 text-xs text-faint">{t("guilds.note")}</p>
    </>
  );
}
