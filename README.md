# Logs do Clã

[![CI](https://github.com/Jean8791/gw2-clan-logs/actions/workflows/ci.yml/badge.svg)](https://github.com/Jean8791/gw2-clan-logs/actions/workflows/ci.yml)

Histórico de **WvW de Guild Wars 2** para clãs e alianças. Os logs do ArcDPS são processados pelo **Elite Insights** e viram um histórico contínuo, com ranking, perfil de cada jogador, comparação e filtros que os relatórios por sessão não têm. O site está em **português e inglês** (botão PT | EN no canto da tela).

## O que o site mostra

| Tela | Para quê |
|---|---|
| **Visão geral** | Resumo do período: lutas, tempo, abates, mortes, os melhores de dano, strips, cleanses e cura por minuto (com botão de detalhe) e as lutas recentes |
| **Dias** | Cada dia de batalha, das 06:00 às 06:00 (Brasília): uma noite que passa da meia-noite continua no mesmo dia |
| **Lutas** e **Luta** | Lista das lutas e o detalhe de cada uma: squad × inimigos, gráfico de dano e tabelas de Dano, Suporte, Boons, Uptime e Defesa, por jogador, por guilda e por grupo |
| **Ranking** | Todos os jogadores, com filtros por período, dia, guilda, só a aliança, função, classe, tamanho do squad, duração e mapa. Mostra total, por minuto ou por segundo, ordena por qualquer coluna e deixa escolher as colunas. Os filtros ficam no link, então dá para mandar no Discord. Quem jogou de mais de uma classe aparece com todas, com as lutas de cada uma |
| **Perfil** | O histórico do jogador, a evolução luta a luta, habilidades e a comparação com a média de quem joga na mesma função |
| **Comparar** | Até 4 jogadores lado a lado, com radar e tabela |
| **Guildas** | A guilda de cada jogador vem do log; nome e tag vêm da API oficial do GW2. Quem administra o site (`ADMIN_DISCORD_IDS`) marca com ★ as da aliança; os demais veem a estrela |
| **Importar logs** | Só para o dono, logado: arraste os logs (ou um `.zip`), acompanhe o processamento e gere o token do script de envio. O envio continua se você trocar de tela |

Métricas: dano, abates e downs (só contra jogadores inimigos), strips, cleanses, **cura e barreira** (total, no grupo, em si mesmo e em quem está caído), **boons gerados** para o squad, o grupo ou só para si, **uptime** dos boons recebidos e defesa. Veja [Como as métricas são calculadas](#como-as-métricas-são-calculadas).

## Como funciona

```
ArcDPS (.zevtc) ──site (Importar logs) ou scripts/enviar-logs.sh──▶ API ──▶ fila ──▶ Elite Insights ──▶ SQLite ──▶ site (React)
                   (login com Discord)   (token pessoal)          Fastify         (.NET)           + JSON guardado
```

- **Cada usuário tem o próprio espaço** (`/u/<id>`), só com os seus logs. Entra-se com o **Discord**, e os logs vão pela tela *Importar logs* ou pelo script `scripts/enviar-logs.sh`, com o token pessoal (veja [Enviar logs](#enviar-logs)). Quem tem o link de um espaço o vê sem login (só leitura); o dono troca o link no menu da conta (*Gerar novo link*), e o antigo deixa de funcionar.
- O mesmo log enviado duas vezes pelo mesmo usuário é ignorado enquanto a luta ainda está guardada; depois de apagada, pode ser importado de novo. Se outro usuário já enviou o mesmo arquivo e a luta está pronta, ela é copiada do banco, sem rodar o Elite Insights de novo (só o limite por hora vale nesse caso). O site também aceita o `.json` do Elite Insights ou do dps.report (até 15 MB: o JSON ocupa muita memória; acima disso, envie o `.zevtc`).
- Depois de processar uma luta, o servidor guarda só o que foi para o banco (cerca de 0,2 MB por luta): o log enviado e o JSON do Elite Insights são apagados. Se o processamento falhar, o log enviado fica para diagnóstico. Por isso uma métrica nova só vale para as lutas enviadas depois dela; as antigas precisam ser enviadas de novo.
- **O site não é um arquivo de logs:** ele só personaliza a visualização, e quem usa precisa guardar os originais em outro lugar. A tela de importação e a de entrada avisam isso, com o prazo em `RETENTION_DAYS`.
- As lutas antigas são apagadas depois de `RETENTION_DAYS` dias, contados pela data da luta (no Docker Compose o padrão é 30; fora dele, 0 = guardar para sempre).

| Parte | Tecnologia |
|---|---|
| API | Node 22 + TypeScript, Fastify, SQLite (better-sqlite3) |
| Site | React 19 + Vite, Tailwind CSS 4, TanStack Query, Recharts; as fontes (Inter e Cinzel, licença OFL) saem do próprio site, em `apps/web/public/fonts`, sem chamar o Google |
| Parser | [Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) CLI (.NET), chamado pela API |
| Testes e CI | Vitest, GitHub Actions |

```
apps/api/         API REST, fila de processamento e extração das estatísticas
  src/ingest.ts   JSON do Elite Insights → estatísticas por jogador (função pura, testada)
  src/queries.ts  ranking, perfil, comparação e filtros em SQL
apps/web/         site em React
packages/shared/  tipos, métricas, filtros e textos (pt/en) usados pelos dois lados
scripts/          envio de logs, backups (local e para o Google Drive) e download do Elite Insights
```

## Rodar localmente

Precisa do **Node 22+**. Para processar `.zevtc` também precisa do **runtime .NET** e do Elite Insights; sem eles, o site aceita só o `.json` do EI.

```bash
npm install
scripts/baixar-elite-insights.sh     # opcional: baixa o EI para tools/GW2EICLI
npm run build && npm start           # http://localhost:5080
```

Para desenvolver (site em http://localhost:5173, API em :5080) e testar:

```bash
npm run dev
npm test
```

Com Docker: `docker build -t gw2-clan-logs .` e `docker run -p 8080:8080 -v dados:/data gw2-clan-logs`.

## Enviar logs

O ArcDPS grava em `Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`. Para gravar **WvW**, no jogo use Alt+Shift+T, depois *Logging*, e ative a gravação de WvW. Cura e barreira só aparecem se quem gravou usa o addon **Healing Stats**.

Há duas formas de enviar, e as duas guardam os logs no seu espaço:

1. **Pelo site**: entre com o Discord, abra *Importar logs* e arraste os arquivos, ou um `.zip` com vários logs (até 300 MB e 150 logs, o equivalente a uma semana de jogo; o zip é aberto no seu navegador e cada log vai como arquivo solto). Eles vão um de cada vez; se o servidor encher, o envio espera sozinho, e ao bater um limite ele para e avisa.
2. **Por script**, que usa a API e o seu token pessoal. Na página *Importar logs*, o cartão *Envio por script* gera o token (ele só aparece uma vez, o anterior deixa de valer e a data de validade aparece na tela; veja `API_TOKEN_DAYS`).

No **Windows** (`scripts/enviar-logs.bat`, usa o `curl.exe` que já vem no Windows 10 e 11). Crie o arquivo `%APPDATA%\gw2logs\config.bat` com o endereço e o token:

```bat
set GW2LOGS_URL=https://seu-dominio
set GW2LOGS_KEY=seu-token
```

e rode, com a pasta dos logs (ou arquivos):

```bat
enviar-logs.bat "%USERPROFILE%\Documents\Guild Wars 2\addons\arcdps\arcdps.cbtlogs"
```

No **Linux/macOS** (`scripts/enviar-logs.sh`):

```bash
export GW2LOGS_URL=https://seu-dominio GW2LOGS_KEY=seu-token   # ou guarde em ~/.config/gw2logs/env (chmod 600)
scripts/enviar-logs.sh ~/Documentos/Guild\ Wars\ 2/addons/arcdps/arcdps.cbtlogs   # arquivos ou pastas
```

- Não guarda registro do que já enviou: o servidor apaga os logs depois de um tempo, e o que sumiu pode ser enviado de novo (o que ainda está guardado é ignorado). Espera quando a fila do servidor está cheia e para com aviso ao bater um limite.
- Nos dois scripts o token não vai na linha de comando (no `.sh` segue por entrada padrão; no `.bat` por um arquivo temporário seu, apagado no fim).
- Quem tem o token envia logs no seu nome: trate-o como senha e gere outro no site se ele vazar (o anterior deixa de valer). O token expira: depois de `API_TOKEN_DAYS` os envios dão erro 401 e é preciso gerar outro no site.

### Envio automático no Windows

Em vez de rodar o `enviar-logs.bat` na mão, o `scripts/monitorar-logs.ps1` pode rodar sozinho pelo Agendador de Tarefas, a cada 5 minutos. Ele usa o Windows PowerShell e o `curl.exe` que já vêm no Windows 10 e 11, e o mesmo `%APPDATA%\gw2logs\config.bat` do `.bat`.

**Instalar**: num PowerShell aberto na pasta do projeto (como administrador, se puder):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1             # a cada 5 minutos
powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1 -Minutos 10 # outro intervalo
```

O instalador copia o monitor para `%LOCALAPPDATA%\gw2logs\`, pede o endereço do site e o token se o `config.bat` ainda não existir (o arquivo fica legível só para o seu usuário) e cria a tarefa *GW2 Logs - enviar logs do ArcDPS*. Como administrador, a tarefa roda escondida e mesmo com você deslogado, sem guardar senha. Sem administrador, ela só roda com você logado e pode piscar uma janela a cada execução. Para testar na hora: `Start-ScheduledTask -TaskName 'GW2 Logs - enviar logs do ArcDPS'`, e veja o resultado em `Documentos\GW2 Logs\monitor.log`.

**Fluxo das pastas**:

```
pasta do ArcDPS ──▶ Documentos\GW2 Logs\integrando ──envio──▶ Documentos\GW2 Logs\integrado
                                                       └────▶ Documentos\GW2 Logs\erro
```

- A cada execução, os `.zevtc`, `.evtc` e `.json` que o ArcDPS já terminou de gravar (mais de 1 minuto sem mudar) vão para `integrando`, com as mesmas subpastas. Depois são enviados um por vez, do mais antigo para o mais novo. O que o site recusou (formato inválido, arquivo grande demais) vai para `erro`. O que ele aceitou **fica em `integrando` até o site terminar de processar**: a cada execução o monitor pergunta o status dos envios pendentes (`pendentes.json` guarda o id de cada um). Luta pronta vai para `integrado`; luta que falhou ao processar (por exemplo, log grande demais para a memória do servidor) vai para `erro`, e o `monitor.log` diz o motivo. Se o site não achar mais a luta, o arquivo é enviado de novo.
- **Os logs SAEM da pasta do ArcDPS.** É assim que o mesmo log não é enviado de novo a cada 5 minutos. Outros programas que leem essa pasta (por exemplo, um uploader para o dps.report) deixam de vê-los: use `GW2 Logs\integrado` neles.
- Fila cheia, limite por hora, disco cheio no servidor, token recusado (401), IP bloqueado (429) ou falta de internet: a execução para e o arquivo fica em `integrando`, para a próxima tentar de novo. Outro erro do servidor conta tentativas por arquivo (`tentativas.json`). Na 5ª, o arquivo vai para `erro`.
- **Token recusado (401)**: o envio fica pausado até o token mudar, porque cada token errado conta como tentativa falha e, na 5ª seguida, o servidor bloqueia o IP (inclusive para enviar pelo site). Gere outro token e troque a linha `set GW2LOGS_KEY=` do `config.bat`: na execução seguinte o envio volta sozinho. O `token-recusado.txt` da pasta de trabalho guarda só o hash do token recusado.
- **Primeira execução**: só entram os logs gravados nos últimos **3 dias** (`GW2LOGS_DIAS`); os mais antigos ficam na pasta do ArcDPS, sem mexer, e podem ir pelo site (zip). O servidor aceita no máximo 10 logs de cada usuário esperando processamento (`UPLOAD_MAX_QUEUE_USER`), e a cada 5 minutos entra mais um lote, até acabar.
- Opcionais no `config.bat` (ou como variáveis de ambiente, que valem mais): `set GW2LOGS_ORIGEM=...` (outra pasta do ArcDPS), `set GW2LOGS_PASTA=...` (outra pasta no lugar de `Documentos\GW2 Logs`) e `set GW2LOGS_MAX_TENTATIVAS=5` e `set GW2LOGS_DIAS=3` (só envia logs dos últimos N dias; `0` = sem limite).
- O `monitor.log` registra cada arquivo enviado, já enviado, integrado, recusado ou que falhou no servidor, cada parada e um resumo por execução. Ao passar de 1 MB, vira `monitor.old.log`.

**Desinstalar**:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\instalar-agendamento.ps1 -Desinstalar
```

Remove a tarefa e o script copiado. A configuração (`%APPDATA%\gw2logs\config.bat`) e as pastas de logs ficam.

## Configuração

Variáveis de ambiente do servidor. No Docker Compose, as principais vêm do arquivo `.env`.

| Variável | Para quê | Padrão |
|---|---|---|
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Aplicativo do Discord do login (portal de desenvolvedores). Sem os dois, o login fica desligado. O secret vai só no servidor | vazio |
| `DISCORD_GUILD_IDS` | IDs dos servidores do Discord do clã, separados por vírgula. Preenchida, o login pede também o escopo `guilds` e só entra quem está em um deles; quem já tinha conta e saiu perde o token pessoal no próximo login. O Discord só é consultado no login: por isso a sessão do navegador pede novo login depois de 7 dias (o site manda a pessoa para o Discord sozinho), e quem saiu do servidor deixa de entrar. Vazia junto com `DISCORD_USER_IDS`, o servidor não sobe (veja `ALLOW_ANY_DISCORD`). Confere só os 200 primeiros servidores de cada pessoa | vazio |
| `DISCORD_USER_IDS` | IDs dos usuários do Discord com acesso, separados por vírgula (Modo desenvolvedor, botão direito no usuário, *Copiar ID do usuário*). Preenchida, só esses usuários entram; vale **junto** com `DISCORD_GUILD_IDS` (precisa estar nas duas). Quem saiu da lista perde a sessão e o token pessoal na hora (a lista é conferida a cada pedido e as sessões de quem está fora são apagadas quando o servidor sobe); as lutas ficam. Cuidado: um ID errado barra todo mundo, e para destravar basta esvaziar a variável e reiniciar. Os IDs identificam pessoas: ficam só no `.env` do servidor | vazio |
| `ALLOW_ANY_DISCORD` | Com o login ligado e as duas listas acima vazias, qualquer conta do Discord entraria e enviaria logs: por isso o servidor **se recusa a subir** nessa situação, com uma mensagem no log. `true` libera de propósito (só esse texto vale). Login desligado (sem `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`) não é afetado | vazio |
| `API_TOKEN_DAYS` | Dias que o token pessoal do script de envio vale (a data aparece ao gerar). Depois é preciso gerar outro no site. Os tokens de antes dessa regra ganham este prazo a partir da subida do servidor | `90` |
| `RATE_LIMIT_PER_MIN` | Limite de pedidos **por IP por minuto** na API (o site, os ícones e o `/api/health` não contam). Passou, responde `429` com `retry-after`. `0` desliga. Atrás do Caddy vale o IP real do cliente (`TRUST_PROXY=true`). Folgado de propósito: uma tela faz vários pedidos, e vários usuários podem sair pelo mesmo IP | `600` |
| `RATE_LIMIT_AUTH_PER_MIN` | Limite mais baixo, por IP por minuto, só para o login e o retorno do Discord (cada um tem a sua conta). `0` = vale só o geral | `30` |
| `PUBLIC_URL` | Endereço público do site (ex.: `https://logs.exemplo.com`): é o retorno do login do Discord (`/api/auth/callback`) e liga o cookie `Secure` quando é https | `http://localhost:5080` |
| `ADMIN_DISCORD_IDS` | IDs do Discord de quem administra o site (marcar as guildas da aliança), separados por vírgula. Vale pela sessão do navegador: quem está na lista vê os controles na tela *Guildas*; os demais só veem a estrela. Sem esta lista e sem `ADMIN_KEY`, a administração fica desligada (nunca aberta). O ID não aparece em nenhuma resposta do site | vazio |
| `ADMIN_KEY` | Opcional, só para script: senha enviada no cabeçalho `x-upload-key` em `PUT /api/guilds/:id`, com o mesmo limite de tentativas dos envios. O site não pede mais essa senha na tela. Vazio = só a administração pelo login | vazio |
| `DATA_DIR` | Banco SQLite, logs enviados e JSON das lutas | `./data` |
| `RETENTION_DAYS` | Dias que as lutas ficam guardadas (0 = para sempre). No Compose o padrão é 30 | `0` |
| `PORT` / `HOST` | Endereço do servidor | `5080` / `127.0.0.1` |
| `EI_DIR` | Pasta do Elite Insights CLI | `./tools/GW2EICLI` |
| `DOTNET` | Comando que roda o Elite Insights (.NET) | `dotnet` |
| `WEB_DIR` | Pasta do site compilado | `./apps/web/dist` |
| `GW2_API` | `off` desliga a busca de nomes de guildas e mapas | ligado |

<details>
<summary>Elite Insights, travas contra abuso e Compose</summary>

| Variável | Para quê | Padrão |
|---|---|---|
| `EI_HTML` | `true` gera o relatório HTML do Elite Insights (botão "Relatório completo"). Custa 40 a 50 MB de disco e ~300 MB de memória a mais por luta grande, então fica desligado | `false` |
| `TRUST_PROXY` | `true` atrás do Caddy: conta o IP real do cliente nos bloqueios e no limite de pedidos. O Compose já liga | `false` |
| `UPLOAD_MAX_FAILS` / `UPLOAD_BLOCK_MIN` | Erros de token ou de senha de administrador seguidos do mesmo IP até bloquear, e por quantos minutos | `5` / `15` |
| `UPLOAD_MAX_QUEUE` | Logs esperando ou em processamento; acima disso o envio é recusado | `30` |
| `UPLOAD_MAX_PER_HOUR` | Logs novos aceitos por hora, no total | `500` |
| `UPLOAD_MAX_QUEUE_USER` / `UPLOAD_MAX_PER_HOUR_USER` | O mesmo, por usuário: logs esperando ou em processamento, e logs novos por hora | `10` / `200` |
| `UPLOAD_MAX_DISK_MB` | Espaço máximo dos logs enviados que ainda esperam processamento | `4096` |
| `DOMINIO` (Compose) | Nome do site, usado pelo Caddy para o HTTPS | obrigatório |
| `EI_TIMEOUT_MIN` | Minutos que o Elite Insights tem para ler um log antes de ser cortado. Em VM com pouca CPU, logs de ~20 MB passam de 5 minutos | `5` |
| `APP_MEM_LIMIT` (Compose) | Teto de memória do container; em VM de 1 GB use `800m` | `2000m` |
| `DOTNET_GCHeapHardLimitPercent` (Compose) | Teto do heap do .NET (o Elite Insights) em % do `APP_MEM_LIMIT`, **em hexadecimal**: `5A` = 90, `4B` = 75, `3C` = 60. Vazio, o .NET usa 75% do limite do contêiner. Se o limite do contêiner subir, suba este valor junto (veja [Migrar para uma VM maior](#migrar-para-uma-vm-maior-ampere-a1-arm64)) | vazio |

O Elite Insights roda com uma configuração enxuta (sem replay de combate, linhas do tempo por segundo e modificadores de dano), que leva o pico de memória de um log grande de ~1,4 GB para ~0,5 GB. O `DetailledWvW` precisa continuar ligado: sem ele o EI não traz dano, kills e inimigos em WvW.

</details>

## Colocar no ar

O site precisa de disco que não se perde e de ~1 GB de memória, então serviços de hospedagem gratuitos que dormem ou apagam o disco não servem. Uma VM *Always Free* da Oracle Cloud funciona, inclusive a de 1 GB (com swap), com HTTPS automático pelo Caddy.

1. **VM:** crie uma instância Ubuntu 24.04 com IP público e sua chave SSH. Na rede da VM (*Security List*), libere as portas 80 e 443 de entrada. O firewall do Ubuntu da Oracle também bloqueia: `sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`.
2. **Swap (VM de 1 GB):** `sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` (e uma linha no `/etc/fstab` para sobreviver ao reinício).
3. **Docker:** `sudo apt install docker.io docker-compose-v2 git` e `sudo usermod -aG docker $USER` (saia e entre de novo).
4. **Endereço:** use um domínio seu apontando para o IP da VM. Sem domínio, `IP-COM-HÍFENS.sslip.io` (por exemplo `203-0-113-7.sslip.io`) já aponta para o IP e o Caddy emite o certificado.
5. **Projeto:** `git clone https://github.com/Jean8791/gw2-clan-logs && cd gw2-clan-logs && git checkout release`, depois `cp .env.example .env`, `chmod 600 .env` e edite o `.env`: o endereço (`DOMINIO`), o aplicativo do Discord (`DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`), **pelo menos uma lista de acesso** (`DISCORD_USER_IDS` ou `DISCORD_GUILD_IDS`: sem as duas o servidor não sobe) e, para administrar as guildas, `ADMIN_DISCORD_IDS`. O `.env` guarda segredos: não o coloque no Git nem em chat.
6. **Subir:** `docker compose up -d --build`. O primeiro build leva alguns minutos, e o certificado HTTPS sai sozinho na primeira visita.
7. **Entrar e enviar os logs:** abra o site, entre com o Discord e use *Importar logs*, ou gere o token pessoal e use o script (veja [Enviar logs](#enviar-logs)).

### Operação

- **Atualizar:** na branch `release`, `git pull && docker compose up -d --build`. Depois de editar o `.env`, recrie o container com `docker compose up -d`: o `restart` **não** relê o `.env`. Se a extração mudou (`SCHEMA_VERSION` em `apps/api/src/db.ts`), `reingest` só alcança as lutas que ainda têm o JSON guardado (`docker compose exec app node apps/api/dist/scripts/reingest.js`; o total impresso no fim mostra quantas foram). (com `sudo` se o seu usuário não estiver no grupo `docker`). Lutas novas já saem certas.
- **Ver os logs sem entrar na VM (Dozzle):** painel web dos logs dos containers em `https://DOMINIO/logs`, atrás do Caddy com usuário e senha (os logs trazem IDs do Discord e nomes: use senha forte). **Configure antes de atualizar**, porque sem `LOGS_USUARIO` e `LOGS_SENHA_HASH` o `docker compose` se recusa a subir. (1) Gere o hash, digitando a senha no terminal (ela não vai na linha de comando): `docker run --rm -it caddy:2 caddy hash-password`. (2) No `.env`, ponha `LOGS_USUARIO=seu_usuario` e `LOGS_SENHA_HASH='o_hash'`, **com aspas simples** (`LOGS_SENHA_HASH='$2a$14$...'`), porque o hash tem `$` e o compose o trocaria. Sem as aspas o compose lê um trecho do hash como variável, avisa `The "XXXX" variable is not set` e corta o hash em silêncio: o site sobe e o `/logs` responde `401`, mas a senha certa não entra. Confira que o hash chegou inteiro: `docker compose exec caddy sh -c 'echo ${#LOGS_SENHA_HASH}'` deve dar `60`. (3) Valide antes de subir: `docker compose config -q && docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile`. (4) `docker compose up -d --build`. O Dozzle lê o socket do Docker em modo leitura, filtrado ao projeto (`DOZZLE_FILTER`), e a porta dele não é publicada: só o Caddy chega nele.
- **Backup fora da VM (Google Drive, criptografado):** `scripts/backup-drive.sh` faz uma cópia consistente do banco, confere a integridade, envia **cifrada** ao Drive com o rclone, confere o tamanho no destino e só então apaga as cópias com mais de 30 dias (`BACKUP_DIAS`). Cron do root, depois do backup local das 04:00: `15 4 * * * RCLONE_CONFIG=/home/ubuntu/.config/rclone/rclone.conf /home/ubuntu/gw2-clan-logs/scripts/backup-drive.sh >> /var/log/gw2-backup-drive.log 2>&1` (o log mostra uma linha `ok` por dia; sem ela, o backup falhou).
  - **Configurar (uma vez):**
    1. `sudo apt install rclone`, na VM e no seu computador.
    2. No computador: `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"` (login do Google; o escopo `drive.file` faz o rclone ver só o que ele mesmo cria, não o resto do Drive). Copie o `{...}` que ele imprime.
    3. Na VM, cole o token sem ele aparecer na tela: `read -rsp "Token: " T; rclone config create gdrive drive scope=drive.file token="$T" config_is_local=false; unset T`. Se o rclone do computador for mais novo que o da VM, o token vem em base64 (começa com `eyJ`) e o da VM não o lê: instale a mesma versão nos dois, ou grave no `rclone.conf` o JSON de dentro do campo `token`.
    4. Na VM, crie o remoto cifrado, com duas senhas aleatórias geradas ali mesmo: `rclone config create gw2crypt crypt remote=gdrive:gw2logs-backup filename_encryption=standard directory_name_encryption=true password="$(openssl rand -base64 36)" password2="$(openssl rand -base64 36)" --obscure`.
    5. Agende o cron (linha acima).

    A configuração (token do Drive e senhas) fica em `~/.config/rclone/rclone.conf`, permissão 600. Nos passos 3 e 4 o token e as senhas aparecem por um instante na linha de comando do `rclone` (visíveis no `ps`): risco aceito numa VM de um usuário só.
  - **Guarde as senhas fora da VM:** sem elas a cópia não abre. Num gerenciador de senhas, salve o bloco `[gw2crypt]` do `rclone.conf` (`sed -n '/^\[gw2crypt\]/,/^$/p' ~/.config/rclone/rclone.conf`, rodado por você no terminal da VM; nunca em chat).
  - **Restaurar** (testado): no computador (ou na VM), recrie o `gdrive` e o `gw2crypt` com o bloco guardado, `rclone copy gw2crypt:gw2logs-AAAA-MM-DD.db restauracao/` e deixe pasta e arquivo legíveis para o usuário do app (`chmod 755 restauracao; chmod 644 restauracao/*.db`). Na VM, na pasta do projeto: `docker compose stop app`, depois `docker compose run --rm --no-deps -v "$PWD/restauracao:/restauracao:ro" --entrypoint sh app -c 'rm -f /data/gw2logs-v2.db-wal /data/gw2logs-v2.db-shm && cp /restauracao/gw2logs-AAAA-MM-DD.db /data/gw2logs-v2.db'` e `docker compose up -d`. Confira em `/api/health` e na tela de Lutas.
  - Os arquivos do Drive têm nome cifrado (o Google só vê texto sem sentido): o nome legível só aparece pelo remoto `gw2crypt:`.
- **Contêiner sem root:** o app roda como o usuário `gw2logs` (uid 10001), sem capacidades (`cap_drop: [ALL]`), sem ganhar privilégios (`no-new-privileges`) e com o sistema de arquivos somente leitura: só `/data` (o volume `dados`) e `/tmp` são graváveis. **Numa VM que já tem o volume `dados` criado pelo root**, faça uma vez, antes do primeiro `up` com esta versão: `docker compose run --rm --no-deps --user root --cap-add CHOWN --entrypoint chown app -R 10001:10001 /data` (o `--cap-add CHOWN` é necessário porque o serviço descarta todas as capacidades, até as do root). Volumes novos, ainda vazios, já nascem com o dono certo. Se o app não subir com `EACCES: permission denied, mkdir '/data/uploads'`, é isto.
- **Atualizar o Elite Insights:** o `Dockerfile` só aceita o `GW2EICLI.zip` cujo SHA-256 bate com `EI_SHA256`. Troque a versão e o hash **juntos**: baixe o zip da versão nova em https://github.com/baaron4/GW2-Elite-Insights-Parser/releases (numa pasta separada), rode `sha256sum GW2EICLI.zip` e ponha o resultado em `EI_SHA256` (e a versão em `EI_VERSION`) no `Dockerfile`. Também dá para passar `--build-arg EI_VERSION=... --build-arg EI_SHA256=...` no build. Versão e hash que não combinam fazem o build falhar, de propósito.
- **Quem foi barrado no login:** cada login negado deixa uma linha no log do servidor, com o ID do Discord, o nome e o motivo: `docker compose logs app | grep 'login negado'`. `notAllowed` é quem não está em `DISCORD_USER_IDS`; `notInGuild` é quem não está no servidor de `DISCORD_GUILD_IDS`. Para liberar alguém, copie o ID da linha para a lista no `.env` (separado por vírgula) e rode `docker compose up -d`: o `restart` não relê o `.env`. O ID aparece só no log do servidor, nunca na resposta do site, e identifica uma pessoa: não o cole em lugar público.
- **Backup diário:** `crontab -e` e `0 4 * * * cd ~/gw2-clan-logs && scripts/backup.sh`. Guarda as últimas 7 cópias do banco em `/data/backup`, dentro do mesmo disco: por isso existe também o backup para o Google Drive, acima. Confira o espaço do disco de vez em quando.
- **Acompanhar:** `docker compose logs -f app`, `docker stats`, e a tela Lutas mostra a fila e os erros de processamento. Cada log processado registra `eiMs` (Elite Insights) e `totalMs` no log "luta processada", e o total fica em `fights.process_ms` (vazio nas lutas copiadas e nas antigas): `SELECT COUNT(*), AVG(process_ms), MAX(process_ms) FROM fights WHERE process_ms IS NOT NULL` dá a média e o pico para estimar quantos logs por hora o servidor aguenta.
- **Alerta de fora do ar:** `GET /api/health` responde o estado e o tamanho da fila. O workflow `.github/workflows/uptime.yml` o consulta a cada 15 minutos e o GitHub avisa por e-mail se falhar; defina a variável `SITE_URL` do repositório (Settings, Secrets and variables, Variables).
- **Segurança:** o SSH só aceita chave, sem login de root, sem encaminhamento de portas, de X11 e de agente (`PermitRootLogin no`, `AllowTcpForwarding no` e afins num arquivo em `/etc/ssh/sshd_config.d/`, com nome começando por `00-`, porque o primeiro valor vence), com `fail2ban` e atualizações automáticas (pode reiniciar sozinho de madrugada). Deixe abertas só as portas 22, 80 e 443, e confira também o firewall da rede da nuvem (*Security List*). No site: quem tem o link de um espaço o vê (só leitura) e o dono pode trocá-lo; enviar logs exige login ou o token pessoal; marcar guildas exige ser administrador (`ADMIN_DISCORD_IDS`) ou a `ADMIN_KEY`, por script.

### Migrar para uma VM maior (Ampere A1, ARM64)

Logs de WvW grandes (de 20 a 50 MB) precisam de mais memória que a VM de 1 GB. A imagem Docker roda em `linux/amd64` e em `linux/arm64`, então o site vai para uma VM Ampere A1 (*Always Free*) com o mesmo `docker compose`, sem mudar o código.

**1. Meça antes de escolher o tamanho.** Com a imagem construída (`docker build -t gw2-medir .`), rode `scripts/medir-ei.sh -d gw2-medir ARQUIVO.zevtc`: ele usa a mesma configuração do servidor e mostra o pico de memória (RSS) e o tempo do Elite Insights. Medido na imagem, com limite de 1500 MB e o padrão do .NET: log de 13 MB, ~475 MB de pico, 6,9 s e JSON de 24 MB; log de 22 MB, 781 MB de pico, 11 s e JSON de 30 MB; log de 39 MB, **falhou** (o .NET só usa 75% do limite) e, com 3 GB, passou com 1,3 GB de pico, 16 s e JSON de 39 MB. Por isso o padrão do compose é 2000m. O pico cresce com o log (e com o JSON gerado); meça os seus maiores logs e escolha o `APP_MEM_LIMIT` com folga de pelo menos 50% sobre o pior pico, mais ~500 MB para o resto do site. Além do EI, o servidor lê o JSON inteiro na memória do Node depois que o EI termina, então o JSON de um log de 50 MB (algo como 90 MB) também pesa.

**2. Tamanho da VM.** A cota *Always Free* soma até 4 OCPU e 24 GB de RAM nas instâncias A1. Ponto de partida: **2 OCPU e 12 GB** (deixa a outra metade da cota livre e é rápido o bastante para o EI, que usa 1 thread: `SingleThreaded=true`). Com a memória medida, ajuste o `.env`:

```
APP_MEM_LIMIT=6g
DOTNET_GCHeapHardLimitPercent=5A
EI_TIMEOUT_MIN=10
```

`5A` é 90 em hexadecimal: o heap do .NET pode usar até 90% do `APP_MEM_LIMIT`. O padrão do .NET (75%) também serve; suba o valor só se o EI falhar com `eiMemory` com o contêiner ainda longe do limite. Esses números são um ponto de partida, não uma garantia: confirme com as suas medições.

**3. Criar a VM.** No console da Oracle, *Create instance*, forma **VM.Standard.A1.Flex** (Ampere), imagem **Ubuntu 24.04 (aarch64)**, 2 OCPU e 12 GB, IP público e a sua chave SSH. Libere as portas 80 e 443 como no passo 1 de [Colocar no ar](#colocar-no-ar). Sem swap (a VM tem memória de sobra). Instale o Docker como no passo 3 e clone o projeto (`git clone ... && git checkout release`).

**4. Copiar o `.env` e os dados.** Faça tudo com o site **parado** na VM antiga, para não perder lutas enviadas durante a cópia (o monitor de envio no Windows tenta de novo sozinho: o arquivo fica em `integrando`).
  1. Na VM antiga: `docker compose stop app` (o Caddy pode continuar). Faça um backup consistente do banco: `docker compose start app && scripts/backup.sh && docker compose stop app`; o backup fica no próprio volume e vai junto na cópia.
  2. Descubra o nome do volume: `docker volume ls | grep dados`.
  3. Da VM antiga para a nova, sem arquivo intermediário (substitua o volume, o usuário e o endereço da VM nova; a chave SSH da VM antiga para a nova precisa existir, ou rode o comando da sua máquina com `ssh` nas duas pontas): `docker run --rm -v VOLUME_DADOS:/data:ro alpine tar czf - -C /data . | ssh usuario@IP-NOVO 'cd ~ && cat > dados.tgz'`.
  4. Na VM nova, antes do primeiro `up`: `docker volume create gw2-clan-logs_dados` e `docker run --rm -v gw2-clan-logs_dados:/data -v ~/dados.tgz:/dados.tgz:ro alpine sh -c 'tar xzf /dados.tgz -C /data && chown -R 10001:10001 /data'` (o dono tem que ser o uid 10001 do app; o nome do volume é `NOMEDAPASTA_dados`, então confira com `docker volume ls`). Depois apague o `dados.tgz`.
  5. Copie o `.env` da VM antiga para a nova com `scp` e `chmod 600 .env`. Não imprima nem cole o conteúdo: ele tem segredos. Acrescente as linhas do passo 2 (`APP_MEM_LIMIT` etc.).
  6. `docker compose up -d --build` (o build é nativo em ARM64). Confira `docker compose logs app` (sem erro, banco aberto) e o total de lutas: `docker compose exec app node -e "const D=require('better-sqlite3');console.log(new D('/data/gw2logs-v2.db',{readonly:true}).prepare('select count(*) n from fights').get())"` e compare com o da VM antiga.

**Validar o Elite Insights em ARM64 antes de mudar o DNS.** O build arm64 da imagem, o Node, o `better-sqlite3`, o runtime .NET e os 606 testes passam (testados sob emulação), mas o Elite Insights só foi exercitado em amd64: sob a emulação QEMU o .NET aborta com `AccessViolationException`, o que é limitação do emulador e não prova nada sobre ARM de verdade. Na A1, antes de tudo, rode `scripts/medir-ei.sh -d IMAGEM ARQUIVO.zevtc` num log pequeno e depois no maior. Se o EI falhar também lá, não mude o DNS (o site continua na VM antiga) e abra uma pendência.

**5. Apontar o DuckDNS e validar.** No painel do DuckDNS, troque o IP do seu subdomínio pelo da VM nova (o TTL é curto, ~1 min). Na primeira visita o Caddy emite o certificado HTTPS (se a emissão falhar, o DNS ainda não propagou: espere e veja `docker compose logs caddy`). Valide: o site abre, o login com o Discord funciona (o endereço é o mesmo, então a URL de retorno não muda), as lutas e os usuários aparecem, `/api/health` responde e **um log grande (o que falhava com `eiMemory`) é importado**. Rode também `scripts/backup.sh` e refaça o agendamento do cron e do `backup-drive.sh` (rclone) na VM nova.

**6. Desligar a VM antiga, só depois.** Deixe a antiga parada (`docker compose stop`) por alguns dias, como plano B: se algo falhar, basta apontar o DuckDNS de volta. Só então apague a instância, e o volume de boot, no console da Oracle.

**"Out of capacity for shape VM.Standard.A1.Flex":** a Oracle não tem A1 livre naquela região e domínio de disponibilidade. Em ordem: (1) tente outro *Availability Domain* na criação (se a região tiver mais de um); (2) tente de novo mais tarde, de madrugada costuma ter vaga; (3) peça menos (1 OCPU e 6 GB) e aumente depois, pois a forma Flex permite redimensionar a instância parada; (4) tente repetidamente com o OCI CLI (`oci compute instance launch ...` em um laço com pausa) até a vaga aparecer; (5) mudar a conta para *Pay As You Go* costuma resolver, e continua sem cobrança enquanto você ficar dentro dos limites *Always Free* (confira o limite na sua conta antes). A região da conta não muda depois de criada. Enquanto não houver vaga, o site continua na VM antiga: nada é desligado antes da validação.

## Branches e lançamento

| Branch | Para quê |
|---|---|
| `development` | O que está sendo desenvolvido e testado. Todo trabalho novo sai dela e os PRs voltam para ela (é a branch padrão) |
| `release` | A produção: o servidor roda o código desta branch. Protegida (exige PR e CI verde) |

Fluxo: tarefa (branch `DDMMAAAAHHMM`) → PR para `development` → teste (`npm test`, build do Docker e envio de logs reais) → PR de `development` para `release` → atualizar o servidor. O CI roda em `development`, em `release` e em todo PR.

## Como as métricas são calculadas

- **Dano, abates e downs** contam só **jogadores inimigos**, sem guardas e estruturas. Em PvE contam os alvos da luta.
- **Por minuto e por segundo** usam o tempo ativo de cada jogador na luta.
- **Cura e barreira:** o total vem do Healing Stats e inclui minions e aliados fora do squad. *Grupo* é o que o jogador deu aos jogadores do seu grupo no squad (ele incluído), e *próprio* é o que deu a si mesmo. *Cura em caídos* é a cura em jogadores no chão.
- **Boons gerados** são o volume que o jogador gera para o squad, para o seu grupo ou só para si (aba Boons, com o seletor Squad | Grupo | Próprio), na unidade do Elite Insights.
- **Uptime** é a % do tempo ativo do jogador com o boon. Em Estabilidade e Poder é o tempo com pelo menos uma pilha, e "Poder (pilhas)" é a média de pilhas. Nas médias do squad o peso é o tempo ativo.
- **Boons e Uptime no Ranking (e no Comparar)** são ajustados pelo tempo jogado: quem jogou menos que a referência do período (metade da mediana de tempo jogado, no mínimo 5 min) é puxado para a média geral, e quem jogou muito quase mantém o próprio valor. Assim, alguém com poucos minutos não aparece no topo só por sorte.
- **Função (DPS ou suporte)** é estimada por luta: é suporte quem cura e dá barreira mais que metade do próprio dano, ou quem está entre os maiores geradores de boons do squad. Em luta curta (menos de 60 s ativos) a estimativa é instável, então a luta herda a função da mesma conta e classe; quando entra uma luta longa nova, a função das curtas dessa conta e classe é recalculada.
