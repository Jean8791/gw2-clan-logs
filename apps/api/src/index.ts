import { loadConfig } from "./config.js";
import { eiAvailable } from "./elite-insights.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const { server, worker } = await buildApp(cfg, { logger: true });

if (!eiAvailable(cfg.eiDir)) {
  server.log.warn(`Elite Insights não encontrado em ${cfg.eiDir}: só arquivos .json do EI serão aceitos. Rode scripts/baixar-elite-insights.sh.`);
}
worker.resume();

for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void server.close().then(() => process.exit(0)));

await server.listen({ port: cfg.port, host: cfg.host });
