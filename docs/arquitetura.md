# Arquitetura

## Visão geral

```
 navegador (React, frontend/dist)
        │  HTTP (JSON)  +  /media (vídeo com suporte a Range)
        ▼
 servidor.py  ── FastAPI, porta 8765, só em 127.0.0.1
        │  1 thread em segundo plano por vez ("job")
        ▼
 cortes.py  ── pipeline
   ├─ faster-whisper (GPU)        transcrição com tempo por palavra
   ├─ claude -p  |  SDK anthropic  escolha de cortes e análise viral
   ├─ ffmpeg / ffprobe            cortar, acelerar, legenda, logo
   └─ yt-dlp                      importar por link (feito no servidor)
```

Decisões estruturais:

- **Um job por vez.** `servidor.py` mantém um dicionário global `JOB` e um `threading.Lock`. A GPU e a conta Claude são recursos únicos; tentar iniciar outro processo devolve `409`. A API de importação por link (`IMPORT`) tem estado próprio e roda em paralelo ao job.
- **O estado vive em arquivos**, não em banco. Reiniciar o servidor não perde dados já gravados, só o job em andamento.
- **O pipeline é independente do servidor.** `cortes.py` pode rodar sozinho (`python cortes.py ...`); o servidor só o chama em uma thread e lê o progresso por `cortes.PROGRESSO`.
- **O painel é estático.** `frontend/dist` é servido pelo FastAPI (`StaticFiles`); em desenvolvimento o Vite faz proxy de `/api` e `/media` para a porta 8765.

## Pastas do projeto

| Caminho | Conteúdo | Vai para o Git? |
|---|---|---|
| `servidor.py`, `cortes.py` | Código do backend | sim |
| `frontend/src`, `frontend/package*.json`, `frontend/index.html`, `frontend/public` | Código do painel | sim |
| `frontend/dist` | Painel compilado (`npm run build`) | não |
| `docs/` | Esta documentação | sim |
| `*.bat`, `requirements.txt`, `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` | Operação e projeto aberto | sim |
| `entrada/` | Episódios (vídeo ou áudio) enviados ou importados | não |
| `trabalho/<episódio>/` | Dados de cada episódio (veja abaixo) | não |
| `saida/<episódio>/` | Vídeos gerados | não |
| `logos/` | Logos da marca (PNG normalizado) | não |
| `config.json`, `templates.json`, `chave_api.txt` | Configuração e segredos do usuário | não |
| `logs/` | `servidor.err.log` | não |
| `.venv/`, `frontend/node_modules/` | Dependências | não |

## Dados por episódio (`trabalho/<nome sem extensão>/`)

| Arquivo | O que guarda |
|---|---|
| `transcricao.json` | `{duracao, segmentos:[{inicio, fim, texto, palavras:[{p, inicio, fim}]}]}` |
| `transcricao.txt` | Mesma transcrição, uma linha por segmento (`[ini-fim] texto`) |
| `transcricao.parcial.json` | Checkpoint da transcrição em andamento; some quando termina |
| `cortes.json` | Lista de cortes (veja [configuracao.md](configuracao.md#cortesjson)) |
| `renders.json` | Qual vídeo foi gerado para cada corte e com quais parâmetros (hash) |
| `analises.json` | Análise de potencial de viralização por corte |
| `meta.json` | Metadados do episódio (resquício: antes cada episódio escolhia seu template) |

Em `saida/<episódio>/`, cada corte gera `NN_titulo_id.mp4`, `NN_titulo_id.ass` (legenda) e `NN_titulo_id.txt` (título, descrição, hashtags e motivo, para colar na postagem).

## Identidade de um corte

Cada corte tem um `id` curto (6 hex) gravado em `cortes.json`. É ele que liga o corte ao vídeo (`renders.json`) e à análise (`analises.json`). Mudar título ou posição não muda o `id`; remover o corte deixa o vídeo "órfão" (aparece como **Corte removido** na biblioteca).

## Detecção de vídeo desatualizado

`hash_render()` resume tudo que muda o vídeo final (início, fim, velocidade, formato, legendas e seu estilo, logo). Se o hash gravado em `renders.json` difere do atual, o vídeo aparece como **Desatualizado**. `hash_analise()` faz o mesmo para a análise viral (início, fim, velocidade, título, descrição).
