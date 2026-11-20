import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ROUTES, isSpaceOwner } from "@gw2logs/shared";
import { useViewer } from "../lib/api";
import { spaceId } from "../lib/space";
import { Loading } from "./ui";

/** Página só do dono do espaço, logado: quem abre o endereço direto vai para a visão geral. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  if (viewer.isLoading) return <Loading />;
  return isSpaceOwner(viewer.data?.publicId, spaceId) ? children : <Navigate to={ROUTES.overview} replace />;
}
