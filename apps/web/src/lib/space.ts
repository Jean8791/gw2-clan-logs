/** Espaço (/u/:id) que a página está mostrando, lido da URL ao carregar. Fora de um espaço é a página inicial. */
const match = /^\/u\/([\w-]+)(?:\/|$)/.exec(window.location.pathname);

export const spaceId: string | null = match?.[1] ?? null;
/** Prefixo das rotas do site (o roteador usa como `basename`, então os links internos não mudam). */
export const spaceBase = spaceId ? `/u/${spaceId}` : "";
/** Prefixo das rotas de dados da API deste espaço. */
export const spaceApi = spaceId ? `/api/u/${spaceId}` : "";
