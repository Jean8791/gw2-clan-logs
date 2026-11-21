// A fila de envio do site, fora de qualquer tela: o estado vive aqui, então sair da página de importar não interrompe o envio nem apaga a lista.
// A tela só assina (subscribe) e mostra o que está aqui. A rede, a espera e os avisos ao navegador entram por parâmetro, então é testável sem navegador.
import { sendInOrder, type ItemState } from "./upload.js";
import type { UploadResult } from "./index.js";

export interface QueueItem<F> {
  file: F;
  state: ItemState;
}

/** O que a tela mostra. Cada mudança cria um objeto novo (é o que o React compara). */
export interface QueueSnapshot<F> {
  items: QueueItem<F>[];
  running: boolean;
  /** Progresso (0 a 100) do arquivo que está sendo enviado. */
  pct: number;
}

export interface UploadQueueDeps<F> {
  send(file: F, onProgress: (pct: number) => void): Promise<UploadResult>;
  wait(ms: number): Promise<void>;
  /** O envio começou (true) ou terminou (false): o navegador usa para perguntar antes de recarregar a página. */
  onRunningChange?(running: boolean): void;
  /** Um envio terminou: o site atualiza a lista de lutas. */
  onSettled?(): void | Promise<void>;
}

export function createUploadQueue<F extends { name: string; size: number }>(deps: UploadQueueDeps<F>) {
  let snap: QueueSnapshot<F> = { items: [], running: false, pct: 0 };
  let stopping = false;
  const subscribers = new Set<() => void>();
  const emit = (next: QueueSnapshot<F>) => {
    snap = next;
    subscribers.forEach((cb) => cb());
  };
  const isPending = (it: QueueItem<F>) => it.state.kind === "pending" || it.state.kind === "skipped";

  /** Envia `batch` (ou tudo o que ainda não foi). Só um envio por vez: com um em andamento, não faz nada. */
  async function run(batch: QueueItem<F>[] = snap.items): Promise<void> {
    const todo = batch.filter(isPending);
    if (!todo.length || snap.running) return;
    stopping = false;
    emit({ ...snap, running: true });
    deps.onRunningChange?.(true);
    try {
      await sendInOrder(todo, {
        send: (it) => deps.send(it.file, (pct) => emit({ ...snap, pct })),
        wait: deps.wait,
        shouldStop: () => stopping,
        onState: (i, state) => emit({ ...snap, pct: 0, items: snap.items.map((it) => (it.file === todo[i]!.file ? { ...it, state } : it)) }),
      });
    } finally {
      emit({ ...snap, running: false });
      deps.onRunningChange?.(false);
      // atualizar a lista de lutas é secundário: se falhar, o envio que já terminou não pode virar erro
      await Promise.resolve(deps.onSettled?.()).catch(() => {});
    }
  }

  return {
    subscribe(callback: () => void): () => void {
      subscribers.add(callback);
      return () => void subscribers.delete(callback);
    },
    getSnapshot: (): QueueSnapshot<F> => snap,
    /** Põe os itens na lista (sem repetir nome e tamanho) e envia os novos. Com um envio em andamento, eles ficam pendentes para o próximo. */
    add(items: QueueItem<F>[]): Promise<void> {
      const fresh: QueueItem<F>[] = [];
      for (const it of items) {
        if (![...snap.items, ...fresh].some((c) => c.file.name === it.file.name && c.file.size === it.file.size)) fresh.push(it);
      }
      if (!fresh.length) return Promise.resolve();
      emit({ ...snap, items: [...snap.items, ...fresh] });
      return run(fresh);
    },
    /** Envia (de novo) tudo o que está pendente ou não foi enviado. */
    sendAll: () => run(),
    /** Para depois do arquivo que está indo; o resto fica como não enviado. */
    stop() {
      stopping = true;
    },
    /** Esvazia a lista (não no meio de um envio). */
    clear() {
      if (!snap.running) emit({ ...snap, items: [] });
    },
  };
}
