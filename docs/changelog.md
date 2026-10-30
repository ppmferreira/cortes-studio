# Changelog

Formato: data · o que mudou. Mais recente primeiro. Atualize junto com cada alteração.

## 2026-10-30 (README comercial)
- `README.md` reescrito como apresentação do produto: proposta de valor, recursos (Shorts, vídeos longos, thumbnails, editor, nota viral, aprendizado), fluxo, início rápido, stack e limites. O passo a passo da linha de comando e a tabela do `config.json` saíram do README (continuam em `docs/configuracao.md` e `docs/operacao.md`).

## 2026-10-30 (gerar só este vídeo e thumbnail viral com IA)
- **Gerar este vídeo:** botão no detalhe do corte que renderiza só aquele corte (salva antes o que estiver editado) e mostra o progresso na aba *Processo*.
- **Thumbnail viral (IA):** o Claude lê o título, a descrição, o motivo, a nota e o texto falado do corte e sugere **3 variantes** de texto (duas linhas curtas em maiúsculas, com o gatilho de cada uma) e o **melhor momento** para o quadro. O editor de thumbnail abre já com a primeira variante e o quadro escolhido; dá para trocar de opção, ajustar zoom e salvar. Rota `POST /api/episodios/{ep}/thumb-ia/{id}`. Não gera arte nem recorta pessoas.

## 2026-10-30 (trechos clicáveis, cabeça arrastável e atalhos)
- **Trechos clicáveis no Ajuste fino:** clicar numa parte mantida ou num buraco o seleciona. Uma barra de ação aparece com **↺ Devolver ao corte** (buraco) ou **Tirar do corte** (parte). As **bordas das partes são arrastáveis** (alças amarelas) para aumentar ou diminuir cada trecho, sem passar do vizinho. Partes coladas (menos de 0,3 s entre elas) viram uma só.
- **Cabeça de reprodução arrastável** (o ponto branco) nas duas linhas do tempo: arrastar move o vídeo.
- **Atalhos novos:** `[` e `]` marcam o começo e o fim de um trecho a tirar, `X`/`Delete` tira, `D` devolve o buraco selecionado, `Esc` limpa, `Home`/`End` vão ao começo/fim do corte, `M` melhora com o Claude, `?` abre a lista completa. A linha de atalhos ficou compacta, com o botão *Todos os atalhos*.

## 2026-10-30 (desfazer e refazer)
- **Ctrl+Z / Ctrl+Y** (e os botões *Desfazer* / *Refazer* no Ajuste fino) desfazem e refazem qualquer edição dos cortes no editor: limites, velocidade, trechos tirados, dividir, remover, novo, texto. Até 100 passos; edições seguidas em menos de 0,5 s (arrastar uma alça) contam como um passo. O histórico zera ao salvar, recarregar ou trocar de episódio. Nos campos de texto vale o desfazer do navegador.
- **Devolver um buraco** agora é pelo botão **↺ devolver**, que aparece ao passar o mouse no buraco do Ajuste fino. Clicar no buraco não faz mais nada (antes, um clique ao tentar selecionar ou arrastar o corte desfazia os trechos tirados). A devolução também pode ser desfeita com Ctrl+Z.

## 2026-10-30 (edição do corte mais fácil)
- **Barra de avançar na prévia do corte** (`ScrubCorte`): posição dentro do vídeo final (sem os buracos), com −15 s, −5 s, +5 s e +15 s. Dá para pular para qualquer ponto sem rever tudo.
- **Pulo dos buracos a cada quadro** (`requestAnimationFrame`), em vez do evento `timeupdate`: o salto fica mais perto do ponto exato. Ainda pode haver uma pequena pausa se o destino não estiver em buffer.
- **Ajuste fino com foco:** *Corte todo / Começo / Fim* e *± zoom* mostram só a borda que você quer ajustar (±30 s por padrão).
- **Marcar trecho arrastando:** `Shift` + arrastar na faixa do ajuste fino marca um pedaço (azul) e abre *Tirar trechos do meio* com os tempos preenchidos. O botão **↺ devolver** num buraco o devolve ao corte.
- Passos de início/fim nos vídeos longos: −30, −5, −1, +1, +5, +30 s.

## 2026-10-30 (logo nos vídeos longos e detalhe do corte)
- **A prévia do corte pula os trechos tirados**, como o vídeo final (*Ver como vai ficar*, *Início* e *Final* no editor). Só vale durante a prévia do corte; o player normal do episódio continua tocando tudo.
- **Buracos visíveis na linha do tempo:** os trechos tirados do meio de um corte aparecem hachurados no corte (linha do tempo e ajuste fino), então dá para ver o que o vídeo final pula (`lib/trechos.ts`, `.track__gap`).
- **Logo própria para vídeos longos (16:9):** `logo_posicao_longo` (padrão topo à direita; também topo à esquerda, base à esquerda ou base à direita) e `logo_tamanho_longo` (padrão 9% da largura), em *Configurações → Marca*, com prévia. Os shorts continuam com a posição e o tamanho de antes. A prévia do editor segue a mesma regra.
- **Detalhe do corte:** *Início/Final* e *Criar thumbnail* foram para o lado da prévia (maior nos vídeos longos); os trechos tirados aparecem como barra e etiquetas com **×** para descartar cada parte; campos arredondados.

## 2026-10-30 (editor mais enxuto, edição pelo Claude e aprendizado)
- **Editor enxuto:** a lista de cortes tem uma barra só (abas Shorts | Longos, *Criar com IA* e menu ⋯ com analisar pendentes, escolher quais e só nota ≥ meta); a linha mostra título, nota e duração; o detalhe do corte tem abas **Corte | Texto do post | Nota**; o player do episódio ficou mais baixo.
- **Tirar trechos do meio de um corte** (`trechos` em `cortes.json`): marca pedaços (tangente, pausa) que o vídeo final pula, com áudio, legenda e duração ajustados (ffmpeg `trim`/`atrim` + `concat`). A análise e o hash do vídeo consideram só as partes mantidas.
- **Melhorar com Claude** (etapa `melhorar`): lê o corte, a análise e a transcrição com margem e **ajusta** início e fim, **tira tangentes** e/ou **divide** em cortes independentes. Os novos entram depois do original (`melhorado_de`), são analisados na hora e o original é mantido ou substituído, à sua escolha. Funciona para shorts e para vídeos longos.
- **Aprendizado com resultados reais:** em *Vídeos gerados → detalhe* há *Resultado depois de postar* (plataforma, data, views, curtidas, comentários, compartilhamentos, retenção). *Aprendizado* na biblioteca mostra os resultados, a correlação local entre nota prevista e views e as **lições** que o Claude escreve a partir deles (etapa `aprender`, mínimo 3 vídeos). As lições entram como contexto nos prompts de escolha e de análise. Não treina o modelo.

## 2026-10-30 (notas: meta, análise por tipo e filtro)
- Detalhe do vídeo: botão **Tags com vírgula** (hashtags sem `#`, separadas por vírgula, no formato do campo de tags do YouTube).
- **Análise própria para vídeos longos** (`PROMPT_VIRAL_LONGO`): critérios de YouTube (abertura e promessa, retenção ao longo do vídeo, estrutura, potencial de clique) e duração ideal de 8 a 25 min no critério de formato. Antes os longos eram medidos como Shorts (ex.: nota 2 por "duração longa demais"). Lotes de 2 vídeos longos e 3 shorts; as análises antigas dos longos ficam como estão até serem refeitas (*Escolher quais* → *Analisar*).
- **Meta de nota viral** (`nota_minima`, padrão 7, em *Configurações → Padrões de geração*): no editor, cortes analisados abaixo da meta aparecem apagados e há o filtro **Só nota ≥ N**.
- **Ficar só com os bons:** em *Criar cortes com IA*, o interruptor *Ficar só com cortes de nota viral a partir de N* faz o Claude escolher o **dobro** de candidatos, analisa todos e mantém os melhores que chegarem à meta (`filtrar_por_nota`). Se nenhum chegar, mantém o melhor. A nota não é inflada: a régua é a mesma.

## 2026-10-30 (análise viral mais rápida)
- Corrigido: a prévia de um corte **longo** no editor aparecia em 9:16 com legenda (usava o formato global). Agora é 16:9, sem legenda.
- As notas são gravadas **assim que cada lote volta** (não só no fim) e o editor atualiza a lista a cada 2 s durante a análise, então dá para ir descartando ou separando cortes enquanto o resto ainda é analisado.
- `analisar_cortes` agora envia lotes de **3 cortes** (antes 5) e roda até **4 lotes ao mesmo tempo** (antes um depois do outro), com esforço `low` (`esforco_analise` no `config.json`, padrão `low`). Com 10 cortes, são 4 chamadas em paralelo em vez de 2 em sequência de 5, cada uma menor. Testado com Claude simulado.

## 2026-10-30 (Claude mais rápido)
- No modo conta, `claude -p` agora recebe `--model` (`modelo_claude`, padrão `claude-sonnet-5-5`) e `--effort` (`esforco_claude`, padrão `medium`). Antes não passava nenhum dos dois e usava o padrão da conta (modelo maior e raciocínio longo), o que deixava a escolha de cortes de episódios longos muito lenta. `esforco_claude` (`low`, `medium` ou `high`) pode ser mudado no `config.json`.

## 2026-10-30 (análise na fila e por seleção)
- **Analisar enquanto outro processo roda:** o pedido entra numa **fila** e começa sozinho quando o processo atual termina (`FILA` em `servidor.py`; só análises entram na fila; cancelar o processo limpa a fila; se o processo anterior terminar com erro, a fila é descartada). `GET /api/job` devolve `fila`.
- **Escolher quais cortes analisar:** botão *Escolher quais* na lista de cortes, com caixas de seleção, *Pendentes / Todos / Nenhum* e *Analisar N selecionados*. O botão padrão agora diz *Analisar pendentes (N)*.

## 2026-10-30 (escolha de cortes mais rápida)
- **Episódios longos são lidos em partes ao mesmo tempo:** acima de ~50 min, a transcrição é dividida em janelas de ~40 min (com 3 min no máximo de sobreposição) e até 4 chamadas ao Claude rodam em paralelo; a quantidade de cortes é repartida entre as partes e as repetições são removidas. Um episódio de 2h37 deixa de ser uma única leitura de ~70 mil tokens.
- **Transcrição enxuta no prompt:** blocos de ~25 s com tempo inteiro (`[inicio-fim] texto`) em vez de um tempo com decimais por frase (cerca de 25% menos texto).
- Pedido de poucos cortes (ex.: *Pedir um corte ao Claude*) em episódio longo: cada parte procura o seu e responde `[]` se não achar.

## 2026-10-30 (biblioteca de vídeos)
- Modo **Lista** (padrão: miniatura pequena, título, nota, trecho da descrição, copiar texto e baixar) e **Grade** compacta; a escolha fica salva no navegador.
- **Vídeos gerados** reformulada: abas **Shorts | Vídeos longos | Thumbnails**; cartões leves (pôster do vídeo sem carregar o arquivo inteiro, nota e duração sobre a imagem); clique abre o **detalhe** em janela (player, nota e motivo, descrição, hashtags, copiar, baixar, excluir); filtros por estado, nota mínima e episódio; **ações em lote** (selecionar, baixar, copiar textos, excluir).
- Vídeos longos mostram e editam a thumbnail dentro do detalhe (usa o mesmo `ThumbDialog` do editor).

## 2026-10-30 (reorganização do editor e templates)
- Lista de cortes com abas **Shorts | Vídeos longos** (sempre visíveis, com contagem). Na janela *Gerar vídeos* os longos têm o selo *Longo*.
- Em *Criar cortes com IA*, um prompt escrito ou editado pode ser guardado como template (campo de nome + *Salvar template*, no tipo escolhido).
- **Dois botões, duas tarefas:** *Criar cortes com IA* (escolha de cortes pelo Claude, um ou vários episódios) e *Gerar vídeos (N)* (só renderizar, com lista de cortes e formato). Antes, um único diálogo fazia as duas coisas.
- **Menu Novo:** *Corte em branco* ou *Pedir um corte ao Claude* (descreva o momento em texto; o Claude acha o trecho e o adiciona sem apagar os cortes existentes).
- **Templates por tipo** (`tipo: short|longo`): 13 prontos (8 de Shorts e 5 de vídeos longos) com prompts reescritos. O diálogo mostra só os templates do tipo escolhido e troca o prompt ao alternar Shorts/Vídeos longos. Templates do usuário têm campo *Serve para*.
- Corrigido: lista aberta dos `<select>` ilegível no tema escuro; cortes longos ganham selo *Longo* na lista.

## 2026-10-30 (vídeos longos e thumbnails)
- **Vídeos longos:** em *Gerar → Pedir cortes ao Claude* há a opção **Vídeos longos (16:9)**. O Claude escolhe capítulos de vários minutos (padrão 3 vídeos de 8 a 25 min) com título, descrição e textos sugeridos para a thumbnail. Cada corte ganha `tipo: "longo"`; o render é sempre 16:9, sem legenda queimada (a menos que `legendas_longo` seja ligado) e com `-preset veryfast`.
- **Thumbnails:** editor no painel (botão *Criar thumbnail…* nos cortes longos): quadro do próprio episódio, duas linhas em Impact (branca e amarela) com contorno, zoom e enquadramento. Salva em `saida/<ep>/thumb_<id>.jpg` (`PUT /api/episodios/{ep}/thumbs/{id}`) ou baixa o JPG.
- `hash_render` passou a considerar a configuração efetiva do corte (`cfg_do_corte`).

## 2026-10-30
- Repositório publicado como **público** no GitHub (MIT), com o e-mail de privacidade do GitHub nos commits.
- Projeto open source: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md` e `docs/licencas-e-direitos.md` (licenças das dependências e aviso de direitos autorais).
- Documentação completa em `docs/` e `.gitignore` para publicar no GitHub.
- Transcrição com **checkpoint** (`transcricao.parcial.json` a cada 90 s) e retomada automática após queda.
- `iniciar.bat` grava `logs/servidor.err.log` e liga `faulthandler`, para diagnosticar quedas.
- Filtro do log do asyncio para o ruído `ConnectionResetError` do Windows.
- Removida a pasta `web/` (primeiro painel em HTML único, substituído pelo React).

## 2026-10-29
- **Análise de potencial de viralização** (nota 0–10 por média ponderada, justificativa por critério, melhorias, título alternativo); selo da nota na lista de cortes e na biblioteca; ordenação por maior potencial.
- Banner "Transcrever este episódio" com porcentagem ao vivo; **cartão global do processo** (canto inferior esquerdo); **cancelar processo** (`POST /api/job/cancelar`, `psutil`).
- Templates passam a ser **só prompt**; quantidade e duração vão para a janela *Gerar* e para os padrões em Configurações. Modo "manter cortes e adicionar novos, sem repetir trechos".
- Confirmações próprias do painel (sem `confirm()` do navegador); biblioteca com filtros, ordenação, agrupamento e texto da postagem copiável.
- Importar episódio por link (yt-dlp); dividir corte no ponto atual (tecla S); logo da marca nos vídeos e na prévia.
- Gerar vídeos por seleção, vários episódios em lote, `renders.json` com hash por corte (só refaz o que mudou).

## 2026-10-28
- Pipeline inicial (`cortes.py`): transcrição com faster-whisper, escolha de cortes pelo Claude, render com ffmpeg em 9:16 com legenda palavra por palavra.
- Painel web: primeiro Flask + HTML, depois **FastAPI + React** no estilo YouTube Studio (Painel, Conteúdo, Editor, Vídeos, Configurações), tema claro/escuro, progresso por etapa com tempo restante.
- Editor: linha do tempo com alças arrastáveis, ajuste fino, atalhos, velocidade por corte (acelera sem mudar o tom), prévia 9:16 com legenda.
- Login com a conta Claude via Claude Code (alternativa à chave de API).
