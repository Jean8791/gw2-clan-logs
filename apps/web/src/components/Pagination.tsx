import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../lib/i18n";
import { Button } from "./ui";

/** Controles de página: total de registros, anterior, "página X de Y" e próxima (a primeira página é a 1). `extra` vai depois do "Próxima". */
export function Pagination({ page, pages, total, onPage, extra }: { page: number; pages: number; total: number; onPage: (page: number) => void; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted">
      <span className="tabular">{t("pagination.total", { total })}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="size-4" /> {t("pagination.prev")}
        </Button>
        <span className="tabular">{t("pagination.page", { page, pages })}</span>
        <Button size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          {t("pagination.next")} <ChevronRight className="size-4" />
        </Button>
        {extra}
      </div>
    </div>
  );
}
