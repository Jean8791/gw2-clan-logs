import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isMonth, parseFilters, ROUTES, statsOfGroup, type BoonScope, type StatGroup, type TimeAdjust } from "@gw2logs/shared";
import { DataTable, type Column } from "../components/DataTable";
import { GuildTag, Profession } from "../components/badges";
import { defaultSort, GroupTabs, ModeToggle, statColumnsFor, type ValueMode } from "../components/statColumns";
import { PeriodPicker } from "../components/PeriodPicker";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHeader } from "../components/ui";
import { useArchiveMonths, useArchivePlayer, useArchiveWeeks } from "../lib/api";
import { accountShort, dateTime, duration, int, monthLabel, weekLabel } from "../lib/format";
import { t } from "../lib/i18n";

/**
 * O perfil de um jogador num mês (ou semana) arquivados: o desempenho somado do resumo diário, a média do clã no mesmo período e quando foi a última
 * luta dele. Vale depois de as lutas serem apagadas, mas não tem as habilidades nem a evolução luta a luta: elas existem só enquanto as lutas estão guardadas.
 */
export function MonthPlayerPage() {
  const { account = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(Object.fromEntries(params));
  const asked = params.get("month") ?? "";
  const month = isMonth(asked) ? asked : undefined;
  const [group, setGroup] = useState<StatGroup>("offense");
  const [scope, setScope] = useState<BoonScope>("squad");
  const [mode, setMode] = useState<ValueMode>("perMin");
  const { data, error, isLoading } = useArchivePlayer(account, month, filters);
  const months = useArchiveMonths(true).data ?? [];
  const weeks = useArchiveWeeks(true).data ?? [];
  // trocar de mês ou de semana mantém o jogador e os filtros de guilda e função
  const setPeriod = (p: { month?: string; week?: string }) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("month");
        next.delete("week");
        if (p.month) next.set("month", p.month);
        if (p.week) next.set("week", p.week);
        return next;
      },
      { replace: true },
    );
  const picker = <PeriodPicker months={months} weeks={weeks} month={month} week={filters.week} onChange={setPeriod} />;

  const period = filters.week ? weekLabel(filters.week) : month ? monthLabel(month) : "";
  const back = `${ROUTES.months}?${params.toString()}`;
  if (isLoading) return <Loading />;
  if (error || !data) {
    return (
      <>
        <BackLink to={back} />
        {picker}
        {error && (error as { status?: number }).status !== 404 ? <ErrorBox error={error} /> : <Empty title={t("monthPlayer.notFound")}>{period}</Empty>}
      </>
    );
  }

  const { row, baseline } = data;
  const keys = statsOfGroup(group, scope);
  const adjust: TimeAdjust = { baseline, refMs: data.referenceMs };
  // "total" do clã inteiro não é comparável com o de um jogador: a linha do clã só aparece nos modos por minuto e por segundo
  const [, month2, day2] = data.lastDay?.day.split("-") ?? [];
  const kind = t(filters.week ? "monthPlayer.kind.week" : "monthPlayer.kind.month");
  // jogador e média do clã no período mostrado (mês ou semana) e, por último, o último dia em que ele jogou
  const summary = [
    { ...row, label: t("monthPlayer.player", { kind }) },
    ...(mode === "total" ? [] : [{ ...baseline, label: t("monthPlayer.clan", { kind }) }]),
    ...(data.lastDay ? [{ ...data.lastDay, label: `${t("monthPlayer.lastFight")} ${day2}/${month2}` }] : []),
  ];
  const labelCol = (id: string, header: string): Column<(typeof summary)[number]> => ({ id, header, sticky: true, cell: (r) => <span className="font-medium">{r.label}</span> });
  return (
    <>
      <BackLink to={back} />
      <PageHeader title={row.name ?? accountShort(account)} subtitle={`${period} · ${account}`} />
      {picker}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label={t("monthPlayer.period")} value={<span className="text-base">{period}</span>} accent />
        <Kpi label={t("table.fights")} value={int(row.fights)} />
        <Kpi label={t("common.activeTime")} value={duration(row.activeMs)} />
        <Kpi label={t("table.class")} value={<span className="flex flex-wrap gap-x-3 gap-y-1 text-base">{row.professions.map((p) => <span key={p.profession} className="inline-flex items-center gap-1"><Profession profession={p.profession} /><span className="text-xs text-faint">{p.fights}</span></span>)}</span>} />
        <Kpi label={t("table.guild")} value={<GuildTag id={row.guildId} />} />
        <Kpi label={t("monthPlayer.lastFight")} value={<span className="text-base">{dateTime(data.lastSeen)}</span>} />
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
      <p className="mt-4 border-t border-line pt-3 text-xs text-faint">{t("monthPlayer.note")}</p>
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
