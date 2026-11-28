import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import {
  filtersToQuery,
  PAGE_SIZE,
  type Aggregate,
  type ArchiveMonth,
  type ArchivePlayerProfile,
  type ArchiveWeek,
  type DaySummary,
  type Fight,
  type FightDetail,
  type Filters,
  type GuildSummary,
  type Overview,
  type PlayerOptions,
  type PlayerProfile,
  type PlayerSkill,
  type PlayerSkillUsage,
  type PlayerSupportSkill,
  type SkillKind,
  type RankingRow,
  type SupportKind,
  type UsageKind,
  type UploadResult,
} from "@gw2logs/shared";

import { ApiError, apiErrorFrom } from "./errors";

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
  eliteInsights: boolean;
  retentionDays: number;
  /** Limites de envio de cada usuário. */
  limits: { queuePerUser: number; perHourPerUser: number };
}

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => get<AppConfig>("/api/config"), staleTime: Infinity });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => get<Meta>(`/api/meta`), staleTime: 60_000 });
export const useGuilds = () => useQuery({ queryKey: ["guilds"], queryFn: () => get<GuildSummary[]>(`/api/guilds`), staleTime: 60_000 });

export const useOverview = (f: Filters, enabled = true) => useQuery({ queryKey: ["overview", f], queryFn: () => get<Overview>(withFilters(`/api/overview`, f)), enabled });

export const useDays = (f: Filters, enabled = true) =>
  useQuery({ queryKey: ["days", f], queryFn: () => get<DaySummary[]>(withFilters(`/api/days`, f)), enabled });

export const useFights = (f: Filters, limit = 100, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["fights", f, limit],
    queryFn: () => get<Fight[]>(withFilters(`/api/fights`, f, { limit })),
    // enquanto houver luta na fila, atualiza sozinho
    refetchInterval: (q) => (q.state.data?.some((x) => x.status === "queued" || x.status === "parsing") ? 3000 : false),
  });

/** Uma página da lista de lutas, já ordenada pelo servidor sobre todas as lutas do filtro, e o total dele (cabeçalho x-total-count). */
export const useFightsPage = (f: Filters, o: { page: number; sort: string; dir: "asc" | "desc" }) =>
  useQuery({
    queryKey: ["fights-page", f, o],
    queryFn: async (): Promise<{ rows: Fight[]; total: number }> => {
      const res = await fetch(withFilters(`/api/fights`, f, { limit: PAGE_SIZE, offset: (o.page - 1) * PAGE_SIZE, sort: o.sort, dir: o.dir }));
      if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
      return { rows: (await res.json()) as Fight[], total: Number(res.headers.get("x-total-count")) || 0 };
    },
    // ao trocar de página ou de ordem, a tabela anterior fica na tela até a nova chegar (sem piscar)
    placeholderData: keepPreviousData,
    // enquanto houver luta na fila, atualiza sozinho
    refetchInterval: (q) => (q.state.data?.rows.some((x) => x.status === "queued" || x.status === "parsing") ? 3000 : false),
  });

export const useFight = (id: string) => useQuery({ queryKey: ["fight", id], queryFn: () => get<FightDetail>(`/api/fights/${encodeURIComponent(id)}`) });

export const useRanking = (f: Filters, enabled = true) =>
  useQuery({ queryKey: ["ranking", f], queryFn: () => get<{ rows: RankingRow[]; baseline: Aggregate; referenceMs: number }>(withFilters(`/api/ranking`, f)), enabled });

/** Meses com resumo diário guardado (o Ranking deles vale mesmo depois de as lutas serem apagadas). */
export const useArchiveMonths = (enabled: boolean) => useQuery({ queryKey: ["archive-months"], queryFn: () => get<ArchiveMonth[]>("/api/archive/months"), enabled });

/** Semanas (sexta 23:03 a sexta 23:00) com resumo diário guardado. */
export const useArchiveWeeks = (enabled: boolean) => useQuery({ queryKey: ["archive-weeks"], queryFn: () => get<ArchiveWeek[]>("/api/archive/weeks"), enabled });

/** O Ranking de um mês, ou da semana `f.week` (que vale no lugar do mês); do resumo só valem a guilda e a função (período, dia e tamanho do squad não existem nele). */
export const useArchiveRanking = (month: string | undefined, f: Filters, enabled: boolean) =>
  useQuery({
    queryKey: ["archive-ranking", f.week ? undefined : month, f.week, f.guild, f.role],
    enabled: enabled && (!!month || !!f.week),
    queryFn: () => get<{ rows: RankingRow[]; baseline: Aggregate; referenceMs: number }>(withFilters(`/api/archive/ranking`, { guild: f.guild, role: f.role, week: f.week }, month ? { month } : {})),
  });

/** O perfil de um jogador num mês ou semana arquivados (do resumo diário). */
export const useArchivePlayer = (account: string, month: string | undefined, f: Filters) =>
  useQuery({
    queryKey: ["archive-player", account, month, f.week, f.guild, f.role],
    enabled: !!month || !!f.week,
    retry: false,
    queryFn: () => get<ArchivePlayerProfile>(withFilters(`/api/archive/players/${encodeURIComponent(account)}`, { guild: f.guild, role: f.role, week: f.week }, month ? { month } : {})),
  });

export const usePlayer = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player", account, f], queryFn: () => get<PlayerProfile>(withFilters(`/api/players/${encodeURIComponent(account)}`, f)), retry: false });

/** Funções, classes e dias que o jogador jogou, para as listas dos filtros da página dele. */
export const usePlayerOptions = (account: string, f: Filters) =>
  useQuery({
    queryKey: ["player-options", account, f],
    queryFn: () => get<PlayerOptions>(withFilters(`/api/players/${encodeURIComponent(account)}/options`, f)),
    retry: false,
    // ao trocar um filtro, as listas anteriores ficam na tela até as novas chegarem (sem piscar)
    placeholderData: keepPreviousData,
  });

export const usePlayerSkills = (account: string, f: Filters) =>
  useQuery({ queryKey: ["player-skills", account, f], queryFn: () => get<PlayerSkill[]>(withFilters(`/api/players/${encodeURIComponent(account)}/skills`, f)) });

/** Habilidades de um jogador em uma luta: dano, cura ou barreira (a cura e a barreira só de quem grava com o Healing Stats). */
export const useFightPlayerSkills = <T extends PlayerSkill | PlayerSupportSkill | PlayerSkillUsage>(fightId: string, account: string, kind: SkillKind) =>
  useQuery({
    queryKey: ["fight-player-skills", fightId, account, kind],
    enabled: !!account,
    queryFn: () => get<T[]>(`/api/fights/${encodeURIComponent(fightId)}/players/${encodeURIComponent(account)}/skills?kind=${kind}`),
  });

/** Usos de cada habilidade (cast) ou dano recebido por habilidade (taken) do jogador. */
export const usePlayerSkillUsage = (account: string, f: Filters, kind: UsageKind, enabled = true) =>
  useQuery({
    queryKey: ["player-skill-usage", account, f, kind],
    enabled,
    queryFn: () => get<PlayerSkillUsage[]>(withFilters(`/api/players/${encodeURIComponent(account)}/skill-usage`, f, { kind })),
  });

/** Cura ou barreira do jogador por habilidade (só de quem grava com o Healing Stats). */
export const usePlayerSupportSkills = (account: string, f: Filters, kind: SupportKind, enabled = true) =>
  useQuery({
    queryKey: ["player-support-skills", account, f, kind],
    enabled,
    queryFn: () => get<PlayerSupportSkill[]>(withFilters(`/api/players/${encodeURIComponent(account)}/support-skills`, f, { kind })),
  });

/** Uma habilidade de um jogador na comparação: o total e a parte (%) que ela é do total dele, para dano, cura ou barreira. */
export interface SkillShare {
  /** identifica a habilidade (a direta e o efeito de mesmo id são linhas diferentes) */
  key: string;
  skillId: number;
  name: string | null;
  indirect: boolean;
  total: number;
  pct: number;
}

/** As habilidades de vários jogadores, na mesma forma para dano, cura e barreira (a ordem é a dos jogadores). */
export const usePlayersSkills = (accounts: string[], f: Filters, kind: "damage" | SupportKind) =>
  useQueries({
    queries: accounts.map((account) => ({
      queryKey: ["player-skill-shares", account, f, kind],
      queryFn: async (): Promise<SkillShare[]> => {
        const base = `/api/players/${encodeURIComponent(account)}`;
        if (kind === "damage") {
          return (await get<PlayerSkill[]>(withFilters(`${base}/skills`, f))).map((s) => ({ key: `s${s.skillId}`, skillId: s.skillId, name: s.name, indirect: false, total: s.damage, pct: s.pct }));
        }
        return (await get<PlayerSupportSkill[]>(withFilters(`${base}/support-skills`, f, { kind }))).map((s) => ({ key: `${s.indirect ? "b" : "s"}${s.skillId}`, skillId: s.skillId, name: s.name, indirect: s.indirect, total: s.amount, pct: s.pct }));
      },
    })),
  });

export const useCompare = (accounts: string[], f: Filters) =>
  useQuery({
    queryKey: ["compare", accounts, f],
    enabled: accounts.length > 0,
    queryFn: () => get<{ players: PlayerProfile[]; baseline: Aggregate }>(withFilters(`/api/compare`, f, { accounts: accounts.join(",") })),
  });

/** Marca ou desmarca uma guilda da aliança. Só vale para quem administra pelo login. */
export async function setGuildAlliance(id: string, inAlliance: boolean) {
  const res = await fetch(`/api/guilds/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inAlliance }),
  });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
}

/** Quem está logado: o nome e se pode administrar (marcar guildas da aliança). */
export interface Viewer {
  name: string;
  avatar: string | null;
  isAdmin: boolean;
}

interface ViewerState {
  user: Viewer | null;
  /** A sessão existe, mas a conferência dos servidores do Discord venceu: é só entrar de novo. */
  expired: boolean;
}

const viewerQuery = <T>(select: (v: ViewerState) => T) =>
  useQuery({
    queryKey: ["viewer"],
    queryFn: async (): Promise<ViewerState> => {
      const res = await fetch("/api/auth/me");
      if (res.ok) return { user: (await res.json()) as Viewer, expired: false };
      const body = res.status === 401 ? await res.json().catch(() => null) : null;
      return { user: null, expired: body?.code === "loginExpired" };
    },
    staleTime: 60_000,
    select,
  });

/** Quem está logado neste navegador (null = ninguém). */
export const useViewer = () => viewerQuery((v) => v.user);

/** A sessão venceu e a pessoa precisa entrar de novo (a tela inicial avisa; sem redirecionar sozinha, para não prender quem cancela o login). */
export const useLoginExpired = () => viewerQuery((v) => v.expired).data === true;

export const logout = () => fetch("/api/auth/logout", { method: "POST" });

/** Apaga a conta (os logs enviados continuam no site). O servidor só apaga se `confirm` for o nome da própria conta. */
export async function deleteAccount(confirm: string): Promise<void> {
  const res = await fetch("/api/auth/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm }) });
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

/** Gera o token pessoal do script de envio (o anterior deixa de valer). O valor só aparece nesta resposta; `expiresAt` é até quando ele vale. */
export async function createToken(): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch("/api/auth/token", { method: "POST" });
  if (!res.ok) throw apiErrorFrom(res.status, await res.json().catch(() => null));
  return (await res.json()) as { token: string; expiresAt: string };
}
