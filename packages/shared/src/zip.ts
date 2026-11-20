// Abre no navegador o zip com vários logs. A leitura é do lado de quem envia: o servidor continua recebendo só
// arquivos soltos, com as travas de sempre (fila, envios por hora, tamanho por arquivo).
import { unzipSync } from "fflate";
import { MAX_UPLOAD_MB } from "./upload.js";

const MB = 1024 * 1024;

/**
 * Tamanho máximo do zip, em MB. Medido nos logs reais do clã: uma semana de jogo dá em média 95 logs e 204 MB (máximo 430 MB);
 * 300 MB cobre a semana normal com folga e protege a memória do navegador. Quem garante caber nos envios por hora é o limite de logs, abaixo.
 */
export const MAX_ZIP_MB = 300;

/**
 * Máximo de logs por zip. Fica abaixo dos 200 envios por hora de cada usuário, para um zip aceito nunca estourar esse limite sozinho.
 * Nos logs do clã a semana de jogo tem em média 95 logs (máximo 173), então 150 cobre quase todas.
 */
export const MAX_ZIP_LOGS = 150;

export class ZipError extends Error {
  constructor(public code: "zipTooBig" | "zipTooMany" | "zipInvalid") {
    super(code);
    this.name = "ZipError";
  }
}

export interface ZipLimits {
  maxZipBytes?: number;
  /** Um log maior que isso não é aberto (o servidor o recusaria de qualquer jeito). */
  maxFileBytes?: number;
  /** Soma dos logs abertos: protege contra zip muito comprimido que encheria a memória. */
  maxTotalBytes?: number;
  /** Quantos logs o zip pode ter (só contam os que seriam enviados). */
  maxLogs?: number;
}

export interface ZipLogs {
  logs: { name: string; data: Uint8Array }[];
  /** Nomes dos logs que passaram do tamanho máximo e ficaram de fora. */
  tooBig: string[];
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Log de verdade: pasta, lixo do macOS (__MACOSX, ._x), outros arquivos e zip dentro de zip ficam de fora. */
const isLog = (path: string) => !path.endsWith("/") && !path.startsWith("__MACOSX/") && !baseName(path).startsWith("._") && /\.(zevtc|evtc|json)$/i.test(path);

export function readLogsFromZip(zip: Uint8Array, limits: ZipLimits = {}): ZipLogs {
  const maxFile = limits.maxFileBytes ?? MAX_UPLOAD_MB * MB;
  const maxTotal = limits.maxTotalBytes ?? 2 * MAX_ZIP_MB * MB;
  const maxLogs = limits.maxLogs ?? MAX_ZIP_LOGS;
  if (zip.length > (limits.maxZipBytes ?? MAX_ZIP_MB * MB)) throw new ZipError("zipTooBig");

  const tooBig: string[] = [];
  let total = 0;
  let count = 0;
  try {
    // o filtro decide pelo tamanho do cabeçalho, antes de expandir: o que não passa nem chega a ser aberto
    const files = unzipSync(zip, {
      filter: (f) => {
        if (!isLog(f.name)) return false;
        if (f.originalSize > maxFile) {
          tooBig.push(baseName(f.name));
          return false;
        }
        total += f.originalSize;
        if (total > maxTotal) throw new ZipError("zipTooBig");
        if (++count > maxLogs) throw new ZipError("zipTooMany");
        return true;
      },
    });
    return { logs: Object.entries(files).map(([path, data]) => ({ name: baseName(path), data })), tooBig };
  } catch (e) {
    throw e instanceof ZipError ? e : new ZipError("zipInvalid");
  }
}
