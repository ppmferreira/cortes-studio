# Operação

## Ligar e desligar

- **Ligar:** dois cliques em `iniciar.bat` (ou `python -X faulthandler servidor.py` dentro do `.venv`). Abre `http://127.0.0.1:8765`. Se `frontend/dist` não existir, o `.bat` instala e compila o painel antes.
- **Desligar:** feche a janela preta do servidor. Isso **mata o processo em andamento** (transcrição, Claude, ffmpeg).
- **Primeira vez / outro computador:** `instalar.bat` (ffmpeg via winget, `.venv`, dependências do `requirements.txt`, bibliotecas CUDA da NVIDIA). Requer Python 3.10+, Node.js 20+ (para compilar o painel) e Windows.
- Só pode haver **um** servidor na porta 8765. Se aparecer erro de porta em uso, já existe um rodando (inclusive oculto).

## Linha de comando (sem o painel)

O pipeline também roda sozinho, a partir de `cortes.py`:

```
python cortes.py transcrever|selecionar|cortar|tudo [arquivo]   # sem arquivo, processa tudo que está em entradapython cortes.py selecionar entrada\episodio.mp4 --manual         # só transcreve e grava trabalho\episodio	ranscricao.txt
```

`rodar.bat` roda `tudo`. Com `--manual` você pede os cortes ao Claude numa conversa, salva `trabalho\<episódio>\cortes.json` e roda `cortar`. Os resultados intermediários ficam em `trabalho\` e são reaproveitados (apague `cortes.json` para escolher de novo; mude a configuração e rode `cortar` para refazer só os vídeos). Para escolher cortes e analisar é preciso o Claude conectado (conta ou chave de API em `chave_api.txt` / variável `ANTHROPIC_API_KEY`).

## Reiniciar com segurança

Mudanças no backend (`servidor.py`, `cortes.py`) só valem depois de reiniciar; mudanças no painel só pedem `npm run build` e recarregar a página.

1. Confira `GET /api/job`. Se `rodando` for `true`, **não reinicie** (o processo morre). Cancele pelo painel ou espere terminar.
2. Reinicie. As análises e transcrições já gravadas permanecem; a transcrição retoma do checkpoint de até 90 s atrás.

## Desenvolvimento

```
python servidor.py                 # backend
cd frontend && npm run dev         # painel com recarga automática (http://localhost:5173, proxy para 8765)
cd frontend && npm run build       # gera frontend/dist (também roda o tsc: o build falha se houver erro de tipo)
```

## Logs

| Onde | O que tem |
|---|---|
| Aba **Processo** (painel) | Saída do processo em andamento (`print` do pipeline) |
| `logs/servidor.err.log` | Erros do servidor e, com `faulthandler`, o rastro de quedas nativas |
| Janela preta do servidor | Mensagens do servidor |

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| Página diz "Servidor fora do ar" / conexão recusada | O servidor não está rodando. Abra `iniciar.bat` |
| Botão de transcrever desabilitado, "outro processo rodando" | O painel faz um processo por vez. Espere ou use **Cancelar** (cartão do canto inferior esquerdo) |
| Aviso `ConnectionResetError ... _call_connection_lost` | Ruído inofensivo do Windows quando o navegador fecha uma conexão; o servidor o filtra do log |
| "Claude não conectado" | Ícone da chave no topo → *Entrar com Claude* (usa o Claude Code instalado) ou cole uma chave de API |
| Login com Claude dá erro na página | O login só vale enquanto o processo `claude auth login` está vivo; não reinicie o servidor no meio |
| Transcrição lenta ou cai para CPU | Faltam as DLLs CUDA (`instalar.bat` instala) ou a GPU está sem memória; use `modelo_whisper` menor (`small`) |
| Pouca memória livre | Episódios longos usam bastante RAM; feche programas pesados durante a transcrição |
| Vídeo gerado sem legenda/logo | Conferir *Configurações → Geração e vídeo / Marca* e o interruptor "Legendas" da janela *Gerar* |
| Vídeos "Desatualizados" | O corte ou o estilo mudou depois da geração; gere de novo pela janela *Gerar* |
| `ffmpeg não encontrado` | `winget install Gyan.FFmpeg` e reabra o terminal |
| Importar por link falha com erro de certificado | Algum antivírus/proxy interceptando HTTPS; teste com outro link |

## Backup

Os dados importantes ficam em `trabalho/` (cortes, transcrição, análises), `saida/`, `logos/`, `config.json` e `templates.json`. Nada disso vai para o Git; copie essas pastas manualmente se quiser backup.
