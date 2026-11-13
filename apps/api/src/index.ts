import { loadConfig, paths } from "./config.js";
import { eiAvailable } from "./elite-insights.js";
import { purgeOldFights } from "./retention.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const { server, db, worker } = await buildApp(cfg, { logger: true });

if (!eiAvailable(cfg.eiDir)) {
  server.log.warn(`Elite Insights não encontrado em ${cfg.eiDir}: só arquivos .json do EI serão aceitos. Rode scripts/baixar-elite-insights.sh.`);
}
worker.resume();

if (cfg.retentionDays > 0) {
  const purge = () =>
    purgeOldFights(db, paths(cfg.dataDir), cfg.retentionDays)
      .then((n) => n && server.log.info(`Retenção: ${n} luta(s) com mais de ${cfg.retentionDays} dias apagada(s).`))
      .catch((err) => server.log.error(err, "Falha ao apagar lutas antigas."));
  void purge();
  setInterval(purge, 60 * 60 * 1000).unref();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void server.close().then(() => process.exit(0)));

await server.listen({ port: cfg.port, host: cfg.host });
