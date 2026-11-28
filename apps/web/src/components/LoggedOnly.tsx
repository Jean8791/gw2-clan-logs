import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ROUTES } from "@gw2logs/shared";
import { useViewer } from "../lib/api";
import { Loading } from "./ui";

/** Página só de quem está logado (importar logs): quem abre o endereço direto vai para a visão geral. */
export function LoggedOnly({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  if (viewer.isLoading) return <Loading />;
  return viewer.data ? children : <Navigate to={ROUTES.overview} replace />;
}
