/** Menor altura da área de rolagem de uma tabela: abaixo disso a tela é pequena demais e é a página que rola (cerca de 6 linhas e o cabeçalho). */
export const MIN_TABLE_HEIGHT = 240;

/**
 * Altura da área de rolagem de uma tabela para ela ocupar o resto da tela.
 * `viewport` é a altura da janela, `top` onde a área começa, na mesma medida (distância do topo da página, já sem a rolagem),
 * e `below` o que precisa caber embaixo dela (barra de paginação, nota e margem da página).
 */
export function fitTableHeight({ viewport, top, below, min = MIN_TABLE_HEIGHT }: { viewport: number; top: number; below: number; min?: number }): number {
  return Math.max(min, Math.floor(viewport - top - below));
}
