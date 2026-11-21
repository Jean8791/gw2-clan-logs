# Logs do Clã

[![CI](https://github.com/Jean8791/gw2-clan-logs/actions/workflows/ci.yml/badge.svg)](https://github.com/Jean8791/gw2-clan-logs/actions/workflows/ci.yml)

Histórico de **WvW de Guild Wars 2** para clãs e alianças. Os logs do ArcDPS são processados pelo **Elite Insights** e viram um histórico contínuo, com ranking, perfil de cada jogador, comparação e filtros que os relatórios por sessão não têm. O site está em **português e inglês** (botão PT | EN no canto da tela).

## O que o site mostra

| Tela | Para quê |
|---|---|
| **Visão geral** | Resumo do período: lutas, tempo, abates, mortes, os melhores de dano, strips, cleanses e cura por minuto (com botão de detalhe) e as lutas recentes |
| **Dias** | Cada dia de batalha, das 06:00 às 06:00 (Brasília): uma noite que passa da meia-noite continua no mesmo dia |
| **Lutas** e **Luta** | Lista das lutas e o detalhe de cada uma: squad × inimigos, gráfico de dano e tabelas de Dano, Suporte, Boons, Uptime e Defesa, por jogador, por guilda e por grupo |
| **Ranking** | Todos os jogadores, com filtros por período, dia, guilda, só a aliança, função, classe, tamanho do squad, duração e mapa. Mostra total, por minuto ou por segundo, ordena por qualquer coluna e deixa escolher as colunas. Os filtros ficam no link, então dá para mandar no Discord |
| **Perfil** | O histórico do jogador, a evolução luta a luta, habilidades e a comparação com a média de quem joga na mesma função |
| **Comparar** | Até 4 jogadores lado a lado, com radar e tabela |
| **Guildas** | A guilda de cada jogador vem do log; nome e tag vêm da API oficial do GW2. Marque com ★ as da sua aliança |

Métricas: dano, abates e downs (só contra jogadores inimigos), strips, cleanses, **cura e barreira** (total, no grupo, em si mesmo e em quem está caído), **boons gerados** para o squad, o grupo ou só para si, **uptime** dos boons recebidos e defesa. Veja [Como as métricas são calculadas](#como-as-métricas-são-calculadas).

## Como funciona

```
ArcDPS (.zevtc) ──scripts/enviar-logs.sh──▶ API ──▶ fila ──▶ Elite Insights ──▶ SQLite ──▶ site (React)
                       (com chave)          Fastify         (.NET)           + JSON guardado
```

- **Não há tela de envio.** Os logs entram só pela API, com uma chave, usando o script `scripts/enviar-logs.sh` (veja [Enviar logs](#enviar-logs)).
- O mesmo log enviado duas vezes pelo mesmo usuário é ignorado enquanto a luta ainda está guardada; depois de apagada, pode ser importado de novo. Se outro usuário já enviou o mesmo arquivo e a luta está pronta, ela é copiada do banco, sem rodar o Elite Insights de novo (só o limite por hora vale nesse caso). O site também aceita o `.json` do Elite Insights ou do dps.report (até 15 MB: o JSON ocupa muita memória; acima disso, envie o `.zevtc`).
- Depois de processar uma luta, o servidor guarda só o que foi para o banco (cerca de 0,2 MB por luta): o log enviado e o JSON do Elite Insights são apagados. Se o processamento falhar, o log enviado fica para diagnóstico. Por isso uma métrica nova só vale para as lutas enviadas depois dela; as antigas precisam ser enviadas de novo.
- **O site não é um arquivo de logs:** ele só personaliza a visualização, e quem usa precisa guardar os originais em outro lugar. A tela de importação e a de entrada avisam isso, com o prazo em `RETENTION_DAYS`.
- As lutas antigas são apagadas depois de `RETENTION_DAYS` dias, contados pela data da luta (no Docker Compose o padrão é 30; fora dele, 0 = guardar para sempre).

| Parte | Tecnologia |
|---|---|
| API | Node 22 + TypeScript, Fastify, SQLite (better-sqlite3) |
| Site | React 19 + Vite, Tailwind CSS 4, TanStack Query, Recharts |
| Parser | [Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser) CLI (.NET), chamado pela API |
| Testes e CI | Vitest, GitHub Actions |

```
apps/api/         API REST, fila de processamento e extração das estatísticas
  src/ingest.ts   JSON do Elite Insights → estatísticas por jogador (função pura, testada)
  src/queries.ts  ranking, perfil, comparação e filtros em SQL
apps/web/         site em React
packages/shared/  tipos, métricas, filtros e textos (pt/en) usados pelos dois lados
scripts/          envio de logs, backup e download do Elite Insights
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
| `GW2_API` | `off` desliga a busca de nomes de guildas e mapas | ligado |

<details>
<summary>Elite Insights, travas contra abuso e Compose</summary>

| Variável | Para quê | Padrão |
|---|---|---|
| `EI_HTML` | `true` gera o relatório HTML do Elite Insights (botão "Relatório completo"). Custa 40 a 50 MB de disco e ~300 MB de memória a mais por luta grande, então fica desligado | `false` |
| `TRUST_PROXY` | `true` atrás do Caddy: conta o IP real do cliente nos bloqueios. O Compose já liga | `false` |
| `UPLOAD_MAX_FAILS` / `UPLOAD_BLOCK_MIN` | Erros de senha seguidos do mesmo IP até bloquear, e por quantos minutos | `5` / `15` |
| `UPLOAD_MAX_QUEUE` | Logs esperando ou em processamento; acima disso o envio é recusado | `30` |
| `UPLOAD_MAX_PER_HOUR` | Logs novos aceitos por hora | `500` |
| `UPLOAD_MAX_DISK_MB` | Espaço máximo dos logs enviados que ainda esperam processamento | `4096` |
| `DOMINIO` (Compose) | Nome do site, usado pelo Caddy para o HTTPS | obrigatório |
| `APP_MEM_LIMIT` (Compose) | Teto de memória do container; em VM de 1 GB use `800m` | `1500m` |

O Elite Insights roda com uma configuração enxuta (sem replay de combate, linhas do tempo por segundo e modificadores de dano), que leva o pico de memória de um log grande de ~1,4 GB para ~0,5 GB. O `DetailledWvW` precisa continuar ligado: sem ele o EI não traz dano, kills e inimigos em WvW.

</details>

## Colocar no ar

O site precisa de disco que não se perde e de ~1 GB de memória, então serviços de hospedagem gratuitos que dormem ou apagam o disco não servem. Uma VM *Always Free* da Oracle Cloud funciona, inclusive a de 1 GB (com swap), com HTTPS automático pelo Caddy.

1. **VM:** crie uma instância Ubuntu 24.04 com IP público e sua chave SSH. Na rede da VM (*Security List*), libere as portas 80 e 443 de entrada. O firewall do Ubuntu da Oracle também bloqueia: `sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`.
2. **Swap (VM de 1 GB):** `sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` (e uma linha no `/etc/fstab` para sobreviver ao reinício).
3. **Docker:** `sudo apt install docker.io docker-compose-v2 git` e `sudo usermod -aG docker $USER` (saia e entre de novo).
4. **Endereço:** use um domínio seu apontando para o IP da VM. Sem domínio, `IP-COM-HÍFENS.sslip.io` (por exemplo `203-0-113-7.sslip.io`) já aponta para o IP e o Caddy emite o certificado.
5. **Projeto:** `git clone https://github.com/Jean8791/gw2-clan-logs && cd gw2-clan-logs && git checkout release`, depois `cp .env.example .env` e edite o `.env` (endereço e senhas fortes e diferentes entre si; `openssl rand -hex 24` gera uma boa).
6. **Subir:** `docker compose up -d --build`. O primeiro build leva alguns minutos, e o certificado HTTPS sai sozinho na primeira visita.
7. **Enviar os logs** com o script, a partir do seu computador.

### Operação

- **Atualizar:** na branch `release`, `git pull && docker compose up -d --build`. Se a extração mudou (`SCHEMA_VERSION` em `apps/api/src/db.ts`), `reingest` só alcança as lutas que ainda têm o JSON guardado (`docker compose exec app node apps/api/dist/scripts/reingest.js`; o total impresso no fim mostra quantas foram). (com `sudo` se o seu usuário não estiver no grupo `docker`). Lutas novas já saem certas.
- **Contêiner sem root:** o app roda como o usuário `gw2logs` (uid 10001), sem capacidades (`cap_drop: [ALL]`), sem ganhar privilégios (`no-new-privileges`) e com o sistema de arquivos somente leitura: só `/data` (o volume `dados`) e `/tmp` são graváveis. **Numa VM que já tem o volume `dados` criado pelo root**, faça uma vez, antes do primeiro `up` com esta versão: `docker compose run --rm --no-deps --user root --cap-add CHOWN --entrypoint chown app -R 10001:10001 /data` (o `--cap-add CHOWN` é necessário porque o serviço descarta todas as capacidades, até as do root). Volumes novos, ainda vazios, já nascem com o dono certo. Se o app não subir com `EACCES: permission denied, mkdir '/data/uploads'`, é isto.
- **Atualizar o Elite Insights:** o `Dockerfile` só aceita o `GW2EICLI.zip` cujo SHA-256 bate com `EI_SHA256`. Troque a versão e o hash **juntos**: baixe o zip da versão nova em https://github.com/baaron4/GW2-Elite-Insights-Parser/releases (numa pasta separada), rode `sha256sum GW2EICLI.zip` e ponha o resultado em `EI_SHA256` (e a versão em `EI_VERSION`) no `Dockerfile`. Também dá para passar `--build-arg EI_VERSION=... --build-arg EI_SHA256=...` no build. Versão e hash que não combinam fazem o build falhar, de propósito.
- **Quem foi barrado no login:** cada login negado deixa uma linha no log do servidor, com o ID do Discord, o nome e o motivo: `docker compose logs app | grep 'login negado'`. `notAllowed` é quem não está em `DISCORD_USER_IDS`; `notInGuild` é quem não está no servidor de `DISCORD_GUILD_IDS`. Para liberar alguém, copie o ID da linha para a lista no `.env` (separado por vírgula) e rode `docker compose up -d`: o `restart` não relê o `.env`. O ID aparece só no log do servidor, nunca na resposta do site, e identifica uma pessoa: não o cole em lugar público.
- **Backup diário:** `crontab -e` e `0 4 * * * cd ~/gw2-clan-logs && scripts/backup.sh`. Guarda as últimas 7 cópias do banco em `/data/backup`, dentro do mesmo disco: copie para fora se o histórico for importante. Confira o espaço do disco de vez em quando.
- **Acompanhar:** `docker compose logs -f app`, `docker stats`, e a tela Lutas mostra a fila e os erros de processamento. Cada log processado registra `eiMs` (Elite Insights) e `totalMs` no log "luta processada", e o total fica em `fights.process_ms` (vazio nas lutas copiadas e nas antigas): `SELECT COUNT(*), AVG(process_ms), MAX(process_ms) FROM fights WHERE process_ms IS NOT NULL` dá a média e o pico para estimar quantos logs por hora o servidor aguenta.
- **Alerta de fora do ar:** `GET /api/health` responde o estado e o tamanho da fila. O workflow `.github/workflows/uptime.yml` o consulta a cada 15 minutos e o GitHub avisa por e-mail se falhar; defina a variável `SITE_URL` do repositório (Settings, Secrets and variables, Variables).
- **Segurança:** o SSH deve aceitar só chave (sem senha) e pode usar `fail2ban`. O site é de leitura aberta; enviar logs e marcar guildas exigem as chaves.

## Branches e lançamento

| Branch | Para quê |
|---|---|
| `development` | O que está sendo desenvolvido e testado. Todo trabalho novo sai dela e os PRs voltam para ela (é a branch padrão) |
| `release` | A produção: o servidor roda o código desta branch. Protegida (exige PR e CI verde) |
| `master` | Cópia da produção: fica igual à `release` depois de cada lançamento, sem commits próprios. Protegida |

Fluxo: tarefa (branch `DDMMAAAAHHMM`) → PR para `development` → teste (`npm test`, build do Docker e envio de logs reais) → PR de `development` para `release` → atualizar o servidor → `master` vai para o mesmo commit da `release`. O CI roda nas três branches e em todo PR.

## Como as métricas são calculadas

- **Dano, abates e downs** contam só **jogadores inimigos**, sem guardas e estruturas. Em PvE contam os alvos da luta.
- **Por minuto e por segundo** usam o tempo ativo de cada jogador na luta.
- **Cura e barreira:** o total vem do Healing Stats e inclui minions e aliados fora do squad. *Grupo* é o que o jogador deu aos jogadores do seu grupo no squad (ele incluído), e *próprio* é o que deu a si mesmo. *Cura em caídos* é a cura em jogadores no chão.
- **Boons gerados** são o volume que o jogador gera para o squad, para o seu grupo ou só para si (aba Boons, com o seletor Squad | Grupo | Próprio), na unidade do Elite Insights.
- **Uptime** é a % do tempo ativo do jogador com o boon. Em Estabilidade e Poder é o tempo com pelo menos uma pilha, e "Poder (pilhas)" é a média de pilhas. Nas médias do squad o peso é o tempo ativo.
- **Função (DPS ou suporte)** é estimada por luta: é suporte quem cura e dá barreira mais que metade do próprio dano, ou quem está entre os maiores geradores de boons do squad.
