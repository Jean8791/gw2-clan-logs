import { defineConfig } from "tsup";

export default defineConfig({
  // entradas nomeadas: mantêm dist/index.js na raiz (o start e o repoRoot dependem disso)
  entry: { index: "src/index.ts", "scripts/import-legacy": "scripts/import-legacy.ts", "scripts/reingest": "scripts/reingest.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // o pacote compartilhado é TypeScript puro: entra no bundle
  noExternal: ["@gw2logs/shared"],
});
