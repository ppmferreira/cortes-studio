# Changelog

Formato: data · o que mudou. Mais recente primeiro. Atualize junto com cada alteração.

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
