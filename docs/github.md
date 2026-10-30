# Publicar no GitHub

## Onde estão os segredos (e por que não vão para o Git)

| Segredo | Onde fica | Está no repositório? |
|---|---|---|
| Login da conta Claude | `C:\Users\<você>\.claude\.credentials.json` (pasta do Claude Code, fora do projeto) | **Não**, nunca entra na pasta do projeto |
| Chave de API da Anthropic (`sk-ant-…`), se você colar uma | `chave_api.txt` na raiz do projeto | **Ignorado** pelo `.gitignore` |
| Variável `ANTHROPIC_API_KEY` | Variáveis de ambiente do Windows | Não é arquivo do projeto |
| Login do GitHub (para enviar o código) | Gerenciador de credenciais do Git / `gh auth login` | Não |

Verificado em 2026-10-30: não existe `chave_api.txt` no projeto, a variável `ANTHROPIC_API_KEY` não está definida e nenhum arquivo contém uma chave real (as únicas ocorrências de `sk-ant-…` são o texto de exemplo da tela de conexão e desta documentação). O painel hoje usa a conta Claude (via Claude Code), então não há chave de API para vazar.

## O que **não** deve ser publicado

`.gitignore` já exclui: `.venv/`, `frontend/node_modules/`, `frontend/dist/`, `entrada/` e `saida/` (vídeos, vários GB), `trabalho/`, `logos/`, `logs/`, `config.json`, `templates.json`, `chave_api.txt`, `__pycache__/`. GitHub recusa arquivos acima de 100 MB, e episódios de terceiros têm direitos autorais: não os publique.

## Passo a passo

1. Crie a conta em github.com (se não tiver) e instale o Git (já instalado) e o GitHub CLI (`gh`, já instalado).
2. Entre no GitHub pelo terminal: `gh auth login` → GitHub.com → HTTPS → "Login with a web browser". Isso guarda a sua credencial do **GitHub** no Windows; não tem relação com a chave do Claude.
3. Na pasta do projeto:
   ```
   git init
   git add .
   git status            # confira: não pode aparecer .venv, entrada, saida, chave_api.txt
   git commit -m "Primeira versão do Cortes Studio"
   gh repo create cortes-studio --private --source . --push
   ```
   O Cortes Studio foi publicado como **público** (licença MIT) em 2026-10-30, depois de revisar tudo. Para um projeto novo, prefira `--private` e só torne público depois de revisar.
4. Para enviar alterações depois: `git add .` → `git commit -m "..."` → `git push`.

## E-mail nos commits (repositório público)

Commits públicos mostram nome e e-mail do autor. O projeto usa o e-mail de privacidade do GitHub (`<id>+<usuário>@users.noreply.github.com`, em github.com/settings/emails). Configure uma vez por repositório: `git config user.email "<id>+<usuário>@users.noreply.github.com"`. Reescrever um commit já publicado não apaga o antigo na hora: ele pode continuar acessível pelo código (SHA) até o GitHub limpar.

## Conferir antes de enviar

- `git status` e `git ls-files` não podem listar `chave_api.txt`, `.venv`, `entrada`, `saida`, `trabalho`.
- Procure por chaves reais: `git grep -nE "sk-ant-[A-Za-z0-9_-]{20,}"` deve voltar vazio (o texto de exemplo `sk-ant-…` não casa).
- Se uma chave **já foi enviada**, apagar o arquivo não basta (o histórico guarda): revogue a chave em console.anthropic.com e gere outra.

## Quem clona o projeto precisa

Python, Node.js, ffmpeg (`winget install Gyan.FFmpeg`) e, para a transcrição rápida, uma GPU NVIDIA. Depois: `instalar.bat` e `iniciar.bat`. O ffmpeg, o yt-dlp e os modelos do Whisper **não** vão no repositório: são baixados na instalação e no primeiro uso.
