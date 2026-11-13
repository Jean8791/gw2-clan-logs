import { Columns3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { cx } from "./ui";

export interface PickableColumn {
  id: string;
  label: string;
  fixed?: boolean;
}

/** Botão "Colunas": lista as colunas da tabela para marcar as que a pessoa quer ver. */
export function ColumnPicker({ columns, hidden, onChange }: { columns: PickableColumn[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc. Ouve a página toda: um "fundo invisível" fixed não serve aqui, porque o cartão
  // tem backdrop-blur e isso faz o fixed cobrir só o cartão, e não a tela.
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pickable = columns.filter((c) => !c.fixed);
  const shown = pickable.filter((c) => !hidden.includes(c.id)).length;

  const toggle = (id: string) => onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);

  return (
    <div ref={box} className="relative flex justify-end border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium text-muted transition hover:border-faint hover:text-text",
          open && "border-gold text-gold",
        )}
      >
        <Columns3 className="size-3.5" />
        {t("table.columns")}
        <span className="tabular text-faint">
          {shown}/{pickable.length}
        </span>
      </button>
      {open && (
        <>
          <div className="absolute right-3 top-full z-40 mt-1 max-h-80 w-64 overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={hidden.length === 0}
              className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-gold hover:bg-surface-2 disabled:text-faint disabled:hover:bg-transparent"
            >
              {t("table.showAll")}
            </button>
            {pickable.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                <input type="checkbox" className="size-4 accent-[#e0b25a]" checked={!hidden.includes(c.id)} onChange={() => toggle(c.id)} />
                <span className="truncate">{c.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
