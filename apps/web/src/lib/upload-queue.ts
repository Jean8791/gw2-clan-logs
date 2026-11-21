import { useSyncExternalStore } from "react";
import { createUploadQueue } from "@gw2logs/shared";
import { uploadLog } from "./api";
import { queryClient } from "./query-client";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Recarregar ou fechar a aba no meio do envio o interrompe: o navegador pergunta antes (o texto da pergunta é dele, não nosso). */
const askBeforeLeaving = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};

/**
 * A fila de envio do site. Mora aqui, fora das telas: trocar de página dentro do site não interrompe o envio nem apaga a lista,
 * e quando ele termina as listas de lutas são atualizadas, mesmo que a tela de importar já tenha saído.
 */
export const uploadQueue = createUploadQueue<File>({
  send: uploadLog,
  wait: sleep,
  onRunningChange: (running) => (running ? window.addEventListener("beforeunload", askBeforeLeaving) : window.removeEventListener("beforeunload", askBeforeLeaving)),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ["fights"] }),
});

export const useUploadQueue = () => useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
