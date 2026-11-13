import { useState } from "react";

/** Imagem do banco de mídias do nosso servidor. Se ainda não existe, mostra o `fallback` (ou nada). */
function MediaIcon({ mediaKey, size, fallback }: { mediaKey: string; size: number; fallback?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback ?? null}</>;
  return <img src={`/api/media/${mediaKey}`} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} className="shrink-0" />;
}

export const BuffIcon = ({ id, size = 16 }: { id: number; size?: number }) => <MediaIcon mediaKey={`buff:${id}`} size={size} />;

/** Ícone de habilidade; sem ícone (ex.: fora do host permitido) deixa um quadrado vazio para os nomes ficarem alinhados. */
export const SkillIcon = ({ id, size = 20 }: { id: number; size?: number }) => (
  <MediaIcon mediaKey={`skill:${id}`} size={size} fallback={<span className="shrink-0 rounded bg-surface-3" style={{ width: size, height: size }} />} />
);
