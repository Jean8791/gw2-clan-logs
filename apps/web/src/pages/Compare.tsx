import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { perMinute, STAT_META, statsOfGroup, type Aggregate, type StatGroup, type StatKey } from "@gw2logs/shared";
import { FilterBar } from "../components/FilterBar";
import { GroupTabs } from "../components/statColumns";
import { PlayerPicker } from "../components/PlayerPicker";
import { ProfessionDot } from "../components/badges";
import { SERIES, TOOLTIP } from "../components/charts";
import { Card, Empty, ErrorBox, Loading, PageHeader, cx } from "../components/ui";
import { useCompare, useRanking } from "../lib/api";
import { mainRole, useFilters, useMe } from "../lib/hooks";
import { BaselinePicker, type BaselineRole } from "../components/BaselinePicker";
import { accountShort, duration, stat } from "../lib/format";

const value = (a: Aggregate, k: StatKey) => (STAT_META[k].format === "volume" ? (a.fights ? a[k] / a.fights : 0) : perMinute(a[k], a.activeMs));

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useFilters({ mode: "wvw" });
  const [group, setGroup] = useState<StatGroup>("offense");
  const me = useMe();
  const accounts = useMemo(() => (params.get("accounts") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4), [params]);
  const { data, error, isLoading } = useCompare(accounts, filters);
  const [baseRole, setBaseRole] = useState<BaselineRole | null>(null);
  const effRole: BaselineRole = baseRole ?? mainRole((data?.players ?? []).flatMap((p) => p.history));
  const baseline = useRanking({ ...filters, role: effRole === "all" ? filters.role : effRole }).data?.baseline;

  const setAccounts = (list: string[]) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (list.length) p.set("accounts", list.join(","));
      else p.delete("accounts");
      return p;
    });

  const players = data?.players ?? [];
  const keys = statsOfGroup(group);
  const label = (a: string) => players.find((p) => p.account === a)?.name ?? accountShort(a);

  // radar: cada métrica normalizada pelo maior valor entre os comparados e a média (0–100)
  const radar = keys.map((k) => {
    const vals = players.map((p) => value(p.totals, k));
    const avg = baseline ? value(baseline, k) : 0;
    const max = Math.max(...vals, avg) || 1;
    const meta = STAT_META[k];
    // quando menor é melhor (mortes, dano recebido), inverte: 100 = nada, 0 = o pior
    const norm = (v: number) => (meta.higherIsBetter ? (v / max) * 100 : (1 - v / max) * 100);
    const row: Record<string, number | string> = { metric: meta.short, Média: norm(avg) };
    players.forEach((p, i) => (row[`p${i}`] = norm(vals[i]!)));
    return row;
  });

  return (
    <>
      <PageHeader title="Comparar jogadores" subtitle="Até 4 jogadores lado a lado, por minuto de luta, contra a média do squad com os mesmos filtros." />
      <FilterBar value={filters} onChange={setFilters} fields={["period", "role", "profession", "size", "map"]} />

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {accounts.map((a, i) => (
            <span key={a} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-sm" style={{ borderColor: SERIES[i] + "80" }}>
              <span className="size-2.5 rounded-full" style={{ background: SERIES[i] }} />
              <Link to={`/jogadores/${encodeURIComponent(a)}`} className="font-medium hover:text-gold">
                {label(a)}
              </Link>
              <button aria-label="Remover" className="rounded p-1 text-faint hover:bg-surface-3 hover:text-text" onClick={() => setAccounts(accounts.filter((x) => x !== a))}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {accounts.length === 0 && me && (
            <button className="text-sm text-gold hover:underline" onClick={() => setAccounts([me])}>
              Começar comigo ({accountShort(me)})
            </button>
          )}
        </div>
        {accounts.length < 4 && (
          <div className="mt-3 max-w-xl">
            <PlayerPicker label="Adicionar jogador" button="Adicionar" exclude={accounts} onPick={(a) => setAccounts([...accounts, a])} />
          </div>
        )}
      </Card>

      {accounts.length === 0 && (
        <Card>
          <Empty title="Escolha quem comparar">Adicione jogadores acima ou selecione até 4 no Ranking e clique em “Comparar”.</Empty>
        </Card>
      )}
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}

      {data && players.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <GroupTabs value={group} onChange={setGroup} />
            <BaselinePicker value={effRole} onChange={setBaseRole} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]">
            <Card title="Perfil">
              <div className="h-[380px] p-2">
                <ResponsiveContainer>
                  <RadarChart data={radar} outerRadius="72%">
                    <PolarGrid stroke="#2a303c" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "#8f98a8", fontSize: 11 }} />
                    <Radar name={effRole === "support" ? "Média dos suportes" : effRole === "dps" ? "Média dos DPS" : "Média do squad"} dataKey="Média" stroke="#8f98a8" strokeDasharray="4 4" fill="#8f98a8" fillOpacity={0.06} />
                    {players.map((p, i) => (
                      <Radar key={p.account} name={p.name ?? accountShort(p.account)} dataKey={`p${i}`} stroke={SERIES[i]} fill={SERIES[i]} fillOpacity={0.14} strokeWidth={2} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip {...TOOLTIP} formatter={(v: number) => `${Math.round(v)}% do melhor`} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Números">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-semibold">Por minuto</th>
                      {players.map((p, i) => (
                        <th key={p.account} className="px-4 py-2.5 text-right font-semibold" style={{ color: SERIES[i] }}>
                          <span className="inline-flex items-center gap-1.5">
                            <ProfessionDot profession={p.professions[0]?.profession ?? null} />
                            {p.name ?? accountShort(p.account)}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold">Média</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    <tr className="border-t border-line/60 text-muted">
                      <td className="px-4 py-2">Lutas · tempo</td>
                      {players.map((p) => (
                        <td key={p.account} className="px-4 py-2 text-right">
                          {p.totals.fights} · {duration(p.totals.activeMs)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right">—</td>
                    </tr>
                    {keys.map((k) => {
                      const meta = STAT_META[k];
                      const vals = players.map((p) => value(p.totals, k));
                      const best = meta.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
                      return (
                        <tr key={k} className="border-t border-line/60">
                          <td className="px-4 py-2 text-muted" title={meta.hint}>
                            {meta.label}
                          </td>
                          {vals.map((v, i) => (
                            <td key={i} className={cx("px-4 py-2 text-right", v === best && players.length > 1 && v !== 0 ? "font-semibold text-gold" : v === 0 ? "text-faint" : "")}>
                              {stat(k, v, true)}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-right text-muted">{baseline ? stat(k, value(baseline, k), true) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-4 py-2.5 text-xs text-faint">Em dourado, o melhor de cada linha. Boons: volume médio por luta.</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
