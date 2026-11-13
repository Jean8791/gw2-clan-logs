#!/usr/bin/env bash
# Envia logs do ArcDPS (.zevtc, .evtc) ou o .json do Elite Insights para o site, pela API.
# Uso: scripts/enviar-logs.sh <arquivo ou pasta> [mais arquivos ou pastas...]
#
# Configuração (variáveis de ambiente ou o arquivo ~/.config/gw2logs/env, com linhas CHAVE=valor; use chmod 600):
#   GW2LOGS_URL        endereço do site, ex.: https://logs.exemplo.com
#   GW2LOGS_KEY        chave de envio (a UPLOAD_KEY do servidor)
#   GW2LOGS_UPLOADER   nome que aparece em "Enviado por" (opcional)
#
# O que já foi enviado fica registrado em ~/.local/state/gw2logs (um registro por servidor) e não é mandado de novo.
# A chave nunca vai na linha de comando (aparece em `ps`): ela segue para o curl por entrada padrão.
set -uo pipefail

CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/gw2logs/env"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gw2logs"
RETRY_QUEUE_FULL=10 # fila cheia: espera 1 min e tenta de novo, até 10 vezes
QUEUE_WAIT=${GW2LOGS_QUEUE_WAIT:-60}

erro() { echo "enviar-logs: $*" >&2; }

if [ -f "$CONFIG_FILE" ]; then
  # `|| [ -n "$nome" ]` lê também a última linha sem quebra de linha; o ${valor%$'\r'} tira o CR de arquivos do Windows
  while IFS='=' read -r nome valor || [ -n "$nome" ]; do
    valor=${valor%$'\r'}
    case "$nome" in GW2LOGS_URL | GW2LOGS_KEY | GW2LOGS_UPLOADER) [ -z "${!nome:-}" ] && export "$nome=$valor" ;; esac
  done <"$CONFIG_FILE"
fi

if [ -z "${GW2LOGS_URL:-}" ] || [ -z "${GW2LOGS_KEY:-}" ]; then
  erro "defina GW2LOGS_URL e GW2LOGS_KEY (variáveis de ambiente ou $CONFIG_FILE). Veja o cabeçalho deste script."
  exit 2
fi
if [ $# -eq 0 ]; then
  erro "uso: $0 <arquivo ou pasta> [...]"
  exit 2
fi
command -v curl >/dev/null || { erro "curl não encontrado."; exit 2; }
command -v sha256sum >/dev/null || { erro "sha256sum não encontrado."; exit 2; }

URL="${GW2LOGS_URL%/}"
# um registro por servidor: testar no local não faz o de produção pular os logs
STATE_FILE="$STATE_DIR/enviados-$(printf %s "$URL" | sha256sum | cut -c1-12)"
mkdir -p "$STATE_DIR" && touch "$STATE_FILE"

# arquivos de log das entradas (pastas são percorridas por inteiro), na ordem do nome
files=()
for entrada in "$@"; do
  if [ -d "$entrada" ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done < <(find "$entrada" -type f \( -iname '*.zevtc' -o -iname '*.evtc' -o -iname '*.json' \) -print0 | sort -z)
  elif [ -f "$entrada" ]; then
    files+=("$entrada")
  else
    erro "não encontrei: $entrada"
  fi
done

sent=0 known=0 failed=0
resumo() { echo "Resumo: $sent enviado(s), $known já enviado(s), $failed com erro, de ${#files[@]} arquivo(s)."; }

# envia um arquivo; devolve o corpo da resposta em $body e o código HTTP em $http
post() {
  local key=${GW2LOGS_KEY//\\/\\\\}
  key=${key//\"/\\\"}
  # no -F do curl, ; , e aspas têm significado: o caminho vai entre aspas, com \ e " escapados
  local caminho=${1//\\/\\\\}
  caminho=${caminho//\"/\\\"}
  local out
  out=$(printf 'header = "X-Upload-Key: %s"\n' "$key" | curl -sS --config - -m 900 -w '\n%{http_code}' \
    -F "file=@\"$caminho\"" ${GW2LOGS_UPLOADER:+--form-string "uploader=$GW2LOGS_UPLOADER"} "$URL/api/upload") || return 1
  http=${out##*$'\n'}
  body=${out%$'\n'*}
}

for f in "${files[@]}"; do
  sha=$(sha256sum -- "$f" | cut -d' ' -f1)
  if grep -qx "$sha" "$STATE_FILE"; then
    known=$((known + 1))
    continue
  fi

  tentativa=0
  while true; do
    http="" body=""
    if ! post "$f"; then
      erro "não consegui falar com $URL (rede ou endereço errado)."
      resumo
      exit 1
    fi
    case "$http" in
      401) erro "senha de envio incorreta: confira GW2LOGS_KEY."; exit 1 ;;
      429) erro "muitas senhas erradas: este IP foi bloqueado por um tempo. Tente de novo mais tarde."; exit 1 ;;
      200) ;;
      *) erro "o servidor respondeu $http para $f."; failed=$((failed + 1)); break ;;
    esac

    if [[ "$body" == *'"code":"queueFull"'* ]] && [ "$tentativa" -lt "$RETRY_QUEUE_FULL" ]; then
      tentativa=$((tentativa + 1))
      echo "Fila do servidor cheia; esperando ${QUEUE_WAIT}s ($tentativa/$RETRY_QUEUE_FULL)..."
      sleep "$QUEUE_WAIT"
      continue
    fi
    if [[ "$body" == *'"code":"queueFull"'* || "$body" == *'"code":"hourlyLimit"'* || "$body" == *'"code":"diskFull"'* ]]; then
      restantes=$((${#files[@]} - sent - known - failed))
      erro "limite do servidor atingido ($(grep -o '"code":"[A-Za-z]*"' <<<"$body" | head -1)); $restantes arquivo(s) ficaram sem enviar. Rode de novo mais tarde."
      resumo
      exit 1
    fi
    if [[ "$body" == *'"error"'* ]]; then
      erro "$f: $(grep -o '"error":"[^"]*"' <<<"$body" | head -1)"
      failed=$((failed + 1))
    elif [[ "$body" == *'"duplicate":true'* ]]; then
      echo "$sha" >>"$STATE_FILE"
      known=$((known + 1))
    else
      echo "$sha" >>"$STATE_FILE"
      sent=$((sent + 1))
      echo "Enviado: $f"
    fi
    break
  done
done

resumo
[ "$failed" -eq 0 ]
