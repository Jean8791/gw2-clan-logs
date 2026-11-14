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
- O mesmo log enviado duas vezes é ignorado. O site também aceita o `.json` do Elite Insights ou do dps.report.
- O JSON completo de cada luta fica em `data/fights/<id>/ei.json.gz`. Uma métrica nova pode ser calculada depois reprocessando as lutas guardadas, sem reenviar os logs: `npm run reingest` fora do Docker, ou `docker compose exec app node apps/api/dist/scripts/reingest.js` no servidor.
- As lutas antigas são apagadas depois de `RETENTION_DAYS` dias, contados pela data da luta (no Docker Compose o padrão é 30; fora dele, 0 = guardar para sempre).

| Parte | Tecnologia |
|---|---|
| API | Node 20 + TypeScript, Fastify, SQLite (better-sqlite3) |
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

Precisa do **Node 20+**. Para processar `.zevtc` também precisa do **runtime .NET** e do Elite Insights; sem eles, o site aceita só o `.json` do EI.

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

Com Docker: `docker build -t gw2-clan-logs .` e `docker run -p 8080:8080 -e UPLOAD_KEY=teste -v dados:/data gw2-clan-logs`.

## Enviar logs

O ArcDPS grava em `Documentos\Guild Wars 2\addons\arcdps\arcdps.cbtlogs\`. Para gravar **WvW**, no jogo use Alt+Shift+T, depois *Logging*, e ative a gravação de WvW. Cura e barreira só aparecem se quem gravou usa o addon **Healing Stats**.

Para enviar, configure o endereço do site e a chave (a `UPLOAD_KEY` do servidor) e rode o script:

```bash
export GW2LOGS_URL=https://seu-dominio GW2LOGS_KEY=a-chave   # ou guarde em ~/.config/gw2logs/env (chmod 600)
scripts/enviar-logs.sh ~/Documentos/Guild\ Wars\ 2/addons/arcdps/arcdps.cbtlogs   # arquivos ou pastas
```

- Não reenvia o que já enviou (o registro é por servidor), espera quando a fila do servidor está cheia e para com aviso ao bater um limite.
- A chave segue ao servidor por entrada padrão e não aparece em `ps`.
- Quem tem a chave envia: trate-a como senha e troque a `UPLOAD_KEY` se ela vazar.

## Configuração

Variáveis de ambiente do servidor. No Docker Compose, as principais vêm do arquivo `.env`.

| Variável | Para quê | Padrão |
|---|---|---|
| `UPLOAD_KEY` | Chave para enviar logs. Vazio = qualquer um envia (nunca deixe vazio na internet) | vazio |
| `ADMIN_KEY` | Senha para marcar as guildas da aliança | igual a `UPLOAD_KEY` |
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
| `UPLOAD_MAX_DISK_MB` | Espaço máximo dos logs enviados | `4096` |
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

- **Atualizar:** na branch `release`, `git pull && docker compose up -d --build`. Se a extração mudou (`SCHEMA_VERSION` em `apps/api/src/db.ts`), reprocesse as lutas já importadas, a partir do JSON guardado, com `docker compose exec app node apps/api/dist/scripts/reingest.js` (com `sudo` se o seu usuário não estiver no grupo `docker`). Lutas novas já saem certas; só as antigas precisam disso.
- **Backup diário:** `crontab -e` e `0 4 * * * cd ~/gw2-clan-logs && scripts/backup.sh`. Guarda as últimas 7 cópias do banco em `/data/backup`, dentro do mesmo disco: copie para fora se o histórico for importante. Cada luta ocupa cerca de 10 MB; confira o espaço do disco.
- **Acompanhar:** `docker compose logs -f app`, `docker stats`, e a tela Lutas mostra a fila e os erros de processamento.
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
