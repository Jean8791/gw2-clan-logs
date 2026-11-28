import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isMonth, parseFilters, ROUTES, statsOfGroup, type Aggregate, type BoonScope, type StatGroup, type TimeAdjust } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { GuildTag, Profession } from "../components/badges";
import { defaultSort, GroupTabs, ModeToggle, statColumnsFor, type ValueMode } from "../components/statColumns";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader } from "../components/ui";
import { useArchivePlayer } from "../lib/api";
import { accountShort, dayLabel, duration, int, monthLabel, weekLabel } from "../lib/format";
import { t } from "../lib/i18n";

/**
 * O perfil de um jogador num mês (ou semana) arquivados: o desempenho somado do resumo diário, a média do clã no mesmo período e o dia a dia.
 * Vale depois de as lutas serem apagadas, mas não tem as habilidades nem a evolução luta a luta: elas existem só enquanto as lutas estão guardadas.
 */
export function MonthPlayerPage() {
  const { account = "" } = useParams();
  const [params] = useSearchParams();
  const filters = parseFilters(Object.fromEntries(params));
  const asked = params.get("month") ?? "";
  const month = isMonth(asked) ? asked : undefined;
  const [group, setGroup] = useState<StatGroup>("offense");
  const [scope, setScope] = useState<BoonScope>("squad");
  const [mode, setMode] = useState<ValueMode>("perMin");
  const { data, error, isLoading } = useArchivePlayer(account, month, filters);

  const period = filters.week ? weekLabel(filters.week) : month ? monthLabel(month) : "";
  const back = `${ROUTES.months}?${params.toString()}`;
  if (isLoading) return <Loading />;
  if (error || !data) {
    return (
      <>
        <BackLink to={back} />
        {error && (error as { status?: number }).status !== 404 ? <ErrorBox error={error} /> : <Empty title={t("monthPlayer.notFound")}>{period}</Empty>}
      </>
    );
  }

  const { row, baseline } = data;
  const keys = statsOfGroup(group, scope);
  const adjust: TimeAdjust = { baseline, refMs: data.referenceMs };
  // "total" do clã inteiro não é comparável com o de um jogador: a linha do clã só aparece nos modos por minuto e por segundo
  const summary = [{ ...row, label: t("monthPlayer.player") }, ...(mode === "total" ? [] : [{ ...baseline, label: t("monthPlayer.clan") }])];
  const labelCol = (id: string, header: string): Column<(typeof summary)[number]> => ({ id, header, sticky: true, cell: (r) => <span className="font-medium">{r.label}</span> });
  const dayCols: Column<Aggregate & { day: string }>[] = [
    { id: "day", header: t("monthPlayer.day"), sticky: true, sort: (d) => d.day, cell: (d) => <span className="font-medium">{dayLabel(d.day)}</span> },
    { id: "fights", header: t("table.fights"), align: "right", sort: (d) => d.fights, cell: (d) => d.fights },
    { id: "time", header: t("common.activeTime"), align: "right", sort: (d) => d.activeMs, cell: (d) => <span className="text-muted">{duration(d.activeMs)}</span> },
    ...statColumnsFor(keys, mode, data.days, adjust),
  ];

  return (
    <>
      <BackLink to={back} />
      <PageHeader title={row.name ?? accountShort(account)} subtitle={`${period} · ${account}`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("table.fights")} value={int(row.fights)} accent />
        <Kpi label={t("common.activeTime")} value={duration(row.activeMs)} />
        <Kpi label={t("table.class")} value={<span className="flex flex-wrap gap-x-3 gap-y-1 text-base">{row.professions.map((p) => <span key={p.profession} className="inline-flex items-center gap-1"><Profession profession={p.profession} /><span className="text-xs text-faint">{p.fights}</span></span>)}</span>} />
        <Kpi label={t("table.guild")} value={<GuildTag id={row.guildId} />} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GroupTabs value={group} onChange={setGroup} scope={scope} onScopeChange={setScope} />
        <ModeToggle value={mode} onChange={setMode} />
      </div>
      <Card title={t("monthPlayer.summary")}>
        <DataTable
          key={`summary-${group}-${scope}-${mode}`}
          rows={summary}
          columns={[labelCol("who", ""), ...statColumnsFor(keys, mode, summary, adjust)]}
          rowKey={(r) => r.label}
          initialSort={{ ...defaultSort(group, scope), desc: true }}
          dense
        />
      </Card>
      <Card className="mt-6" title={t("monthPlayer.days")}>
        <DataTable key={`days-${group}-${scope}-${mode}`} rows={data.days} columns={dayCols} rowKey={(d) => d.day} initialSort={{ id: "day", desc: false }} dense />
        <p className="border-t border-line px-5 py-2.5 text-xs text-faint">{t("monthPlayer.note")}</p>
      </Card>
      <p className="mt-4 text-xs text-faint">
        <Link to={ROUTES.player(account)} className="text-gold hover:underline">
          {t("monthPlayer.liveProfile")}
        </Link>
      </p>
    </>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-gold">
      <ArrowLeft className="size-4" /> {t("monthPlayer.back")}
    </Link>
  );
}
