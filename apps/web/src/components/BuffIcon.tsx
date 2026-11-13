import { useState } from "react";

/** Ícone de um boon, servido pelo nosso servidor. Some se ainda não foi baixado (não mostra imagem quebrada). */
export function BuffIcon({ id, size = 16 }: { id: number; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={`/api/media/buff:${id}`} width={size} height={size} alt="" loading="lazy" onError={() => setFailed(true)} className="shrink-0" />;
}
