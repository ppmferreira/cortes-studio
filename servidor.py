#!/usr/bin/env python3
"""API (FastAPI) + painel React do gerador de cortes. Abre em http://127.0.0.1:8765

Documentação interativa da API: http://127.0.0.1:8765/docs
"""
import contextlib
import io
import json
import os
import re
import subprocess
import threading
import time
import traceback
import webbrowser
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import cortes as C

PORTA = 8765
CHAVE_ARQ = C.BASE / "chave_api.txt"
DIST = C.BASE / "frontend" / "dist"

# DLLs CUDA instaladas via pip (para usar a GPU)
for d in (C.BASE / ".venv" / "Lib" / "site-packages" / "nvidia").glob("*/bin"):
    os.environ["PATH"] = str(d) + os.pathsep + os.environ["PATH"]
if not os.environ.get("ANTHROPIC_API_KEY") and CHAVE_ARQ.exists():
    os.environ["ANTHROPIC_API_KEY"] = CHAVE_ARQ.read_text(encoding="utf-8-sig").strip()

import logging


class _SemRuidoWindows(logging.Filter):
    """No Windows o asyncio reclama (ConnectionResetError) toda vez que o navegador fecha uma conexão, por exemplo
    ao recarregar a página ou pular no player de vídeo. É inofensivo, então não polui o terminal nem o log do processo."""

    def filter(self, record):
        info = record.exc_info
        return not (info and isinstance(info[1], ConnectionResetError))


logging.getLogger("asyncio").addFilter(_SemRuidoWindows())

app = FastAPI(title="Cortes de Podcast")


# ----------------------------------------------------------------- modelos
class Corte(BaseModel):
    inicio: float = Field(ge=0)
    fim: float = Field(gt=0)
    titulo: str = "Corte"
    motivo: str = ""
    descricao: str = ""
    hashtags: list[str] = []
    id: str = ""
    velocidade: float = Field(1.0, ge=0.5, le=2.0)


class Geral(BaseModel):
    """Configurações globais: padrões de geração, vídeo/legenda e marca."""
    idioma: str = "pt"
    modelo_whisper: str = "medium"
    modelo_claude: str = "claude-sonnet-5-5"
    qtd_cortes: int = Field(6, ge=1, le=30)
    duracao_min: int = Field(30, ge=5, le=900)
    duracao_max: int = Field(90, ge=10, le=1800)
    formato: Literal["vertical", "horizontal"] = "vertical"
    legendas: bool = True
    palavras_por_legenda: int = Field(3, ge=1, le=8)
    tamanho_legenda: int = Field(14, ge=6, le=40)
    fonte_legenda: str = "Arial"
    cor_legenda: str = Field("#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")
    posicao_legenda: Literal["baixo", "meio", "alto"] = "baixo"
    folga_inicio: float = Field(0.15, ge=0, le=3)
    folga_fim: float = Field(0.35, ge=0, le=3)
    velocidade_padrao: float = Field(1.0, ge=0.5, le=2.0)
    usar_logo: bool = True
    logo: str = ""
    logo_posicao: Literal["topo-esquerda", "topo-centro", "topo-direita", "centro", "baixo-esquerda", "baixo-centro", "baixo-direita"] = "topo-centro"
    logo_tamanho: int = Field(22, ge=5, le=60)
    logo_opacidade: int = Field(100, ge=10, le=100)


class TemplateIn(BaseModel):
    nome: str = Field(min_length=1, max_length=60)
    descricao: str = ""
    prompt: str = Field(min_length=1, max_length=4000)


class OpcoesRender(BaseModel):
    formato: Literal["vertical", "horizontal"] | None = None
    legendas: bool | None = None
    template: str | None = None            # template usado só nesta geração
    # ajustes da escolha de cortes (Claude) só desta geração; se faltarem, vale o template
    qtd_cortes: int | None = Field(None, ge=1, le=30)
    duracao_min: int | None = Field(None, ge=5, le=900)
    duracao_max: int | None = Field(None, ge=10, le=1800)
    instrucoes_extras: str | None = None
    adicionar: bool | None = None          # mantém os cortes atuais e acrescenta novos, sem repetir trechos


class RodarLote(BaseModel):
    episodios: list[str] = Field(min_length=1)
    refazer: bool = False                  # refaz a escolha de cortes mesmo nos episódios que já têm cortes
    gerar_videos: bool = True              # false = só escolhe os cortes, para você revisar antes
    opcoes: OpcoesRender | None = None


class Rodar(BaseModel):
    episodio: str
    etapa: Literal["tudo", "cortes", "transcrever", "selecionar", "cortar", "analisar"]
    manual: bool = False
    refazer: bool = False
    cortes: list[str] | None = None        # só estes cortes (ids) ao gerar vídeos
    opcoes: OpcoesRender | None = None     # formato/legendas só desta geração


class Chave(BaseModel):
    chave: str = ""


# ----------------------------------------------------------------- job em background
class Log(io.TextIOBase):
    """Captura o print() do pipeline; trata \\r (barra de progresso) como sobrescrita da linha."""

    def __init__(self):
        self.linhas = [""]

    def write(self, s):
        for ch in s:
            if ch == "\n":
                self.linhas.append("")
            elif ch == "\r":
                self.linhas[-1] = ""
            else:
                self.linhas[-1] += ch
        return len(s)

    def texto(self):
        return "\n".join(self.linhas[-400:])


LOG = Log()
JOB = {"rodando": False, "etapa": "", "episodio": "", "erro": None, "plano": [], "feitas": [], "t0": 0.0, "lote": None}
TRAVA = threading.Lock()
# peso de cada etapa no progresso total de "Fazer tudo" (a transcrição é de longe a mais demorada)
PESOS = {"transcrever": 0.70, "selecionar": 0.08, "cortar": 0.22, "analisar": 1.0}


def iniciar_etapa(nome: str):
    JOB["etapa"], JOB["t0"] = nome, time.time()
    C.progresso(None, "")


def job_publico():
    rodando, atual = JOB["rodando"], JOB["etapa"]
    pct_etapa = C.PROGRESSO["pct"] if rodando else None
    soma = sum(PESOS[e] for e in JOB["plano"]) or 1
    feito = sum(PESOS[e] for e in JOB["feitas"])
    if rodando and pct_etapa is not None:
        feito += PESOS.get(atual, 0) * pct_etapa / 100
    decorrido = time.time() - JOB["t0"] if rodando else 0
    eta = decorrido * (100 - pct_etapa) / pct_etapa if rodando and pct_etapa and pct_etapa >= 2 and decorrido > 5 else None
    lote = JOB.get("lote")
    pct_ep = feito / soma
    total = (lote["i"] + pct_ep) / lote["n"] * 100 if lote else pct_ep * 100
    return {
        "rodando": rodando, "etapa": atual if rodando else "", "episodio": JOB["episodio"], "erro": JOB["erro"],
        "plano": JOB["plano"], "feitas": JOB["feitas"], "lote": lote,
        "pct_total": round(total, 1), "pct_etapa": pct_etapa,
        "detalhe": C.PROGRESSO["detalhe"] if rodando else "",
        "decorrido_s": round(decorrido), "eta_s": round(eta) if eta is not None else None,
        "log": LOG.texto(),
    }


def _rodar_etapas(video: Path, etapa: str, manual: bool, refazer: bool, ids, opcoes):
    """Roda as etapas de um episódio (pode levantar SystemExit/Exception). Os ajustes de `opcoes` valem só desta execução."""
    extra = dict(opcoes or {})
    cfg = {**C.config_do_episodio(video, extra.pop("template", None)), **extra}
    with contextlib.redirect_stdout(LOG), contextlib.redirect_stderr(LOG):
        if etapa == "analisar":
            iniciar_etapa("analisar")
            C.analisar_cortes(video, cfg, ids)
            JOB["feitas"].append("analisar")
            return
        if etapa in ("tudo", "cortes", "transcrever"):
            iniciar_etapa("transcrever")
            C.transcrever(video, cfg)
            JOB["feitas"].append("transcrever")
        if etapa in ("tudo", "cortes", "selecionar"):
            iniciar_etapa("selecionar")
            if refazer:
                (C.TRABALHO / video.stem / "cortes.json").unlink(missing_ok=True)
            if C.selecionar(video, cfg, manual) is None and etapa in ("tudo", "cortes"):
                return
            JOB["feitas"].append("selecionar")
        if etapa in ("tudo", "cortar"):
            iniciar_etapa("cortar")
            C.cortar(video, cfg, ids)
            JOB["feitas"].append("cortar")


def executar(video: Path, etapa: str, manual: bool, refazer: bool, ids=None, opcoes=None):
    global LOG
    LOG = Log()
    try:
        _rodar_etapas(video, etapa, manual, refazer, ids, opcoes)
        LOG.write("\nConcluído.\n")
    except SystemExit as e:
        JOB["erro"] = str(e.code)
    except Exception:
        JOB["erro"] = traceback.format_exc().strip().splitlines()[-1]
        LOG.write(traceback.format_exc())
    finally:
        JOB["rodando"] = False
        C.CANCELAR.clear()


def executar_lote(videos: list[Path], refazer: bool, opcoes, gerar_videos: bool = True):
    """Vários episódios em sequência: transcreve (se faltar), pede os cortes ao Claude e gera os vídeos de cada um."""
    global LOG
    LOG = Log()
    erros = []
    try:
        for i, v in enumerate(videos):
            JOB.update(episodio=v.name, plano=["transcrever", "selecionar"] + (["cortar"] if gerar_videos else []), feitas=[], lote={"i": i, "n": len(videos)})
            LOG.write(f"\n=== Episódio {i + 1} de {len(videos)}: {v.name} ===\n")
            try:
                _rodar_etapas(v, "tudo" if gerar_videos else "cortes", False, refazer, None, opcoes)
            except SystemExit as e:
                erros.append(f"{v.name}: {e.code}")
                LOG.write(f"ERRO: {e.code}\n")
            except Exception:
                erros.append(f"{v.name}: {traceback.format_exc().strip().splitlines()[-1]}")
                LOG.write(traceback.format_exc())
        LOG.write("\nConcluído.\n" if not erros else "\nTerminou com erros.\n")
        if erros:
            JOB["erro"] = " · ".join(erros)
    finally:
        JOB.update(rodando=False, lote=None)
        C.CANCELAR.clear()


# ----------------------------------------------------------------- helpers
def video_de(nome: str) -> Path:
    p = C.ENTRADA / Path(nome).name
    if not p.is_file() or p.suffix.lower() not in C.EXTENSOES:
        raise HTTPException(404, "Episódio não encontrado.")
    return p


def info_episodio(p: Path):
    trab, saida = C.TRABALHO / p.stem, C.SAIDA / p.stem
    cortes = trab / "cortes.json"
    cfg = C.config_do_episodio(p)
    return {
        "nome": p.name,
        "mb": round(p.stat().st_size / 1e6, 1),
        "enviado": p.stat().st_mtime,
        "audio": p.suffix.lower() in C.EXT_AUDIO,
        "transcrito": (trab / "transcricao.json").exists(),
        "n_cortes": len(json.loads(cortes.read_text(encoding="utf-8-sig"))) if cortes.exists() else 0,
        "videos": sorted(f.name for f in saida.glob("*.mp4")) if saida.exists() else [],
        "template": cfg["template"],
        "template_nome": cfg["template_nome"],
        "config": {k: cfg[k] for k in (*C.CAMPOS_TEMPLATE, *C.CAMPOS_LOGO)},
    }


# ----------------------------------------------------------------- rotas da API
@app.get("/api/estado")
def estado():
    C.ENTRADA.mkdir(exist_ok=True)
    eps = [info_episodio(p) for p in sorted(C.ENTRADA.iterdir()) if p.suffix.lower() in C.EXTENSOES]
    conta = C.status_conta_claude()
    api = bool(os.environ.get("ANTHROPIC_API_KEY"))
    lista, ativo = C.todos_templates()
    base = C.carregar_config()
    logos = sorted(f.name for f in C.LOGOS.glob("*.png")) if C.LOGOS.exists() else []
    return {"episodios": eps, "geral": {k: base[k] for k in C.CAMPOS_GERAL}, "logos": logos, "templates": lista, "template_ativo": ativo,
            "chave": api or conta["conectado"], "conexao": {**conta, "api": api}}


# ---- conexão com o Claude: entrar com a conta (via Claude Code) ou chave de API
LOGIN = {"proc": None, "url": None}


def _ler_login(proc):
    for linha in proc.stdout:
        m = re.search(r"https?://\S+", linha)
        if m and not LOGIN["url"]:
            LOGIN["url"] = m.group(0)


@app.get("/api/claude")
def claude_status():
    p = LOGIN["proc"]
    return {**C.status_conta_claude(), "api": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "entrando": bool(p and p.poll() is None), "url": LOGIN["url"]}


@app.post("/api/claude/login")
def claude_login():
    exe = C.claude_cli()
    if not exe:
        raise HTTPException(400, "Claude Code não encontrado neste computador. Use uma chave de API.")
    if LOGIN["proc"] and LOGIN["proc"].poll() is None:
        LOGIN["proc"].kill()
    LOGIN["url"] = None
    # abre a página de login do Claude no navegador; o processo termina quando você conclui o login
    proc = subprocess.Popen([exe, "auth", "login", "--claudeai"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", creationflags=C._SEM_JANELA)
    LOGIN["proc"] = proc
    threading.Thread(target=_ler_login, args=(proc,), daemon=True).start()
    time.sleep(2)
    return {"ok": True, "url": LOGIN["url"]}


class Codigo(BaseModel):
    codigo: str


@app.post("/api/claude/codigo")
def claude_codigo(d: Codigo):
    """A página de login do Claude mostra um código; ele é entregue ao Claude Code para concluir a entrada."""
    p = LOGIN["proc"]
    if not p or p.poll() is not None or not p.stdin:
        raise HTTPException(409, "Nenhum login em andamento. Clique em “Entrar com Claude” de novo.")
    p.stdin.write(d.codigo.strip() + "\n")
    p.stdin.flush()
    return {"ok": True}


@app.post("/api/claude/cancelar")
def claude_cancelar():
    if LOGIN["proc"] and LOGIN["proc"].poll() is None:
        LOGIN["proc"].kill()
    return {"ok": True}


@app.post("/api/claude/logout")
def claude_logout():
    exe = C.claude_cli()
    if exe:
        subprocess.run([exe, "auth", "logout"], capture_output=True, timeout=30, creationflags=C._SEM_JANELA)
    return {"ok": True}


@app.post("/api/upload")
async def upload(arquivo: UploadFile = File(...)):
    nome = re.sub(r'[<>:"/\\|?*]', "_", Path(arquivo.filename or "").name)
    if Path(nome).suffix.lower() not in C.EXTENSOES:
        raise HTTPException(400, "Formato não suportado.")
    C.ENTRADA.mkdir(exist_ok=True)
    with open(C.ENTRADA / nome, "wb") as f:  # em blocos: episódios de GB não vão para a memória
        while bloco := await arquivo.read(8 * 1024 * 1024):
            f.write(bloco)
    return {"nome": nome}


@app.put("/api/config")
def salvar_config(g: Geral):
    arq = C.BASE / "config.json"
    atual = json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else {}
    atual.update(g.model_dump())
    arq.write_text(json.dumps(atual, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


@app.post("/api/logos")
async def enviar_logo(arquivo: UploadFile = File(...)):
    """Recebe uma imagem, normaliza (PNG transparente, recorte redondo se for o caso) e guarda em logos/."""
    nome = re.sub(r"[^\w-]+", "_", Path(arquivo.filename or "logo").stem, flags=re.UNICODE).strip("_")[:40] or "logo"
    C.LOGOS.mkdir(exist_ok=True)
    tmp = C.LOGOS / f"_envio_{C.novo_id()}{Path(arquivo.filename or '').suffix.lower() or '.img'}"
    with open(tmp, "wb") as f:
        while bloco := await arquivo.read(1024 * 1024):
            f.write(bloco)
    destino = C.LOGOS / f"{nome}.png"
    try:
        C.preparar_logo(tmp, destino)
    except Exception:
        raise HTTPException(400, "Não consegui ler essa imagem. Use PNG, JPG ou WebP.")
    finally:
        tmp.unlink(missing_ok=True)
    return {"nome": destino.name}


@app.delete("/api/logos/{nome}")
def apagar_logo(nome: str):
    (C.LOGOS / Path(nome).name).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/media/logos/{nome}")
def media_logo(nome: str):
    arq = C.LOGOS / Path(nome).name
    if not arq.is_file():
        raise HTTPException(404)
    return FileResponse(arq)


@app.put("/api/chave")
def salvar_chave(d: Chave):
    chave = d.chave.strip()
    if chave:
        CHAVE_ARQ.write_text(chave, encoding="utf-8")
        os.environ["ANTHROPIC_API_KEY"] = chave
    else:
        CHAVE_ARQ.unlink(missing_ok=True)
        os.environ.pop("ANTHROPIC_API_KEY", None)
    return {"chave": bool(chave)}


@app.post("/api/rodar")
def rodar(d: Rodar):
    video = video_de(d.episodio)
    with TRAVA:
        if JOB["rodando"]:
            raise HTTPException(409, "Já existe um processo rodando.")
        plano = {"tudo": ["transcrever", "selecionar", "cortar"], "cortes": ["transcrever", "selecionar"]}.get(d.etapa, [d.etapa])
        JOB.update(rodando=True, etapa=d.etapa, episodio=video.name, erro=None, plano=plano, feitas=[], t0=time.time(), lote=None)
        C.CANCELAR.clear()
    threading.Thread(target=executar, daemon=True, args=(video, d.etapa, d.manual, d.refazer, set(d.cortes) if d.cortes is not None else None,
                                                              d.opcoes.model_dump(exclude_none=True) if d.opcoes else None)).start()
    return {"ok": True}


@app.post("/api/rodar-lote")
def rodar_lote(d: RodarLote):
    videos = [video_de(n) for n in dict.fromkeys(d.episodios)]
    precisam = [v for v in videos if d.refazer or not (C.TRABALHO / v.stem / "cortes.json").exists()]
    if precisam and not C.modo_claude():
        raise HTTPException(400, "Conecte o Claude (ícone no topo) para escolher os cortes automaticamente.")
    with TRAVA:
        if JOB["rodando"]:
            raise HTTPException(409, "Já existe um processo rodando.")
        JOB.update(rodando=True, etapa="", episodio=videos[0].name, erro=None, plano=[], feitas=[], t0=time.time(),
                   lote={"i": 0, "n": len(videos)})
        C.CANCELAR.clear()
    opcoes = d.opcoes.model_dump(exclude_none=True) if d.opcoes else None
    threading.Thread(target=executar_lote, daemon=True, args=(videos, d.refazer, opcoes, d.gerar_videos)).start()
    return {"ok": True, "n": len(videos)}


# ---- importar episódio por link (YouTube e outros sites suportados pelo yt-dlp)
IMPORT = {"rodando": False, "url": "", "pct": None, "detalhe": "", "erro": None, "nome": None}


class Importar(BaseModel):
    url: str


def _baixar(url: str):
    try:
        import yt_dlp

        def gancho(d):
            if d["status"] == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                IMPORT["pct"] = round(d["downloaded_bytes"] / total * 100, 1) if total else None
                IMPORT["detalhe"] = f"Baixando… {(d.get('_speed_str') or '').strip()}"
            elif d["status"] == "finished":
                IMPORT.update(pct=None, detalhe="Juntando áudio e vídeo…")

        opcoes = {
            "format": "bv*[height<=1080]+ba/b[height<=1080]/b", "merge_output_format": "mp4", "noplaylist": True,
            "outtmpl": str(C.ENTRADA / "%(title).80s.%(ext)s"), "windowsfilenames": True,
            "ffmpeg_location": str(Path(C.achar_ffmpeg()).parent), "progress_hooks": [gancho],
            "quiet": True, "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            info = ydl.extract_info(url, download=True)
            arq = Path(ydl.prepare_filename(info)).with_suffix(".mp4")
        IMPORT.update(nome=arq.name, pct=100, detalhe="Pronto")
    except BaseException as e:  # yt-dlp usa SystemExit em alguns erros
        IMPORT["erro"] = (str(e) or "Falha ao baixar").replace("ERROR: ", "")[:300]
    finally:
        IMPORT["rodando"] = False


@app.post("/api/importar")
def importar(d: Importar):
    url = d.url.strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(400, "Cole um link que comece com http:// ou https://")
    with TRAVA:
        if IMPORT["rodando"]:
            raise HTTPException(409, "Já existe uma importação em andamento.")
        IMPORT.update(rodando=True, url=url, pct=None, detalhe="Conectando…", erro=None, nome=None)
    C.ENTRADA.mkdir(exist_ok=True)
    threading.Thread(target=_baixar, args=(url,), daemon=True).start()
    return {"ok": True}


@app.get("/api/importar")
def importar_status():
    return IMPORT


@app.post("/api/job/cancelar")
def cancelar_job():
    """Cancela o processo em andamento. A transcrição para no próximo trecho; Claude e ffmpeg são encerrados na hora."""
    if not JOB["rodando"]:
        raise HTTPException(409, "Nenhum processo em andamento.")
    C.CANCELAR.set()
    try:
        import psutil
        for filho in psutil.Process().children(recursive=True):
            if filho.name().lower().split(".")[0] in ("claude", "ffmpeg", "ffprobe"):
                filho.kill()
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/job")
def job():
    return job_publico()


@app.get("/api/episodios/{ep}/cortes")
def ler_cortes(ep: str):
    arq = C.TRABALHO / Path(ep).stem / "cortes.json"
    return json.loads(arq.read_text(encoding="utf-8-sig")) if arq.exists() else []


def garantir_ids(video: Path) -> list[dict]:
    """Garante id e velocidade em cada corte e migra vídeos antigos (sem renders.json) para o controle por corte."""
    arq = C.TRABALHO / video.stem / "cortes.json"
    if not arq.exists():
        return []
    cortes = json.loads(arq.read_text(encoding="utf-8-sig"))
    mudou = False
    for c in cortes:
        if not c.get("id"):
            c["id"], mudou = C.novo_id(), True
        if "velocidade" not in c:
            c["velocidade"], mudou = 1.0, True
    if mudou:
        arq.write_text(json.dumps(cortes, indent=2, ensure_ascii=False), encoding="utf-8")
    saida = C.SAIDA / video.stem
    if saida.exists() and not (C.TRABALHO / video.stem / "renders.json").exists():
        cfg, renders = C.config_do_episodio(video), {}
        for f in sorted(saida.glob("*.mp4")):  # vídeos feitos antes: "NN_titulo.mp4" = corte NN
            m = re.match(r"^(\d+)_", f.name)
            if m and 0 < int(m.group(1)) <= len(cortes):
                c = cortes[int(m.group(1)) - 1]
                renders[c["id"]] = {"arquivo": f.name, "hash": C.hash_render(c, cfg), "titulo": c["titulo"]}
        if renders:
            C.gravar_renders(video, renders)
    return cortes


def encaixar_nas_palavras(itens: list[dict], palavras: list[dict], cfg: dict) -> list[dict]:
    """Move início/fim para a palavra mais próxima (com a folga da config), para não cortar no meio de uma palavra.
    Compara sem a folga, então salvar de novo o mesmo corte não o desloca."""
    if not palavras:
        return itens
    for c in itens:
        ini = min(palavras, key=lambda w: abs(w["inicio"] - (c["inicio"] + cfg["folga_inicio"])))
        fim = min(palavras, key=lambda w: abs(w["fim"] - (c["fim"] - cfg["folga_fim"])))
        c["inicio"] = round(max(0.0, ini["inicio"] - cfg["folga_inicio"]), 2)
        c["fim"] = round(fim["fim"] + cfg["folga_fim"], 2)
    return itens


_CACHE_TRANS: dict = {}


def dados_transcricao(video: Path) -> dict | None:
    arq = C.TRABALHO / video.stem / "transcricao.json"
    if not arq.exists():
        return None
    mt = arq.stat().st_mtime
    if _CACHE_TRANS.get(video.stem, (0, None))[0] != mt:
        _CACHE_TRANS[video.stem] = (mt, json.loads(arq.read_text(encoding="utf-8-sig")))
    return _CACHE_TRANS[video.stem][1]


@app.get("/api/episodios/{ep}/cortes")
def ler_cortes(ep: str):
    return garantir_ids(video_de(ep))


def _apagar_arquivos_render(video: Path, ids: set[str]):
    """Apaga os vídeos (e legenda/texto) gerados para esses cortes e tira do controle de renders."""
    renders, saida = C.ler_renders(video), C.SAIDA / video.stem
    for i in ids:
        r = renders.pop(i, None)
        if r:
            for ext in (".mp4", ".ass", ".txt"):
                (saida / (Path(r["arquivo"]).stem + ext)).unlink(missing_ok=True)
    C.gravar_renders(video, renders)


@app.put("/api/episodios/{ep}/cortes")
def gravar_cortes(ep: str, cortes: list[Corte], apagar_videos: str = ""):
    """`apagar_videos`: ids (separados por vírgula) de cortes removidos cujo vídeo gerado também deve ser apagado."""
    video = video_de(ep)
    if apagar_videos:
        _apagar_arquivos_render(video, {x for x in apagar_videos.split(",") if x})
    for c in cortes:
        if c.fim <= c.inicio:
            raise HTTPException(400, f"Corte '{c.titulo}': o fim precisa ser maior que o início.")
    itens = [c.model_dump() for c in cortes]
    for c in itens:
        c["id"] = c["id"] or C.novo_id()
    dados = dados_transcricao(video)
    if dados:
        palavras = [w for sg in dados["segmentos"] for w in sg["palavras"]]
        itens = encaixar_nas_palavras(itens, palavras, C.config_do_episodio(video))
        for c in itens:
            c["fim"] = min(c["fim"], round(dados["duracao"], 2))
    arq = C.pasta_trabalho(video) / "cortes.json"
    arq.write_text(json.dumps(itens, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "n": len(itens), "cortes": itens}


@app.post("/api/episodios/{ep}/status-render")
def status_render(ep: str, o: OpcoesRender):
    """Para cada corte: novo (sem vídeo), pronto (vídeo em dia) ou desatualizado (cortes/estilo mudaram depois)."""
    video = video_de(ep)
    cortes = garantir_ids(video)
    extra = o.model_dump(exclude_none=True)
    cfg = {**C.config_do_episodio(video, extra.pop("template", None)), **extra}
    renders, saida = C.ler_renders(video), C.SAIDA / video.stem
    por_id = {c["id"]: c for c in cortes}
    estados = {}
    for c in cortes:
        r = renders.get(c["id"])
        if r and (saida / r["arquivo"]).exists():
            estados[c["id"]] = {"estado": "pronto" if r["hash"] == C.hash_render(c, cfg) else "desatualizado", "arquivo": r["arquivo"]}
        else:
            estados[c["id"]] = {"estado": "novo", "arquivo": None}
    por_arquivo = {r["arquivo"]: (i, r) for i, r in renders.items()}
    analises = C.ler_analises(video)
    videos = []
    for f in sorted(saida.glob("*.mp4")) if saida.exists() else []:
        i, r = por_arquivo.get(f.name, (None, None))
        base = {"arquivo": f.name, "gerado_em": f.stat().st_mtime, "nota": (analises.get(i or "") or {}).get("nota")}
        if i in por_id:
            c = por_id[i]
            videos.append({**base, "titulo": c["titulo"], "descricao": c.get("descricao", ""), "hashtags": c.get("hashtags", []),
                           "corte": i, "estado": estados[i]["estado"], "duracao": round((c["fim"] - c["inicio"]) / (c.get("velocidade") or 1), 1)})
        else:  # corte removido: o texto vem do .txt gravado junto com o vídeo
            titulo, descricao, tags = (r or {}).get("titulo") or f.stem, "", []
            txt = saida / (f.stem + ".txt")
            if txt.exists():
                partes = [x.strip() for x in txt.read_text(encoding="utf-8").split("\n\n")]
                titulo = partes[0] or titulo
                descricao = partes[1] if len(partes) > 1 else ""
                tags = partes[2].split() if len(partes) > 2 else []
            videos.append({**base, "titulo": titulo, "descricao": descricao, "hashtags": tags, "corte": None, "estado": "sem_corte", "duracao": None})
    return {"cortes": estados, "videos": videos}


@app.get("/api/episodios/{ep}/analises")
def analises_do_episodio(ep: str):
    """Análise de potencial viral por corte (id). `desatualizada` = o corte mudou depois da análise."""
    video = video_de(ep)
    atuais = {c["id"]: c for c in garantir_ids(video)}
    saida = {}
    for i, a in C.ler_analises(video).items():
        if i in atuais:
            saida[i] = {**a, "desatualizada": a.get("hash") != C.hash_analise(atuais[i])}
    return saida


@app.get("/api/episodios/{ep}/palavras")
def palavras_do_trecho(ep: str, ini: float, fim: float):
    """Palavras com tempo dentro do intervalo (para a prévia 9:16 com legenda no editor)."""
    dados = dados_transcricao(video_de(ep))
    if not dados:
        return []
    return [{"p": w["p"], "inicio": w["inicio"], "fim": w["fim"]}
            for sg in dados["segmentos"] if sg["fim"] >= ini and sg["inicio"] <= fim
            for w in sg["palavras"] if w["fim"] > ini and w["inicio"] < fim]


@app.delete("/api/episodios/{ep}/videos/{nome}")
def apagar_video(ep: str, nome: str):
    video = video_de(ep)
    saida, base = C.SAIDA / video.stem, Path(nome).stem
    for ext in (".mp4", ".ass", ".txt"):
        (saida / (base + ext)).unlink(missing_ok=True)
    renders = {i: r for i, r in C.ler_renders(video).items() if r["arquivo"] != Path(nome).name}
    C.gravar_renders(video, renders)
    return {"ok": True}


# ---- templates (prompts)
def _salvar_templates(usuario: list[dict] | None = None, ativo: str | None = None):
    d = C.ler_templates_arquivo()
    if usuario is not None:
        d["usuario"] = usuario
    if ativo is not None:
        d["ativo"] = ativo
    C.gravar_templates_arquivo(d)


@app.get("/api/templates")
def listar_templates():
    lista, ativo = C.todos_templates()
    return {"templates": lista, "ativo": ativo}


@app.post("/api/templates")
def criar_template(t: TemplateIn):
    usuario = C.ler_templates_arquivo().get("usuario", [])
    novo = {"id": C.novo_id("u-"), "nome": t.nome.strip(), "descricao": t.descricao.strip(), "prompt": t.prompt.strip()}
    _salvar_templates(usuario + [novo])
    return {"id": novo["id"]}


@app.put("/api/templates/{tid}")
def editar_template(tid: str, t: TemplateIn):
    usuario = C.ler_templates_arquivo().get("usuario", [])
    if not any(x["id"] == tid for x in usuario):
        raise HTTPException(400, "Templates prontos não são editáveis. Duplique para criar o seu.")
    for x in usuario:
        if x["id"] == tid:
            x.pop("config", None)
            x.update(nome=t.nome.strip(), descricao=t.descricao.strip(), prompt=t.prompt.strip())
    _salvar_templates(usuario)
    return {"ok": True}


@app.delete("/api/templates/{tid}")
def excluir_template(tid: str):
    d = C.ler_templates_arquivo()
    usuario = d.get("usuario", [])
    if not any(x["id"] == tid for x in usuario):
        raise HTTPException(400, "Templates prontos não podem ser excluídos.")
    _salvar_templates([x for x in usuario if x["id"] != tid], "shorts" if d.get("ativo") == tid else None)
    return {"ok": True}


class IdTemplate(BaseModel):
    id: str | None = None


@app.put("/api/templates-padrao")
def template_padrao(d: IdTemplate):
    """Template usado por padrão ao pedir cortes ao Claude. Vazio = nenhum (só o prompt que você escrever)."""
    lista, _ = C.todos_templates()
    if d.id and not any(t["id"] == d.id for t in lista):
        raise HTTPException(404, "Template não encontrado.")
    _salvar_templates(None, d.id or "")
    return {"ok": True}


@app.get("/api/episodios/{ep}/transcricao")
def transcricao(ep: str):
    arq = C.TRABALHO / Path(ep).stem / "transcricao.json"
    if not arq.exists():
        return []
    dados = json.loads(arq.read_text(encoding="utf-8-sig"))
    return [{"inicio": s["inicio"], "fim": s["fim"], "texto": s["texto"]} for s in dados["segmentos"]]


@app.get("/api/episodios/{ep}/legenda/{nome}")
def legenda(ep: str, nome: str):
    arq = (C.SAIDA / Path(ep).stem / Path(nome).name).with_suffix(".txt")
    return {"texto": arq.read_text(encoding="utf-8") if arq.exists() else ""}


# FileResponse atende requisições Range (necessário para o player buscar trechos)
@app.get("/media/entrada/{nome}")
def media_entrada(nome: str):
    return FileResponse(video_de(nome))


@app.get("/media/saida/{ep}/{nome}")
def media_saida(ep: str, nome: str):
    arq = C.SAIDA / Path(ep).name / Path(nome).name
    if not arq.is_file():
        raise HTTPException(404)
    return FileResponse(arq)


# painel React compilado (frontend/dist); em desenvolvimento use "npm run dev" em frontend/
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="painel")
else:
    @app.get("/")
    def sem_painel():
        return {"aviso": "Painel não compilado. Rode: cd frontend && npm install && npm run build"}


if __name__ == "__main__":
    for p in (C.ENTRADA, C.SAIDA, C.TRABALHO):
        p.mkdir(exist_ok=True)
    if not os.environ.get("CORTES_SEM_BROWSER"):
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORTA}")).start()
    print(f"Painel em http://127.0.0.1:{PORTA}  (feche esta janela para encerrar)")
    uvicorn.run(app, host="127.0.0.1", port=PORTA, log_level="warning")
