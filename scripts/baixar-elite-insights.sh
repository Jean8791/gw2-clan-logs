#!/usr/bin/env bash
# Baixa o Elite Insights CLI (parser oficial da comunidade) para tools/GW2EICLI.
# Ele precisa do runtime .NET 10 (https://learn.microsoft.com/dotnet/core/install/linux).
# Fora do Docker, se o EI cair com "Value cannot be null (path)", crie ~/.config e ~/.local/share e exporte XDG_CONFIG_HOME e XDG_DATA_HOME.
# Uso: scripts/baixar-elite-insights.sh [versão]   (padrão: v3.32.0.0)
set -euo pipefail

VERSAO="${1:-v3.32.0.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${EI_DIR:-$ROOT/tools/GW2EICLI}"

command -v unzip >/dev/null || { echo "Instale o unzip (sudo apt install unzip)" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Baixando o Elite Insights $VERSAO..."
curl -fsSL -o "$TMP/ei.zip" "https://github.com/baaron4/GW2-Elite-Insights-Parser/releases/download/$VERSAO/GW2EICLI.zip"
mkdir -p "$DEST"
unzip -q -o "$TMP/ei.zip" -d "$DEST"
echo "Pronto: $DEST"
command -v dotnet >/dev/null || echo "Aviso: o comando 'dotnet' não foi encontrado; instale o runtime .NET para processar .zevtc." >&2
