import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/Overview";
import { FightsPage } from "./pages/Fights";
import { FightPage } from "./pages/Fight";
import { RankingPage } from "./pages/Ranking";
import { PlayerPage, MePage } from "./pages/Player";
import { ComparePage } from "./pages/Compare";
import { GuildsPage } from "./pages/Guilds";
import { UploadPage } from "./pages/Upload";
import { Empty } from "./components/ui";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <OverviewPage /> },
      { path: "/lutas", element: <FightsPage /> },
      { path: "/lutas/:id", element: <FightPage /> },
      { path: "/ranking", element: <RankingPage /> },
      { path: "/jogadores/:account", element: <PlayerPage /> },
      { path: "/eu", element: <MePage /> },
      { path: "/comparar", element: <ComparePage /> },
      { path: "/guildas", element: <GuildsPage /> },
      { path: "/enviar", element: <UploadPage /> },
      { path: "*", element: <Empty title="Página não encontrada" /> },
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
