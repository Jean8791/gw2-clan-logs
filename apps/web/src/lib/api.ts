import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  filtersToQuery,
  PAGE_SIZE,
  type Aggregate,
  type DaySummary,
  type Fight,
  type FightDetail,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerOptions,
  type PlayerProfile,
  type PlayerSkill,
  type RankingRow,
  type UploadResult,
} from "@gw2logs/shared";

import { ApiError, apiErrorFrom } from "./errors";
import { spaceApi } from "./space";

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
  loginAvailable: boolean;
  adminKeyRequired: boolean;
  eliteInsights: boolean;
  retentionDays: number;
  /** Limites de envio de cada usuário. */
  limits: { queuePerUser: number; perHourPerUser: number };
}

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => get<AppConfig>("/api/config"), staleTime: Infinity });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => get<Meta>(`${spaceApi}/meta`), staleTime: 60_000 });
export const useGuilds = () => useQuery({ queryKey: ["guilds"], queryFn: () => get<GuildSummary[]>(`${spaceApi}/guilds`), staleTime: 60_000 });

export const useOverview = (f: Filters) => useQuery({ queryKey: ["overview", f], queryFn: () => get<Overview>(withFilters(`${spaceApi}/overview`, f)) });

export const useDays = (f: Filters, enabled = true) =>
  useQuery({ queryKey: ["days", f], queryFn: () => get<DaySummary[]>(withFilters(`${spaceApi}/days`, f)), enabled });

export const useFights = (f: Filters, limit = 100, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["fights", f, limit],
    queryFn: () => get<Fight[]>(withFilters(`${spaceApi}/fights`, f, { limit })),
    // enquanto houver luta na fila, atualiza sozinho
    refetchInterval: (q) => (q.state.data?.some((x) => x.status === "queued" || x.status === "parsing") ? 3000 : false),
  });

/** Uma página da lista de lutas, já ordenada pelo servidor sobre todas as lutas do filtro, e o total dele (cabeçalho x-total-count). */
export const useFightsPage = (f: Filters, o: { page: number; sort: string; dir: "asc" | "desc" }) =>
  useQuery({
    queryKey: ["fights-page", f, o],
    queryFn: async (): Promise<{ rows: Fight[]; total: number }> => {
      const res = await fetch(withFilters(`${spaceApi}/fights`, f, { limit: PAGE_SIZE, offset: (o.page - 1) * PAGE_SIZE, sort: o.sort, dir: o.dir }));
      if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
      return { rows: (await res.json()) as Fight[], total: Number(res.headers.get("x-total-count")) || 0 };
    },
    // ao trocar de página ou de ordem, a tabela anterior fica na tela até a nova chegar (sem piscar)
    placeholderData: keepPreviousData,
    // enquanto houver luta na fila, atualiza sozinho
    refetchInterval: (q) => (q.state.data?.rows.some((x) => x.status === "queued" || x.status === "parsing") ? 3000 : false),
  });

export const useFight = (id: string) => useQuery({ queryKey: ["fight", id], queryFn: () => get<FightDetail>(`${spaceApi}/fights/${encodeURIComponent(id)}`) });

export const useRanking = (f: Filters) =>
  useQuery({ queryKey: ["ranking", f], queryFn: () => get<{ rows: RankingRow[]; baseline: Aggregate }>(withFilters(`${spaceApi}/ranking`, f)) });

export const usePlayer = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player", account, f], queryFn: () => get<PlayerProfile>(withFilters(`${spaceApi}/players/${encodeURIComponent(account)}`, f)), retry: false });

/** Funções, classes e dias que o jogador jogou, para as listas dos filtros da página dele. */
export const usePlayerOptions = (account: string, f: Filters) =>
  useQuery({
    queryKey: ["player-options", account, f],
    queryFn: () => get<PlayerOptions>(withFilters(`${spaceApi}/players/${encodeURIComponent(account)}/options`, f)),
    retry: false,
    // ao trocar um filtro, as listas anteriores ficam na tela até as novas chegarem (sem piscar)
    placeholderData: keepPreviousData,
  });

export const usePlayerSkills = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player-skills", account, f], queryFn: () => get<PlayerSkill[]>(withFilters(`${spaceApi}/players/${encodeURIComponent(account)}/skills`, f)) });

export const useCompare = (accounts: string[], f: Filters) =>
  useQuery({
    queryKey: ["compare", accounts, f],
    enabled: accounts.length > 0,
    queryFn: () => get<{ players: PlayerProfile[]; baseline: Aggregate }>(withFilters(`${spaceApi}/compare`, f, { accounts: accounts.join(",") })),
  });

export async function setGuildAlliance(id: string, inAlliance: boolean, key: string) {
  const res = await fetch(`/api/guilds/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(key ? { "X-Upload-Key": key } : {}) },
    body: JSON.stringify({ inAlliance }),
  });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
}

export interface SpaceUser {
  publicId: string;
  name: string;
  avatar: string | null;
}

/** Dono do espaço que está aberto. */
export const useOwner = () => useQuery({ queryKey: ["owner"], queryFn: () => get<SpaceUser>(spaceApi), retry: false, staleTime: Infinity });

/** Quem está logado neste navegador (null = ninguém). */
export const useViewer = () =>
  useQuery({
    queryKey: ["viewer"],
    queryFn: async (): Promise<SpaceUser | null> => {
      const res = await fetch("/api/auth/me");
      return res.ok ? ((await res.json()) as SpaceUser) : null;
    },
    staleTime: 60_000,
  });

export const logout = () => fetch("/api/auth/logout", { method: "POST" });

/** Apaga a conta do usuário logado e todos os logs dele. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch("/api/auth/account", { method: "DELETE" });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
}

/** Envia um log com o cookie da sessão. XHR para ter o progresso (logs de WvW são grandes). Erro HTTP vira ApiError. */
export function uploadLog(file: File, onProgress: (pct: number) => void): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* resposta vazia */
      }
      if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(body) && body[0]) resolve(body[0] as UploadResult);
      else reject(apiErrorFrom(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error", "network"));
    xhr.send(form);
  });
}

/** Gera o token pessoal do script de envio (o anterior deixa de valer). O valor só aparece nesta resposta. */
export async function createToken(): Promise<string> {
  const res = await fetch("/api/auth/token", { method: "POST" });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
  return ((await res.json()) as { token: string }).token;
}
