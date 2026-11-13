import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  onRowClick,
  rowClassName,
  footer,
  dense,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  initialSort?: { id: string; desc: boolean };
  onRowClick?: (r: T) => void;
  rowClassName?: (r: T) => string | undefined;
  footer?: ReactNode;
  dense?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
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
  }, [rows, columns, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {columns.map((c) => {
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
                  onClick={() => c.sort && setSort(active ? { id: c.id, desc: !sort!.desc } : { id: c.id, desc: true })}
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
          {sorted.map((r, i) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx("group", onRowClick && "cursor-pointer", rowClassName?.(r))}
            >
              {columns.map((c) => (
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
                  {c.cell(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
