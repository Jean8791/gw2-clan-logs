// Envio de vários logs pelo navegador sem sufocar o servidor: um arquivo por vez, espera quando a fila está cheia
// e para ao bater um limite. As chamadas de rede entram por parâmetro, então a regra é testável sem navegador.
import type { UploadResult } from "./index.js";

/** Tamanho máximo de um log, em MB (o servidor recusa acima disso). */
export const MAX_UPLOAD_MB = 80;

/** Espera entre uma tentativa e outra quando a fila do servidor está cheia. */
export const QUEUE_RETRY_MS = 15_000;
/** Quantas esperas seguidas por um mesmo arquivo antes de desistir (15 s × 40 = 10 minutos). */
export const QUEUE_MAX_WAITS = 40;

export type ItemState =
  | { kind: "pending" }
  | { kind: "sending" }
  | { kind: "waiting"; waits: number }
  | { kind: "done"; result: UploadResult }
  /** Este arquivo deu erro. `code` é o código estável da API (ou "network"). */
  | { kind: "error"; code?: string; message?: string }
  /** Não chegou a ser enviado porque a fila parou (limite, sessão, rede ou pedido do usuário). */
  | { kind: "skipped"; code: string };

export interface SendHooks<T> {
  /** Envia um arquivo. Erro HTTP: lança um objeto com `status` e `code`. Sem rede: status 0. */
  send(item: T): Promise<UploadResult>;
  wait(ms: number): Promise<void>;
  shouldStop(): boolean;
  onState(index: number, state: ItemState): void;
}

/** Erros que valem para todos os arquivos: continuar só pioraria (ou nem adiantaria). */
const STOPS_EVERYTHING = new Set(["hourlyLimit", "diskFull"]);

export async function sendInOrder<T>(items: T[], h: SendHooks<T>): Promise<void> {
  /** Marca o arquivo atual (se tiver erro) e todo o resto como parado, com o motivo. */
  const stopFrom = (from: number, code: string) => {
    for (let j = from; j < items.length; j++) h.onState(j, { kind: "skipped", code });
  };

  for (let i = 0; i < items.length; i++) {
    if (h.shouldStop()) return stopFrom(i, "stopped");

    for (let waits = 0; ; ) {
      h.onState(i, { kind: "sending" });
      let result: UploadResult;
      try {
        result = await h.send(items[i]!);
      } catch (e) {
        const { status, code, message } = e as { status?: number; code?: string; message?: string };
        const motivo = code ?? (status === 0 ? "network" : `http${status ?? ""}`);
        h.onState(i, { kind: "error", code: motivo, message });
        // 401 (sessão), 429 (bloqueio) e rede fora valem para todos; outro erro de servidor só para este arquivo
        if (status === 0 || status === 401 || status === 429) return stopFrom(i + 1, motivo);
        break;
      }

      if (!result.error) {
        h.onState(i, { kind: "done", result });
        break;
      }
      const code = result.code;
      if (code && STOPS_EVERYTHING.has(code)) {
        h.onState(i, { kind: "error", code, message: result.error });
        return stopFrom(i + 1, code);
      }
      if (code === "queueFull") {
        if (waits >= QUEUE_MAX_WAITS) {
          h.onState(i, { kind: "error", code, message: result.error });
          return stopFrom(i + 1, code);
        }
        waits++;
        h.onState(i, { kind: "waiting", waits });
        await h.wait(QUEUE_RETRY_MS);
        if (h.shouldStop()) return stopFrom(i, "stopped");
        continue;
      }
      h.onState(i, { kind: "error", code, message: result.error }); // formato inválido, arquivo grande...
      break;
    }
  }
}
