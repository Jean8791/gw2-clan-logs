import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router-dom";
import { legacyRoute, ROUTES } from "@gw2logs/shared";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/Overview";
import { FightsPage } from "./pages/Fights";
import { FightPage } from "./pages/Fight";
import { RankingPage } from "./pages/Ranking";
import { PlayerPage, MePage } from "./pages/Player";
import { ComparePage } from "./pages/Compare";
import { GuildsPage } from "./pages/Guilds";
import { UploadPage } from "./pages/Upload";
import { DaysPage } from "./pages/Days";
import { Empty } from "./components/ui";
import { t } from "./lib/i18n";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

/** Link antigo em português: leva ao caminho em inglês, com a busca e o hash. */
function NotFound() {
  const { pathname, search, hash } = useLocation();
  const novo = legacyRoute(pathname);
  return novo ? <Navigate to={`${novo}${search}${hash}`} replace /> : <Empty title={t("notfound.title")} />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: ROUTES.overview, element: <OverviewPage /> },
      { path: ROUTES.days, element: <DaysPage /> },
      { path: ROUTES.fights, element: <FightsPage /> },
      { path: `${ROUTES.fights}/:id`, element: <FightPage /> },
      { path: ROUTES.ranking, element: <RankingPage /> },
      { path: "/players/:account", element: <PlayerPage /> },
      { path: ROUTES.me, element: <MePage /> },
      { path: ROUTES.compare, element: <ComparePage /> },
      { path: ROUTES.guilds, element: <GuildsPage /> },
      { path: ROUTES.upload, element: <UploadPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
