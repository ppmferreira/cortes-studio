# API (FastAPI, `servidor.py`)

Base: `http://127.0.0.1:8765`. Documentação interativa gerada pelo FastAPI em `/docs`. Erros usam `{"detail": "mensagem"}` (400 validação, 404 não encontrado, 409 já existe processo rodando). Nomes de episódio são o nome do arquivo em `entrada/` (com extensão), codificado na URL.

## Estado e episódios

| Método e rota | Corpo → resposta |
|---|---|
| `GET /api/estado` | → `{episodios[], geral, logos[], templates[], template_ativo, chave, conexao}`. Cada episódio: `nome, mb, enviado, audio, transcrito, n_cortes, videos[], template, template_nome, config{}` (configuração efetiva). `chave` = há Claude disponível (conta ou API). `conexao` = `{instalado, conectado, email, api}` |
| `POST /api/upload` | multipart, campo `arquivo` → `{nome}`. Grava em blocos de 8 MB em `entrada/` |
| `POST /api/importar` | `{url}` (http/https) → `{ok}`. Baixa com yt-dlp em segundo plano |
| `GET /api/importar` | → `{rodando, url, pct, detalhe, erro, nome}` |

## Processo em segundo plano

| Método e rota | Corpo → resposta |
|---|---|
| `POST /api/rodar` | `{episodio, etapa, manual?, refazer?, cortes?, opcoes?}` → `{ok}`. `etapa`: `tudo`, `cortes`, `transcrever`, `selecionar`, `cortar`, `analisar`. `cortes` = ids a processar (em `cortar` e `analisar`). `refazer` apaga `cortes.json` antes de `selecionar`. `409` se já há processo |
| `POST /api/rodar-lote` | `{episodios[], refazer?, gerar_videos?, opcoes?}` → `{ok, n}`. Exige Claude conectado se algum episódio precisa de cortes |
| `GET /api/job` | → `{rodando, etapa, episodio, erro, plano[], feitas[], lote{i,n}\|null, pct_total, pct_etapa, detalhe, decorrido_s, eta_s, log}` |
| `POST /api/job/cancelar` | → `{ok}`; `409` se nada está rodando |

`opcoes` (valem só para aquela execução, mescladas sobre a configuração): `formato`, `legendas`, `template`, `qtd_cortes`, `duracao_min`, `duracao_max`, `instrucoes_extras` (o prompt), `adicionar` (manter cortes atuais e acrescentar novos).

## Cortes, vídeos e análises

| Método e rota | Corpo → resposta |
|---|---|
| `GET /api/episodios/{ep}/cortes` | → lista de cortes. Atribui `id` e `velocidade` ausentes e migra vídeos antigos para `renders.json` |
| `PUT /api/episodios/{ep}/cortes?apagar_videos=id1,id2` | lista de cortes → `{ok, n, cortes}`. Encaixa início/fim na palavra mais próxima (sem deslocar a cada novo salvamento). `apagar_videos` apaga também os vídeos desses cortes removidos. `400` se `fim <= inicio` |
| `POST /api/episodios/{ep}/status-render` | `{formato?, legendas?, template?}` → `{cortes:{id:{estado, arquivo}}, videos[]}`. `estado`: `novo`, `pronto`, `desatualizado`, `sem_corte`. Cada vídeo: `arquivo, titulo, descricao, hashtags, corte, estado, gerado_em, duracao, nota` |
| `DELETE /api/episodios/{ep}/videos/{nome}` | apaga `.mp4`, `.ass`, `.txt` e a entrada em `renders.json` |
| `GET /api/episodios/{ep}/analises` | → `{id: Analise + desatualizada}` |
| `GET /api/episodios/{ep}/transcricao` | → `[{inicio, fim, texto}]` |
| `GET /api/episodios/{ep}/palavras?ini=&fim=` | → `[{p, inicio, fim}]` do intervalo (legenda da prévia) |
| `GET /api/episodios/{ep}/legenda/{nome}` | → `{texto}` (conteúdo do `.txt` do vídeo) |

## Templates (prompts)

| Método e rota | Corpo → resposta |
|---|---|
| `GET /api/templates` | → `{templates[], ativo}`; cada template `{id, nome, descricao, builtin, prompt}` |
| `POST /api/templates` | `{nome, descricao?, prompt}` → `{id}` (`u-xxxxxx`) |
| `PUT /api/templates/{id}` | idem; `400` se for template pronto |
| `DELETE /api/templates/{id}` | `400` se for template pronto. Se era o padrão, volta para `shorts` |
| `PUT /api/templates-padrao` | `{id}` (`null`/`""` = nenhum) |

## Configuração, marca e Claude

| Método e rota | Corpo → resposta |
|---|---|
| `PUT /api/config` | objeto `Geral` completo (idioma, modelos, padrões de geração, vídeo/legenda, marca) → `{ok}` |
| `POST /api/logos` | multipart `arquivo` → `{nome}`. Normaliza para PNG transparente (recorta em círculo logo redonda com fundo branco) |
| `DELETE /api/logos/{nome}` | apaga a logo |
| `PUT /api/chave` | `{chave}` → `{chave: bool}`. Vazio remove. Grava `chave_api.txt` e o ambiente do processo |
| `GET /api/claude` | → `{instalado, conectado, email, api, entrando, url}` |
| `POST /api/claude/login` | inicia `claude auth login --claudeai`; → `{ok, url}` |
| `POST /api/claude/codigo` | `{codigo}`; entrega o código ao login em andamento |
| `POST /api/claude/cancelar` / `POST /api/claude/logout` | cancela o login / sai da conta |

## Mídia

- `GET /media/entrada/{nome}` — episódio (aceita `Range`).
- `GET /media/saida/{episodio}/{arquivo}` — vídeo gerado (aceita `Range`).
- `GET /media/logos/{nome}` — logo.
- `GET /` — painel (`frontend/dist`); sem build, devolve um aviso em JSON.

## Thumbnails (vídeos longos)

| Rota | O que faz |
|---|---|
| `PUT /api/episodios/{ep}/thumbs/{id}` | Corpo = JPEG (até 5 MB, `Content-Type: image/jpeg`). Grava `saida/<ep>/thumb_<id>.jpg` |
| `DELETE /api/episodios/{ep}/thumbs/{id}` | Apaga a thumbnail |

O arquivo é servido por `/media/saida/{ep}/thumb_<id>.jpg`. Em `POST /api/rodar` e `/api/rodar-lote`, `opcoes.tipo_corte = "longo"` pede vídeos longos. `status-render` devolve `tipo` e `thumb` (existe arquivo) em cada vídeo.

`POST/PUT /api/templates` aceitam `tipo` (`short` ou `longo`, padrão `short`); `GET /api/templates` e `/api/estado` devolvem `tipo` em cada template.

`POST /api/rodar` com `etapa: "analisar"` enquanto outro processo roda não devolve 409: entra na fila e responde `{ok, fila: N}`; as demais etapas continuam devolvendo 409. `GET /api/job` inclui `fila` (quantidade de análises esperando).

## Edição, melhoria e aprendizado

- `POST /api/rodar` aceita `etapa: "melhorar"` (com `cortes: [ids]` e `opcoes.substituir`) e `etapa: "aprender"`.
- `cortes.json` / `PUT /api/episodios/{ep}/cortes`: cada corte pode ter `trechos` (`[[ini, fim], ...]`, partes mantidas), `melhorado_de` (id do corte de origem), `tipo` e `thumb`.
- `GET /api/desempenho` → `{resultados, licoes, correlacao}`.
- `PUT /api/episodios/{ep}/desempenho/{id}` grava o resultado real de um vídeo postado (`plataforma`, `postado_em`, `views`, `curtidas`, `comentarios`, `compartilhamentos`, `retencao_pct`, `observacao`), junto com um retrato do corte (nota prevista, critérios, abertura, duração).
- `DELETE /api/desempenho/{chave}` remove um resultado (`chave` = `<episódio>|<id do corte>`).
