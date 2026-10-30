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
