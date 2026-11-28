# Etapas 3 a 5 dos boons: o que foi feito e o que foi decidido

Segue `auditoria_elite_insights_3_32_boons_wvw.md` e `etapa-0-validacao-boons.md`. Mesmas 20 logs reais, de uma noite (13/11/2026), Elite Insights 3.32.0.0.

## Etapa 3: perda registrada, rejeição explícita e ABU (feita)

- **Guardado por boon, no escopo Squad** (colunas novas em `player_stats` e no resumo diário): `<boon>Waste` (`wasted` do EI) e `<boon>Rej` (`overstack − generation`, nunca negativo). Os campos do EI não são alterados.
- **Versão da fórmula:** `fights.boon_formula` guarda `BOON_FORMULA_VERSION` (hoje 3). 1 = só o volume, 2 = volume e geração efetiva, 3 = com perda e rejeição. As lutas anteriores ficam com NULL.
- **Medidas derivadas** (`boonMetrics` em `packages/shared`): ABU (indicador principal), BVU (complementar, pode passar de 100% e leva aviso), taxa de perda, taxa de rejeição e resíduo (`outgoing − (generation + rejeição + perda)`, para auditoria). Os cenários da auditoria viraram testes.
- **Cobertura:** o tempo em que o log trouxe a geração, para a luta toda (quem não gerou nada tem um zero verdadeiro). Sem cobertura, ou com período misto, as medidas são N/D. `overstack` menor que `generation` (acima de 0,002) é tratado como inconsistência: o jogador fica sem cobertura naquela luta, em vez de mascarar.
- **Tela:** com um boon escolhido na aba Boons do Ranking, aparecem Aproveitamento (ABU), Aproveitamento do volume (BVU) e Taxa de perda, calculados com os mesmos valores (ajustados) das colunas vizinhas.
- **Migração:** quando as colunas de perda nascem, as lutas já gravadas perdem a cobertura (não há dado de perda delas), e os dias ainda abertos do resumo diário são refeitos.

Conferido nos 20 logs reprocessados: mediana de ABU de Stability 0,87 e BVU 0,87, rejeição explícita total 0.

## Etapa 4: peso da média entre lutas (decidido: não mudar)

A hipótese N2 era que o peso certo seria duração da fase × destinatários, e não o tempo ativo da fonte. A Etapa 0 mediu isso: o valor muda até 25% a 34%, mas o ranking quase não muda (Spearman ≥ 0,985 e 4 a 5 dos 5 primeiros iguais), e a eficiência muda no máximo 0,021. **Decisão:** manter o tempo ativo como peso. Mudar exigiria guardar a duração da fase e os destinatários por luta, sem ganho observável. Reabrir se uma amostra com squads de tamanhos muito diferentes mostrar o contrário.

## Etapa 5: camada tática (analisada; não implementada)

Pergunta: dá para medir se as habilidades de boon foram usadas espaçadas ou todas juntas?

**Dados disponíveis (medidos):**
- O JSON traz `rotation[].skills[].castTime` (momento de cada uso, em ms) de cada habilidade, sem opção extra do EI.
- Falta o vínculo habilidade → boon, que o JSON não traz. A API pública do GW2 traz isso nos fatos da habilidade (`Buff` com `status`): 575 das 667 habilidades distintas usadas nos logs (86%) foram encontradas, e destas há 29 que aplicam Stability, 11 Quickness, 4 Alacrity, 32 Protection, 15 Aegis e outras. É uma lista que o site teria de manter (e que muda com os patches do jogo).
- Eventos de remoção por fonte inimiga e o estado das pilhas antes de cada aplicação **não estão** no JSON. Seguem exigindo o EVTC original ou instrumentar o EI (sem verificação).

**Protótipo (não vai para o site):** concentração em janela de 3 e 5 s dos usos de habilidades de Stability e intervalo mediano entre usos, por jogador e luta, comparados com o ABU de Stability (39 pares com ao menos 4 usos).

| Medida | Correlação com o ABU | Correlação com a geração |
|---|---:|---:|
| Concentração em 3 s | +0,01 | +0,28 |
| Concentração em 5 s | +0,12 | +0,24 |
| Intervalo mediano entre usos | −0,10 | −0,47 |
| Número de usos | −0,01 | +0,02 |

**Leitura:** nesta amostra, usar as habilidades de Stability juntas ou espaçadas **não explica** o aproveitamento. A correlação com o ABU é praticamente zero, o que combina com a auditoria: a perda registrada vem principalmente de remoção e substituição, não de jogar tudo junto. O intervalo entre usos se relaciona mais com a quantidade gerada (−0,47), como se esperaria, mas isso é atividade, não eficiência.

**Decisão:** não criar a métrica de concentração no site. Seria um número sem relação demonstrada com o que se quer medir, e a auditoria alerta para não punir concentração sem contexto (um engage pede Stability junta). Se a guilda ainda quiser, o caminho barato é mostrar o **número de usos de habilidades de cada boon**, por jogador e luta, a partir dos usos já guardados (`player_skill_usage`) mais a lista habilidade → boon. Limites: um clã, uma noite, 39 pares.
