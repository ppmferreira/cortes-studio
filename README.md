# Cortes automáticos de podcast

> 📚 **Documentação completa em [`docs/`](docs/README.md)** (arquitetura, pipeline, API, painel, configuração, operação, GitHub).

Episódio → transcrição (Whisper, na sua RTX 3050) → Claude escolhe os melhores trechos → ffmpeg corta em vertical 9:16 com legendas palavra por palavra.

## Painel web (React + FastAPI)

Dê dois cliques em `iniciar.bat`: abre o painel em http://127.0.0.1:8765 (a API tem documentação interativa em `/docs`). Lá você envia o episódio, clica em **Fazer tudo automaticamente** (ou etapa por etapa), edita os cortes com o player (ajuste início/fim usando o tempo atual do vídeo), gera e baixa os vídeos. A chave da API pode ser colada pelo botão no topo. Também dá para montar os cortes manualmente, sem API.

- Backend: `servidor.py` (FastAPI) usa o pipeline de `cortes.py`.
- Painel: `frontend/` (React + TypeScript + Vite). O `iniciar.bat` compila na primeira vez; depois de mexer no painel, rode `npm run build` dentro de `frontend`.
- Desenvolvimento do painel com recarga automática: rode `python servidor.py` e, em outro terminal, `cd frontend && npm run dev` (abre em http://localhost:5173).

## Uso rápido (linha de comando)

1. Coloque o episódio (mp4, mkv, mov, mp3, wav...) na pasta `entrada`.
2. Defina a chave da API uma vez (PowerShell): `setx ANTHROPIC_API_KEY "sua-chave"` e abra um novo terminal.
3. Dê dois cliques em `rodar.bat`.
4. Os cortes saem em `saida\<nome do episodio>\` — cada `.mp4` vem com um `.txt` (título, descrição, hashtags).

`instalar.bat` só precisa rodar de novo se mudar de máquina (já foi feito aqui).

## Modo manual (sem API, eu escolho os cortes na conversa)

```
python cortes.py selecionar entrada\episodio.mp4 --manual   (gera trabalho\episodio\transcricao.txt)
```
Peça ao Claude no Claude Code para ler a transcrição e salvar `trabalho\episodio\cortes.json`. Depois:
```
python cortes.py cortar entrada\episodio.mp4
```

## Etapas separadas

`python cortes.py transcrever|selecionar|cortar|tudo [arquivo]` — sem arquivo, processa tudo que está em `entrada`. Resultados intermediários ficam em `trabalho\` e são reaproveitados (apague `cortes.json` para escolher de novo; mude a config e rode `cortar` para refazer só os vídeos).

## Ajustes (`config.json`)

| Chave | Padrão | O que faz |
|---|---|---|
| `qtd_cortes` | 6 | quantos cortes por episódio |
| `duracao_min` / `duracao_max` | 30 / 90 | duração em segundos |
| `formato` | vertical | `vertical` (9:16) ou `horizontal` |
| `legendas` | true | queima legenda no vídeo |
| `palavras_por_legenda` | 3 | palavras por bloco |
| `modelo_whisper` | medium | `large-v3` (mais preciso, ~5GB VRAM), `small` (mais rápido) |
| `instrucoes_extras` | "" | ex.: "priorize momentos engraçados e polêmicos" |

## Formato de `cortes.json`

```json
[{"inicio": 123.4, "fim": 170.0, "titulo": "...", "motivo": "...", "descricao": "...", "hashtags": ["#x"]}]
```

## Limitações

- Reenquadramento vertical = vídeo original centralizado sobre fundo desfocado (não segue o rosto de quem fala).
- Podcast só em áudio gera vídeo com fundo preto + legendas.
- Transcrição do Whisper pode errar nomes próprios/termos (ex.: "podcast" virou "Padcast" no teste); revise `trabalho\<ep>\transcricao.json` se importar.

## Templates, velocidade e geração por seleção

- **Templates** (Configurações › Templates): reúnem o estilo dos cortes (formato, duração, legenda, velocidade padrão e o briefing que o Claude segue). Há 6 prontos (Shorts, Viral rápido, Debate, Humor, Educativo, YouTube longo); duplique um para criar o seu. Cada episódio escolhe o seu no editor; o padrão vale para os demais. Ficam em `templates.json`.
- **Velocidade por corte** (1× a 2×): aplicada no vídeo e no áudio sem mudar o tom da voz; a legenda acompanha. A prévia 9:16 do editor já mostra enquadramento, legenda e velocidade.
- **Gerar vídeos…**: abre a escolha de quais cortes gerar. Mostra o estado de cada um (Novo, Pronto, Desatualizado), só gera o que você marcar, não apaga os outros e avisa quando dois cortes repetem o mesmo trecho.

## Requisitos

Windows, Python 3.10+, Node.js 20+, ffmpeg (`winget install Gyan.FFmpeg`) e, para a transcrição rápida, uma GPU NVIDIA. Para escolher cortes e analisar viralização é preciso o Claude: login com a sua conta (via Claude Code) ou uma chave de API, ambos seus.

## Licença e avisos

Código sob licença **MIT** (veja [`LICENSE`](LICENSE)). Contribuições são bem-vindas: [`CONTRIBUTING.md`](CONTRIBUTING.md). Segurança: [`SECURITY.md`](SECURITY.md).

Projeto independente, sem vínculo com Anthropic, OpenAI, YouTube, TikTok ou Meta. O software não inclui conteúdo de terceiros: **você** é responsável pelos episódios que processa e publica (direitos autorais e termos das plataformas). Detalhes em [`docs/licencas-e-direitos.md`](docs/licencas-e-direitos.md).
