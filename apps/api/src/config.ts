import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório (funciona tanto em src/ quanto em dist/). */
export const repoRoot = path.resolve(here, "..", "..", "..");

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  eiDir: string;
  /** Comando que roda o Elite Insights (dll .NET). */
  dotnet: string;
  /** Senha para enviar logs. Vazio = qualquer um envia. */
  uploadKey: string;
  /** Senha para administrar (marcar guildas da aliança). Padrão: a mesma do envio. */
  adminKey: string;
  /** Pasta com o site compilado (apps/web/dist). */
  webDir: string;
  /** Dias que as lutas ficam guardadas. 0 = guardar para sempre. */
  retentionDays: number;
  /** Buscar nomes de mapas e guildas na API oficial do GW2. */
  gw2Api: boolean;
  /** Atrás de proxy (Caddy): vale o IP do X-Forwarded-For. Ligado sem proxy, qualquer um forjaria o IP. */
  trustProxy: boolean;
  limits: UploadLimits;
}

/** Travas contra abuso: tentativas de senha, fila de processamento, envios por hora e espaço em disco. */
export interface UploadLimits {
  maxFailedKeys: number;
  blockMinutes: number;
  maxQueue: number;
  maxPerHour: number;
  maxUploadsMb: number;
}

/** Número positivo da variável de ambiente; vazio ou inválido usa o padrão. */
const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const uploadKey = env.UPLOAD_KEY ?? "";
  return {
    port: Number(env.PORT ?? 5080),
    host: env.HOST ?? "127.0.0.1",
    dataDir: path.resolve(env.DATA_DIR ?? path.join(repoRoot, "data")),
    eiDir: path.resolve(env.EI_DIR ?? path.join(repoRoot, "tools", "GW2EICLI")),
    dotnet: env.DOTNET ?? "dotnet",
    uploadKey,
    adminKey: env.ADMIN_KEY ?? uploadKey,
    webDir: path.resolve(env.WEB_DIR ?? path.join(repoRoot, "apps", "web", "dist")),
    retentionDays: Number(env.RETENTION_DAYS ?? 0),
    gw2Api: env.GW2_API !== "off",
    trustProxy: env.TRUST_PROXY === "true",
    limits: {
      maxFailedKeys: positive(env.UPLOAD_MAX_FAILS, 5),
      blockMinutes: positive(env.UPLOAD_BLOCK_MIN, 15),
      maxQueue: positive(env.UPLOAD_MAX_QUEUE, 30),
      maxPerHour: positive(env.UPLOAD_MAX_PER_HOUR, 100),
      maxUploadsMb: positive(env.UPLOAD_MAX_DISK_MB, 4096),
    },
  };
}

export const paths = (dataDir: string) => ({
  db: path.join(dataDir, "gw2logs-v2.db"),
  uploads: path.join(dataDir, "uploads"),
  fights: path.join(dataDir, "fights"),
  fightDir: (id: string) => path.join(dataDir, "fights", id),
});
