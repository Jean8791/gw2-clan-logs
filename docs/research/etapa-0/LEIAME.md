# Scripts da Etapa 0

Python 3, sem dependências. Geram os números de `../etapa-0-validacao-boons.md`.

1. Processe os logs com o Elite Insights 3.32 gerando JSON e HTML (`SaveOutJSON=true`, `SaveOutHTML=true`, `DetailledWvW=true`).
2. `EI_OUT=<pasta dos .json e .html> python3 etapa0.py` (resíduos, Active, extensões, escala; grava `/tmp/etapa0-rows.json`).
3. `EI_OUT=... python3 etapa0_html.py` (compara as células do HTML com o JSON).
4. `EI_OUT=... python3 etapa0_n2.py` (peso da média entre lutas).
5. `python3 etapa0_abu.py` (BVU × ABU; usa o arquivo gerado no passo 2).

Os logs e os JSON trazem nomes de jogadores: não os coloque no repositório.

6. `EI_OUT=... python3 etapa5.py` (viabilidade da camada tática: baixa os fatos das habilidades na API pública do GW2, liga habilidade a boon e compara a concentração dos usos de Stability com o aproveitamento; ver `../etapas-3-a-5-boons.md`).
