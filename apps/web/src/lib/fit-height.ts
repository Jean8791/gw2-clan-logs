import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitTableHeight } from "@gw2logs/shared";
import { SHORT_SCREEN } from "./screen";

/**
 * Mede a tela e devolve a altura que a área de rolagem da tabela deve ter para ocupar o resto dela (`undefined` no celular, onde a
 * tabela cresce e a página rola). Mede de novo ao redimensionar a janela e quando muda o tamanho de qualquer coisa ao redor
 * (filtros que quebram em mais linhas, nota, barra de baixo), porque o que sobra depende de tudo isso.
 */
export function useFitHeight(enabled: boolean) {
  const wrap = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>();

  const measure = useCallback(() => {
    const w = wrap.current;
    const a = area.current;
    const main = w?.closest("main");
    if (!w || !a || !main || !window.matchMedia("(min-width: 768px)").matches) return setHeight(undefined);
    const rect = (el: Element) => el.getBoundingClientRect();
    const bar = rect(w).height - rect(a).height; // paginação e botão Colunas, embaixo da área
    // o que vem depois da tabela até o fim do conteúdo (o <main> estica além dele, por isso não serve de medida)
    const last = main.lastElementChild ?? w;
    const style = getComputedStyle(main);
    const afterTable = rect(last).bottom - rect(w).bottom + parseFloat(getComputedStyle(last).marginBottom);
    // em tela baixa a nota de baixo fica para fora da conta (aparece ao rolar a página): a tabela fica com esse espaço
    const tail = (window.matchMedia(SHORT_SCREEN).matches ? 0 : afterTable) + parseFloat(style.paddingBottom);
    setHeight(fitTableHeight({ viewport: window.innerHeight, top: rect(a).top, below: bar + tail }));
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    measure();
  });

  useEffect(() => {
    const w = wrap.current;
    if (!enabled || !w) return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(document.body);
    // tudo ao redor da tabela, nos dois lados, em cada nível até o <main>
    for (let el: Element | null = w; el && el.tagName !== "MAIN"; el = el.parentElement) {
      for (const s of el.parentElement?.children ?? []) if (s !== el) watch.observe(s);
    }
    window.addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, measure]);

  return { wrap, area, height };
}
