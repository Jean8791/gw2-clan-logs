// Busca de texto das listas: sem diferenciar maiúsculas nem acentos.

/** Texto para comparar: minúsculo, sem acentos e sem colchetes (a tag aparece como [ABC]). */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[[\]]/g, "").toLowerCase().trim();

/** A guilda bate com a busca? Vale um pedaço do nome ou da tag; busca vazia mostra todas. */
export function guildMatches(g: { name: string | null; tag: string | null }, query: string): boolean {
  const q = plain(query);
  return q === "" || plain(g.name ?? "").includes(q) || plain(g.tag ?? "").includes(q);
}
