#!/usr/bin/env bash
# Roda o site no Linux/Ubuntu: http://localhost:5080
# Uso:  ./iniciar.sh            (ou: UPLOAD_KEY=senhadocla ./iniciar.sh)
# Para aceitar acesso de outras máquinas da rede: URLS=http://0.0.0.0:5080 ./iniciar.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ASPNETCORE_URLS="${URLS:-http://localhost:5080}"
export DATA_DIR="${DATA_DIR:-$ROOT/data}"
export EI_DIR="${EI_DIR:-$ROOT/tools/GW2EICLI}"
export UPLOAD_KEY="${UPLOAD_KEY:-}"

if ! command -v dotnet >/dev/null 2>&1; then
  echo "Precisa do .NET 10 SDK: https://learn.microsoft.com/dotnet/core/install/linux-ubuntu" >&2
  exit 1
fi

if [ ! -f "$EI_DIR/GuildWars2EliteInsights-CLI.dll" ]; then
  # Primeira execução: baixa o Elite Insights CLI (parser oficial da comunidade).
  VERSAO="v3.32.0.0"
  echo "Baixando o Elite Insights $VERSAO..."
  command -v unzip >/dev/null || { echo "Instale o unzip: sudo apt install unzip" >&2; exit 1; }
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/ei.zip" "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/$VERSAO/GW2EICLI.zip"
  mkdir -p "$EI_DIR"
  unzip -q -o "$TMP/ei.zip" -d "$EI_DIR"
  rm -rf "$TMP"
fi

echo "Site em $ASPNETCORE_URLS  (Ctrl+C para parar)"
exec dotnet run --project "$ROOT/src/Gw2Logs" -c Release --no-launch-profile
