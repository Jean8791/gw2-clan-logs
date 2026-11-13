import { useQuery } from "@tanstack/react-query";
import {
  filtersToQuery,
  type Aggregate,
  type Fight,
  type FightDetail,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerProfile,
  type RankingRow,
  type UploadResult,
} from "@gw2logs/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Erro ${res.status}`);
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

export const useCompare = (accounts: string[], f: Filters) =>
  useQuery({
    queryKey: ["compare", accounts, f],
    enabled: accounts.length > 0,
    queryFn: () => get<{ players: PlayerProfile[]; baseline: Aggregate }>(withFilters("/api/compare", f, { accounts: accounts.join(",") })),
  });

export async function uploadLogs(files: File[], uploader: string, key: string, onProgress?: (pct: number) => void): Promise<UploadResult[]> {
  const form = new FormData();
  if (uploader) form.append("uploader", uploader);
  for (const f of files) form.append("file", f, f.name);
  // XHR para ter progresso do envio (logs de WvW são grandes)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    if (key) xhr.setRequestHeader("X-Upload-Key", key);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* resposta vazia */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult[]);
      else reject(new ApiError(xhr.status, body?.error ?? `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Falha de rede ao enviar."));
    xhr.send(form);
  });
}

export async function setGuildAlliance(id: string, inAlliance: boolean, key: string) {
  const res = await fetch(`/api/guilds/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(key ? { "X-Upload-Key": key } : {}) },
    body: JSON.stringify({ inAlliance }),
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? `Erro ${res.status}`);
}
