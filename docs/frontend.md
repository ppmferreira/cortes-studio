# Painel (frontend)

React 19 + TypeScript + Vite, sem bibliotecas de UI. Código em `frontend/src`. Em produção o FastAPI serve `frontend/dist`; depois de mudar o painel rode `npm run build` dentro de `frontend/` e recarregue a página (não precisa reiniciar o servidor).

```
frontend/src/
  main.tsx, App.tsx          raiz: estado global, rotas, diálogos e cartões flutuantes
  api.ts, types.ts, hooks.ts cliente HTTP tipado, tipos, hooks (job, tema, rota, toast)
  lib/logo.ts                posição da logo (igual a cortes.py::posicao_logo)
  ui/                        kit de componentes: kit.tsx, Icon.tsx, Confirm.tsx
  components/                peças reutilizáveis
  pages/                     Painel, Conteudo, Editor, Videos, Configuracoes
  styles/                    tokens.css, base.css, ui.css, app.css, editor.css, templates.css
```

## Páginas (rota por hash: `#/painel`, `#/conteudo`, `#/editor`, `#/videos`, `#/config`)

| Página | O que mostra |
|---|---|
| `Painel` | Cartões estilo YouTube Studio: último episódio, processamento, estatísticas, vídeos gerados, conexão com o Claude |
| `Conteudo` | Tabela de episódios (miniatura, status, cortes, vídeos); a busca do topo filtra |
| `Editor` | Player, linha do tempo com alças, ajuste fino, detalhe do corte, prévia 9:16, painel lateral (Cortes · Transcrição · Processo · Vídeos) |
| `Videos` | Biblioteca: filtros por estado, ordenação (inclui maior potencial viral), agrupar por episódio, texto da postagem e cópia |
| `Configuracoes` | Abas: Templates (prompts) · Geração e vídeo · Marca e conta |

## Componentes principais

- `GerarDialog` — janela **Gerar**: um episódio ou vários; usar os cortes existentes ou pedir cortes ao Claude (quantidade, duração, template como ponto de partida do prompt, manter/substituir cortes atuais); formato e legenda. Devolve um `Pedido` (`cortes` | `claude` | `lote`).
- `Track` — régua + blocos de corte + alças arrastáveis (pointer events). Usada na linha do tempo geral e no ajuste fino.
- `Previa` — desenha o `<video>` do editor num `<canvas>` 9:16 com o mesmo enquadramento, legenda palavra por palavra e logo da geração.
- `ViralCard` / `NotaChip` — nota 0–10, critérios com barra e justificativa, pontos fortes, melhorias, título alternativo.
- `TranscreverBanner` — convite para transcrever e, depois, a barra de progresso ao vivo.
- `JobCard` — cartão fixo (canto inferior esquerdo) do processo em andamento, com cancelar.
- `ProcessPanel` — etapas, progresso total e por etapa, log, cancelar.
- `Short` — cartão de vídeo pronto (player, título, descrição, tags, copiar, baixar, excluir).
- `TemplateDialog`, `EnviarDialog`, `Dialogs` (conta Claude) — janelas de formulário.
- `ui/Confirm` — `usePerguntar()` / `useConfirmar()`: confirmações próprias (nunca `confirm()` do navegador).

## Padrões

- **Estado global em `App`:** `estado` (de `GET /api/estado`), episódio selecionado (`localStorage.ep`), diálogos, upload/importação. `useJob` consulta `/api/job` a cada 1 s com processo rodando, 3 s parado, e chama `carregar()` quando o processo termina.
- **Cortes são editados localmente** no `Editor` e só vão ao servidor em **Salvar** (ou ao abrir *Gerar*, que salva antes). Remover um corte com vídeo pergunta se o vídeo também será apagado (aplicado no salvamento).
- **Atalhos do editor:** Espaço, ← →, I, O, N, S (dividir o corte no ponto atual).
- **Tema** claro/escuro por `data-theme` no `<html>`, definido por script inline em `index.html` (evita flash) e persistido em `localStorage.tema`.
- **Idioma:** textos da interface e nomes de variáveis em português.

## Design system (`styles/tokens.css`)

Inspirado no YouTube Studio. Três camadas: primitivos (escala de 4 px, raios, tipografia, movimento, z-index), semânticos (`--bg`, `--surface-1/2/3`, `--text-1/2/3`, `--border`, `--hover`, `--brand`, `--link`, `--success`, `--warning`, `--danger`) e componentes (`ui.css`, `app.css`, `editor.css`, `templates.css`). Todo componente usa tokens, nunca cores soltas (exceção: as cores das notas de viralização). `prefers-reduced-motion` zera as durações.

## Vídeos longos e thumbnails

- `GerarDialog`: seletor **Shorts (9:16) | Vídeos longos (16:9)** nas opções do Claude (muda os padrões para 3 vídeos de 480 a 1500 s e esconde as opções de formato/legenda).
- `ThumbDialog`: canvas 1280×720 que desenha um quadro do vídeo do episódio (`<video>` oculto em `/media/entrada`), degradê, texto em Impact e contorno. Salva por `api.salvarThumb` ou baixa o JPG. Aparece no `CutDetail` só para cortes `tipo === 'longo'`; nesses cortes o medidor de duração não alerta "fora do ideal".

## Criar cortes × gerar vídeos

- `GerarDialog` tem dois focos (prop `modoInicial`): `'claude'` = **Criar cortes com IA** (abas *Só este / Vários episódios*, seletor Shorts|Longos, template filtrado por tipo, prompt, quantidade e duração) e qualquer outro = **Gerar vídeos** (lista de cortes marcáveis e formato/legenda).
- `CorteIADialog`: *Pedir um corte ao Claude*: texto livre, tipo, template opcional (filtrado pelo tipo; o prompt vai junto com o pedido) e duração. Envia `qtd_cortes: 1`, `adicionar: true` e o pedido em `instrucoes_extras`. Salva antes o que estiver editado.
- Rodapé do editor: menu **Novo** (`.menu`, `.menu__lista`) com *Corte em branco* e *Pedir um corte ao Claude*.

A lista de cortes do `Editor` tem duas abas, **Shorts** e **Vídeos longos** (sempre visíveis, com contagem; `tipoLista`/`ordemLista`). Selecionar um corte troca para a aba dele; *Novo* cria o corte no tipo da aba. Os números continuam sendo os da posição no episódio. No `GerarDialog`, prompt novo/editado mostra *Guardar este prompt como template* (`api.criarTemplate`, depois `aoCriouTemplate`).

## Biblioteca (`pages/Videos.tsx`)

Abas `short | longo | thumbs` (o tipo vem de `status-render`: `tipo` e `thumb`). Cartões `.vcard` mostram um `<video preload="metadata" src="...#t=0.8">` mudo como pôster; só o `Detalhe` (janela) carrega o vídeo e toca. Filtros: estado, nota mínima, episódio, ordem e agrupar por episódio. Seleção em lote (`.batchbar`): baixar (um por vez, 500 ms entre cada), copiar textos, excluir. Thumbnails: `/media/saida/<ep>/thumb_<id>.jpg`, apagadas por `api.apagarThumb`.

A biblioteca tem dois modos (`modo`, salvo em `localStorage` como `videos_modo`): **Lista** (`.vrow`, padrão) e **Grade** compacta (`.vgrid--compacta`).

Lista de cortes: *Escolher quais* liga caixas de seleção (`paraAnalisar`) para analisar só alguns cortes; o botão de análise fica ativo mesmo com outro processo rodando (o pedido vai para a fila do servidor e o painel avisa).

## Editor enxuto, melhorar e aprendizado

Lista: `.listbar` (abas Shorts | Longos, *Criar com IA*, menu ⋯). Detalhe do corte: abas `sub` = Corte | Texto do post | Nota; *Melhorar com Claude* no topo; *Tirar trechos do meio* (`trechos`) na aba Corte. `Videos.tsx`: `FormResultado` (resultado depois de postar) no detalhe e `AprendizadoDialog` (botão *Aprendizado* no topo da biblioteca; atualiza a cada 3 s enquanto aberto).

`Track` desenha os trechos pulados de cada corte como `.track__gap` (hachurado). `lib/trechos.ts` tem `mantidos()` e `lacunas()`, usados também pelo `Editor`.

Editor: o ajuste fino tem foco (`focoFino`: tudo, começo, fim) e largura (`larguraFino`); `Track` aceita `marca`/`aoMarcar` (Shift + arrastar) e `aoRestaurar` (clique no buraco). A prévia do corte tem a barra `ScrubCorte`; o pulo dos buracos roda num laço `requestAnimationFrame` enquanto `tocando`.

Histórico de edição do `Editor`: `setCortes` empilha o estado anterior (`hist`, até 100 passos, 0,5 s para agrupar); `carregarCortes` carrega do disco e zera o histórico. `desfazer`/`refazer` ficam em Ctrl+Z / Ctrl+Y e nos botões do Ajuste fino. O buraco é devolvido pelo botão `.track__gapbtn` (`aoRestaurar`), visível ao passar o mouse.
