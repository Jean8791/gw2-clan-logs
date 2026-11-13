import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "scripts/import-legacy.ts", "scripts/reingest.ts"],
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // o pacote compartilhado é TypeScript puro: entra no bundle
  noExternal: ["@gw2logs/shared"],
});
