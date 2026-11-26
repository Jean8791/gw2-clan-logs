#!/usr/bin/env bash
# Mede o pico de memória (RSS) e o tempo do Elite Insights num log, com a MESMA configuração do servidor
# (eiConfLines e eiEnv de apps/api/src/elite-insights.ts: o script lê de lá, não tem cópia).
#
# Uso: scripts/medir-ei.sh [opções] <log.zevtc>
#   -o CHAVE=valor   troca uma linha da configuração do EI (repetível), ex.: -o ParsePhases=false
#   -e VAR=valor     acrescenta uma variável de ambiente ao EI (repetível), ex.: -e DOTNET_GCHeapHardLimitPercent=5A
#   -d IMAGEM        roda dentro da imagem Docker (ex.: gw2-clan-logs), como no servidor: sem root, /tmp em memória
#   -m LIMITE        com -d, o limite de memória do contêiner (padrão 1500m, o do compose)
#   -k               mantém o JSON gerado (por padrão é apagado) e mostra o caminho
# Fora do Docker precisa do runtime .NET e do EI (scripts/baixar-elite-insights.sh). Variáveis: EI_DIR (padrão tools/GW2EICLI), DOTNET (padrão dotnet).
# O pico é o VmHWM do processo, lido de /proc a cada 0,2 s (pode perder o que cresce nos últimos 0,2 s).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

trocas=() envs=() imagem="" limite="1500m" manter=0
while getopts "o:e:d:m:k" opt; do
  case "$opt" in
    o) trocas+=("$OPTARG") ;;
    e) envs+=("$OPTARG") ;;
    d) imagem="$OPTARG" ;;
    m) limite="$OPTARG" ;;
    k) manter=1 ;;
    *) sed -n '2,13p' "$0" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
[ $# -eq 1 ] && [ -f "$1" ] || { echo "Uso: scripts/medir-ei.sh [opções] <log.zevtc>" >&2; exit 1; }
LOG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

# dentro de data/ (ignorado pelo git): o Docker Desktop só compartilha pastas da home, não o /tmp
mkdir -p "$ROOT/data"
TMP="$(mktemp -d -p "$ROOT/data" medir.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/saida"
chmod 777 "$TMP/saida"

# configuração e ambiente exatamente como o servidor monta
SAIDA_EI="$TMP/saida"
[ -n "$imagem" ] && SAIDA_EI="/saida"
(cd "$ROOT/apps/api" && SAIDA_EI="$SAIDA_EI" npx --no-install tsx -e '
  import { eiConfLines, eiEnv } from "./src/elite-insights.ts";
  const [conf, env] = [eiConfLines(process.env.SAIDA_EI!, { html: false }), eiEnv({})];
  process.stdout.write(conf.join("\n") + "\n");
  process.stderr.write(Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
' >"$TMP/ei.conf" 2>"$TMP/ei.env")

for t in ${trocas[@]+"${trocas[@]}"}; do
  chave="${t%%=*}"
  grep -q "^$chave=" "$TMP/ei.conf" || { echo "Opção desconhecida na configuração: $chave" >&2; exit 1; }
  sed -i "s|^$chave=.*|$t|" "$TMP/ei.conf"
done
for e in ${envs[@]+"${envs[@]}"}; do echo "$e" >>"$TMP/ei.env"; done

# roda o EI e guarda o maior VmHWM; este trecho roda igual no host e no contêiner (sh simples)
cat >"$TMP/medir.sh" <<'EOF'
#!/bin/sh
cd "$EI_DIR"
t0=$(date +%s.%N)
env $(cat "$MED/ei.env") "$DOTNET" "$EI_DIR/GuildWars2EliteInsights-CLI.dll" -c "$MED/ei.conf" "$LOGF" >"$MED/ei.out" 2>&1 &
pid=$!
pico=0
while kill -0 "$pid" 2>/dev/null; do
  v=$(awk '/VmHWM/ {print $2}' "/proc/$pid/status" 2>/dev/null)
  [ -n "$v" ] && pico=$v
  sleep 0.2
done
wait "$pid"; code=$?
t1=$(date +%s.%N)
echo "$code $pico $(awk "BEGIN {printf \"%.1f\", $t1 - $t0}")" >"$MED/resultado"
EOF
chmod +x "$TMP/medir.sh"

if [ -n "$imagem" ]; then
  docker run --rm --memory "$limite" --memory-swap "$limite" --read-only --tmpfs /tmp:size=64m --cap-drop ALL \
    --security-opt no-new-privileges:true --entrypoint sh \
    -v "$TMP:/med" -v "$TMP/saida:/saida" -v "$LOG:/entrada.zevtc:ro" \
    -e EI_DIR=/ei -e DOTNET=dotnet -e MED=/med -e LOGF=/entrada.zevtc \
    "$imagem" /med/medir.sh
else
  EI_DIR="${EI_DIR:-$ROOT/tools/GW2EICLI}" DOTNET="${DOTNET:-dotnet}" MED="$TMP" LOGF="$LOG" "$TMP/medir.sh"
fi

read -r codigo pico_kb segundos <"$TMP/resultado"
json="$(find "$TMP/saida" -name '*.json' | head -n1)"
echo "Log:      $(basename "$LOG") ($(( $(stat -c %s "$LOG") / 1024 / 1024 )) MB)"
[ -n "$imagem" ] && echo "Ambiente: imagem $imagem, limite $limite" || echo "Ambiente: direto na máquina"
[ ${#trocas[@]} -gt 0 ] && echo "Trocas:   ${trocas[*]}"
echo "Saída EI: código $codigo, $([ -n "$json" ] && echo "JSON de $(( $(stat -c %s "$json") / 1024 / 1024 )) MB" || echo "SEM JSON (falhou; veja abaixo)")"
echo "Pico RSS: $(( pico_kb / 1024 )) MB"
echo "Tempo:    ${segundos} s"
if [ -z "$json" ]; then tail -n 20 "$TMP/ei.out" >&2; exit 2; fi
if [ "$manter" = 1 ]; then
  mkdir -p "$ROOT/data/medicoes"
  cp "$json" "$ROOT/data/medicoes/"
  echo "JSON:     $ROOT/data/medicoes/$(basename "$json")"
fi
