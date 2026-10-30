# Decisões e limites

## Decisões

- **Tudo local.** Privacidade e custo: o vídeo nunca sai do computador; só texto vai ao Claude.
- **Conta Claude via Claude Code em vez de chave de API.** O Claude Code já é instalado e logado; o painel o chama de forma não interativa (`claude -p`) com flags que cortam o prompt padrão. A chave de API continua suportada como alternativa. Não se usa OAuth direto da Anthropic em app de terceiros.
- **FastAPI + React** (antes: Flask + HTML único). FastAPI dá validação (Pydantic), `Range` nos vídeos e documentação automática; React para o editor interativo.
- **Estado em arquivos.** Simples de inspecionar, copiar e restaurar; sem migrações.
- **Um job por vez.** Evita disputa de GPU e de limite da conta Claude.
- **Template = só prompt.** Quantidade, duração, formato e legenda são ajustes da geração (padrões em Configurações, alteráveis na janela *Gerar*). Misturar os dois tornava os templates confusos.
- **Nota viral transparente.** O Claude dá as notas dos critérios; a média ponderada e o critério de formato são calculados em código, para a nota ser reproduzível e explicável.
- **Hash por vídeo** (`hash_render`) em vez de apagar tudo a cada geração: só refaz o que mudou, sem tocar nos outros.
- **Encaixe nas palavras.** Início e fim são movidos para a palavra mais próxima (com folga) para nunca cortar no meio de uma palavra; comparado sem a folga, para não "andar" a cada salvamento.
- **Confirmações próprias** (`ui/Confirm`) em vez de `confirm()` do navegador.

## Limites conhecidos

- **Windows apenas** na prática: `.bat`, `CREATE_NO_WINDOW`, caminhos do winget e fontes (Arial, Impact…) pensados para Windows.
- **Nota viral é estimativa de IA**, sem dados reais de TikTok/Reels/YouTube. Serve para comparar e melhorar, não para prever alcance.
- **Reenquadramento vertical é fixo:** vídeo centralizado sobre fundo desfocado; não segue o rosto de quem fala.
- **Transcrição retomada não usa VAD** no trecho restante (limite do faster-whisper). Nomes próprios e termos técnicos podem sair errados; a transcrição não é editável pelo painel.
- **Cancelar a transcrição** só tem efeito no próximo segmento (segundos).
- **Importação por link** depende do yt-dlp e dos termos de cada site; baixe só conteúdo seu ou autorizado.
- **Publicação direta no YouTube não existe.** Seria via YouTube Data API v3 (OAuth), com a limitação de que projetos não auditados só enviam como privado e a cota diária limita a ~6 envios.
- **Memória:** transcrever episódios de 3 h com pouca RAM livre é arriscado (ver `operacao.md`).
- **Sem testes automatizados.** A verificação tem sido manual (navegador e chamadas à API) e por testes pontuais com Claude simulado.

## Thumbnails: o que não é feito

As thumbnails são montadas localmente a partir de um quadro do episódio, com texto estilizado. **Não** há geração de arte por IA nem recorte de pessoas/remoção de fundo (o estilo de canais que usam rostos recortados sobre cenários dramáticos exige edição externa). O JPG pode ser baixado e finalizado em outro editor. Vídeos longos não têm legenda queimada por padrão e a prévia do editor não reproduz o 16:9 com logo.

## Aprendizado: o que é e o que não é

O Claude não é treinado: as lições são texto gerado a partir dos resultados que você registra e entram como contexto nos prompts. Com poucos vídeos (menos de uns 8) a correlação e as lições são hipóteses, não regras. Não há leitura automática das métricas das plataformas; o registro é manual. Visualizações dependem do horário, do alcance do canal e do tempo desde a postagem, então compare vídeos parecidos. A prévia do corte (*Ver como vai ficar*) pula as partes tiradas, como o vídeo gerado; o player normal do episódio toca tudo.
