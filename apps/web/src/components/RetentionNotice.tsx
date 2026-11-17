import { Info } from "lucide-react";
import { useConfig } from "../lib/api";
import { t } from "../lib/i18n";

/** Aviso fixo: o site só personaliza a visualização, não é arquivo; os logs são apagados depois de um tempo. */
export function RetentionNotice() {
  const { data: cfg } = useConfig();
  if (!cfg) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-gold/30 bg-gold/10 p-3 text-left text-sm text-gold">
      <Info className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <div className="font-medium">{t("retention.title")}</div>
        <p>{cfg.retentionDays > 0 ? t("retention.days", { n: cfg.retentionDays }) : t("retention.noDays")}</p>
        <p>{t("retention.keep")}</p>
      </div>
    </div>
  );
}
