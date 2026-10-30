#!/usr/bin/env python3
"""Cortes automáticos de podcast.

Fluxo: transcrever (Whisper) -> selecionar (Claude) -> cortar (ffmpeg, vertical + legendas).

Uso:
    python cortes.py tudo entrada\\episodio.mp4
    python cortes.py transcrever entrada\\episodio.mp4
    python cortes.py selecionar entrada\\episodio.mp4 [--manual]
    python cortes.py cortar entrada\\episodio.mp4

Sem argumentos de arquivo, processa todos os vídeos/áudios da pasta "entrada".
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
ENTRADA = BASE / "entrada"
SAIDA = BASE / "saida"
LOGOS = BASE / "logos"
TRABALHO = BASE / "trabalho"
EXTENSOES = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".mp3", ".wav", ".m4a", ".flac", ".ogg"}
EXT_AUDIO = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}

# Progresso da etapa em andamento, lido pelo painel web. pct: 0-100, ou None se não der para medir.
PROGRESSO = {"pct": None, "detalhe": ""}
# Pedido de cancelamento vindo do painel: as etapas conferem em cada passo (segmento, corte, lote) e param.
CANCELAR = threading.Event()


def progresso(pct, detalhe=""):
    if CANCELAR.is_set():
        sys.exit("Cancelado pelo usuário.")
    PROGRESSO["pct"] = pct
    PROGRESSO["detalhe"] = detalhe

CONFIG_PADRAO = {
    # --- gerais (valem para todos os episódios; ficam em config.json)
    "idioma": "pt",
    "modelo_whisper": "medium",        # "large-v3" é mais preciso, mas pede ~5GB de VRAM; "small" é mais rápido
    "modelo_claude": "claude-sonnet-5-5",
    "esforco_claude": "medium",        # raciocínio do Claude na conta: low (mais rápido), medium, high
    # --- estilo de corte (definidos pelo template do episódio)
    "qtd_cortes": 6,
    "duracao_min": 30,                 # segundos
    "duracao_max": 90,                 # segundos
    "formato": "vertical",             # "vertical" (9:16) ou "horizontal"
    "legendas": True,
    "legendas_longo": False,           # vídeos longos (16:9) saem sem legenda queimada, a menos que ligue
    "palavras_por_legenda": 3,
    "fonte_legenda": "Arial",
    "tamanho_legenda": 14,             # relativo a uma tela de 1080 de largura (ASS PlayResX=1080)
    "cor_legenda": "#FFFFFF",
    "posicao_legenda": "baixo",        # "baixo", "meio" ou "alto"
    "folga_inicio": 0.15,              # segundos antes da primeira palavra
    "folga_fim": 0.35,                 # segundos depois da última palavra
    "velocidade_padrao": 1.0,          # velocidade inicial dos cortes novos (0.5 a 2.0)
    "instrucoes_extras": "",           # ex.: "priorize momentos engraçados"
    "nota_minima": 7,                  # meta de potencial viral (0-10): marca cortes abaixo e filtra ao pedir cortes ao Claude
    "usar_logo": True,                 # (template) mostra a logo da marca nos cortes
    # --- marca (geral): uma logo para todos os templates, guardada em logos/
    "logo": "",                        # nome do arquivo em logos/ ("" = sem logo)
    "logo_posicao": "topo-centro",     # topo|baixo + esquerda|centro|direita, ou "centro"
    "logo_tamanho": 22,                # % da largura do vídeo
    "logo_opacidade": 100,             # 10 a 100
    "logo_posicao_longo": "topo-direita",  # vídeos longos (16:9): um canto (topo/baixo + esquerda/direita)
    "logo_tamanho_longo": 9,           # % da largura do vídeo longo
}

_ESTILO = ("qtd_cortes", "duracao_min", "duracao_max", "formato", "legendas", "palavras_por_legenda", "tamanho_legenda",
           "fonte_legenda", "cor_legenda", "posicao_legenda", "folga_inicio", "folga_fim", "velocidade_padrao", "usar_logo", "nota_minima")
CAMPOS_LOGO = ("usar_logo", "logo", "logo_posicao", "logo_tamanho", "logo_opacidade", "logo_posicao_longo", "logo_tamanho_longo")
# configuração que o editor recebe: estilo global + o prompt do template escolhido
CAMPOS_TEMPLATE = _ESTILO + ("instrucoes_extras",)
# configurações globais (config.json): geral + padrões de geração + vídeo/legenda + marca
CAMPOS_GERAL = ("idioma", "modelo_whisper", "modelo_claude") + _ESTILO + ("logo", "logo_posicao", "logo_tamanho", "logo_opacidade", "logo_posicao_longo", "logo_tamanho_longo")


def _t(id_, nome, descricao, prompt, tipo="short"):
    return {"id": id_, "nome": nome, "descricao": descricao, "builtin": True, "prompt": prompt, "tipo": tipo}


# Template = só o prompt (briefing) que o Claude segue ao escolher os cortes. Quantidade, duração, formato e
# legenda são ajustes da geração. `tipo` separa os de Shorts (9:16) dos de vídeos longos (16:9).
# Os templates prontos não mudam; os seus ficam em templates.json.
TEMPLATES_BASE = [
    # ---- Shorts / Reels / TikTok
    _t("shorts", "Shorts / Reels / TikTok", "Gancho forte nos 3 primeiros segundos e ideia completa.",
       "Priorize trechos que começam com um gancho nos primeiros 3 segundos: uma pergunta, uma afirmação ousada, um número "
       "surpreendente ou o início de uma história. O corte precisa fazer sentido sozinho, sem depender do resto do episódio, "
       "e terminar numa ideia fechada (conclusão, punchline ou lição). Corte começos lentos, apresentações, \"então...\", "
       "\"bom, é isso\" e qualquer enrolação antes do ponto principal."),
    _t("viral", "Viral e polêmico", "Frases de impacto, opiniões fortes e momentos que dão reação.",
       "Procure o que as pessoas vão comentar, discordar ou compartilhar: opiniões fortes, revelações, confissões, "
       "críticas diretas, números absurdos e frases que cabem numa legenda. Dê preferência a trechos com emoção "
       "visível na voz (indignação, riso, surpresa). Comece no ponto de maior tensão, sem contexto longo. Evite "
       "ofensas gratuitas a pessoas específicas e afirmações que pareçam factualmente falsas."),
    _t("historias", "Histórias e causos", "Mini-histórias com início, virada e final.",
       "Escolha histórias e causos curtos com estrutura clara: situação inicial, complicação, virada e desfecho. "
       "O corte deve abrir direto na situação interessante (\"teve uma vez que...\") e terminar no desfecho ou na "
       "frase final que fecha a história. Prefira detalhes concretos, diálogos e reviravoltas. Não corte antes do final da história."),
    _t("debate", "Debate e opinião", "Argumentos completos, com discordância.",
       "Escolha trechos em que alguém defende uma posição com argumento completo (tese, motivo e exemplo) ou em que "
       "há discordância real entre as pessoas. O corte deve conter a pergunta ou provocação que gerou a opinião, "
       "quando ela for necessária para entender. Evite trechos que dependam de assunto que veio muitos minutos antes."),
    _t("humor", "Humor e piadas", "Piadas com setup e punchline, sem cortar a risada.",
       "Escolha piadas e situações engraçadas com setup e punchline completos, incluindo a reação (risada, "
       "comentário engraçado do outro) logo depois do final. Comece no início do setup e termine pouco depois da risada. "
       "Prefira humor que funcione sem contexto; descarte piadas internas que só quem viu o resto entende."),
    _t("educativo", "Educativo e dicas", "Explicações claras e conselhos aplicáveis.",
       "Escolha explicações claras, dicas práticas, passo a passo, listas e conselhos que a pessoa possa aplicar no dia. "
       "O corte deve abrir com o problema ou a promessa (\"o erro que quase todo mundo comete é...\") e entregar a solução "
       "até o fim. Prefira exemplos concretos e números a generalidades."),
    _t("frases", "Frases de impacto e reflexões", "Trechos curtos e memoráveis, bons para texto na tela.",
       "Procure frases memoráveis e reflexões que resumem uma ideia em poucas palavras: conselhos de vida, "
       "verdades incômodas, comparações originais e conclusões marcantes. Prefira trechos curtos, em que quase "
       "todas as palavras importam, com pausa ou entonação forte no final. Evite divagações longas."),
    _t("emocional", "Emocional e superação", "Momentos de vulnerabilidade, virada e aprendizado.",
       "Escolha momentos emocionais genuínos: superação, perda, erro assumido, gratidão, confissão, virada de vida. "
       "O corte deve deixar claro o que aconteceu, o que a pessoa sentiu e o que aprendeu. Comece no ponto em que a "
       "emoção começa a aparecer e termine na lição ou no silêncio depois da fala. Evite sensacionalismo e trechos que exponham terceiros."),
    # ---- Vídeos longos (16:9)
    _t("capitulos", "Capítulos do episódio", "Divide o episódio em partes com tema próprio.",
       "Divida a conversa em capítulos independentes, cada um com um tema ou pergunta central, começo natural "
       "(apresentação do assunto ou pergunta do apresentador) e fechamento (conclusão, mudança de assunto). "
       "O título deve prometer claramente o que o espectador vai ver. Evite cortar no meio de uma explicação e escolha capítulos que o "
       "espectador entenda sem ter visto o restante.", "longo"),
    _t("historia_longa", "Histórias completas", "Uma história inteira, do começo ao fim.",
       "Escolha as histórias mais fortes contadas no episódio e traga-as por inteiro: contexto, desenvolvimento, clímax "
       "e desfecho, incluindo a reação e a reflexão depois. Prefira histórias com reviravolta, risco ou emoção. "
       "O vídeo pode começar um pouco antes, com a pergunta que puxou a história.", "longo"),
    _t("debate_longo", "Debates e polêmicas", "Discussões longas com lados e conclusão.",
       "Escolha as discussões mais intensas: temas polêmicos em que há posições diferentes, argumentos e contra-argumentos. "
       "O vídeo deve ter a pergunta que abriu o debate, o desenvolvimento e um fechamento (consenso, discordância "
       "declarada ou piada que encerra). Prefira trechos em que as pessoas se respondem diretamente.", "longo"),
    _t("aula", "Aula e explicação aprofundada", "Um assunto explicado a fundo.",
       "Escolha trechos em que um assunto é explicado em profundidade, com sequência lógica: o que é, por que importa, "
       "exemplos e como aplicar. O vídeo deve funcionar como uma aula curta, com começo que apresenta o tema e final que resume ou conclui. "
       "Evite trechos com muitas interrupções ou mudanças de assunto.", "longo"),
    _t("convidado", "Melhor do convidado", "Os trechos mais fortes de quem está sendo entrevistado.",
       "Foque nos momentos em que o convidado é o protagonista: trajetória, bastidores, histórias pessoais, opiniões "
       "e revelações. O título deve citar o tema e, se possível, a expressão mais forte dele. O vídeo pode incluir a pergunta do "
       "apresentador no início, mas a maior parte do tempo deve ser do convidado.", "longo"),
]


# ---------------------------------------------------------------- utilidades
def carregar_config():
    """Configurações gerais + valores padrão. O estilo de corte vem do template (config_do_episodio)."""
    cfg = dict(CONFIG_PADRAO)
    arq = BASE / "config.json"
    if arq.exists():
        cfg.update(json.loads(arq.read_text(encoding="utf-8-sig")))
    else:
        arq.write_text(json.dumps({k: CONFIG_PADRAO[k] for k in CAMPOS_GERAL}, indent=2, ensure_ascii=False), encoding="utf-8")
    return cfg


def ler_templates_arquivo():
    arq = BASE / "templates.json"
    return json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else {"ativo": "shorts", "usuario": []}


def gravar_templates_arquivo(dados):
    (BASE / "templates.json").write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")


def todos_templates():
    """(lista de templates, id do template padrão; "" = nenhum). Os prontos vêm primeiro."""
    d = ler_templates_arquivo()
    usuario = []
    for t in d.get("usuario", []):
        prompt = t.get("prompt") or (t.get("config") or {}).get("instrucoes_extras", "")  # migra templates antigos
        usuario.append({"id": t["id"], "nome": t["nome"], "descricao": t.get("descricao", ""), "builtin": False, "prompt": prompt,
                        "tipo": t.get("tipo", "short")})
    return TEMPLATES_BASE + usuario, d.get("ativo", "shorts")


def ler_meta(video: Path) -> dict:
    arq = TRABALHO / video.stem / "meta.json"
    return json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else {}


def gravar_meta(video: Path, dados: dict):
    (pasta_trabalho(video) / "meta.json").write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")


def config_do_episodio(video: Path | None = None, template: str | None = None):
    """Configuração efetiva: tudo vem da configuração global; só o prompt (instrucoes_extras) vem do template.
    `template` = id escolhido; "" = sem template; None = o template padrão."""
    cfg = carregar_config()
    lista, ativo = todos_templates()
    escolhido = ativo if template is None else template
    tpl = next((t for t in lista if t["id"] == escolhido), None)
    cfg["instrucoes_extras"] = tpl["prompt"] if tpl else ""
    cfg["template"] = tpl["id"] if tpl else ""
    cfg["template_nome"] = tpl["nome"] if tpl else "Sem template"
    return cfg


def novo_id(prefixo=""):
    return prefixo + secrets.token_hex(3)


def achar_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # winget instala em um caminho que pode não estar no PATH da sessão atual
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for cand in base.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"):
        return str(cand)
    sys.exit("ffmpeg não encontrado. Rode instalar.bat ou: winget install Gyan.FFmpeg")


def pasta_trabalho(video: Path) -> Path:
    p = TRABALHO / video.stem
    p.mkdir(parents=True, exist_ok=True)
    return p


def listar_entradas(arg):
    if arg:
        return [Path(a).resolve() for a in arg]
    ENTRADA.mkdir(exist_ok=True)
    return sorted(p for p in ENTRADA.iterdir() if p.suffix.lower() in EXTENSOES)


def fmt_tempo(s):
    s = int(s)
    return f"{s // 60:02d}:{s % 60:02d}"


def slug(txt):
    txt = re.sub(r"[^\w\s-]", "", txt, flags=re.UNICODE).strip()
    return re.sub(r"\s+", "_", txt)[:50] or "corte"


# ---------------------------------------------------------------- 1. transcrever
PARCIAL_A_CADA = 90   # segundos entre os checkpoints da transcrição


def transcrever(video: Path, cfg):
    trab = pasta_trabalho(video)
    saida = trab / "transcricao.json"
    if saida.exists():
        print(f"[transcrever] já existe: {saida}")
        return json.loads(saida.read_text(encoding="utf-8"))

    from faster_whisper import WhisperModel

    progresso(None, "Carregando o modelo Whisper (na primeira vez ele é baixado)")
    try:
        modelo = WhisperModel(cfg["modelo_whisper"], device="cuda", compute_type="float16")
        print("[transcrever] usando GPU")
    except Exception as e:  # sem CUDA/cuDNN: cai para CPU
        print(f"[transcrever] GPU indisponível ({str(e)[:80]}), usando CPU")
        modelo = WhisperModel(cfg["modelo_whisper"], device="cpu", compute_type="int8")

    # Checkpoint: episódios longos levam dezenas de minutos. A cada PARCIAL_A_CADA segundos o que já foi transcrito é
    # salvo; se o processo cair, a próxima execução continua de onde parou em vez de recomeçar do zero.
    parcial = trab / "transcricao.parcial.json"
    anteriores, inicio = [], 0.0
    if parcial.exists():
        try:
            anteriores = json.loads(parcial.read_text(encoding="utf-8"))["segmentos"]
            inicio = anteriores[-1]["fim"] if anteriores else 0.0
        except (ValueError, KeyError, IndexError):
            anteriores, inicio = [], 0.0
    print(f"[transcrever] {video.name} ... (pode demorar)" + (f" — retomando de {fmt_tempo(inicio)}" if inicio else ""))
    # ao retomar, o VAD do faster-whisper não roda (ele só vale sem clip_timestamps); o resto do trecho é transcrito direto
    extra = {"clip_timestamps": [inicio]} if inicio else {"vad_filter": True}
    segs, info = modelo.transcribe(str(video), language=cfg["idioma"], word_timestamps=True, beam_size=5, **extra)
    dados = {"duracao": info.duration, "segmentos": list(anteriores)}
    ultimo_salvo = time.time()
    for s in segs:
        dados["segmentos"].append({
            "inicio": s.start, "fim": s.end, "texto": s.text.strip(),
            "palavras": [{"p": w.word.strip(), "inicio": w.start, "fim": w.end} for w in (s.words or [])],
        })
        print(f"\r  {fmt_tempo(s.end)} / {fmt_tempo(info.duration)}", end="", flush=True)
        progresso(min(s.end / info.duration * 100, 100), f"{fmt_tempo(s.end)} de {fmt_tempo(info.duration)} de áudio")
        if time.time() - ultimo_salvo >= PARCIAL_A_CADA:
            tmp = parcial.with_suffix(".tmp")
            tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
            tmp.replace(parcial)
            ultimo_salvo = time.time()
    print()
    saida.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    parcial.unlink(missing_ok=True)

    linhas = [f"[{s['inicio']:.1f}-{s['fim']:.1f}] {s['texto']}" for s in dados["segmentos"]]
    (trab / "transcricao.txt").write_text("\n".join(linhas), encoding="utf-8")
    return dados


# ---------------------------------------------------------------- 2. selecionar
PROMPT = """Você é editor de cortes virais para Reels/TikTok/Shorts a partir de um podcast.
Abaixo está a transcrição com tempos em segundos no formato [inicio-fim] texto.

Escolha os {qtd} melhores trechos para cortes. Regras:
- Duração de cada corte entre {dmin} e {dmax} segundos.
- Comece em um gancho forte (pergunta, afirmação ousada, história que prende) e termine em uma ideia completa, nunca no meio de uma frase.
- Cada corte deve fazer sentido sozinho, sem precisar do contexto do resto do episódio.
- Cortes não podem se sobrepor.
- Prefira: histórias, opiniões fortes, revelações, humor, conselhos práticos, momentos emocionais.
{extras}
Responda SOMENTE com um JSON válido (lista), sem texto fora do JSON, neste formato:
[{{"inicio": 123.4, "fim": 170.0, "titulo": "título curto e chamativo",
  "motivo": "por que esse trecho funciona", "descricao": "legenda do post com emojis",
  "hashtags": ["#exemplo"]}}]

TRANSCRIÇÃO:
{transcricao}
"""


PROMPT_LONGO = """Você é editor de vídeos longos para o YouTube a partir de um podcast.
Abaixo está a transcrição com tempos em segundos no formato [inicio-fim] texto.

Escolha os {qtd} melhores capítulos/trechos para virarem vídeos longos independentes. Regras:
- Duração de cada vídeo entre {dmin} e {dmax} segundos.
- Cada vídeo deve ter começo, meio e fim: um assunto, uma história ou um debate completo, que faça sentido sozinho.
- Comece em um ponto natural (apresentação do tema, pergunta ou história) e termine em uma conclusão, nunca no meio de uma frase.
- Trechos não podem se sobrepor.
- Prefira: histórias completas, debates, explicações aprofundadas, polêmicas, momentos marcantes.
{extras}
Responda SOMENTE com um JSON válido (lista), sem texto fora do JSON, neste formato:
[{{"inicio": 123.4, "fim": 1500.0, "titulo": "título do vídeo (até 70 caracteres, chamativo, sem clickbait mentiroso)",
  "motivo": "por que esse trecho funciona como vídeo longo", "descricao": "descrição do vídeo para o YouTube, com resumo e emojis",
  "hashtags": ["#exemplo"],
  "thumb": {{"linha1": "2 a 3 palavras em branco, MAIÚSCULAS", "linha2": "2 a 3 palavras em amarelo, MAIÚSCULAS"}}}}]

TRANSCRIÇÃO:
{transcricao}
"""


def ajustar_limites(cortes, dados, cfg):
    """Encaixa início/fim nas fronteiras de palavras e limita à duração do episódio."""
    palavras = [w for s in dados["segmentos"] for w in s["palavras"]]
    if not palavras:
        return cortes
    for c in cortes:
        w_ini = min(palavras, key=lambda w: abs(w["inicio"] - c["inicio"]))
        w_fim = min(palavras, key=lambda w: abs(w["fim"] - c["fim"]))
        c["inicio"] = max(0.0, w_ini["inicio"] - cfg["folga_inicio"])
        c["fim"] = min(dados["duracao"], w_fim["fim"] + cfg["folga_fim"])
    return cortes


def claude_cli():
    """Caminho do executável do Claude Code (usado para entrar com a conta Claude), ou None."""
    exe = shutil.which("claude")
    if exe:
        return exe
    local = Path.home() / ".local" / "bin" / ("claude.exe" if os.name == "nt" else "claude")
    return str(local) if local.exists() else None


_SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def status_conta_claude():
    """{'instalado', 'conectado', 'email'} da conta Claude no Claude Code."""
    exe = claude_cli()
    if not exe:
        return {"instalado": False, "conectado": False, "email": None}
    try:
        r = subprocess.run([exe, "auth", "status"], capture_output=True, text=True, encoding="utf-8",
                           timeout=20, creationflags=_SEM_JANELA)
        d = json.loads(r.stdout)
    except (subprocess.SubprocessError, ValueError, OSError):
        return {"instalado": True, "conectado": False, "email": None}
    return {"instalado": True, "conectado": bool(d.get("loggedIn")), "email": d.get("email")}


def modo_claude():
    """'api' se houver chave, 'conta' se houver login no Claude Code, senão None."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "api"
    return "conta" if status_conta_claude()["conectado"] else None


def consultar_claude(prompt, cfg, modo):
    if modo == "api":
        import anthropic
        resp = anthropic.Anthropic().messages.create(
            model=cfg["modelo_claude"], max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in resp.content if b.type == "text")
    # conta Claude: chamada não interativa do Claude Code, sem ferramentas (só texto entra e sai)
    r = subprocess.run(
        [claude_cli(), "-p", "--output-format", "json", "--tools", "", "--no-session-persistence",
         # sem prompt de sistema padrão, plugins, MCP nem configurações do projeto: só o necessário
         "--system-prompt", "Você é um editor de cortes de podcast. Responda só o que foi pedido.",
         "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "",
         # modelo e esforço explícitos: sem isso o Claude Code usa o padrão da conta (modelo maior, raciocínio longo, bem mais lento)
         "--model", cfg["modelo_claude"], "--effort", cfg.get("esforco_claude", "medium")],
        input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=900, creationflags=_SEM_JANELA,
    )
    if CANCELAR.is_set():
        sys.exit("Cancelado pelo usuário.")
    try:
        d = json.loads(r.stdout)
    except ValueError:
        sys.exit(f"Falha ao chamar o Claude: {(r.stderr or r.stdout)[:300]}")
    if d.get("is_error"):
        sys.exit(f"Claude respondeu com erro: {d.get('result', '')[:300]}")
    return d["result"]


def texto_compacto(segmentos, ini=0.0, fim=None, bloco=25.0):
    """Transcrição enxuta para o prompt: junta segmentos em blocos de ~25 s, tempos inteiros ([inicio-fim] texto).
    Gasta bem menos tokens que um tempo com decimais por frase, e o corte é encaixado nas palavras depois."""
    linhas, atual = [], None
    for sg in segmentos:
        if sg["fim"] < ini or (fim is not None and sg["inicio"] > fim):
            continue
        if atual is None:
            atual = [sg["inicio"], sg["fim"], [sg["texto"].strip()]]
        else:
            atual[1] = sg["fim"]; atual[2].append(sg["texto"].strip())
        if atual[1] - atual[0] >= bloco:
            linhas.append(f"[{atual[0]:.0f}-{atual[1]:.0f}] {' '.join(atual[2])}"); atual = None
    if atual:
        linhas.append(f"[{atual[0]:.0f}-{atual[1]:.0f}] {' '.join(atual[2])}")
    return "\n".join(linhas)


def janelas_do_episodio(duracao, dmax, limite=2400):
    """Episódios longos são lidos em partes (com uma pequena sobreposição), pedidas ao Claude ao mesmo tempo."""
    if duracao <= limite * 1.25:
        return [(0.0, float(duracao))]
    n = -(-int(duracao) // limite)
    tam, sobra = duracao / n, min(dmax, 180)
    return [(max(0.0, i * tam - (sobra if i else 0)), min(float(duracao), (i + 1) * tam + (sobra if i < n - 1 else 0))) for i in range(n)]


def dividir_cotas(qtd, partes):
    """Reparte `qtd` cortes entre as partes (as primeiras ficam com o resto)."""
    return [qtd // partes + (1 if i < qtd % partes else 0) for i in range(partes)]


def selecionar(video: Path, cfg, manual=False):
    trab = pasta_trabalho(video)
    arq = trab / "cortes.json"
    adicionar = bool(cfg.get("adicionar")) and arq.exists()  # mantém os cortes atuais e acrescenta novos
    if arq.exists() and not adicionar:
        print(f"[selecionar] já existe: {arq} (apague para refazer)")
        return json.loads(arq.read_text(encoding="utf-8"))
    atuais = json.loads(arq.read_text(encoding="utf-8-sig")) if adicionar else []

    dados = transcrever(video, cfg)
    if manual:
        print(f"[selecionar] modo manual. Peça ao Claude para ler:\n  {trab / 'transcricao.txt'}\n"
              f"e salvar os cortes em:\n  {arq}")
        return None

    modo = modo_claude()
    if not modo:
        sys.exit("Claude não conectado. Clique no ícone da chave no topo do painel e entre com sua conta Claude "
                 "(ou cole uma chave de API), ou monte os cortes manualmente.")

    extras = f"- Instruções extras: {cfg['instrucoes_extras']}\n" if cfg["instrucoes_extras"] else ""
    if atuais:  # pede para não repetir o que já foi cortado (e confere depois, sem confiar só no pedido)
        usados = ", ".join(f"{c['inicio']:.0f}-{c['fim']:.0f}" for c in atuais)
        extras += f"- Já existem cortes nestes trechos (segundos): {usados}. Escolha trechos NOVOS, sem se sobrepor a nenhum deles.\n"
    longo = cfg.get("tipo_corte") == "longo"
    extras += licoes_para_prompt("longo" if longo else "short")
    qtd_final = cfg["qtd_cortes"]
    filtrar = bool(cfg.get("filtrar_por_nota")) and float(cfg.get("nota_minima") or 0) > 0 and qtd_final > 1
    qtd_busca = min(30, qtd_final * 2) if filtrar else qtd_final   # com filtro por nota, pede o dobro e fica com os melhores
    modelo_prompt = PROMPT_LONGO if longo else PROMPT
    janelas = janelas_do_episodio(dados["duracao"], cfg["duracao_max"])
    cotas = dividir_cotas(qtd_busca, len(janelas))
    if qtd_busca < len(janelas):  # poucos cortes pedidos (ex.: um corte específico): cada parte procura o seu
        cotas = [1] * len(janelas)
        extras += "- Se nada neste trecho combinar com o pedido, responda apenas []\n"
    pedidos = []
    for (j_ini, j_fim), qtd in zip(janelas, cotas):
        if qtd <= 0:
            continue
        aviso = (f"- Você está vendo só o trecho do episódio de {j_ini:.0f} a {j_fim:.0f} segundos. "
                 f"Escolha apenas trechos dentro dele.\n") if len(janelas) > 1 else ""
        pedidos.append(modelo_prompt.format(qtd=qtd, dmin=cfg["duracao_min"], dmax=cfg["duracao_max"], extras=extras + aviso,
                                            transcricao=texto_compacto(dados["segmentos"], j_ini, j_fim)))
    print(f"[selecionar] consultando Claude ({len(pedidos)} {'parte' if len(pedidos) == 1 else 'partes em paralelo'}) ...")
    progresso(None, "Claude está lendo a transcrição e escolhendo os cortes" if len(pedidos) == 1
              else f"Claude está lendo o episódio em {len(pedidos)} partes ao mesmo tempo")
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(4, len(pedidos))) as ex:
        respostas = list(ex.map(lambda pr: consultar_claude(pr, cfg, modo), pedidos))
    cortes = []
    for bruto in respostas:
        m = re.search(r"\[.*\]", bruto, re.DOTALL)
        if not m:
            sys.exit(f"Resposta sem JSON:\n{bruto}")
        cortes += json.loads(m.group(0))
    cortes = ajustar_limites(cortes, dados, cfg)
    unicos = []
    for c in sorted(cortes, key=lambda c: c["inicio"]):
        if all(min(c["fim"], u["fim"]) - max(c["inicio"], u["inicio"]) <= 1 for u in unicos):
            unicos.append(c)
    cortes = unicos
    if atuais:
        antes = len(cortes)
        cortes = [c for c in cortes if all(min(c["fim"], a["fim"]) - max(c["inicio"], a["inicio"]) <= 1 for a in atuais)]
        if len(cortes) < antes:
            print(f"[selecionar] {antes - len(cortes)} corte(s) descartado(s) por repetir trecho que já existia")
    for c in cortes:
        c.setdefault("id", novo_id())
        c.setdefault("velocidade", 1.0 if longo else cfg.get("velocidade_padrao", 1.0))
        c["tipo"] = "longo" if longo else "short"
    novos_ids = {c["id"] for c in cortes}
    cortes = atuais + cortes
    arq.write_text(json.dumps(cortes, indent=2, ensure_ascii=False), encoding="utf-8")
    if filtrar and novos_ids:
        cortes = filtrar_por_nota(video, cfg, cortes, novos_ids, qtd_final)
    for i, c in enumerate(cortes, 1):
        print(f"  {i}. [{fmt_tempo(c['inicio'])}-{fmt_tempo(c['fim'])}] {c['titulo']}")
    return cortes


# ---------------------------------------------------------------- potencial de viralização
def filtrar_por_nota(video, cfg, cortes, novos_ids, qtd_final):
    """Analisa os cortes novos e fica só com os que atingem `nota_minima` (os melhores, até `qtd_final`).
    Se nenhum atingir, mantém o melhor para você ter um ponto de partida."""
    minima = float(cfg["nota_minima"])
    print(f"[selecionar] analisando {len(novos_ids)} candidatos para ficar só com nota >= {minima:g} ...")
    analisar_cortes(video, cfg, novos_ids)
    analises = ler_analises(video)
    nota = lambda c: (analises.get(c["id"]) or {}).get("nota", -1)
    candidatos = sorted((c for c in cortes if c["id"] in novos_ids), key=nota, reverse=True)
    boas = [c for c in candidatos if nota(c) >= minima][:qtd_final]
    if not boas and candidatos:
        boas = candidatos[:1]
        print(f"[selecionar] nenhum candidato chegou a {minima:g}; mantido o melhor ({nota(boas[0]):g})")
    manter = {c["id"] for c in boas}
    descartados = novos_ids - manter
    cortes = [c for c in cortes if c["id"] not in descartados]
    for i in descartados:
        analises.pop(i, None)
    gravar_analises(video, analises)
    (pasta_trabalho(video) / "cortes.json").write_text(json.dumps(cortes, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[selecionar] {len(manter)} de {len(novos_ids)} candidatos ficaram (nota >= {minima:g}); {len(descartados)} descartados")
    return cortes


# Peso de cada critério na nota final (0-10). Cinco critérios são avaliados pelo Claude a partir do texto;
# "plataforma" (duração e ritmo de fala) é calculado aqui, por regra, para ser verificável.
PESOS_VIRAL = {"gancho": 25, "retencao": 20, "emocao": 15, "clareza": 15, "compartilhavel": 15, "plataforma": 10}
NOMES_VIRAL = {"gancho": "Gancho (primeiros 3 s)", "retencao": "Retenção", "emocao": "Emoção e impacto", "clareza": "Clareza e autonomia",
               "compartilhavel": "Potencial de compartilhamento", "plataforma": "Formato (duração e ritmo)"}
NOMES_VIRAL_LONGO = {"gancho": "Abertura e promessa", "retencao": "Retenção ao longo do vídeo", "emocao": "Emoção e impacto",
                    "clareza": "Estrutura (começo, meio e fim)", "compartilhavel": "Potencial de clique e compartilhamento",
                    "plataforma": "Formato (duração e ritmo)"}
AVISO_VIRAL = ("Estimativa feita por IA a partir do texto, da duração e do ritmo do corte. Não usa dados reais de TikTok, "
               "Reels ou YouTube e não garante resultado: serve para comparar cortes e apontar o que melhorar.")

PROMPT_VIRAL = """Você é analista de conteúdo curto (TikTok, Reels e YouTube Shorts) e avalia cortes de um podcast.
Seja crítico e calibrado: nota 5 é um corte mediano; 8 ou mais é raro (gancho forte e ideia completa); 9 e 10 quase nunca.
Para cada critério dê uma nota INTEIRA de 0 a 10 e uma justificativa curta (1 ou 2 frases) que cite trechos do texto.

Critérios:
- gancho: os 3 primeiros segundos prendem? (pergunta, afirmação ousada, curiosidade, promessa). Começar com "então", "bom", apresentação ou contexto = nota baixa.
- retencao: há motivo para assistir até o fim? (progressão, tensão, recompensa no final, sem trechos mortos).
- emocao: provoca reação (riso, indignação, surpresa, identificação)?
- clareza: faz sentido sozinho, sem o resto do episódio, e termina numa ideia completa?
- compartilhavel: alguém mandaria para um amigo ou comentaria? (opinião marcante, frase citável, tema em alta).

Além disso: "pontos_fortes" (até 3), "melhorias" (até 3, acionáveis: onde cortar, como reescrever o início) e "titulo_alternativo" (um título/gancho melhor, ou "" se o atual já é bom).
Responda SOMENTE com JSON válido (uma lista, um objeto por corte, na mesma ordem), neste formato:
[{{"id": "...", "criterios": {{"gancho": {{"nota": 0, "porque": "..."}}, "retencao": {{"nota": 0, "porque": "..."}}, "emocao": {{"nota": 0, "porque": "..."}}, "clareza": {{"nota": 0, "porque": "..."}}, "compartilhavel": {{"nota": 0, "porque": "..."}}}}, "resumo": "2 frases explicando a nota geral", "pontos_fortes": ["..."], "melhorias": ["..."], "titulo_alternativo": "..."}}]

CORTES:
{cortes}
"""


PROMPT_VIRAL_LONGO = """Você é analista de conteúdo do YouTube e avalia vídeos LONGOS (de 8 a 25 minutos) feitos a partir de um podcast.
Não compare com Shorts: a duração é esperada. Seja crítico e calibrado: nota 5 é um vídeo mediano; 7 é bom e publicável; 8 ou mais é raro.
Para cada critério dê uma nota INTEIRA de 0 a 10 e uma justificativa curta (1 ou 2 frases) que cite trechos do texto.

Critérios:
- gancho: a abertura (primeiros 30 s) cria uma promessa clara de por que ficar? O título combina com o que o vídeo entrega? Começar no meio de uma frase ou com enrolação = nota baixa.
- retencao: o vídeo mantém o interesse por minutos? (progressão, novas informações ou viradas, sem longos trechos mortos ou repetidos).
- emocao: provoca reação (riso, indignação, surpresa, identificação)?
- clareza: tem começo, meio e fim, um assunto central, e faz sentido sem o resto do episódio?
- compartilhavel: renderia clique em uma thumbnail e alguém comentaria ou mandaria para um amigo?

Além disso: "pontos_fortes" (até 3), "melhorias" (até 3, acionáveis: onde cortar o começo ou o fim, o que reescrever no título) e "titulo_alternativo" (um título melhor, ou "" se o atual já é bom).
Responda SOMENTE com JSON válido (uma lista, um objeto por vídeo, na mesma ordem), neste formato:
[{{"id": "...", "criterios": {{"gancho": {{"nota": 0, "porque": "..."}}, "retencao": {{"nota": 0, "porque": "..."}}, "emocao": {{"nota": 0, "porque": "..."}}, "clareza": {{"nota": 0, "porque": "..."}}, "compartilhavel": {{"nota": 0, "porque": "..."}}}}, "resumo": "2 frases explicando a nota geral", "pontos_fortes": ["..."], "melhorias": ["..."], "titulo_alternativo": "..."}}]

VÍDEOS:
{cortes}
"""


def hash_analise(c):
    """Muda quando o corte muda; a análise antiga passa a valer como 'desatualizada'."""
    base = {"i": round(float(c["inicio"]), 2), "f": round(float(c["fim"]), 2), "v": velocidade_de(c), "t": c.get("titulo", ""), "d": c.get("descricao", "")}
    if c.get("trechos"):
        base["tr"] = [[round(a, 2), round(b, 2)] for a, b in trechos_de(c)]
    return hashlib.sha1(json.dumps(base, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def ler_analises(video: Path) -> dict:
    arq = TRABALHO / video.stem / "analises.json"
    return json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else {}


def gravar_analises(video: Path, dados: dict):
    (pasta_trabalho(video) / "analises.json").write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")


def _faixa(valor, faixas):
    for limite, nota in faixas:
        if valor <= limite:
            return nota
    return faixas[-1][1]


def criterio_plataforma(c, n_palavras):
    """Nota 0-10 por regra: duração final e palavras por segundo. Devolve (nota, explicação, medidas)."""
    dur = duracao_efetiva(c) / velocidade_de(c)
    longo = c.get("tipo") == "longo"
    nd = _faixa(dur, [(180, 3), (360, 5), (480, 7), (1500, 10), (2100, 8), (3600, 6), (1e9, 4)]) if longo \
        else _faixa(dur, [(10, 4), (15, 6), (45, 10), (60, 8), (90, 6), (180, 4), (1e9, 2)])
    ritmo = n_palavras / dur if dur else 0
    nr = 10 if 2.4 <= ritmo <= 3.6 else 8 if 2.0 <= ritmo <= 4.2 else 6 if 1.6 <= ritmo <= 5.0 else 4
    nota = round((nd + nr) / 2)
    faixa = "melhor faixa para vídeos longos: 8 a 25 min" if longo else "melhor faixa para Shorts: 15 a 45 s"
    porque = (f"Duração final de {dur:.0f} s ({faixa}) e ritmo de {ritmo:.1f} palavras por segundo "
              f"(ideal: 2,4 a 3,6). Esta nota é calculada por regra, não pelo Claude.")
    return nota, porque, {"duracao_s": round(dur, 1), "palavras_por_s": round(ritmo, 2)}


def veredito_viral(nota):
    return "Alto potencial" if nota >= 8 else "Bom potencial" if nota >= 6.5 else "Potencial mediano" if nota >= 5 else "Potencial baixo"


def analisar_cortes(video: Path, cfg, ids=None):
    """Analisa o potencial de viralização dos cortes. `ids` = só esses (sempre refeitos); sem `ids`, os que faltam ou mudaram."""
    trab = pasta_trabalho(video)
    cortes = json.loads((trab / "cortes.json").read_text(encoding="utf-8-sig"))
    dados = json.loads((trab / "transcricao.json").read_text(encoding="utf-8-sig"))
    palavras = [w for s in dados["segmentos"] for w in s["palavras"]]
    analises = ler_analises(video)
    alvo = [c for c in cortes if (c.get("id") in ids if ids is not None else analises.get(c.get("id"), {}).get("hash") != hash_analise(c))]
    if not alvo:
        print("[analisar] nada a analisar: todas as análises estão em dia")
        progresso(100, "Tudo já estava analisado")
        return
    modo = modo_claude()
    if not modo:
        sys.exit("Claude não conectado. Clique no ícone da chave no topo do painel e entre com sua conta Claude (ou cole uma chave de API).")

    # lotes pequenos, pedidos ao Claude ao mesmo tempo; a nota é só pontuação de critérios, então o esforço padrão é baixo
    LOTE = 3
    cfg_a = {**cfg, "esforco_claude": cfg.get("esforco_analise", "low")}
    tam = {"short": LOTE, "longo": 2}   # vídeos longos têm muito texto: lotes menores
    lotes, preparados = [], []
    for tp in ("short", "longo"):
        grupo = [c for c in alvo if (c.get("tipo") or "short") == tp]
        lotes += [(tp, grupo[k:k + tam[tp]]) for k in range(0, len(grupo), tam[tp])]
    for tp, lote in lotes:
        blocos, medidas = [], {}
        for c in lote:
            vel = velocidade_de(c)
            dentro = palavras_virtuais(palavras, c)
            abertura = " ".join(w["p"] for w in dentro if w["inicio"] < c["inicio"] + 3 * vel)
            nota_p, porque_p, med = criterio_plataforma(c, len(dentro))
            medidas[c["id"]] = (nota_p, porque_p, med)
            blocos.append(f'### id={c["id"]} | duração final {med["duracao_s"]:.0f} s | velocidade {vel:g}x | título: {c.get("titulo", "")} | descrição: {c.get("descricao", "")}\n'
                          f'Primeiros 3 segundos: "{abertura}"\nTexto completo: "{" ".join(w["p"] for w in dentro)}"')
        modelo_p = (PROMPT_VIRAL_LONGO if tp == "longo" else PROMPT_VIRAL).format(cortes="\n\n".join(blocos))
        lic = licoes_para_prompt(tp)
        if lic:  # lições dos resultados reais ajudam a calibrar a nota; a régua dos critérios continua a mesma
            modelo_p = modelo_p.replace("\nCORTES:\n", f"\n{lic}\nCORTES:\n", 1).replace("\nVÍDEOS:\n", f"\n{lic}\nVÍDEOS:\n", 1)
        preparados.append((lote, medidas, modelo_p, tp))

    print(f"[analisar] consultando Claude ({len(alvo)} cortes em {len(lotes)} {'lote' if len(lotes) == 1 else 'lotes'}, até 4 ao mesmo tempo) ...")
    progresso(0, f"Analisando {len(alvo)} {'corte' if len(alvo) == 1 else 'cortes'}")
    def aplicar(i, bruto):
        """Grava as notas de um lote assim que ele volta (o painel mostra cada nota na hora)."""
        lote, medidas, _, tp = preparados[i]
        nomes = NOMES_VIRAL_LONGO if tp == "longo" else NOMES_VIRAL
        m = re.search(r"\[.*\]", bruto, re.DOTALL)
        if not m:
            sys.exit(f"Resposta sem JSON:\n{bruto[:500]}")
        por_id = {a.get("id"): a for a in json.loads(m.group(0))}
        for c in lote:
            a = por_id.get(c["id"])
            if not a:
                print(f"  aviso: sem análise para o corte {c['id']}")
                continue
            criterios = {}
            for chave in ("gancho", "retencao", "emocao", "clareza", "compartilhavel"):
                x = a.get("criterios", {}).get(chave, {})
                criterios[chave] = {"nota": max(0, min(10, int(round(float(x.get("nota", 0)))))), "porque": str(x.get("porque", "")).strip()}
            nota_p, porque_p, med = medidas[c["id"]]
            criterios["plataforma"] = {"nota": nota_p, "porque": porque_p}
            total = sum(PESOS_VIRAL.values())
            nota = round(sum(criterios[k2]["nota"] * PESOS_VIRAL[k2] for k2 in PESOS_VIRAL) / total, 1)
            for k2 in criterios:
                criterios[k2].update(nome=nomes[k2], peso=PESOS_VIRAL[k2])
            analises[c["id"]] = {
                "nota": nota, "veredito": veredito_viral(nota), "resumo": str(a.get("resumo", "")).strip(),
                "criterios": criterios, "medidas": med,
                "pontos_fortes": [str(x) for x in a.get("pontos_fortes", [])][:3], "melhorias": [str(x) for x in a.get("melhorias", [])][:3],
                "titulo_alternativo": str(a.get("titulo_alternativo", "")).strip(), "hash": hash_analise(c),
                "analisado_em": time.time(), "aviso": AVISO_VIRAL,
            }
            print(f"  {nota:>4}  {c.get('titulo', '')[:60]}")
        gravar_analises(video, analises)

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=min(4, len(preparados))) as ex:
        futuros = {ex.submit(consultar_claude, pr[2], cfg_a, modo): i for i, pr in enumerate(preparados)}
        for n_ok, fut in enumerate(as_completed(futuros), 1):
            aplicar(futuros[fut], fut.result())
            progresso(n_ok / len(preparados) * 100, f"Análise: {n_ok} de {len(preparados)} lotes prontos")

    progresso(100, "Análise concluída")


# ---------------------------------------------------------------- aprender com os resultados reais
# O Claude não "treina": as lições abaixo são escritas por ele a partir dos resultados que VOCÊ registra e
# entram como contexto nos prompts de escolha e de análise dos próximos cortes.
DESEMPENHO = BASE / "desempenho.json"   # {"<episodio>|<id do corte>": {...resultado + retrato do corte na hora}}
LICOES = BASE / "licoes.json"            # {"atualizado_em", "n_resultados", "resumo", "calibracao", "licoes": [{"tipo","texto","forca"}]}
CAMPOS_RESULTADO = ("plataforma", "postado_em", "views", "curtidas", "comentarios", "compartilhamentos", "retencao_pct", "observacao")


def ler_desempenho() -> dict:
    return json.loads(DESEMPENHO.read_text(encoding="utf-8-sig")) if DESEMPENHO.exists() else {}


def gravar_desempenho(d: dict):
    DESEMPENHO.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")


def ler_licoes() -> dict:
    return json.loads(LICOES.read_text(encoding="utf-8-sig")) if LICOES.exists() else {}


def licoes_para_prompt(tipo: str) -> str:
    """Linhas de lições (do tipo 'short'/'longo' e as gerais) para colar em um prompt; vazio se ainda não há."""
    itens = [l for l in ler_licoes().get("licoes", []) if l.get("tipo") in (tipo, "ambos", None)]
    if not itens:
        return ""
    return ("- Lições aprendidas com os resultados REAIS dos cortes anteriores deste canal (use como guia, sem repetir cegamente):\n"
            + "\n".join(f"  * {l['texto']}" for l in itens[:8]) + "\n")


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs) ** 0.5
    sy = sum((y - my) ** 2 for y in ys) ** 0.5
    return None if sx == 0 or sy == 0 else round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 2)


def correlacoes(dados: dict) -> dict:
    """Correlação (Pearson) entre a nota prevista e as visualizações reais (log), geral e por critério. Indicativo, não prova."""
    import math
    itens = [d for d in dados.values() if d.get("views") is not None and d.get("nota_prevista") is not None]
    ys = [math.log1p(float(d["views"])) for d in itens]
    out = {"n": len(itens), "nota": _pearson([float(d["nota_prevista"]) for d in itens], ys), "criterios": {}}
    for k in PESOS_VIRAL:
        pares = [(float(d["criterios"][k]), y) for d, y in zip(itens, ys) if k in (d.get("criterios") or {})]
        out["criterios"][k] = _pearson([p[0] for p in pares], [p[1] for p in pares])
    return out


PROMPT_APRENDER = """Você é analista de desempenho de vídeos de podcast cortados para redes sociais.
Abaixo estão os vídeos que o usuário POSTOU, com o que foi previsto antes (nota viral e critérios, texto de abertura, duração) e o resultado REAL (visualizações, curtidas, comentários, compartilhamentos, retenção média %).
Descubra o que de fato funcionou e o que não funcionou NESTE canal, e escreva lições curtas e acionáveis para quem escolhe e avalia os próximos cortes.
Regras: baseie cada lição nos dados (cite padrões, não invente); a amostra é pequena, então marque "forca": "fraca" quando houver poucos casos e nunca trate uma coincidência como regra;
diga também se a nota prevista parece otimista ou pessimista em relação aos resultados e quais critérios parecem prever melhor. Máximo de 8 lições.
Responda SOMENTE com JSON válido:
{{"resumo": "2 frases sobre o que os resultados mostram", "calibracao": "como a nota prevista se compara ao resultado real, em 1 ou 2 frases",
  "licoes": [{{"tipo": "short" ou "longo" ou "ambos", "texto": "lição acionável e específica", "forca": "fraca" ou "media" ou "forte"}}]}}

CORRELAÇÃO LOCAL (nota prevista x visualizações, -1 a 1; n = vídeos): {correlacao}

VÍDEOS POSTADOS:
{videos}
"""


def aprender(cfg):
    """Atualiza `licoes.json` a partir dos resultados registrados (mínimo 3 vídeos com visualizações)."""
    dados = ler_desempenho()
    uteis = {k: v for k, v in dados.items() if v.get("views") is not None}
    if len(uteis) < 3:
        sys.exit("Registre o resultado de pelo menos 3 vídeos postados (visualizações) para o Claude encontrar padrões.")
    modo = modo_claude()
    if not modo:
        sys.exit("Claude não conectado. Clique no ícone da chave no topo do painel e entre com sua conta Claude (ou cole uma chave de API).")
    cor = correlacoes(uteis)
    campos = ("titulo", "tipo", "duracao_s", "nota_prevista", "criterios", "abertura", "plataforma", "views", "curtidas", "comentarios",
              "compartilhamentos", "retencao_pct", "observacao")
    videos = "\n".join(json.dumps({c: v.get(c) for c in campos if v.get(c) not in (None, "")}, ensure_ascii=False) for v in uteis.values())
    print(f"[aprender] consultando Claude ({len(uteis)} vídeos com resultado) ...")
    progresso(None, f"Claude está analisando {len(uteis)} resultados")
    bruto = consultar_claude(PROMPT_APRENDER.format(correlacao=json.dumps(cor, ensure_ascii=False), videos=videos), cfg, modo)
    m = re.search(r"\{.*\}", bruto, re.DOTALL)
    if not m:
        sys.exit(f"Resposta sem JSON:\n{bruto[:500]}")
    r = json.loads(m.group(0))
    licoes = [{"tipo": l.get("tipo") if l.get("tipo") in ("short", "longo", "ambos") else "ambos", "texto": str(l.get("texto", "")).strip(),
               "forca": l.get("forca") if l.get("forca") in ("fraca", "media", "forte") else "fraca"}
              for l in r.get("licoes", []) if str(l.get("texto", "")).strip()][:8]
    LICOES.write_text(json.dumps({"atualizado_em": time.time(), "n_resultados": len(uteis), "resumo": str(r.get("resumo", "")).strip(),
                                  "calibracao": str(r.get("calibracao", "")).strip(), "correlacao": cor, "licoes": licoes},
                                 indent=2, ensure_ascii=False), encoding="utf-8")
    progresso(100, "Lições atualizadas")
    print(f"[aprender] {len(licoes)} lições gravadas")


# ---------------------------------------------------------------- melhorar cortes com o Claude
PROMPT_MELHORAR = """Você é editor de vídeo de podcast. Recebe UM corte já escolhido, a análise dele (com o que melhorar) e a transcrição do trecho
e de uma margem antes e depois, em blocos [inicio-fim] texto, com tempos em segundos do episódio.
Sua tarefa é melhorar o corte aplicando as sugestões, SEM inventar falas nem mudar o sentido. Você pode:
- ajustar início e fim (use a margem fornecida);
- tirar trechos do meio (tangentes, repetições, pausas, enrolação): informe "trechos" = as partes MANTIDAS, em ordem e sem sobreposição;
- dividir em 2 ou mais cortes independentes quando o trecho mistura assuntos ou é longo demais.
Regras: cada corte resultante precisa fazer sentido sozinho, começar em um gancho e terminar em uma ideia completa, e ter duração
final (somando só as partes mantidas) entre {dmin} e {dmax} segundos. {tipo_regra}Se o corte já está bom, devolva-o quase igual (acao "ajustar").
Responda SOMENTE com JSON válido neste formato:
{{"acao": "ajustar" ou "dividir", "resumo": "o que você mudou e por quê, em 1 ou 2 frases",
  "cortes": [{{"inicio": 0.0, "fim": 0.0, "trechos": [[0.0, 0.0]], "titulo": "...", "descricao": "...", "hashtags": ["#..."]}}]}}
("trechos" pode ser [] se o corte for contínuo.)

CORTE ATUAL: de {inicio:.0f} a {fim:.0f} s (duração {dur:.0f} s). Título: {titulo}
MELHORIAS SUGERIDAS NA ANÁLISE:
{melhorias}

TRANSCRIÇÃO (margem incluída):
{transcricao}
"""


def melhorar_cortes(video: Path, cfg, ids):
    """Pede ao Claude para melhorar os cortes `ids`: ajustar limites, tirar trechos do meio ou dividir.
    Os cortes novos entram logo depois do original (marcados com `melhorado_de`) e são analisados em seguida.
    Com `substituir`, o original é removido; senão ele é mantido para você comparar."""
    trab = pasta_trabalho(video)
    arq = trab / "cortes.json"
    cortes = json.loads(arq.read_text(encoding="utf-8-sig"))
    dados = json.loads((trab / "transcricao.json").read_text(encoding="utf-8-sig"))
    analises = ler_analises(video)
    alvo = [c for c in cortes if c.get("id") in (ids or set())]
    if not alvo:
        sys.exit("Nenhum corte para melhorar. Salve os cortes e selecione ao menos um.")
    modo = modo_claude()
    if not modo:
        sys.exit("Claude não conectado. Clique no ícone da chave no topo do painel e entre com sua conta Claude (ou cole uma chave de API).")

    def pedido(c):
        longo = c.get("tipo") == "longo"
        margem = 120 if longo else 45
        melhorias = (analises.get(c["id"]) or {}).get("melhorias") or ["(sem análise: melhore o gancho inicial e corte enrolação)"]
        dmin, dmax = (cfg["duracao_min"], cfg["duracao_max"]) if not longo else (300, 1500)
        return PROMPT_MELHORAR.format(
            dmin=dmin, dmax=dmax, inicio=c["inicio"], fim=c["fim"], dur=duracao_efetiva(c), titulo=c.get("titulo", ""),
            tipo_regra="Este é um vídeo longo de YouTube (16:9): capítulos completos, não Shorts. " if longo else "",
            melhorias="\n".join(f"- {m}" for m in melhorias),
            transcricao=texto_compacto(dados["segmentos"], c["inicio"] - margem, c["fim"] + margem, bloco=10))

    print(f"[melhorar] consultando Claude ({len(alvo)} {'corte' if len(alvo) == 1 else 'cortes'}) ...")
    progresso(0, f"Claude está melhorando {len(alvo)} {'corte' if len(alvo) == 1 else 'cortes'}")
    from concurrent.futures import ThreadPoolExecutor, as_completed
    respostas = {}
    with ThreadPoolExecutor(max_workers=min(3, len(alvo))) as ex:
        futuros = {ex.submit(consultar_claude, pedido(c), cfg, modo): c["id"] for c in alvo}
        for n_ok, fut in enumerate(as_completed(futuros), 1):
            respostas[futuros[fut]] = fut.result()
            progresso(n_ok / len(alvo) * 100, f"Melhorados {n_ok} de {len(alvo)}")

    palavras = [w for s in dados["segmentos"] for w in s["palavras"]]
    novos_ids, saida = [], []
    for c in cortes:
        saida.append(c)
        bruto = respostas.get(c.get("id"))
        if bruto is None:
            continue
        m = re.search(r"\{.*\}", bruto, re.DOTALL)
        if not m:
            print(f"  aviso: resposta sem JSON para o corte {c['id']}")
            continue
        try:
            r = json.loads(m.group(0))
        except ValueError:
            print(f"  aviso: JSON inválido para o corte {c['id']}")
            continue
        novos = []
        for n in r.get("cortes", []):
            try:
                ini, fim = float(n["inicio"]), float(n["fim"])
            except (KeyError, TypeError, ValueError):
                continue
            if fim - ini < 5:
                continue
            ajustado = ajustar_limites([{"inicio": ini, "fim": fim}], dados, cfg)[0]
            trechos = []
            for par in n.get("trechos") or []:
                try:
                    a, b = float(par[0]), float(par[1])
                except (TypeError, ValueError, IndexError):
                    continue
                if b - a >= 0.3:
                    trechos.append([max(ajustado["inicio"], a), min(ajustado["fim"], b)])
            novo = {**{k: v for k, v in c.items() if k not in ("id", "trechos", "thumb")},
                    "id": novo_id(), "inicio": round(ajustado["inicio"], 2), "fim": round(ajustado["fim"], 2),
                    "titulo": str(n.get("titulo") or c.get("titulo", "")).strip(),
                    "descricao": str(n.get("descricao") or c.get("descricao", "")).strip(),
                    "hashtags": [str(h) for h in (n.get("hashtags") or c.get("hashtags", []))],
                    "melhorado_de": c["id"], "motivo": str(r.get("resumo", "")).strip()}
            if len(trechos) > 1:
                novo["trechos"] = [[round(a, 2), round(b, 2)] for a, b in trechos]
            novos.append(novo)
        print(f"  corte {c['id']}: {r.get('acao', '?')} -> {len(novos)} corte(s). {str(r.get('resumo', ''))[:200]}")
        if cfg.get("substituir") and novos:
            saida.pop()
        saida += novos
        novos_ids += [n["id"] for n in novos]
    arq.write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")
    if novos_ids:
        progresso(None, "Analisando os cortes melhorados")
        analisar_cortes(video, cfg, set(novos_ids))
    else:
        print("[melhorar] nenhum corte novo foi criado")
    progresso(100, "Melhoria concluída")


# ---------------------------------------------------------------- logo da marca
def preparar_logo(origem: Path, destino: Path):
    """Normaliza a logo para PNG com fundo transparente. Se vier quadrada com cantos brancos e opaca
    (logo redonda em fundo branco), recorta em círculo."""
    from PIL import Image, ImageDraw

    im = Image.open(origem).convert("RGBA")
    w, h = im.size
    if im.getchannel("A").getextrema()[0] == 255 and abs(w - h) <= 0.05 * max(w, h):
        k = max(2, w // 25)
        cantos = [im.getpixel(xy)[:3] for xy in ((k, k), (w - k, k), (k, h - k), (w - k, h - k))]
        if all(min(c) > 235 for c in cantos):
            sup = Image.new("L", (w * 4, h * 4), 0)  # máscara em 4x para o contorno ficar liso
            ImageDraw.Draw(sup).ellipse((w * 0.02 * 4, h * 0.02 * 4, w * 0.98 * 4, h * 0.98 * 4), fill=255)
            im.putalpha(sup.resize((w, h), Image.LANCZOS))
    im.thumbnail((1024, 1024))
    LOGOS.mkdir(exist_ok=True)
    im.save(destino, "PNG")


def logo_ativa(cfg):
    """Caminho da logo a aplicar (ou None)."""
    if not cfg.get("usar_logo", True) or not cfg.get("logo"):
        return None
    arq = LOGOS / Path(cfg["logo"]).name
    return arq if arq.is_file() else None


def posicao_logo(cfg, vertical, lw, lh, src_w, src_h):
    """(x, y) da logo na tela final. Em 9:16 o vídeo fica no meio e sobra uma faixa em cima e embaixo:
    'topo-centro' e 'baixo-centro' centralizam a logo nessa faixa, quando ela cabe."""
    W, H = (1080, 1920) if vertical else (1920, 1080)
    m = round(W * 0.04)
    banda = (H - W * src_h / src_w) / 2 if vertical and src_w else 0
    pos = cfg.get("logo_posicao", "topo-centro")
    x = {"esquerda": m, "direita": W - lw - m}.get(pos.split("-")[-1], (W - lw) // 2)
    cabe = banda >= lh + 2 * m
    if pos == "centro":
        y = (H - lh) // 2
    elif pos.startswith("topo"):
        y = round((banda - lh) / 2) if pos == "topo-centro" and cabe else m
    else:
        y = round(H - banda / 2 - lh / 2) if pos == "baixo-centro" and cabe else H - lh - m
    return int(x), int(y)


def dimensoes_video(ffmpeg, video: Path):
    """(largura, altura) do vídeo de origem, ou (0, 0) se for só áudio."""
    probe = Path(ffmpeg).with_name(Path(ffmpeg).name.replace("ffmpeg", "ffprobe"))
    try:
        r = subprocess.run([str(probe), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", str(video)], capture_output=True, text=True, timeout=30, creationflags=_SEM_JANELA)
        w, h = r.stdout.strip().split(",")[:2]
        return int(w), int(h)
    except (ValueError, OSError, subprocess.SubprocessError):
        return 0, 0


# ---------------------------------------------------------------- 3. cortar
def tempo_ass(t):
    h, resto = divmod(t, 3600)
    m, s = divmod(resto, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def gerar_ass(palavras, ini, fim, destino: Path, cfg, vertical, vel=1.0):
    """Legenda em blocos de N palavras. Tempos relativos ao início do corte e já divididos pela velocidade."""
    largura, altura = (1080, 1920) if vertical else (1920, 1080)
    n = cfg["palavras_por_legenda"]
    tam = cfg["tamanho_legenda"] * (largura / 1080 * 5 if vertical else 3.2)
    alinhamento, margem_v = {"baixo": (2, 380 if vertical else 80), "meio": (5, 0),
                             "alto": (8, 300 if vertical else 80)}.get(cfg.get("posicao_legenda", "baixo"), (2, 380))
    hexa = (cfg.get("cor_legenda") or "#FFFFFF").lstrip("#")
    cor = f"&H00{hexa[4:6]}{hexa[2:4]}{hexa[0:2]}".upper()  # ASS usa BGR
    cab = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {largura}\nPlayResY: {altura}\nWrapStyle: 2\n\n"
        "[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,"
        "BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,"
        "Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"Style: Padrao,{cfg['fonte_legenda']},{tam:.0f},{cor},&H000000FF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,5,2,{alinhamento},60,60,{margem_v},1\n\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )
    uteis = [w for w in palavras if w["fim"] > ini and w["inicio"] < fim]
    linhas = []
    for i in range(0, len(uteis), n):
        bloco = uteis[i:i + n]
        t0 = max(bloco[0]["inicio"] - ini, 0)
        t1 = min(bloco[-1]["fim"], fim) - ini
        if i + n < len(uteis):  # estende até a próxima palavra para não piscar
            t1 = max(t1, min(uteis[i + n]["inicio"] - ini, t1 + 0.4))
        txt = " ".join(w["p"] for w in bloco).upper().replace("{", "(").replace("}", ")")
        linhas.append(f"Dialogue: 0,{tempo_ass(t0 / vel)},{tempo_ass(t1 / vel)},Padrao,,0,0,0,,{txt}")
    destino.write_text(cab + "\n".join(linhas) + "\n", encoding="utf-8-sig")


def extras_do_filtro(f, rotulo, vel, logo, ass_nome):
    """Encadeia velocidade, logo e legenda (nessa ordem) sobre o rótulo atual. A logo e a legenda
    entram depois da velocidade; os tempos da legenda já foram divididos por ela."""
    if vel != 1:
        f += f";{rotulo}setpts=PTS/{vel:.4f}[vs]"
        rotulo = "[vs]"
    if logo:
        f += (f";[{logo['idx']}:v]scale={logo['w']}:-1,format=rgba,colorchannelmixer=aa={logo['op']:.2f}[lg]"
              f";{rotulo}[lg]overlay={logo['x']}:{logo['y']}[vl]")
        rotulo = "[vl]"
    if ass_nome:
        f += f";{rotulo}ass={ass_nome}[vo]"
        rotulo = "[vo]"
    return f, rotulo


def filtro_video(vertical, ass_nome, vel=1.0, logo=None):
    if vertical:
        # fundo desfocado preenchendo 9:16 + vídeo original centralizado
        f = ("[0:v]split=2[a][b];"
             "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:5[bg];"
             "[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]")
    else:
        f = "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v]"
    return extras_do_filtro(f, "[v]", vel, logo, ass_nome)


def trechos_de(c):
    """Partes mantidas do corte, em segundos do episódio: [(ini, fim), ...]. Sem `trechos`, o corte inteiro.
    `trechos` permite tirar partes do meio (tangentes, pausas) sem dividir o corte."""
    ini, fim = float(c["inicio"]), float(c["fim"])
    brutos = c.get("trechos") or []
    partes = sorted((max(ini, float(a)), min(fim, float(b))) for a, b in brutos)
    partes = [(a, b) for a, b in partes if b - a >= 0.3]
    return partes if partes else [(ini, fim)]


def duracao_efetiva(c):
    """Duração do corte em segundos do episódio, já sem os trechos removidos (antes da velocidade)."""
    return sum(b - a for a, b in trechos_de(c))


def palavras_virtuais(palavras, c):
    """Palavras dos trechos mantidos numa linha do tempo contínua que começa em `inicio` (para a legenda)."""
    saida, acum = [], 0.0
    ini = float(c["inicio"])
    for a, b in trechos_de(c):
        for w in palavras:
            if w["fim"] > a and w["inicio"] < b:
                saida.append({"p": w["p"], "inicio": ini + acum + max(w["inicio"], a) - a, "fim": ini + acum + min(w["fim"], b) - a})
        acum += b - a
    return saida


def velocidade_de(c):
    return min(2.0, max(0.5, float(c.get("velocidade") or 1.0)))


def cfg_do_corte(c, cfg):
    """Vídeo longo sai sempre em 16:9; legenda queimada só se `legendas_longo` estiver ligado."""
    if c.get("tipo") != "longo":
        return cfg
    return {**cfg, "formato": "horizontal", "legendas": bool(cfg.get("legendas_longo", False)),
            "logo_posicao": cfg.get("logo_posicao_longo", "topo-direita"), "logo_tamanho": cfg.get("logo_tamanho_longo", 9)}


def hash_render(c, cfg):
    """Identifica tudo que muda o vídeo final. Se o hash mudou, o vídeo gerado está desatualizado."""
    cfg = cfg_do_corte(c, cfg)
    chaves = {"i": round(float(c["inicio"]), 2), "f": round(float(c["fim"]), 2), "v": velocidade_de(c),
              **({"tr": [[round(a, 2), round(b, 2)] for a, b in trechos_de(c)]} if c.get("trechos") else {}),
              "fmt": cfg["formato"], "leg": bool(cfg["legendas"]), "pl": cfg["palavras_por_legenda"],
              "tam": cfg["tamanho_legenda"], "fonte": cfg["fonte_legenda"], "cor": cfg.get("cor_legenda"),
              "pos": cfg.get("posicao_legenda")}
    logo = logo_ativa(cfg)
    if logo:  # inclui data e tamanho do arquivo: trocar a imagem também deixa o vídeo desatualizado
        chaves["logo"] = [logo.name, logo.stat().st_size, int(logo.stat().st_mtime), cfg.get("logo_posicao"),
                          cfg.get("logo_tamanho"), cfg.get("logo_opacidade")]
    return hashlib.sha1(json.dumps(chaves, sort_keys=True).encode()).hexdigest()[:12]


def ler_renders(video: Path) -> dict:
    arq = TRABALHO / video.stem / "renders.json"
    return json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else {}


def gravar_renders(video: Path, dados: dict):
    (pasta_trabalho(video) / "renders.json").write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")


def cortar(video: Path, cfg, ids=None):
    """Gera os vídeos. `ids` = só esses cortes (sempre refeitos); sem `ids`, gera os que faltam ou mudaram."""
    trab = pasta_trabalho(video)
    arq_cortes = trab / "cortes.json"
    if not arq_cortes.exists():
        sys.exit(f"Sem {arq_cortes}. Rode 'selecionar' antes.")
    cortes = json.loads(arq_cortes.read_text(encoding="utf-8-sig"))
    dados = json.loads((trab / "transcricao.json").read_text(encoding="utf-8-sig"))
    palavras = [w for s in dados["segmentos"] for w in s["palavras"]]
    ffmpeg = achar_ffmpeg()
    e_audio = video.suffix.lower() in EXT_AUDIO
    destino = SAIDA / video.stem
    destino.mkdir(parents=True, exist_ok=True)
    renders = ler_renders(video)
    src_w, src_h = (0, 0) if e_audio else dimensoes_video(ffmpeg, video)

    alvo = []
    for i, c in enumerate(cortes, 1):
        cid = c.get("id") or f"{i:02d}"
        if ids is not None:
            if cid in ids:
                alvo.append((i, cid, c))
        else:
            r = renders.get(cid)
            if not (r and r.get("hash") == hash_render(c, cfg) and (destino / r["arquivo"]).exists()):
                alvo.append((i, cid, c))
    if not alvo:
        print("[cortar] nada a gerar: todos os vídeos já estão atualizados")
        progresso(100, "Tudo já estava pronto")
        return

    for n, (i, cid, c) in enumerate(alvo):
        nome = f"{i:02d}_{slug(c['titulo'])}_{cid}"
        ini, fim = float(c["inicio"]), float(c["fim"])
        vel = velocidade_de(c)
        cfgo, cfg_ = cfg, cfg_do_corte(c, cfg)  # cfg_ = configuração efetiva deste corte
        cfg = cfg_
        vertical = cfg["formato"] == "vertical"
        logo_arq = logo_ativa(cfg)
        trs = trechos_de(c)
        total = duracao_efetiva(c)
        print(f"[cortar] {nome}  ({total:.0f}s{f' em {len(trs)} trechos' if len(trs) > 1 else ''} a {vel:g}x = {total / vel:.0f}s)")
        progresso(n / len(alvo) * 100, f"Corte {n + 1} de {len(alvo)}: {c['titulo']}")

        antigo = renders.get(cid)  # remove a versão anterior deste corte (e só dele)
        if antigo:
            for ext in (".mp4", ".ass", ".txt"):
                (destino / (Path(antigo["arquivo"]).stem + ext)).unlink(missing_ok=True)

        ass_nome = None
        if cfg["legendas"] and palavras:
            ass_nome = f"{nome}.ass"
            if len(trs) > 1:
                gerar_ass(palavras_virtuais(palavras, c), ini, ini + total, destino / ass_nome, cfg, vertical, vel)
            else:
                gerar_ass(palavras, ini, fim, destino / ass_nome, cfg, vertical, vel)

        logo = None
        if logo_arq:
            from PIL import Image
            with Image.open(logo_arq) as im:
                larg = round((1080 if vertical else 1920) * cfg.get("logo_tamanho", 22) / 100)
                alt = round(larg * im.height / im.width)
            x, y = posicao_logo(cfg, vertical, larg, alt, src_w, src_h)
            logo = {"w": larg, "x": x, "y": y, "op": cfg.get("logo_opacidade", 100) / 100}

        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
        if e_audio:  # podcast só em áudio: gera fundo preto
            cmd += ["-f", "lavfi", "-i", f"color=c=black:s={'1080x1920' if vertical else '1920x1080'}:r=30:d={total / vel:.2f}"]
            cmd += ["-ss", f"{ini:.2f}", "-t", f"{fim - ini:.2f}", "-i", str(video)]
            if logo:
                cmd += ["-i", str(logo_arq)]
                logo["idx"] = 2
            filtro, saida_v = extras_do_filtro("[0:v]null[v]", "[v]", vel, logo, ass_nome)
            mapa = ["-map", saida_v, "-map", "1:a"]
        else:
            cmd += ["-ss", f"{ini:.2f}", "-t", f"{fim - ini:.2f}", "-i", str(video)]
            if logo:
                cmd += ["-i", str(logo_arq)]
                logo["idx"] = 1
            filtro, saida_v = filtro_video(vertical, ass_nome, vel, logo)
            mapa = ["-map", saida_v, "-map", "0:a?"]
        if len(trs) > 1:  # vários trechos: corta cada parte (tempos relativos ao -ss) e junta, antes dos demais filtros
            ai = 1 if e_audio else 0
            pre = ""
            if not e_audio:
                pre += "".join(f"[0:v]trim=start={a - ini:.3f}:end={b - ini:.3f},setpts=PTS-STARTPTS[v{k}];" for k, (a, b) in enumerate(trs))
                pre += "".join(f"[v{k}]" for k in range(len(trs))) + f"concat=n={len(trs)}:v=1:a=0[vc];"
                filtro = filtro.replace("[0:v]", "[vc]", 1)
            pre += "".join(f"[{ai}:a]atrim=start={a - ini:.3f}:end={b - ini:.3f},asetpts=PTS-STARTPTS[a{k}];" for k, (a, b) in enumerate(trs))
            pre += "".join(f"[a{k}]" for k in range(len(trs))) + f"concat=n={len(trs)}:v=0:a=1[ac];"
            pre += f"[ac]atempo={vel:.4f}[ao];" if vel != 1 else "[ac]anull[ao];"
            filtro = pre + filtro
            mapa = [mapa[0], mapa[1], "-map", "[ao]"]
            cmd += ["-filter_complex", filtro] + mapa
        else:
            cmd += ["-filter_complex", filtro] + mapa
            if vel != 1:
                cmd += ["-af", f"atempo={vel:.4f}"]  # acelera sem mudar o tom da voz
        cmd += ["-c:v", "libx264", "-preset", "veryfast" if c.get("tipo") == "longo" else "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"{nome}.mp4"]
        # roda dentro da pasta de destino: o filtro "ass" aceita nome relativo sem problemas de "C:\"
        r = subprocess.run(cmd, cwd=destino, capture_output=True, text=True)
        if CANCELAR.is_set():
            sys.exit("Cancelado pelo usuário.")
        if r.returncode != 0:
            print("  ERRO ffmpeg:", r.stderr[-600:])
            cfg = cfgo
            continue

        legenda = (f"{c['titulo']}\n\n{c.get('descricao', '')}\n\n{' '.join(c.get('hashtags', []))}\n\n"
                   f"Motivo: {c.get('motivo', '')}\n")
        (destino / f"{nome}.txt").write_text(legenda, encoding="utf-8")
        renders[cid] = {"arquivo": f"{nome}.mp4", "hash": hash_render(c, cfgo), "titulo": c["titulo"]}
        gravar_renders(video, renders)
        cfg = cfgo
    progresso(100, "Vídeos prontos")
    print(f"[cortar] pronto: {destino}")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("etapa", choices=["tudo", "transcrever", "selecionar", "cortar"])
    ap.add_argument("arquivos", nargs="*")
    ap.add_argument("--manual", action="store_true", help="não chama a API; Claude escolhe os cortes na conversa")
    a = ap.parse_args()

    videos = listar_entradas(a.arquivos)
    if not videos:
        sys.exit(f"Nenhum arquivo em {ENTRADA}. Coloque o episódio lá.")
    for v in videos:
        cfg = config_do_episodio(v)
        print(f"\n=== {v.name} (template: {cfg['template_nome']}) ===")
        if a.etapa in ("tudo", "transcrever"):
            transcrever(v, cfg)
        if a.etapa in ("tudo", "selecionar"):
            if selecionar(v, cfg, a.manual) is None and a.etapa == "tudo":
                return
        if a.etapa in ("tudo", "cortar"):
            cortar(v, cfg)


if __name__ == "__main__":
    main()
