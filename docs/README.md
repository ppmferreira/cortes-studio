# Cortes Studio — documentação

Painel local que transforma episódios de podcast em cortes verticais (Shorts, Reels, TikTok): transcreve o áudio, o Claude escolhe os melhores trechos, o ffmpeg gera os vídeos com legenda, logo e velocidade, e o Claude estima o potencial de viralização de cada corte.

Projeto open source (licença MIT, veja `../LICENSE` e `../CONTRIBUTING.md`).

Tudo roda no computador do usuário (Windows, GPU NVIDIA para a transcrição). Não há servidor na nuvem: a única chamada externa é ao Claude (conta do usuário via Claude Code, ou chave de API) e ao YouTube, quando se importa um episódio por link.

> **Regra do projeto:** esta pasta é a fonte de verdade. Leia aqui antes de mexer no código e atualize aqui junto com cada alteração (veja `../CONTRIBUTING.md`).

## Índice

| Documento | Para que serve |
|---|---|
| [arquitetura.md](arquitetura.md) | Visão geral, componentes, pastas, onde fica cada dado |
| [pipeline.md](pipeline.md) | As etapas: transcrever, escolher cortes, analisar viralização, gerar vídeos, cancelar |
| [api.md](api.md) | Todas as rotas HTTP do backend (FastAPI) |
| [frontend.md](frontend.md) | Painel React: páginas, componentes, design system, padrões |
| [configuracao.md](configuracao.md) | `config.json`, templates, marca (logo), conta Claude / chave de API, formato dos arquivos de dados |
| [operacao.md](operacao.md) | Como ligar, parar, reiniciar com segurança, logs e solução de problemas |
| [github.md](github.md) | Como publicar o projeto no GitHub sem vazar segredos |
| [licencas-e-direitos.md](licencas-e-direitos.md) | Licença MIT, licenças das dependências, aviso de direitos autorais |
| [decisoes-e-limites.md](decisoes-e-limites.md) | Por que as coisas são como são e o que ainda não funciona |
| [changelog.md](changelog.md) | Histórico de mudanças |

## Em uma frase por arquivo

- `servidor.py` — API FastAPI, controla o job em segundo plano e serve o painel compilado.
- `cortes.py` — o pipeline (e uma CLI): transcrição, seleção pelo Claude, análise viral, render com ffmpeg.
- `frontend/` — painel React + TypeScript (Vite), compilado em `frontend/dist`.
- `iniciar.bat` — liga o servidor; `instalar.bat` — instala dependências; `rodar.bat` — pipeline pela linha de comando.
