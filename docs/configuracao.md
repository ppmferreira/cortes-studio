# Configuração e dados

## `config.json` (padrões globais)

Gravado por `PUT /api/config` (página Configurações). Chaves ausentes usam `CONFIG_PADRAO` de `cortes.py`.

| Grupo | Chave (padrão) | Significado |
|---|---|---|
| Geral | `idioma` (`pt`), `modelo_whisper` (`medium`), `modelo_claude` (`claude-sonnet-5-5`, só vale com chave de API) | Transcrição e modelo |
| Geração | `qtd_cortes` (6), `duracao_min` (30), `duracao_max` (90), `velocidade_padrao` (1.0), `folga_inicio` (0,15), `folga_fim` (0,35) | O que se pede ao Claude e a margem em volta da fala |
| Vídeo e legenda | `formato` (`vertical`/`horizontal`), `legendas`, `palavras_por_legenda` (3), `tamanho_legenda` (14), `fonte_legenda` (Arial), `cor_legenda` (`#FFFFFF`), `posicao_legenda` (`baixo`/`meio`/`alto`) | Aparência do vídeo final |
| Marca | `usar_logo`, `logo` (nome do PNG em `logos/`), `logo_posicao`, `logo_tamanho` (% da largura), `logo_opacidade` | Logo nos cortes |

`posicao_legenda` e `logo_posicao` usam as mesmas regras no ffmpeg (`cortes.py`) e na prévia (`Previa.tsx`, `lib/logo.ts`). Mudar qualquer campo que entra em `hash_render` deixa os vídeos já gerados como **Desatualizados**.

## Templates (`templates.json`)

Um template é **só um prompt**: o briefing que o Claude segue ao escolher cortes. Quantidade, duração, formato e legenda não fazem parte dele.

```json
{ "ativo": "shorts", "usuario": [ { "id": "u-ab12cd", "nome": "...", "descricao": "...", "prompt": "..." } ] }
```

- Prontos (em `cortes.py::TEMPLATES_BASE`, não editáveis): `shorts`, `viral`, `debate`, `humor`, `educativo`, `capitulos`.
- `ativo` = template padrão; `""` = nenhum (o usuário escreve o prompt na janela *Gerar*).
- Entradas antigas com `config` são migradas na leitura (o `instrucoes_extras` vira `prompt`).
- Na janela *Gerar* o template só preenche o prompt, que pode ser editado e vale apenas para aquela execução.

## Conta Claude e chave de API

| O quê | Onde fica | Observação |
|---|---|---|
| Login da conta Claude (usado hoje) | Pasta do Claude Code do usuário: `%USERPROFILE%\.claude\` (credenciais em `.credentials.json`) | **Fora do projeto.** Nunca vai para o Git. O painel não lê esse arquivo; só executa `claude auth status/login/logout` |
| Chave de API (opcional) | `chave_api.txt` na raiz do projeto, ou variável de ambiente `ANTHROPIC_API_KEY` | `chave_api.txt` está no `.gitignore`. Se a variável existir, ela tem prioridade (`modo_claude()` devolve `api`) |

Sem nenhum dos dois, as etapas que usam o Claude falham com uma mensagem pedindo para conectar. Montar cortes à mão continua funcionando.

## Formatos dos arquivos de dados

### `cortes.json`
```json
[ { "id": "9c7013", "inicio": 3338.17, "fim": 3415.99, "titulo": "...", "motivo": "...",
    "descricao": "...", "hashtags": ["#podcast"], "velocidade": 1.0 } ]
```
Tempos em segundos do episódio original. A duração final do vídeo é `(fim - inicio) / velocidade`.

### `renders.json`
```json
{ "<id do corte>": { "arquivo": "05_Titulo_8fc5fa.mp4", "hash": "a1b2c3d4e5f6", "titulo": "..." } }
```

### `analises.json`
```json
{ "<id do corte>": { "nota": 4.5, "veredito": "Potencial baixo", "resumo": "...",
    "criterios": { "gancho": {"nome": "...", "nota": 2, "peso": 25, "porque": "..."}, "...": {} },
    "medidas": {"duracao_s": 36.5, "palavras_por_s": 2.88}, "pontos_fortes": [], "melhorias": [],
    "titulo_alternativo": "", "hash": "...", "analisado_em": 1761800000, "aviso": "..." } }
```

## Variáveis de ambiente

- `ANTHROPIC_API_KEY` — chave de API (opcional).
- `CORTES_SEM_BROWSER=1` — o servidor não abre o navegador ao iniciar.

## Arquivos de lote (`.bat`)

`iniciar.bat` (painel; grava erros em `logs\servidor.err.log` e liga `-X faulthandler`), `instalar.bat` (ffmpeg via winget, venv, dependências, bibliotecas CUDA), `rodar.bat` (pipeline completo por linha de comando).
