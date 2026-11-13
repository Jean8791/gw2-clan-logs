import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { GuildSummary } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { Badge, Card, ErrorBox, Input, Loading, PageHeader, cx } from "../components/ui";
import { setGuildAlliance, useConfig, useGuilds } from "../lib/api";
import { useSessionValue } from "../lib/hooks";
import { date } from "../lib/format";

export function GuildsPage() {
  const { data, error, isLoading } = useGuilds();
  const { data: cfg } = useConfig();
  const [key, setKey] = useSessionValue("gw2logs.adminKey");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const qc = useQueryClient();

  const toggle = async (g: GuildSummary) => {
    setBusy(g.id);
    setErr(null);
    try {
      await setGuildAlliance(g.id, !g.inAlliance, key);
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<GuildSummary>[] = [
    {
      id: "ally",
      header: "Aliança",
      align: "center",
      sort: (g) => (g.inAlliance ? 1 : 0),
      cell: (g) => (
        <button
          disabled={busy === g.id}
          onClick={() => toggle(g)}
          aria-label={g.inAlliance ? "Tirar da aliança" : "Marcar como da aliança"}
          className={cx("rounded-md p-1.5 transition", g.inAlliance ? "text-gold hover:bg-gold-soft" : "text-faint hover:bg-surface-3 hover:text-text")}
        >
          <Star className={cx("size-4", g.inAlliance && "fill-gold")} />
        </button>
      ),
    },
    { id: "tag", header: "Tag", sort: (g) => g.tag ?? "", cell: (g) => <Badge tone={g.inAlliance ? "gold" : "neutral"}>[{g.tag ?? "?"}]</Badge> },
    {
      id: "name",
      header: "Guilda",
      sort: (g) => g.name ?? "",
      cell: (g) => (
        <Link to={`/ranking?guild=${encodeURIComponent(g.id)}`} className="font-medium hover:text-gold">
          {g.name ?? <span className="text-faint">Nome ainda não carregado</span>}
        </Link>
      ),
    },
    { id: "players", header: "Jogadores", align: "right", sort: (g) => g.players, cell: (g) => g.players },
    { id: "fights", header: "Lutas", align: "right", sort: (g) => g.fights, cell: (g) => g.fights },
    { id: "last", header: "Visto por último", align: "right", sort: (g) => g.lastSeen, cell: (g) => <span className="text-muted">{date(g.lastSeen)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Guildas"
        subtitle="Marque com ★ as guildas da sua aliança. Depois filtre o ranking e as lutas por “Só a aliança” ou por guilda."
      />
      {cfg?.adminKeyRequired && (
        <Card className="mb-4 max-w-md p-4">
          <div className="flex items-end gap-2">
            <KeyRound className="mb-2.5 size-4 text-faint" />
            <Input className="flex-1" label="Senha de administrador" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Para marcar guildas da aliança" />
          </div>
        </Card>
      )}
      {err != null && (
        <div className="mb-4">
          <ErrorBox error={err} />
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <Card>
          <DataTable rows={data} columns={columns} rowKey={(g) => g.id} initialSort={{ id: "players", desc: true }} />
        </Card>
      )}
      <p className="mt-3 text-xs text-faint">A guilda de cada jogador é a que ele estava representando na luta. Nomes e tags vêm da API oficial do Guild Wars 2.</p>
    </>
  );
}
