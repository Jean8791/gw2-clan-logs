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
  /** Senha para administrar por script (marcar guildas da aliança), no cabeçalho x-upload-key. Vazio = só a administração pelo login. */
  adminKey: string;
  /** IDs do Discord de quem administra pelo login (sessão do navegador). Sem esta lista e sem `adminKey`, a administração fica desligada. */
  adminDiscordIds: string[];
  /** Endereço público do site (ex.: https://logs.exemplo.com): vira o retorno do login e decide o cookie Secure. */
  publicUrl: string;
  /**
   * Aplicativo do Discord para o login. Sem os dois valores o login fica desligado.
   * `guildIds`: só quem está em um desses servidores entra. `userIds`: só esses usuários entram.
   * Preenchidas as duas, valem juntas. Vazia, a lista não restringe.
   */
  discord: { clientId: string; clientSecret: string; guildIds: string[]; userIds: string[] };
  /** Liberar de propósito o login a qualquer conta do Discord (as duas listas vazias). Sem isto o servidor não sobe nessa situação. */
  allowAnyDiscord: boolean;
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
  /** Limite de pedidos por IP por minuto: `perMin` para a API toda (0 desliga) e `authPerMin` para o login e o retorno do Discord (0 = só o geral). */
  rateLimit: { perMin: number; authPerMin: number };
  /** Gerar o relatório HTML do Elite Insights (40 a 50 MB de disco e ~300 MB de memória a mais por luta grande). */
  eiHtml: boolean;
  /** Tempo máximo, em milissegundos, que o Elite Insights tem para ler um log; passado disso é cortado. */
  eiTimeoutMs: number;
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

/** Número inteiro, zero ou positivo, da variável de ambiente (0 desliga); vazio, decimal ou inválido usa o padrão (0,5 não pode virar 0 sem querer). */
const nonNegative = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
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
    adminDiscordIds: idList(env.ADMIN_DISCORD_IDS),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 5080}`).replace(/\/+$/, ""),
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? "",
      clientSecret: env.DISCORD_CLIENT_SECRET ?? "",
      guildIds: idList(env.DISCORD_GUILD_IDS),
      userIds: idList(env.DISCORD_USER_IDS),
    },
    allowAnyDiscord: env.ALLOW_ANY_DISCORD === "true",
    webDir: path.resolve(env.WEB_DIR ?? path.join(repoRoot, "apps", "web", "dist")),
    retentionDays: Number(env.RETENTION_DAYS ?? 0),
    gw2Api: env.GW2_API !== "off",
    trustProxy: env.TRUST_PROXY === "true",
    apiTokenDays: positive(env.API_TOKEN_DAYS, DEFAULT_API_TOKEN_DAYS),
    rateLimit: { perMin: nonNegative(env.RATE_LIMIT_PER_MIN, 600), authPerMin: nonNegative(env.RATE_LIMIT_AUTH_PER_MIN, 30) },
    eiHtml: env.EI_HTML === "true",
    eiTimeoutMs: positive(env.EI_TIMEOUT_MIN, 5) * 60_000,
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

/**
 * Com o login ligado, as duas listas vazias deixam entrar e enviar logs qualquer conta do Discord. Isso tem que ser escolha, não esquecimento:
 * quem sobe o servidor assim sem `ALLOW_ANY_DISCORD=true` recebe o erro. Roda no index.ts (não no buildApp, que os testes usam sem listas).
 */
export function assertLoginRestricted(cfg: Config): void {
  const loginOn = cfg.discord.clientId !== "" && cfg.discord.clientSecret !== "";
  if (!loginOn || cfg.allowAnyDiscord || cfg.discord.userIds.length > 0 || cfg.discord.guildIds.length > 0) return;
  throw new Error(
    "Login do Discord ligado sem restrição: qualquer conta do Discord entraria e enviaria logs. Preencha DISCORD_USER_IDS ou DISCORD_GUILD_IDS, " +
      "ou defina ALLOW_ANY_DISCORD=true se for isso mesmo que você quer.",
  );
}

export const paths = (dataDir: string) => ({
  db: path.join(dataDir, "gw2logs-v2.db"),
  uploads: path.join(dataDir, "uploads"),
  fights: path.join(dataDir, "fights"),
  fightDir: (id: string) => path.join(dataDir, "fights", id),
});
