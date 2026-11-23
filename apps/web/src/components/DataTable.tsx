import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { pageCount, pageSlice, visibleColumns } from "@gw2logs/shared";
import { loadHiddenColumns, saveHiddenColumns } from "../lib/columns";
import { ColumnPicker } from "./ColumnPicker";
import { Pagination } from "./Pagination";
import { useFitHeight } from "../lib/fit-height";
import { cx } from "./ui";

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** valor usado para ordenar; sem ele a coluna não ordena */
  sort?: (row: T) => number | string | null;
  align?: "left" | "right" | "center";
  title?: string;
  className?: string;
  /** coluna fixa à esquerda ao rolar na horizontal */
  sticky?: boolean;
  /** nome em texto na lista do botão "Colunas" (o header pode ser um ícone); sem ele usa o header ou o id */
  label?: string;
  /** coluna que não pode ser escondida (nome do jogador, caixa de seleção) */
  fixed?: boolean;
  /** valor da linha "Total" no fim da tabela, calculado sobre todas as linhas (não só as da página); sem ele a célula fica vazia */
  total?: (rows: T[]) => ReactNode;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  sort: sortProp,
  onSortChange,
  pageSize,
  fill,
  bar,
  onSorted,
  onRowClick,
  rowClassName,
  footer,
  totalLabel,
  dense,
  pickerKey,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  initialSort?: { id: string; desc: boolean };
  /**
   * Ordenação feita fora (no servidor): com `onSortChange` a tabela só mostra a seta de `sort` e avisa o clique, sem reordenar as linhas.
   * Sem ele, ordena aqui, sobre todas as linhas recebidas.
   */
  sort?: { id: string; desc: boolean } | null;
  onSortChange?: (sort: { id: string; desc: boolean }) => void;
  /** Mostra só esta quantidade de linhas por vez, com os controles de página. A ordenação continua valendo para todas as linhas. */
  pageSize?: number;
  /**
   * Ocupa o resto da altura da tela, medida no navegador (ver `useFitHeight`): só a lista de dentro rola e o cabeçalho fica sempre à vista.
   * Se a tela for pequena demais para o mínimo, é a página que rola. Sem ele, a tabela tem altura máxima própria.
   */
  fill?: boolean;
  /** Barra de baixo montada pelo pai (paginação no servidor). Recebe o botão "Colunas", para ficar nela; devolva null se não houver barra. */
  bar?: (picker: ReactNode) => ReactNode;
  /** Avisa qual coluna a pessoa escolheu para ordenar; a tabela continua ordenando sozinha (diferente de `onSortChange`, em que o pai ordena). */
  onSorted?: (sort: { id: string; desc: boolean }) => void;
  onRowClick?: (r: T) => void;
  rowClassName?: (r: T) => string | undefined;
  footer?: ReactNode;
  /** Com ele (e colunas com `total`), a tabela fecha com uma linha de totais; este texto vai na primeira coluna. */
  totalLabel?: ReactNode;
  dense?: boolean;
  /** com ele, aparece o botão "Colunas" e a escolha fica salva no navegador, por tabela */
  pickerKey?: string;
}) {
  const fit = useFitHeight(fill === true);
  const [localSort, setLocalSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const external = onSortChange !== undefined;
  const sort = external ? (sortProp ?? null) : localSort;
  const chooseSort = (next: { id: string; desc: boolean }) => {
    if (external) return onSortChange(next);
    setLocalSort(next);
    setPage(1);
    onSorted?.(next);
  };
  // mudou o conjunto de linhas (filtro): volta para a primeira página
  useEffect(() => setPage(1), [rows.length]);
  const [hidden, setHidden] = useState<string[]>(() => (pickerKey ? loadHiddenColumns(pickerKey) : []));
  useEffect(() => setHidden(pickerKey ? loadHiddenColumns(pickerKey) : []), [pickerKey]);
  const shown = useMemo(() => visibleColumns(columns, hidden), [columns, hidden]);
  const choose = (next: string[]) => {
    setHidden(next);
    if (pickerKey) saveHiddenColumns(pickerKey, next);
  };
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (external || !col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "pt-BR") : (x as number) - (y as number);
      return sort!.desc ? -r : r;
    });
  }, [rows, columns, sort, external]);
  const pages = pageSize ? pageCount(sorted.length, pageSize) : 1;
  const current = Math.min(page, pages);
  const visible = pageSize ? pageSlice(sorted, current, pageSize) : sorted;
  // a posição da linha (#) continua contando desde a primeira página
  const offset = pageSize ? (current - 1) * pageSize : 0;

  // o botão "Colunas" fica na barra de baixo, depois do "Próxima"; sem paginação, numa barra só com ele
  const picker = pickerKey ? (
    <ColumnPicker
      columns={columns.map((c) => ({ id: c.id, fixed: c.fixed, label: c.label ?? (typeof c.header === "string" && c.header ? c.header : c.id) }))}
      hidden={hidden}
      onChange={choose}
    />
  ) : null;
  const bottom =
    bar?.(picker) ??
    (pageSize && sorted.length > pageSize ? (
      <Pagination page={current} pages={pages} total={sorted.length} onPage={setPage} extra={picker} />
    ) : picker ? (
      <div className="flex shrink-0 justify-end border-t border-line px-4 py-2">{picker}</div>
    ) : null);

  return (
    // Área de rolagem com altura limitada: assim o cabeçalho (sticky) fica preso no topo dela ao rolar, como na bel.st.
    // Com overflow só no eixo x o cabeçalho colava num contêiner que não rola na vertical e sumia.
    <div ref={fill ? fit.wrap : undefined}>
      <div ref={fill ? fit.area : undefined} style={fill ? { height: fit.height } : undefined} className={fill ? "overflow-auto" : "max-h-[calc(100vh-5rem)] overflow-auto"}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {shown.map((c) => {
              const active = sort?.id === c.id;
              return (
                <th
                  key={c.id}
                  title={c.title}
                  className={cx(
                    "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sort && "cursor-pointer select-none hover:text-text",
                    active && "text-gold",
                    c.sticky && "left-0 z-20",
                  )}
                  onClick={() => c.sort && chooseSort(active ? { id: c.id, desc: !sort!.desc } : { id: c.id, desc: true })}
                >
                  <span className={cx("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.header}
                    {active && (sort!.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx("group", onRowClick && "cursor-pointer", rowClassName?.(r))}
            >
              {shown.map((c) => (
                <td
                  key={c.id}
                  className={cx(
                    "tabular whitespace-nowrap border-b border-line/60 px-3 transition-colors group-hover:bg-surface-2/70",
                    dense ? "py-1.5" : "py-2.5",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sticky && "sticky left-0 z-[5] bg-surface",
                    c.className,
                  )}
                >
                  {c.cell(r, offset + i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalLabel !== undefined && shown.some((c) => c.total) && (
          <tfoot>
            <tr>
              {shown.map((c, i) => (
                <td
                  key={c.id}
                  className={cx(
                    "tabular sticky bottom-0 whitespace-nowrap border-t border-line bg-surface px-3 py-2.5 font-semibold text-gold",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sticky ? "left-0 z-20" : "z-10",
                  )}
                >
                  {c.total ? c.total(sorted) : i === 0 ? totalLabel : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
        {footer}
      </table>
      </div>
      {bottom}
    </div>
  );
}
