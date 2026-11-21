import { QueryClient } from "@tanstack/react-query";

/** O cliente de consultas do site, fora do React para a fila de envio poder atualizar as listas mesmo depois de a tela de importar sair. */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });
