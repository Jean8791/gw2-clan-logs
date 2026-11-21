import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório (funciona tanto em src/ quanto em dist/). */
export const repoRoot = path.resolve(here, "..", "..", "..");

/** Dias de validade do token pessoal de envio (API_TOKEN_DAYS). */
export const DEFAULT_API_TOKEN_DAYS = 90;

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  eiDir: string;
  /** Comando que roda o Elite Insights (dll .NET). */
  dotnet: string;
  /** Senha para administrar (marcar guildas da aliança). Vazio = qualquer um administra. */
  adminKey: string;
  /** Endereço público do site (ex.: https://logs.exemplo.com): vira o retorno do login e decide o cookie Secure. */
  publicUrl: string;
  /**
   * Aplicativo do Discord para o login. Sem os dois valores o login fica desligado.
   * `guildIds`: só quem está em um desses servidores entra. `userIds`: só esses usuários entram.
   * Preenchidas as duas, valem juntas. Vazia, a lista não restringe.
   */
  discord: { clientId: string; clientSecret: string; guildIds: string[]; userIds: string[] };
  /** Pasta com o site compilado (apps/web/dist). */
  webDir: string;
  /** Dias que as lutas ficam guardadas. 0 = guardar para sempre. */
  retentionDays: number;
  /** Buscar nomes de mapas e guildas na API oficial do GW2. */
  gw2Api: boolean;
  /** Atrás de proxy (Caddy): vale o IP do X-Forwarded-For. Ligado sem proxy, qualquer um forjaria o IP. */
  trustProxy: boolean;
  /** Dias que o token pessoal de envio vale; depois é preciso gerar outro no site. */
  apiTokenDays: number;
  /** Gerar o relatório HTML do Elite Insights (40 a 50 MB de disco e ~300 MB de memória a mais por luta grande). */
  eiHtml: boolean;
  limits: UploadLimits;
}

/** Travas contra abuso: tentativas de senha, fila de processamento, envios por hora (no total e por usuário) e espaço em disco. */
export interface UploadLimits {
  maxFailedKeys: number;
  blockMinutes: number;
  maxQueue: number;
  maxPerHour: number;
  maxUploadsMb: number;
  /** Logs de um mesmo usuário esperando ou em processamento. */
  maxQueuePerUser: number;
  /** Logs novos de um mesmo usuário por hora. */
  maxPerHourPerUser: number;
}

/** Número positivo da variável de ambiente; vazio ou inválido usa o padrão. */
const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Lista de IDs separados por vírgula: tira espaços e ignora vazios. */
const idList = (raw: string | undefined) => (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 5080),
    host: env.HOST ?? "127.0.0.1",
    dataDir: path.resolve(env.DATA_DIR ?? path.join(repoRoot, "data")),
    eiDir: path.resolve(env.EI_DIR ?? path.join(repoRoot, "tools", "GW2EICLI")),
    dotnet: env.DOTNET ?? "dotnet",
    adminKey: env.ADMIN_KEY ?? "",
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 5080}`).replace(/\/+$/, ""),
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? "",
      clientSecret: env.DISCORD_CLIENT_SECRET ?? "",
      guildIds: idList(env.DISCORD_GUILD_IDS),
      userIds: idList(env.DISCORD_USER_IDS),
    },
    webDir: path.resolve(env.WEB_DIR ?? path.join(repoRoot, "apps", "web", "dist")),
    retentionDays: Number(env.RETENTION_DAYS ?? 0),
    gw2Api: env.GW2_API !== "off",
    trustProxy: env.TRUST_PROXY === "true",
    apiTokenDays: positive(env.API_TOKEN_DAYS, DEFAULT_API_TOKEN_DAYS),
    eiHtml: env.EI_HTML === "true",
    limits: {
      maxFailedKeys: positive(env.UPLOAD_MAX_FAILS, 5),
      blockMinutes: positive(env.UPLOAD_BLOCK_MIN, 15),
      maxQueue: positive(env.UPLOAD_MAX_QUEUE, 30),
      maxPerHour: positive(env.UPLOAD_MAX_PER_HOUR, 500),
      maxUploadsMb: positive(env.UPLOAD_MAX_DISK_MB, 4096),
      maxQueuePerUser: positive(env.UPLOAD_MAX_QUEUE_USER, 10),
      maxPerHourPerUser: positive(env.UPLOAD_MAX_PER_HOUR_USER, 200),
    },
  };
}

export const paths = (dataDir: string) => ({
  db: path.join(dataDir, "gw2logs-v2.db"),
  uploads: path.join(dataDir, "uploads"),
  fights: path.join(dataDir, "fights"),
  fightDir: (id: string) => path.join(dataDir, "fights", id),
});
