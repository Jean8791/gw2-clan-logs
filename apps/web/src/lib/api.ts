import { useQuery } from "@tanstack/react-query";
import {
  filtersToQuery,
  type Aggregate,
  type DaySummary,
  type Fight,
  type FightDetail,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerProfile,
  type PlayerSkill,
  type RankingRow,
} from "@gw2logs/shared";

import { apiErrorFrom } from "./errors";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFrom(res.status, body);
  }
  return res.json() as Promise<T>;
}

const withFilters = (path: string, f: Filters, extra: Record<string, string | number> = {}) => {
  const q = filtersToQuery(f);
  const e = new URLSearchParams(Object.entries(extra).map(([k, v]) => [k, String(v)])).toString();
  const qs = [q, e].filter(Boolean).join("&");
  return qs ? `${path}?${qs}` : path;
};

export interface Meta {
  maps: { id: number; name: string | null }[];
  professions: string[];
  players: { account: string; name: string | null; profession: string | null; lastSeen: string | null }[];
}

export interface AppConfig {
  uploadKeyRequired: boolean;
  adminKeyRequired: boolean;
  eliteInsights: boolean;
}

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => get<AppConfig>("/api/config"), staleTime: Infinity });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => get<Meta>("/api/meta"), staleTime: 60_000 });
export const useGuilds = () => useQuery({ queryKey: ["guilds"], queryFn: () => get<GuildSummary[]>("/api/guilds"), staleTime: 60_000 });

export const useOverview = (f: Filters) => useQuery({ queryKey: ["overview", f], queryFn: () => get<Overview>(withFilters("/api/overview", f)) });

export const useDays = (f: Filters, enabled = true) =>
  useQuery({ queryKey: ["days", f], queryFn: () => get<DaySummary[]>(withFilters("/api/days", f)), enabled });

export const useFights = (f: Filters, limit = 100) =>
  useQuery({
    queryKey: ["fights", f, limit],
    queryFn: () => get<Fight[]>(withFilters("/api/fights", f, { limit })),
    // enquanto houver luta na fila, atualiza sozinho
    refetchInterval: (q) => (q.state.data?.some((x) => x.status === "queued" || x.status === "parsing") ? 3000 : false),
  });

export const useFight = (id: string) => useQuery({ queryKey: ["fight", id], queryFn: () => get<FightDetail>(`/api/fights/${encodeURIComponent(id)}`) });

export const useRanking = (f: Filters) =>
  useQuery({ queryKey: ["ranking", f], queryFn: () => get<{ rows: RankingRow[]; baseline: Aggregate }>(withFilters("/api/ranking", f)) });

export const usePlayer = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player", account, f], queryFn: () => get<PlayerProfile>(withFilters(`/api/players/${encodeURIComponent(account)}`, f)), retry: false });

export const usePlayerSkills = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player-skills", account, f], queryFn: () => get<PlayerSkill[]>(withFilters(`/api/players/${encodeURIComponent(account)}/skills`, f)) });

export const useCompare = (accounts: string[], f: Filters) =>
  useQuery({
    queryKey: ["compare", accounts, f],
    enabled: accounts.length > 0,
    queryFn: () => get<{ players: PlayerProfile[]; baseline: Aggregate }>(withFilters("/api/compare", f, { accounts: accounts.join(",") })),
  });

export async function setGuildAlliance(id: string, inAlliance: boolean, key: string) {
  const res = await fetch(`/api/guilds/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(key ? { "X-Upload-Key": key } : {}) },
    body: JSON.stringify({ inAlliance }),
  });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
}
