# Etapa 0: validação empírica dos campos de boons do Elite Insights 3.32

Complementa `auditoria_elite_insights_3_32_boons_wvw.md`. Só mede e compara: nenhum código do site foi alterado.

## 1. Dados e método

- **Logs:** 20 logs reais de WvW (`.zevtc`) de uma noite só (13/11/2026), processados com o Elite Insights 3.32.0.0 do contêiner do site, com `DetailledWvW=true`, `SaveOutJSON=true` e `SaveOutHTML=true`.
- **Amostra:** 1.644 pares jogador/buff presentes ao mesmo tempo em `squadBuffs` e `squadBuffVolumes` (fase 0, escopo Squad, fora do squad excluído). 33 jogadores no maior log.
- **Limites da amostra:** um clã, uma noite, composição parecida. Os resultados abaixo valem como evidência forte para esse contexto, não como regra geral.
- **Não executado:** o simulador de buffs do EI não foi instrumentado. Por isso o caminho com ID ou sem ID (NoID) e as causas dos desvios continuam sem confirmação (seção 9).
- **Reprodução:** os scripts estão em `docs/research/etapa-0/`. Rode com `EI_OUT=<pasta com os .json e .html>`.

## 2. Overstack e geração (confirma a auditoria)

| Medida | Resultado |
|---|---|
| `overstack == generation` | **1.644 de 1.644** pares (100%) |
| `overstack > generation` (rejeição explícita) | 0 |
| `overstack < generation` (inconsistência) | 0 |

Nenhum par teve rejeição explícita. Isso é compatível com o simulador "com ID", que não registra rejeições, mas não prova isso. Também não prova que o excesso real é zero.

## 3. `outgoing` × `overstack + wasted` (não é uma identidade)

Resíduo relativo = (`outgoing` − (`overstack` + `wasted`)) ÷ `outgoing`, só com `outgoing` > 0,005.

- **Geral (1.637 pares):** mediana 0,0000; 72,8% dentro de ±1%; 78,7% dentro de ±5%. O volume é **maior** que `overstack + wasted` em 26,6% dos pares e **menor** em 0,5%.
- **Fecham bem** (≥ 91% dentro de ±1%): Superspeed, Resistance, Quickness, Vigor, Stability (80%) e as auras.
- **Divergem com frequência** (pares com |resíduo| > 5%): Might 23%, Protection 28%, Resolution 25%, Aegis 22%, Fury 39%, Regeneration 27% e **Swiftness 60%** (mediana +10,6%).
- **Swiftness** chega a ter volume muito acima da soma: por exemplo, geração 0,533 e volume 12,808.
- **Causa:** não identificada. Está no EVTC e no simulador, não no JSON agregado.

Nos 10 boons que o site guarda, **a geração nunca passou do volume** (0 casos).

## 4. O que a "perda registrada" (`wasted`) é na prática

- **Aegis:** mediana de `generation ÷ outgoing` = **0,22**. Mais de 3/4 do volume de Aegis aparece como perda registrada, em 86 de 107 pares. É compatível com a leitura da auditoria: a Aegis é consumida ao bloquear um ataque, e isso entra como remoção.
- **Outros boons:** a perda aparece em 61% a 80% dos pares de Stability, Might, Protection, Resolution, Fury e Aegis.
- **Conclusão:** `wasted` não mede "jogar tudo de uma vez". O agregado não separa strip inimigo, substituição, bloqueio e jogada cedo demais.

## 5. Métrica que usamos × métrica recomendada

- **BVU** = `generation ÷ outgoing` (a que o site usa hoje).
- **ABU** = `generation ÷ (overstack + wasted)` (recomendada pela auditoria como principal).
- Como `overstack == generation`, a ABU vale `generation ÷ (generation + wasted)`.

| Boon | BVU mediana | ABU mediana | pares com ABU maior que BVU em >5 p.p. |
|---|---:|---:|---:|
| Stability | 0,89 | 0,89 | 7 de 83 |
| Might | 0,77 | 0,84 | 36 de 175 |
| Protection | 0,83 | 0,88 | 33 de 132 |
| Resolution | 0,79 | 0,87 | 27 de 112 |
| Fury | 0,81 | 0,94 | 51 de 144 |
| Aegis | 0,22 | 0,24 | 20 de 107 |
| Quickness, Superspeed | 1,00 | 1,00 | 2 e 3 |

- A diferença mediana entre as duas é próxima de zero, mas num quarto dos casos de Might, Protection, Resolution e Fury a ABU é bem maior.
- Quanto às posições: a correlação entre os rankings por BVU e por ABU, por jogador e luta, foi baixa (0,68 em Stability e 0,58 em Might). Muitos pares ficam perto de 1,0 e empatam, o que aumenta o ruído. É um indício, não uma conclusão.

## 6. Outras verificações

- **HTML do EI × JSON:** a geração Squad (`generation`, `overstack`, `wasted`) coincide em 1.878 de 1.886 células (99,6%), e o volume em 13.309 de 13.318. As 8 divergências têm zeros no HTML e valores no JSON. Podem ser um segundo registro da mesma conta, que o meu cruzamento por conta não separa. Não confirmei.
- **Active × fase inteira:** os denominadores são diferentes. A razão entre a geração Active e a da fase inteira tem mediana 1,127, e a do volume 1,007. Em 89% dos pares as duas razões diferem em mais de 0,02. **Não misturar** variantes Active e de fase inteira. O site usa só a fase inteira para volume e geração.
- **Extensões:** `byExtension` > 0 em 77 pares, `outgoingByExtension` > 0 em 79, `extended` > 0 em 291 e `unknownExtended` > 0 em 149. O site não soma esses campos, então não há contagem dupla.
- **Volumes enormes:** nenhum volume de escopo Squad passou de 1.000. (O HTML tem um valor de 18 milhões em outra tabela, fora do que o site lê.)
- **Escala da geração:** intensidade (Stability, Might) fica entre 0 e 1,2 pilhas médias. Duração (Quickness, Protection, Fury etc.) vai até cerca de 16 (percentual do tempo). O site mostra os dois com 2 casas e sem unidade.

## 7. Peso da média entre lutas (hipótese N2)

Comparei o peso atual (tempo ativo da fonte) com o peso da auditoria (duração da fase × destinatários, com N = squad − 1), agregando por conta nos 20 logs.

| Boon | Spearman dos rankings | top 5 em comum | maior diferença de valor |
|---|---:|---:|---:|
| Stability | 0,990 | 4 de 5 | 24,8% |
| Might | 0,995 | 5 de 5 | 33,6% |
| Protection | 0,992 | 5 de 5 | 27,3% |
| Resolution | 0,985 | 5 de 5 | 24,8% |
| Fury | 0,992 | 5 de 5 | 24,8% |
| Aegis | 0,997 | 5 de 5 | 24,8% |

- **Efeito prático:** o valor muda até 25% a 34%, mas o ranking quase não muda. A eficiência muda no máximo 0,021 (absoluto).
- **Razão dos totais × média das razões:** a média simples das razões por luta difere da razão dos totais em mediana 0,046 (Stability) e 0,053 (Might), com máximo de 0,235. **Manter a razão dos totais**, como o site faz.
- **Limite:** o N do squad foi aproximado pela contagem de jogadores no squad, e a amostra é de uma noite.

## 8. Conclusões

**Confirmado nos dados**
1. `overstack == generation` em 100% dos pares: sem rejeição explícita observada.
2. `outgoing` ≈ `overstack + wasted` na mediana, mas não é identidade: 26,6% dos pares têm volume maior.
3. O HTML oficial mostra os mesmos valores do JSON.
4. Variantes Active têm denominadores diferentes das de fase inteira.
5. A perda registrada é grande onde o boon é consumido por design (Aegis: mediana de 78% do volume).
6. A geração nunca superou o volume nos 10 boons do site.

**Hipóteses (sem prova)**
- O simulador usado é o "com ID". Compatível, não provado.
- As causas dos desvios de Swiftness, Fury, Regeneration, Might e Protection (divergências de borda de fase, aplicações longas, extensões, remoções sem waste).
- ABU como indicador melhor que BVU para ordenar jogadores.

**Recomendações para o plano**
- Etapa 1 (nomes e textos): confirmada, com mais força. A "perda registrada" não pode ser descrita como excesso nem como erro do jogador.
- Etapa 3 (guardar `overstack` e `wasted`): necessária para calcular a ABU. A rejeição `overstack − generation` pode ser guardada como número próprio, hoje sempre zero.
- Etapa 4 (peso da média): de baixa prioridade, porque o ranking quase não muda.

## 9. Limites

- Uma noite, um clã. Falta validar em outras composições, durações e pressão inimiga.
- Não foi possível instrumentar o EI para ver o simulador e os acumuladores antes do arredondamento.
- Não comparei com wvw.bel.st nem com GW2 Mists.
- Swiftness, Fury, Regeneration, Might e Protection têm desvios sem causa conhecida.
