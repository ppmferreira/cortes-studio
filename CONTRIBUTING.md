# Como contribuir

Obrigado por querer ajudar! O Cortes Studio é um projeto aberto (licença MIT).

## Antes de começar

1. Leia [`docs/README.md`](docs/README.md): a documentação é a fonte de verdade (arquitetura, pipeline, API, painel).
2. Rode o projeto: `instalar.bat` (primeira vez) e `iniciar.bat`. Requisitos: Windows, Python 3.10+, Node.js 20+, ffmpeg e, para a transcrição rápida, uma GPU NVIDIA.
3. Para o painel com recarga automática: `python servidor.py` e, em outro terminal, `cd frontend && npm run dev`.

## Regras para um pull request

- **Atualize `docs/`** junto com a mudança (rota → `api.md`, etapa → `pipeline.md`, tela → `frontend.md`, configuração → `configuracao.md`) e adicione uma linha em `docs/changelog.md`.
- `cd frontend && npm run build` precisa passar (ele roda o `tsc`).
- Teste de verdade: chame a rota ou abra a tela. Para o Claude, prefira uma versão simulada nos testes em vez de gastar o plano de alguém.
- Interface, mensagens e documentação em português do Brasil.
- **Nunca** inclua no PR: vídeos, transcrições, `config.json`, `templates.json`, `chave_api.txt`, logos pessoais, nomes ou trechos de episódios de terceiros. Eles já estão no `.gitignore`; confira com `git status`.
- Mudanças grandes: abra uma *issue* antes para combinarmos a direção.

## Segurança

Achou uma falha? Veja [`SECURITY.md`](SECURITY.md) e **não** abra uma *issue* pública com detalhes explorável.
