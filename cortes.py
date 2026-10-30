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
    # --- estilo de corte (definidos pelo template do episódio)
    "qtd_cortes": 6,
    "duracao_min": 30,                 # segundos
    "duracao_max": 90,                 # segundos
    "formato": "vertical",             # "vertical" (9:16) ou "horizontal"
    "legendas": True,
    "palavras_por_legenda": 3,
    "fonte_legenda": "Arial",
    "tamanho_legenda": 14,             # relativo a uma tela de 1080 de largura (ASS PlayResX=1080)
    "cor_legenda": "#FFFFFF",
    "posicao_legenda": "baixo",        # "baixo", "meio" ou "alto"
    "folga_inicio": 0.15,              # segundos antes da primeira palavra
    "folga_fim": 0.35,                 # segundos depois da última palavra
    "velocidade_padrao": 1.0,          # velocidade inicial dos cortes novos (0.5 a 2.0)
    "instrucoes_extras": "",           # ex.: "priorize momentos engraçados"
    "usar_logo": True,                 # (template) mostra a logo da marca nos cortes
    # --- marca (geral): uma logo para todos os templates, guardada em logos/
    "logo": "",                        # nome do arquivo em logos/ ("" = sem logo)
    "logo_posicao": "topo-centro",     # topo|baixo + esquerda|centro|direita, ou "centro"
    "logo_tamanho": 22,                # % da largura do vídeo
    "logo_opacidade": 100,             # 10 a 100
}

_ESTILO = ("qtd_cortes", "duracao_min", "duracao_max", "formato", "legendas", "palavras_por_legenda", "tamanho_legenda",
           "fonte_legenda", "cor_legenda", "posicao_legenda", "folga_inicio", "folga_fim", "velocidade_padrao", "usar_logo")
CAMPOS_LOGO = ("usar_logo", "logo", "logo_posicao", "logo_tamanho", "logo_opacidade")
# configuração que o editor recebe: estilo global + o prompt do template escolhido
CAMPOS_TEMPLATE = _ESTILO + ("instrucoes_extras",)
# configurações globais (config.json): geral + padrões de geração + vídeo/legenda + marca
CAMPOS_GERAL = ("idioma", "modelo_whisper", "modelo_claude") + _ESTILO + ("logo", "logo_posicao", "logo_tamanho", "logo_opacidade")


def _t(id_, nome, descricao, prompt):
    return {"id": id_, "nome": nome, "descricao": descricao, "builtin": True, "prompt": prompt}


# Template = só o prompt (briefing) que o Claude segue ao escolher os cortes. Quantidade, duração, formato e
# legenda são ajustes da geração. Os templates prontos não mudam; os seus ficam em templates.json.
TEMPLATES_BASE = [
    _t("shorts", "Shorts / Reels / TikTok", "Ganchos fortes e cortes que funcionam sozinhos.",
       "Comece com um gancho forte nos primeiros 3 segundos. Cada corte deve fazer sentido sozinho, sem precisar do resto do episódio, "
       "e terminar em uma ideia completa."),
    _t("viral", "Viral e polêmico", "Frases de impacto, revelações e momentos de reação.",
       "Priorize frases de impacto, revelações, opiniões fortes e momentos que provoquem reação. Evite pausas, enrolação e apresentações."),
    _t("debate", "Debate e opinião", "Argumentos completos, com começo, meio e fim.",
       "Escolha argumentos completos, com começo, meio e fim, opiniões fortes e discordâncias. Evite trechos que dependam do contexto do resto do episódio."),
    _t("humor", "Humor e piadas", "Piadas com setup e punchline, sem cortar a risada.",
       "Escolha piadas e situações engraçadas com setup e punchline completos. Termine logo depois da risada."),
    _t("educativo", "Educativo e dicas", "Explicações claras e dicas práticas.",
       "Escolha explicações claras, dicas práticas, listas e conselhos que a pessoa possa aplicar."),
    _t("capitulos", "Capítulos longos", "Trechos completos com tema próprio (use com durações longas).",
       "Escolha capítulos completos da conversa, cada um com tema próprio, que funcionem como um vídeo independente."),
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
        usuario.append({"id": t["id"], "nome": t["nome"], "descricao": t.get("descricao", ""), "builtin": False, "prompt": prompt})
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
         "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", ""],
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

    texto ="\n".join(f"[{s['inicio']:.1f}-{s['fim']:.1f}] {s['texto']}" for s in dados["segmentos"])
    extras = f"- Instruções extras: {cfg['instrucoes_extras']}\n" if cfg["instrucoes_extras"] else ""
    if atuais:  # pede para não repetir o que já foi cortado (e confere depois, sem confiar só no pedido)
        usados = ", ".join(f"{c['inicio']:.0f}-{c['fim']:.0f}" for c in atuais)
        extras += f"- Já existem cortes nestes trechos (segundos): {usados}. Escolha trechos NOVOS, sem se sobrepor a nenhum deles.\n"
    prompt = PROMPT.format(qtd=cfg["qtd_cortes"], dmin=cfg["duracao_min"], dmax=cfg["duracao_max"],
                           extras=extras, transcricao=texto)
    print("[selecionar] consultando Claude ...")
    progresso(None, "Claude está lendo a transcrição e escolhendo os cortes")
    bruto = consultar_claude(prompt, cfg, modo)
    m = re.search(r"\[.*\]", bruto, re.DOTALL)
    if not m:
        sys.exit(f"Resposta sem JSON:\n{bruto}")
    cortes = json.loads(m.group(0))
    cortes = ajustar_limites(cortes, dados, cfg)
    if atuais:
        antes = len(cortes)
        cortes = [c for c in cortes if all(min(c["fim"], a["fim"]) - max(c["inicio"], a["inicio"]) <= 1 for a in atuais)]
        if len(cortes) < antes:
            print(f"[selecionar] {antes - len(cortes)} corte(s) descartado(s) por repetir trecho que já existia")
    for c in cortes:
        c.setdefault("id", novo_id())
        c.setdefault("velocidade", cfg.get("velocidade_padrao", 1.0))
    cortes = atuais + cortes
    arq.write_text(json.dumps(cortes, indent=2, ensure_ascii=False), encoding="utf-8")
    for i, c in enumerate(cortes, 1):
        print(f"  {i}. [{fmt_tempo(c['inicio'])}-{fmt_tempo(c['fim'])}] {c['titulo']}")
    return cortes


# ---------------------------------------------------------------- potencial de viralização
# Peso de cada critério na nota final (0-10). Cinco critérios são avaliados pelo Claude a partir do texto;
# "plataforma" (duração e ritmo de fala) é calculado aqui, por regra, para ser verificável.
PESOS_VIRAL = {"gancho": 25, "retencao": 20, "emocao": 15, "clareza": 15, "compartilhavel": 15, "plataforma": 10}
NOMES_VIRAL = {"gancho": "Gancho (primeiros 3 s)", "retencao": "Retenção", "emocao": "Emoção e impacto", "clareza": "Clareza e autonomia",
               "compartilhavel": "Potencial de compartilhamento", "plataforma": "Formato (duração e ritmo)"}
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


def hash_analise(c):
    """Muda quando o corte muda; a análise antiga passa a valer como 'desatualizada'."""
    base = {"i": round(float(c["inicio"]), 2), "f": round(float(c["fim"]), 2), "v": velocidade_de(c), "t": c.get("titulo", ""), "d": c.get("descricao", "")}
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
    dur = (float(c["fim"]) - float(c["inicio"])) / velocidade_de(c)
    nd = _faixa(dur, [(10, 4), (15, 6), (45, 10), (60, 8), (90, 6), (180, 4), (1e9, 2)])
    ritmo = n_palavras / dur if dur else 0
    nr = 10 if 2.4 <= ritmo <= 3.6 else 8 if 2.0 <= ritmo <= 4.2 else 6 if 1.6 <= ritmo <= 5.0 else 4
    nota = round((nd + nr) / 2)
    porque = (f"Duração final de {dur:.0f} s (melhor faixa para Shorts: 15 a 45 s) e ritmo de {ritmo:.1f} palavras por segundo "
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

    LOTE = 5
    for k in range(0, len(alvo), LOTE):
        lote = alvo[k:k + LOTE]
        progresso(k / len(alvo) * 100, f"Analisando cortes {k + 1} a {k + len(lote)} de {len(alvo)}")
        blocos, medidas = [], {}
        for c in lote:
            vel = velocidade_de(c)
            dentro = [w for w in palavras if w["fim"] > c["inicio"] and w["inicio"] < c["fim"]]
            abertura = " ".join(w["p"] for w in dentro if w["inicio"] < c["inicio"] + 3 * vel)
            nota_p, porque_p, med = criterio_plataforma(c, len(dentro))
            medidas[c["id"]] = (nota_p, porque_p, med)
            blocos.append(f'### id={c["id"]} | duração final {med["duracao_s"]:.0f} s | velocidade {vel:g}x | título: {c.get("titulo", "")} | descrição: {c.get("descricao", "")}\n'
                          f'Primeiros 3 segundos: "{abertura}"\nTexto completo: "{" ".join(w["p"] for w in dentro)}"')
        print(f"[analisar] consultando Claude ({len(lote)} cortes) ...")
        bruto = consultar_claude(PROMPT_VIRAL.format(cortes="\n\n".join(blocos)), cfg, modo)
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
                criterios[k2].update(nome=NOMES_VIRAL[k2], peso=PESOS_VIRAL[k2])
            analises[c["id"]] = {
                "nota": nota, "veredito": veredito_viral(nota), "resumo": str(a.get("resumo", "")).strip(),
                "criterios": criterios, "medidas": med,
                "pontos_fortes": [str(x) for x in a.get("pontos_fortes", [])][:3], "melhorias": [str(x) for x in a.get("melhorias", [])][:3],
                "titulo_alternativo": str(a.get("titulo_alternativo", "")).strip(), "hash": hash_analise(c),
                "analisado_em": time.time(), "aviso": AVISO_VIRAL,
            }
            print(f"  {nota:>4}  {c.get('titulo', '')[:60]}")
        gravar_analises(video, analises)
    progresso(100, "Análise concluída")


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


def velocidade_de(c):
    return min(2.0, max(0.5, float(c.get("velocidade") or 1.0)))


def hash_render(c, cfg):
    """Identifica tudo que muda o vídeo final. Se o hash mudou, o vídeo gerado está desatualizado."""
    chaves = {"i": round(float(c["inicio"]), 2), "f": round(float(c["fim"]), 2), "v": velocidade_de(c),
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
    vertical = cfg["formato"] == "vertical"
    e_audio = video.suffix.lower() in EXT_AUDIO
    destino = SAIDA / video.stem
    destino.mkdir(parents=True, exist_ok=True)
    renders = ler_renders(video)
    logo_arq = logo_ativa(cfg)
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
        print(f"[cortar] {nome}  ({fim - ini:.0f}s a {vel:g}x = {(fim - ini) / vel:.0f}s)")
        progresso(n / len(alvo) * 100, f"Corte {n + 1} de {len(alvo)}: {c['titulo']}")

        antigo = renders.get(cid)  # remove a versão anterior deste corte (e só dele)
        if antigo:
            for ext in (".mp4", ".ass", ".txt"):
                (destino / (Path(antigo["arquivo"]).stem + ext)).unlink(missing_ok=True)

        ass_nome = None
        if cfg["legendas"] and palavras:
            ass_nome = f"{nome}.ass"
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
            cmd += ["-f", "lavfi", "-i", f"color=c=black:s=1080x1920:r=30:d={(fim - ini) / vel:.2f}"]
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
        cmd += ["-filter_complex", filtro] + mapa
        if vel != 1:
            cmd += ["-af", f"atempo={vel:.4f}"]  # acelera sem mudar o tom da voz
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"{nome}.mp4"]
        # roda dentro da pasta de destino: o filtro "ass" aceita nome relativo sem problemas de "C:\"
        r = subprocess.run(cmd, cwd=destino, capture_output=True, text=True)
        if CANCELAR.is_set():
            sys.exit("Cancelado pelo usuário.")
        if r.returncode != 0:
            print("  ERRO ffmpeg:", r.stderr[-600:])
            continue

        legenda = (f"{c['titulo']}\n\n{c.get('descricao', '')}\n\n{' '.join(c.get('hashtags', []))}\n\n"
                   f"Motivo: {c.get('motivo', '')}\n")
        (destino / f"{nome}.txt").write_text(legenda, encoding="utf-8")
        renders[cid] = {"arquivo": f"{nome}.mp4", "hash": hash_render(c, cfg), "titulo": c["titulo"]}
        gravar_renders(video, renders)
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
