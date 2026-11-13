/** Rotas do site. Ficam em inglês, qualquer que seja o idioma da tela. */
export const ROUTES = {
  overview: "/",
  days: "/days",
  fights: "/fights",
  fight: (id: string) => `/fights/${id}`,
  ranking: "/ranking",
  player: (account: string) => `/players/${encodeURIComponent(account)}`,
  compare: "/compare",
  guilds: "/guilds",
  me: "/me",
} as const;

// Primeiro trecho das rotas antigas (em português) e o que virou; os links já compartilhados continuam abrindo.
const LEGACY: Record<string, string> = {
  dias: "days",
  lutas: "fights",
  jogadores: "players",
  comparar: "compare",
  guildas: "guilds",
  eu: "me",
};

/** Caminho novo para um caminho antigo em português, ou null se o caminho não é um deles. */
export function legacyRoute(pathname: string): string | null {
  const [, first, ...rest] = pathname.split("/");
  const novo = first !== undefined && Object.hasOwn(LEGACY, first) ? LEGACY[first] : undefined;
  const temSubrota = rest.length === 1 && rest[0] !== "";
  const vazio = rest.length === 0;
  const aceita = vazio || (temSubrota && (first === "lutas" || first === "jogadores"));
  return novo && aceita ? `/${[novo, ...rest].join("/")}` : null;
}
