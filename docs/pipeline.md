# Pipeline

Código em `cortes.py`. O servidor chama estas funções em `_rodar_etapas()` (`servidor.py`).

| Etapa (API) | Função | O que faz |
|---|---|---|
| `transcrever` | `transcrever()` | Áudio → texto com tempo por palavra |
| `selecionar` | `selecionar()` | Claude escolhe os cortes |
| `cortes` | transcrever + selecionar | Atalho: tudo menos gerar vídeos |
| `cortar` | `cortar()` | Gera os vídeos (ffmpeg) |
| `analisar` | `analisar_cortes()` | Nota de potencial viral por corte |
| `tudo` | as três primeiras + `cortar` | Fluxo completo |

Cada etapa chama `progresso(pct, detalhe)`, que alimenta a barra do painel **e** é o ponto onde o cancelamento é conferido.

## 1. Transcrever

- Modelo `faster-whisper` (`modelo_whisper`, padrão `medium`), GPU `float16`; se a GPU falhar, cai para CPU `int8`.
- `word_timestamps=True`, `beam_size=5`, idioma `idioma` (padrão `pt`), `vad_filter=True` na primeira passada.
- **Checkpoint:** a cada `PARCIAL_A_CADA` (90 s) grava `transcricao.parcial.json`. Se existir ao iniciar, retoma de `fim` do último segmento usando `clip_timestamps=[inicio]`. Ao retomar o VAD não roda (limite do faster-whisper: o VAD só vale sem `clip_timestamps`).
- Ao terminar grava `transcricao.json` e `transcricao.txt` e apaga o parcial.
- Se `transcricao.json` já existe, a etapa é pulada.
- Dependência de CUDA: o servidor adiciona ao `PATH` as DLLs de `.venv/Lib/site-packages/nvidia/*/bin`.

## 2. Escolher cortes (`selecionar`)

1. Garante a transcrição.
2. Monta o prompt (`PROMPT`) com a transcrição (`[inicio-fim] texto`), a quantidade, a duração mínima/máxima e o **prompt do template** (`instrucoes_extras`).
3. Chama o Claude por `consultar_claude(prompt, cfg, modo)`:
   - **`conta`** (preferido, sem chave): executa `claude -p --output-format json --tools "" --no-session-persistence --system-prompt ... --disable-slash-commands --strict-mcp-config --setting-sources ""` com o prompt na entrada padrão. Esses flags reduzem a sobrecarga de ~56 mil para ~150 tokens. Timeout de 15 min.
   - **`api`**: SDK `anthropic`, modelo `modelo_claude`, `max_tokens=8000`.
   - `modo_claude()` devolve `api` se existir `ANTHROPIC_API_KEY`, senão `conta` se `claude auth status` indicar login, senão `None` (erro explicando como conectar).
4. Extrai o JSON (primeiro `[` até o último `]`), encaixa início/fim nas palavras (`ajustar_limites`, com `folga_inicio` e `folga_fim`), atribui `id` e `velocidade` (`velocidade_padrao`).
5. **Modo adicionar** (`cfg["adicionar"]`): mantém os cortes atuais, informa ao Claude os trechos já usados e descarta qualquer corte novo que se sobreponha a um existente por mais de 1 s. Sem isso, a etapa só roda se não houver `cortes.json` (ou se `refazer`, que o apaga antes).

## 3. Analisar potencial viral (`analisar_cortes`)

- Processa os cortes sem análise ou com hash desatualizado (ou os `ids` pedidos), em **lotes de 5** por chamada ao Claude.
- O Claude avalia 5 critérios, com nota inteira 0–10 e justificativa: `gancho`, `retencao`, `emocao`, `clareza`, `compartilhavel`. O prompt exige calibração crítica (5 = mediano; 8+ raro).
- O sexto critério, **`plataforma`** (duração final e palavras por segundo), é calculado em código por `criterio_plataforma()` e não pelo Claude.
- **Nota final = média ponderada** (`PESOS_VIRAL`): gancho 25, retenção 20, emoção 15, clareza 15, compartilhamento 15, plataforma 10. Arredondada a 1 casa.
- Veredito: ≥8 Alto potencial · ≥6,5 Bom · ≥5 Mediano · abaixo Baixo.
- Cada análise grava também resumo, pontos fortes (até 3), melhorias (até 3), título alternativo e o aviso de que é uma estimativa de IA sem dados reais de plataforma.
- Resultado em `analises.json`, salvo a cada lote.

## 4. Gerar vídeos (`cortar`)

- `ids` informado → refaz só esses cortes. Sem `ids` → gera os que não têm vídeo ou cujo hash mudou.
- Antes de refazer um corte, apaga a versão anterior **dele** (`.mp4`, `.ass`, `.txt`); os outros não são tocados.
- Filtro do ffmpeg (`filtro_video` + `extras_do_filtro`), nesta ordem: base → velocidade → logo → legenda.
  - **Vertical 1080×1920:** fundo = vídeo ampliado e borrado; frente = vídeo na largura total, centralizado.
  - **Horizontal 1920×1080:** escala com barras (`pad`).
  - **Velocidade:** `setpts=PTS/v` no vídeo e `atempo=v` no áudio (tom preservado). Faixa 0,5–2,0.
  - **Logo:** segunda entrada do ffmpeg, `scale` + `colorchannelmixer=aa` (opacidade) + `overlay`. Posição calculada por `posicao_logo()` (`topo-centro` fica no meio da faixa desfocada, quando cabe). A mesma lógica existe em `frontend/src/lib/logo.ts` para a prévia.
  - **Legenda:** arquivo ASS gerado por `gerar_ass()`, blocos de N palavras em maiúsculas, tempos já divididos pela velocidade. Posição, fonte, cor e tamanho vêm da configuração.
  - Áudio-only: gera um fundo preto 1080×1920 e aplica os mesmos efeitos.
- Codificação: `libx264 -crf 20 -preset medium -pix_fmt yuv420p`, `aac 160k`, `+faststart`.
- Nome do arquivo: `NN_<slug do título>_<id>.mp4`, onde `NN` é a posição do corte na lista no momento da geração.
- Ao concluir, grava em `renders.json` `{id: {arquivo, hash, titulo}}`.

## Configuração efetiva de uma execução

`config_do_episodio(video, template)` = `config.json` (com padrões) + **prompt** do template escolhido em `instrucoes_extras`. Os ajustes pontuais da janela *Gerar* (`opcoes`) são mesclados por cima e valem só para aquela execução. Veja [configuracao.md](configuracao.md).

## Cancelamento

`POST /api/job/cancelar` liga `cortes.CANCELAR` (um `threading.Event`) e encerra, com `psutil`, os processos filhos `claude`, `ffmpeg` e `ffprobe`. `progresso()` e as chamadas externas conferem o evento e abortam com `SystemExit("Cancelado pelo usuário.")`. A transcrição para no próximo segmento (segundos); o que já estava salvo é mantido.

## Vários episódios

`executar_lote()` roda episódio por episódio (`transcrever` → `selecionar` → `cortar`, ou sem `cortar` se `gerar_videos=false`). Um erro em um episódio não interrompe os outros; os erros são reunidos em `JOB["erro"]`. O progresso total considera `lote.i / lote.n`.

## Importar por link

`_baixar()` usa `yt-dlp` (até 1080p, `mp4`) e grava em `entrada/<título>.mp4`, com progresso em `IMPORT`. Só aceita `http://` e `https://`.

## Vídeos longos (`tipo_corte = "longo"`)

Usa `PROMPT_LONGO` no lugar de `PROMPT`: capítulos completos (começo, meio e fim), sem sobreposição, e o Claude devolve também `thumb: {linha1, linha2}` (textos curtos em maiúsculas). Os cortes ganham `tipo: "longo"` e velocidade 1×. Em `cortar`, `cfg_do_corte()` força `formato = horizontal` e `legendas = legendas_longo` (padrão `false`); o ffmpeg usa `-preset veryfast` para não demorar em vídeos de 20 min. Cortes `short` e `longo` convivem no mesmo episódio. Não há limite de duração além dos 1800 s da API de opções.

## Escolha de cortes em episódios longos

`selecionar` usa `texto_compacto()` (blocos de ~25 s, tempos inteiros) e `janelas_do_episodio()`: episódios com mais de ~50 min são divididos em janelas de ~40 min, com sobreposição de até 3 min, cada uma enviada em uma chamada `claude -p` (até 4 em paralelo, `ThreadPoolExecutor`). `dividir_cotas()` reparte `qtd_cortes` entre as janelas; se `qtd_cortes` for menor que o número de janelas, cada janela procura 1 e pode responder `[]`. Depois de `ajustar_limites`, cortes que se sobrepõem (mais de 1 s) são descartados. Cada chamada tem timeout de 900 s.

Análise viral: lotes de 3 cortes, até 4 em paralelo (`ThreadPoolExecutor`), `--effort` = `esforco_analise` (padrão `low`). O progresso mostra quantos lotes já voltaram; os resultados são gravados na ordem dos cortes.

## Análise por tipo e filtro por nota

`analisar_cortes` separa os cortes por `tipo`: `short` usa `PROMPT_VIRAL` e a régua de duração de Shorts (melhor faixa 15 a 45 s); `longo` usa `PROMPT_VIRAL_LONGO` e a régua de vídeos longos (melhor faixa 8 a 25 min, pontos: até 3 min = 3, até 6 = 5, até 8 = 7, até 25 = 10, até 35 = 8, até 60 = 6, acima = 4). Os nomes dos critérios gravados em `analises.json` também mudam por tipo. Com `filtrar_por_nota`, `selecionar` pede `2 × qtd_cortes` (máx. 30), grava, chama `filtrar_por_nota()` (analisa só os novos, descarta os abaixo de `nota_minima`, mantém até `qtd_cortes` pela nota e remove do `cortes.json` e do `analises.json` os descartados).

## Trechos removidos, melhorar e aprender

- **`trechos`:** `trechos_de(c)` devolve as partes mantidas (padrão: o corte inteiro). Em `cortar`, com mais de uma parte o ffmpeg usa `-ss/-t` do corte e, dentro do filtro, `trim`/`atrim` + `concat` por parte, antes de velocidade, logo e legenda. A legenda usa `palavras_virtuais()` (linha do tempo contínua). Duração = `duracao_efetiva()` (soma das partes) dividida pela velocidade; entra em `hash_render`, `hash_analise` e no critério de formato.
- **`melhorar_cortes`:** para cada corte, um pedido ao Claude (até 3 em paralelo) com o corte, as *melhorias* da análise e a transcrição em blocos de 10 s com margem (45 s em shorts, 120 s em longos). A resposta (`ajustar` ou `dividir`) vira cortes novos (limites encaixados nas palavras), analisados em seguida. `opcoes.substituir` remove o original.
- **`aprender`:** reúne os resultados de `desempenho.json` (mínimo 3 com visualizações), calcula a correlação local (Pearson, nota prevista × log das views) e pede ao Claude até 8 lições, gravadas em `licoes.json`. `licoes_para_prompt()` acrescenta as lições (do tipo certo) aos prompts de `selecionar` e de análise. Elas orientam, não mudam a régua dos critérios.
