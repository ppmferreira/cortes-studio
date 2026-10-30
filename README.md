<div align="center">

# ✂️ Cortes Studio

### Transforme episódios de podcast em Shorts, vídeos longos e thumbnails prontos para postar.

Transcreve, escolhe os melhores momentos com IA, edita, legenda, dá nota de viralização e aprende com os seus resultados.
**Tudo rodando no seu computador.**

[Começar](#-começar-em-5-minutos) · [Recursos](#-o-que-ele-faz) · [Como funciona](#-como-funciona) · [Documentação](docs/README.md) · [Licença MIT](LICENSE)

</div>

---

## Por que usar

Cortar um episódio de 2 horas na mão leva uma tarde: assistir, anotar tempos, cortar, legendar, escrever título e descrição, montar thumbnail. O **Cortes Studio** faz o trabalho pesado e deixa para você só o que importa: **decidir o que vai ao ar**.

| Sem ele | Com ele |
|---|---|
| Assistir tudo para achar os bons momentos | A IA lê a transcrição inteira e propõe os cortes, com o motivo de cada um |
| Adivinhar o que vai performar | Nota de **potencial viral de 0 a 10**, explicada critério por critério |
| Editar vídeo por vídeo | Painel visual: ajuste, tire trechos, divida e desfaça com Ctrl+Z |
| Pensar em título, descrição e hashtags | Saem prontos, junto com o vídeo, para colar na postagem |
| Montar thumbnail do zero | O Claude sugere o texto e o melhor quadro; você ajusta e salva |
| Repetir os mesmos erros | Registre os resultados reais e as lições entram nas próximas escolhas |

## 🚀 O que ele faz

**Cortes curtos (Shorts, Reels, TikTok)**
- Vertical 9:16 com **legenda palavra por palavra**, logo da marca e velocidade de 1× a 2× (sem mudar o tom da voz).
- Gancho nos primeiros segundos, ideia completa no final, sem repetir trechos.

**Vídeos longos para YouTube (16:9)**
- A IA divide episódios de horas em **capítulos de 8 a 25 minutos**, com título, descrição e texto de thumbnail.
- Episódios longos são lidos em partes ao mesmo tempo, o que encurta a espera.
- Logo própria para vídeos longos (cantos superior ou inferior).

**Thumbnails**
- *Thumbnail viral (IA)*: o Claude lê o corte e propõe 3 textos de duas linhas e o melhor quadro.
- Editor com zoom, enquadramento e texto no estilo de canais de podcast, exportando em JPG.

**Editor de cortes**
- Linha do tempo com ajuste fino, alças arrastáveis e prévia do vídeo final.
- **Tirar trechos do meio** (tangentes, pausas), devolver, marcar com atalhos, desfazer e refazer.
- **Melhorar com Claude**: ajusta o início e o fim, corta tangentes ou divide um corte em vários.

**Inteligência de viralização**
- Nota de 0 a 10 com 6 critérios (gancho, retenção, emoção, clareza, compartilhamento e formato), pontos fortes, o que melhorar e título alternativo.
- **Meta de nota**: peça ao Claude mais candidatos e fique só com os que atingem a sua meta.
- **Aprendizado**: registre views e retenção depois de postar; o Claude extrai lições que passam a orientar as próximas escolhas.

**Produtividade**
- 13 **templates** prontos (8 para Shorts, 5 para vídeos longos) e os seus próprios.
- Vários episódios em fila, importação por link, biblioteca de vídeos em lista ou grade e ações em lote.
- Transcrição com checkpoint: se cair, continua de onde parou.

## 🧠 Como funciona

```
 Episódio (vídeo/áudio ou link)
        │
        ▼
 Transcrição  ── Whisper na sua GPU, tempo por palavra
        │
        ▼
 Escolha dos cortes ── Claude, com o template e o prompt que você definir
        │
        ▼
 Nota de viralização ── 6 critérios, lotes em paralelo
        │
        ▼
 Editor ── você ajusta, tira trechos, pede melhorias
        │
        ▼
 Vídeos + thumbnails ── ffmpeg: corte, velocidade, logo e legenda
        │
        ▼
 Resultados reais ── você registra; as lições voltam para o início
```

## ⚡ Começar em 5 minutos

**Requisitos:** Windows, Python 3.10+, Node.js 20+ e, para transcrever rápido, uma placa NVIDIA (sem GPU funciona, só mais devagar).

1. `instalar.bat` (uma vez): instala o ffmpeg, o ambiente Python e as dependências.
2. `iniciar.bat`: abre o painel em **http://127.0.0.1:8765** (na primeira vez compila o painel).
3. No ícone da chave, no topo, conecte o Claude: **entre com a sua conta Claude** (via Claude Code) ou cole uma **chave de API**.
4. Envie um episódio (ou cole um link), clique em **Fazer tudo automaticamente** e revise os cortes.

> O painel só escuta em `127.0.0.1`: nada fica exposto na rede. Seus episódios, transcrições e vídeos não saem do computador. A única chamada externa é ao Claude (e ao YouTube, se você importar por link).

## 🧩 Stack

FastAPI · React 19 + TypeScript + Vite · faster-whisper (CUDA) · ffmpeg · Claude (conta ou API) · yt-dlp

## 📚 Documentação

Tudo está em [`docs/`](docs/README.md): [arquitetura](docs/arquitetura.md), [pipeline](docs/pipeline.md), [API](docs/api.md), [painel](docs/frontend.md), [configuração](docs/configuracao.md), [operação](docs/operacao.md) e [decisões e limites](docs/decisoes-e-limites.md). O histórico de mudanças está em [`docs/changelog.md`](docs/changelog.md).

## ⚠️ Limites e transparência

- A **nota de viralização é uma estimativa feita por IA** a partir do texto, da duração e do ritmo. Não usa dados das plataformas e não garante resultado: serve para comparar cortes e apontar o que melhorar.
- O **aprendizado não treina o modelo**: as lições são texto gerado a partir dos resultados que você registra e entram como contexto nos pedidos seguintes. Com poucos vídeos, são hipóteses.
- As **thumbnails** usam um quadro do próprio episódio com texto estilizado. Não geram arte nem recortam pessoas.
- O enquadramento vertical é o vídeo original centralizado sobre fundo desfocado; ele não segue o rosto de quem fala.
- A transcrição do Whisper pode errar nomes próprios e termos técnicos.
- Feito e testado no **Windows**.

## 🤝 Contribuir

Contribuições são bem-vindas: veja [`CONTRIBUTING.md`](CONTRIBUTING.md). Para relatar uma vulnerabilidade, [`SECURITY.md`](SECURITY.md).

## 📄 Licença e avisos

Código sob licença **MIT** ([`LICENSE`](LICENSE)). Projeto independente, sem vínculo com Anthropic, OpenAI, YouTube, TikTok ou Meta. O software não inclui conteúdo de terceiros: **você** é responsável pelos episódios que processa e publica (direitos autorais e termos das plataformas). Detalhes em [`docs/licencas-e-direitos.md`](docs/licencas-e-direitos.md).
