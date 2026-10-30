# Licença, dependências e direitos autorais

## Licença do projeto

**MIT** (arquivo `LICENSE`, na raiz). Qualquer pessoa pode usar, copiar, modificar e distribuir, inclusive comercialmente, mantendo o aviso de copyright e a licença. O software é fornecido "como está", sem garantia.

## Dependências (todas com licenças permissivas)

Conferido em 2026-10-30 nos metadados das versões instaladas. Elas **não são redistribuídas** neste repositório: são instaladas por `instalar.bat` / `pip` / `npm`.

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| faster-whisper | 1.2.1 | MIT | Transcrição |
| ctranslate2 | 4.8.4 | MIT | Motor do Whisper |
| av (PyAV) | 15.1.0 | BSD-3-Clause | Leitura de áudio |
| fastapi | 0.162.0 | MIT | API |
| starlette | 1.10.0 | BSD-3-Clause | Base do FastAPI |
| pydantic | 2.14.1 | MIT | Validação |
| uvicorn | 0.54.0 | BSD-3-Clause | Servidor |
| python-multipart | 0.0.32 | Apache-2.0 | Upload |
| anthropic | 2.3.0 | Apache-2.0 | SDK do Claude (modo chave de API) |
| yt-dlp | 2026.10.26 | Unlicense | Importar por link |
| pillow | 13.0.0 | MIT-CMU | Logo |
| psutil | 7.2.2 | BSD-3-Clause | Cancelar processos |
| react, react-dom | 19.3.1 | MIT | Painel |
| vite, @vitejs/plugin-react | 8.3.5 / 6.1.2 | MIT | Build do painel |
| typescript | 7.0.2 | Apache-2.0 | Build do painel |

Programas externos, chamados como processos e **não incluídos**:

- **ffmpeg/ffprobe** — instalado à parte (`winget install Gyan.FFmpeg`). A licença depende do build (o da Gyan é GPL); como o projeto só executa o programa e não o distribui, a licença do ffmpeg não se estende ao código daqui.
- **Claude Code** (`claude`) — produto da Anthropic, com termos próprios, usado para entrar com a conta do usuário.
- **Modelos do Whisper** (pesos da OpenAI, MIT) — baixados no primeiro uso.

## Sem vínculo com empresas

Este projeto é independente. Não é afiliado, patrocinado nem endossado pela Anthropic, OpenAI, Google/YouTube, TikTok ou Meta. "Claude", "YouTube Studio" e demais nomes pertencem aos seus donos; o visual do painel é apenas inspirado no YouTube Studio e não usa seus arquivos, logotipo ou código.

## Direitos autorais do conteúdo (leia antes de usar)

O software processa episódios que **você** fornece. Ele **não inclui** nem distribui nenhum conteúdo de terceiros.

- Cortar, legendar e publicar um podcast que não é seu, ou sem autorização, pode violar direitos autorais e as regras das plataformas (strikes e remoção de canais).
- A importação por link usa o yt-dlp. Respeite os termos de uso do site de origem e baixe apenas conteúdo seu ou autorizado.
- A análise de viralização é uma estimativa feita por IA, sem dados reais das plataformas, e não garante resultado.
- Quem usa o software é o responsável pelo que processa e publica.
- Não envie ao repositório vídeos, transcrições, logos ou trechos de episódios de terceiros (o `.gitignore` já exclui essas pastas).

## Dados pessoais no repositório

Commits públicos mostram o nome e o e-mail do autor. Configure o Git com o e-mail de privacidade do GitHub (`<id>+<usuário>@users.noreply.github.com`) antes de publicar. Veja [github.md](github.md).
