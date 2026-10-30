import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, hms, tituloDe, urlEntrada } from '../api'
import { CorteIADialog } from '../components/CorteIADialog'
import { GerarDialog } from '../components/GerarDialog'
import type { Pedido } from '../components/GerarDialog'
import { Previa } from '../components/Previa'
import { lacunas, mantidos } from '../lib/trechos'
import { NotaChip, ViralCard } from '../components/ViralCard'
import { TranscreverBanner } from '../components/TranscreverBanner'
import { ProcessPanel } from '../components/ProcessPanel'
import { Short } from '../components/Short'
import { ThumbDialog } from '../components/ThumbDialog'
import { VELOCIDADES } from '../components/TemplateDialog'
import { Track } from '../components/Track'
import { useConfirmar, usePerguntar } from '../ui/Confirm'
import { Icon } from '../ui/Icon'
import { Badge, Button, Chip } from '../ui/kit'
import type { Analise, Corte, Episodio, Etapa, Job, OpcoesRender, Palavra, Segmento, StatusRender, Template } from '../types'

type Aba = 'cortes' | 'transcricao' | 'processo' | 'videos'
type Lado = 'inicio' | 'fim'

interface Props {
  ep: Episodio
  job: Job | null
  episodios: Episodio[]
  templates: Template[]
  temChave: boolean
  aoRodar: (etapa: Etapa, refazer: boolean, extra?: { cortes?: string[]; opcoes?: OpcoesRender }) => void
  aoLote: (episodios: string[], refazer: boolean, gerarVideos: boolean, opcoes: OpcoesRender) => void
  aoMudou: () => void
  aoCancelar: () => void
  aviso: (m: string) => void
}

const VELOCIDADES_PLAYER = [0.75, 1, 1.25, 1.5, 2]
const duracaoFinal = (c: Corte) => mantidos(c).reduce((s, [a, b]) => s + b - a, 0) / (c.velocidade || 1)

export function Editor({ ep, job, episodios, templates, temChave, aoRodar, aoLote, aoMudou, aoCancelar, aviso }: Props) {
  const config = ep.config
  const perguntar = usePerguntar()
  const confirmar = useConfirmar()
  const player = useRef<HTMLVideoElement>(null)
  const parar = useRef<number | null>(null)          // segundo em que a prévia de um trecho deve parar
  const [cortes, setCortesRaw] = useState<Corte[]>([])
  // histórico de edição (Ctrl+Z / Ctrl+Y). Edições seguidas em menos de 0,5 s (ex.: arrastar uma alça) viram um passo só.
  const cortesRef = useRef<Corte[]>([])
  const hist = useRef<{ passado: Corte[][]; futuro: Corte[][]; t: number }>({ passado: [], futuro: [], t: 0 })
  const carregarCortes = useCallback((c: Corte[]) => { cortesRef.current = c; hist.current = { passado: [], futuro: [], t: 0 }; setCortesRaw(c) }, [])
  const setCortes = useCallback((v: Corte[] | ((cs: Corte[]) => Corte[])) => {
    const prev = cortesRef.current
    const next = typeof v === 'function' ? v(prev) : v
    if (next === prev) return
    const h = hist.current, agora = Date.now()
    if (agora - h.t > 500) { h.passado.push(prev); if (h.passado.length > 100) h.passado.shift() }
    h.t = agora; h.futuro = []
    cortesRef.current = next
    setCortesRaw(next)
  }, [])
  const [, forcar] = useState(0)
  const desfazer = useCallback(() => {
    const h = hist.current, ant = h.passado.pop()
    if (!ant) return
    h.futuro.push(cortesRef.current); h.t = 0
    cortesRef.current = ant; setCortesRaw(ant); setSujo(true); setSel(s => (s === null ? s : Math.min(s, ant.length - 1))); forcar(n => n + 1)
  }, [])
  const refazer = useCallback(() => {
    const h = hist.current, prox = h.futuro.pop()
    if (!prox) return
    h.passado.push(cortesRef.current); h.t = 0
    cortesRef.current = prox; setCortesRaw(prox); setSujo(true); setSel(s => (s === null ? s : Math.min(s, prox.length - 1))); forcar(n => n + 1)
  }, [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return   // nos campos de texto vale o desfazer do navegador
      e.preventDefault()
      if (k === 'y' || e.shiftKey) refazer(); else desfazer()
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [desfazer, refazer])
  const [trans, setTrans] = useState<Segmento[]>([])
  const [status, setStatus] = useState<StatusRender | null>(null)
  const [analises, setAnalises] = useState<Record<string, Analise>>({})
  const [sel, setSel] = useState<number | null>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [vel, setVel] = useState(1)
  const [aba, setAba] = useState<Aba>('cortes')
  const [semPlayer, setSemPlayer] = useState(false)
  const [sujo, setSujo] = useState(false)
  const [gerar, setGerar] = useState(false)
  const [paraAnalisar, setParaAnalisar] = useState<Set<string> | null>(null)   // null = seleção desligada
  const [menuNovo, setMenuNovo] = useState(false)
  const [menuMais, setMenuMais] = useState(false)
  const [pedirCorte, setPedirCorte] = useState(false)
  const apagarAoSalvar = useRef<string[]>([])   // cortes removidos cujo vídeo o usuário quer apagar junto
  const [modoGerar, setModoGerar] = useState<'existentes' | 'claude' | undefined>()
  const ocupado = !!job?.rodando

  const atualizarStatus = useCallback(() => {
    api.statusRender(ep.nome).then(setStatus).catch(() => undefined)
    api.analises(ep.nome).then(setAnalises).catch(() => undefined)
  }, [ep.nome])

  // recarrega do disco ao trocar de episódio ou quando uma etapa muda os dados
  useEffect(() => {
    api.cortes(ep.nome).then(c => { carregarCortes(c); setSujo(false); setSel(s => (s !== null && s < c.length ? s : c.length ? 0 : null)) })
    api.transcricao(ep.nome).then(setTrans)
    setSemPlayer(false)
  }, [ep.nome, ep.n_cortes, ep.transcrito])
  useEffect(atualizarStatus, [atualizarStatus, ep.videos.join('|'), ep.n_cortes])
  // durante a análise viral, as notas aparecem na lista conforme cada lote volta
  const analisandoAgora = !!job?.rodando && job.etapa === 'analisar' && job.episodio === ep.nome
  useEffect(() => {
    if (!analisandoAgora) return
    const id = window.setInterval(() => { api.analises(ep.nome).then(setAnalises).catch(() => undefined) }, 2000)
    return () => window.clearInterval(id)
  }, [analisandoAgora, ep.nome])
  // quando um processo termina (o Claude pode ter trocado os cortes) recarrega, sem perder edição não salva
  const sujoRef = useRef(false)
  sujoRef.current = sujo
  const rodandoJob = !!job?.rodando
  useEffect(() => {
    if (rodandoJob || sujoRef.current) return
    api.cortes(ep.nome).then(c => { carregarCortes(c); setSel(x => (x !== null && x < c.length ? x : c.length ? 0 : null)) })
    atualizarStatus()
  }, [rodandoJob, ep.nome, atualizarStatus])

  const agora = () => +(player.current?.currentTime ?? 0).toFixed(1)
  const limite = dur || (trans.length ? trans[trans.length - 1].fim : 0)

  const aplicarVel = (v: number) => { if (player.current) player.current.playbackRate = v }

  const ir = useCallback((s: number, tocar = false) => {
    const p = player.current
    if (!p) return
    parar.current = null
    p.playbackRate = vel
    p.currentTime = Math.max(0, s)
    if (tocar) void p.play()
  }, [vel])

  /** Toca o trecho na velocidade do corte e para no fim. */
  const buracos = useRef<[number, number][]>([])
  // pulo dos trechos tirados a cada quadro (o evento timeupdate é lento e deixava o buraco aparecer e travar)
  useEffect(() => {
    if (!tocando) return
    let id = 0
    const laco = () => {
      const v = player.current
      if (v && parar.current !== null) {
        const g = buracos.current.find(([a, b]) => v.currentTime >= a - 0.02 && v.currentTime < b - 0.05)
        if (g) v.currentTime = g[1]
      }
      id = requestAnimationFrame(laco)
    }
    id = requestAnimationFrame(laco)
    return () => cancelAnimationFrame(id)
  }, [tocando])   // trechos que a prévia do corte pula, como o vídeo final
  const previa = (ini: number, fim: number, v = 1, pular: [number, number][] = [], tocar = true) => {
    const p = player.current
    if (!p) return
    buracos.current = pular
    p.playbackRate = v
    p.currentTime = Math.max(0, ini)
    parar.current = fim
    if (tocar) void p.play()
  }

  const editar = (i: number, p: Partial<Corte>) => { setCortes(cs => cs.map((c, j) => (j === i ? { ...c, ...p } : c))); setSujo(true) }

  /** Muda início ou fim respeitando 1 s de duração mínima e os limites do episódio. */
  const mudarLimite = useCallback((i: number, lado: Lado, s: number) => {
    setCortes(cs => cs.map((c, j) => {
      if (j !== i) return c
      const v = lado === 'inicio' ? Math.min(Math.max(0, s), c.fim - 1) : Math.max(Math.min(limite || Infinity, s), c.inicio + 1)
      return { ...c, [lado]: +v.toFixed(2) }
    }))
    setSujo(true)
  }, [limite])

  // lista separada por tipo: abas Shorts | Vídeos longos
  const [tipoLista, setTipoLista] = useState<'short' | 'longo'>('short')
  const [soBoas, setSoBoas] = useState(false)   // esconde cortes analisados abaixo da meta
  const meta = config.nota_minima ?? 7
  const nShorts = cortes.filter(x => x.tipo !== 'longo').length
  const nLongos = cortes.length - nShorts
  const ordemLista = useMemo(
    () => cortes.map((x, i) => ({ x, i })).filter(({ x }) => (x.tipo === 'longo') === (tipoLista === 'longo') && (!soBoas || (analises[x.id]?.nota ?? 99) >= meta)),
    [cortes, tipoLista, soBoas, analises, meta])

  const novo = useCallback(() => {
    const t0 = agora()
    setCortes(cs => { setSel(cs.length); return [...cs, { id: '', velocidade: config.velocidade_padrao, inicio: t0, fim: t0 + 45, titulo: 'Novo corte', motivo: '', descricao: '', hashtags: [], tipo: tipoLista }] })
    setSujo(true); setAba('cortes')
  }, [config.velocidade_padrao, tipoLista])

  // ao selecionar um corte (lista ou linha do tempo), mostra a aba do tipo dele
  useEffect(() => {
    const t = sel != null && cortes[sel] ? (cortes[sel].tipo ?? 'short') : undefined
    if (t && t !== tipoLista) setTipoLista(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  /** Divide o corte i em dois, no ponto atual do player (cada parte com pelo menos 1 s). */
  const dividir = useCallback((i: number) => {
    const c = cortes[i], p = +(player.current?.currentTime ?? 0).toFixed(2)
    if (!c || p <= c.inicio + 1 || p >= c.fim - 1) { aviso('Posicione o player dentro do corte (a 1 s ou mais das pontas) para dividir.'); return }
    const a = { ...c, fim: p, titulo: `${c.titulo} (parte 1)` }
    const b = { ...c, id: '', inicio: p, titulo: `${c.titulo} (parte 2)` }
    setCortes(cs => [...cs.slice(0, i), a, b, ...cs.slice(i + 1)])
    setSel(i); setSujo(true)
  }, [cortes, aviso])

  const remover = async (i: number) => {
    const alvo = cortes[i]
    if (alvo?.id && status?.cortes[alvo.id]?.arquivo) {  // o corte já tem vídeo: pergunta o que fazer com ele
      const r = await perguntar({
        titulo: 'Remover este corte?',
        mensagem: <>O corte <b>“{alvo.titulo}”</b> já tem um vídeo gerado. O que fazer com o vídeo?<br /><span className="t-meta">A remoção só vale depois de Salvar. Se mantiver o vídeo, ele fica na biblioteca como “Corte removido”.</span></>,
        acoes: [{ id: 'apagar', rotulo: 'Remover e apagar o vídeo', perigo: true }, { id: 'manter', rotulo: 'Remover e manter o vídeo' }],
      })
      if (!r) return
      if (r === 'apagar') apagarAoSalvar.current = [...apagarAoSalvar.current, alvo.id]
    }
    setCortes(cs => cs.filter((_, j) => j !== i))
    setSel(s => (s === null ? null : Math.max(0, Math.min(s, cortes.length - 2))))
    setSujo(true)
  }

  async function salvar(): Promise<boolean> {
    try {
      const r = await api.salvarCortes(ep.nome, cortes, apagarAoSalvar.current)
      if (apagarAoSalvar.current.length) aoMudou()
      apagarAoSalvar.current = []
      carregarCortes(r.cortes); setSujo(false); atualizarStatus()
      aviso(`${r.n} cortes salvos (encaixados nas palavras)`)
      return true
    } catch (e) { aviso((e as Error).message); return false }
  }

  /** Pede ao Claude a análise de viralização (os cortes precisam estar salvos). Sem ids: só os que faltam ou mudaram. */
  async function analisar(idsAlvo?: string[]) {
    if (sujo && !(await salvar())) return
    setAba('cortes')
    aoRodar('analisar', false, idsAlvo ? { cortes: idsAlvo } : undefined)
  }

  /** Pede ao Claude para melhorar os cortes: ajusta limites, tira tangentes ou divide. Mantém ou substitui o original. */
  async function melhorar(ids: string[]) {
    if (!ids.length) return
    if (sujo && !(await salvar())) return
    const r = await perguntar({
      titulo: ids.length === 1 ? 'Melhorar este corte com o Claude?' : `Melhorar ${ids.length} cortes com o Claude?`,
      mensagem: <>O Claude lê o corte e a análise, ajusta início e fim, tira tangentes do meio e, se o trecho misturar assuntos, divide em cortes independentes. Os novos são analisados em seguida.<br /><span className="t-meta">Usa a conta Claude. O que fazer com o corte original?</span></>,
      acoes: [{ id: 'manter', rotulo: 'Criar e manter o original' }, { id: 'trocar', rotulo: 'Criar e substituir o original', perigo: true }],
    })
    if (!r) return
    setAba('processo')
    aoRodar('melhorar', false, { cortes: ids, opcoes: { substituir: r === 'trocar' } })
  }

  // fecha o menu "Novo" ao clicar fora
  useEffect(() => {
    if (!menuNovo && !menuMais) return
    const f = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu')) { setMenuNovo(false); setMenuMais(false) } }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [menuNovo, menuMais])

  /** Pede um corte específico ao Claude. Salva antes o que estiver editado, para não perder nada ao recarregar. */
  async function abrirPedirCorte() {
    setMenuNovo(false)
    if (sujo && !(await salvar())) return
    setPedirCorte(true)
  }

  /** Abre a janela Gerar. Para usar os cortes existentes, salva antes o que estiver editado. */
  async function abrirGerar(modo?: 'existentes' | 'claude') {
    if (modo !== 'claude' && sujo && !(await salvar())) return
    setModoGerar(modo)
    setGerar(true)
  }

  // atalhos de teclado (ignorados ao digitar em campos)
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      if (alvo?.closest?.('input, textarea, select, dialog, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return
      const p = player.current
      if (!p) return
      const nativo = alvo === p   // o <video> já trata espaço e setas quando está em foco
      switch (e.key.toLowerCase()) {
        case ' ': if (!nativo) { e.preventDefault(); if (p.paused) void p.play(); else p.pause() } break
        case 'arrowleft': if (!nativo) { e.preventDefault(); p.currentTime = Math.max(0, p.currentTime - (e.shiftKey ? 1 : 5)) } break
        case 'arrowright': if (!nativo) { e.preventDefault(); p.currentTime += e.shiftKey ? 1 : 5 } break
        case 'i': if (sel !== null) mudarLimite(sel, 'inicio', agora()); break
        case 'o': if (sel !== null) mudarLimite(sel, 'fim', agora()); break
        case 'n': novo(); break
        case 's': if (sel !== null) dividir(sel); break
      }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [sel, mudarLimite, novo, dividir])

  const falaAgora = useMemo(() => trans.find(s => t >= s.inicio && t < s.fim)?.texto ?? '', [trans, t])
  const c = sel !== null ? cortes[sel] : undefined
  const [focoFino, setFocoFino] = useState<'tudo' | 'inicio' | 'fim'>('tudo')
  const [larguraFino, setLarguraFino] = useState(30)   // segundos de cada lado, nos focos começo/fim
  const [marca, setMarca] = useState<[number, number] | null>(null)   // trecho marcado com Shift + arrastar
  useEffect(() => { setMarca(null) }, [sel])
  const janela = c ? (focoFino === 'inicio'
    ? { w0: Math.max(0, c.inicio - larguraFino), w1: c.inicio + larguraFino }
    : focoFino === 'fim'
      ? { w0: Math.max(0, c.fim - larguraFino), w1: Math.min(limite || c.fim + larguraFino, c.fim + larguraFino) }
      : { w0: Math.max(0, c.inicio - 20), w1: Math.min(limite || c.fim + 20, c.fim + 20) }) : null
  /** Clicar num buraco do corte devolve aquele pedaço. */
  const restaurarLacuna = (i: number, g0: number, g1: number) => {
    const x = cortes[i]
    if (!x) return
    const juntas = [...mantidos(x), [g0, g1] as [number, number]].sort((p, q) => p[0] - q[0])
    const fundidas: [number, number][] = []
    for (const [a, b] of juntas) {
      const ult = fundidas[fundidas.length - 1]
      if (ult && a <= ult[1] + 0.05) ult[1] = Math.max(ult[1], b); else fundidas.push([a, b])
    }
    editar(i, { trechos: fundidas.length === 1 && fundidas[0][0] <= x.inicio + 0.05 && fundidas[0][1] >= x.fim - 0.05 ? null : fundidas })
  }
  const pendentes = status ? cortes.filter(x => status.cortes[x.id]?.estado !== 'pronto').length : null

  return (
    <div className="editor">
      <div className="editor__main">
        <div className="crumbs"><a href="#/conteudo">Conteúdo</a><Icon name="arrow" /><span className="truncate">{ep.nome}</span></div>

        <div className={'player' + (ep.audio ? ' player--audio' : '')}>
          <video ref={player} src={urlEntrada(ep.nome)} controls preload="metadata"
                 onLoadedMetadata={e => { setDur(e.currentTarget.duration); setSemPlayer(false) }}
                 onTimeUpdate={e => {
                   const v = e.currentTarget
                   setT(v.currentTime)
                   if (parar.current !== null) {  // prévia de um corte: pula os trechos tirados
                     const g = buracos.current.find(([a, b]) => v.currentTime >= a && v.currentTime < b - 0.05)
                     if (g) { v.currentTime = g[1]; return }
                   }
                   if (parar.current !== null && v.currentTime >= parar.current) { v.pause(); parar.current = null; v.playbackRate = vel }
                 }}
                 onPlay={() => setTocando(true)} onPause={() => { setTocando(false); aplicarVel(vel) }}
                 onError={() => setSemPlayer(true)} />
          {semPlayer && <div className="player__error">Este formato não toca no navegador, mas os cortes funcionam normalmente.</div>}
        </div>

        <div className="toolbar" role="toolbar" aria-label="Controles do player">
          <Button size="sm" variant="tonal" onClick={() => ir(t - 5)}>−5 s</Button>
          <Button size="sm" variant="filled" icon={tocando ? 'pause' : 'play'} onClick={() => { const p = player.current; if (p) { if (p.paused) void p.play(); else p.pause() } }}>{tocando ? 'Pausar' : 'Tocar'}</Button>
          <Button size="sm" variant="tonal" onClick={() => ir(t + 5)}>+5 s</Button>
          <span className="toolbar__time t-num">{hms(t)} <span className="t-muted">/ {limite ? hms(limite) : '--:--'}</span></span>
          <span className="toolbar__spacer" />
          <label className="toolbar__speed t-meta">Velocidade
            <select className="input" value={vel} aria-label="Velocidade de reprodução"
                    onChange={e => { const v = Number(e.target.value); setVel(v); aplicarVel(v) }}>
              {VELOCIDADES_PLAYER.map(v => <option key={v} value={v}>{v}×</option>)}
            </select>
          </label>
        </div>

        {ep.transcrito ? (
          <div className="caption" aria-live="off">
            <Icon name="caption" />
            <span className={falaAgora ? '' : 't-muted'}>{falaAgora || 'Sem fala neste ponto.'}</span>
          </div>
        ) : (
          <TranscreverBanner ep={ep} job={job} aoTranscrever={() => aoRodar('transcrever', false)} aoClaude={() => abrirGerar('claude')} aoCancelar={aoCancelar} />
        )}

        <section className="card editor__timeline" aria-label="Linha do tempo">
          <div className="card__head">
            <h2 className="t-heading">Linha do tempo</h2>
            <span className="t-meta">Arraste as alças do corte selecionado. Clique na faixa para ir ao ponto.</span>
          </div>
          {limite > 0 ? (
            <Track w0={0} w1={limite} t={t} cortes={cortes} sel={sel}
                   aoBuscar={s => ir(s)} aoSelecionar={i => { setSel(i); setAba('cortes') }} aoMudar={mudarLimite} />
          ) : <div className="skeleton" style={{ height: 56 }} />}

          {c && janela && sel !== null && (
            <>
              <div className="track-title"><b>Ajuste fino</b><span className="t-meta">corte {sel + 1} · {hms(janela.w0)} a {hms(janela.w1)}</span>
                <span className="fino__ctl">
                  <Button size="sm" variant="text" disabled={!hist.current.passado.length} onClick={desfazer} aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)">↶ Desfazer</Button>
                  <Button size="sm" variant="text" disabled={!hist.current.futuro.length} onClick={refazer} aria-label="Refazer (Ctrl+Y)" title="Refazer (Ctrl+Y)">↷ Refazer</Button>
                  <Chip selected={focoFino === 'tudo'} onClick={() => setFocoFino('tudo')}>Corte todo</Chip>
                  <Chip selected={focoFino === 'inicio'} onClick={() => setFocoFino('inicio')}>Começo</Chip>
                  <Chip selected={focoFino === 'fim'} onClick={() => setFocoFino('fim')}>Fim</Chip>
                  {focoFino !== 'tudo' && <>
                    <Button size="sm" variant="text" aria-label="Aproximar" onClick={() => setLarguraFino(w => Math.max(5, Math.round(w / 2)))}>＋ zoom</Button>
                    <Button size="sm" variant="text" aria-label="Afastar" onClick={() => setLarguraFino(w => Math.min(300, w * 2))}>－ zoom</Button>
                  </>}
                </span></div>
              <Track fino somenteSel w0={janela.w0} w1={janela.w1} t={t} cortes={cortes} sel={sel}
                     marca={marca} aoMarcar={(a, b) => setMarca([a, b])} aoRestaurar={restaurarLacuna}
                     aoBuscar={s => ir(s)} aoSelecionar={() => undefined} aoMudar={mudarLimite} />
            </>
          )}
          <div className="shortcuts t-meta">
            <span><kbd>Espaço</kbd> tocar/pausar</span><span><kbd>←</kbd><kbd>→</kbd> ±5 s (<kbd>Shift</kbd> ±1 s)</span>
            <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>Y</kbd> refaz</span><span><kbd>Shift</kbd>+arrastar na faixa: marcar trecho para tirar</span><span>passe o mouse num buraco e clique em ↺ devolver</span><span><kbd>I</kbd> início aqui</span><span><kbd>O</kbd> fim aqui</span><span><kbd>N</kbd> novo corte</span><span><kbd>S</kbd> dividir o corte aqui</span>
          </div>
        </section>

        {c && sel !== null ? (
          <CutDetail key={sel} i={sel} c={c} ep={ep} marca={marca} aoMarca={setMarca} trans={trans} video={player} tocando={tocando} agora={agora}
                     analise={analises[c.id]} analisando={ocupado && job?.etapa === 'analisar'} podeAnalisar={!!c.id && ep.transcrito}
                     aoAnalisar={() => analisar(c.id ? [c.id] : undefined)}
                     aoEditar={p => editar(sel, p)} aoLimite={(lado, s) => mudarLimite(sel, lado, s)}
                     aoTodos={v => { setCortes(cs => cs.map(x => ({ ...x, velocidade: v }))); setSujo(true) }}
                     aoPrevia={previa} aoParar={() => { player.current?.pause(); parar.current = null }} aoRemover={() => remover(sel)} aoDividir={() => dividir(sel)}
                     aoMelhorar={() => melhorar(c.id ? [c.id] : [])} podeMelhorar={!!c.id && ep.transcrito && !ocupado} />
        ) : (
          <div className="card empty empty--sm">
            <Icon name="scissors" /><p>Selecione um corte na lista ou na linha do tempo para ajustar, ou crie um novo na posição atual.</p>
            <Button icon="add" onClick={novo}>Novo corte aqui</Button>
          </div>
        )}
      </div>

      {/* ------------------------------ painel lateral ------------------------------ */}
      <aside className="editor__side card" aria-label="Painel do episódio">
        <div className="editor__sidehead">
          <h1 className="side-title">{tituloDe(ep.nome)}</h1>
          <div className="episode-head__meta">
            <Badge tone={ep.transcrito ? 'ok' : undefined}>{ep.transcrito ? 'Transcrito' : 'Sem transcrição'}</Badge>
            <Badge tone={ep.videos.length ? 'ok' : undefined}>{ep.videos.length} vídeos</Badge>
            {sujo && <Badge tone="run">Não salvo</Badge>}
          </div>
        </div>
        <div className="tabs" role="tablist">
          <Chip selected={aba === 'cortes'} count={cortes.length} onClick={() => setAba('cortes')}>Cortes</Chip>
          <Chip selected={aba === 'transcricao'} onClick={() => setAba('transcricao')}>Transcrição</Chip>
          <Chip selected={aba === 'processo'} onClick={() => setAba('processo')}>Processo{ocupado ? ` • ${Math.round(job?.pct_total ?? 0)}%` : ''}</Chip>
          <Chip selected={aba === 'videos'} count={ep.videos.length} onClick={() => setAba('videos')}>Vídeos</Chip>
        </div>

        <div className="editor__scroll" role="tabpanel">
          {aba === 'cortes' && (
            cortes.length === 0 ? (
              <div className="empty empty--sm"><Icon name="scissors" /><p>Nenhum corte ainda.{ep.transcrito ? ' Peça ao Claude ou marque os trechos à mão com o player.' : ' Comece transcrevendo o episódio.'}</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  {ep.transcrito
                    ? <Button variant="brand" icon="sparkle" disabled={ocupado} onClick={() => abrirGerar('claude')}>Pedir cortes ao Claude</Button>
                    : <Button variant="brand" icon="mic" disabled={ocupado} onClick={() => aoRodar('transcrever', false)}>Transcrever episódio</Button>}
                </div></div>
            ) : (
              <>
              <div className="listbar">
                <div className="tabs" role="tablist" style={{ margin: 0 }}>
                  <Chip selected={tipoLista === 'short'} count={nShorts} onClick={() => setTipoLista('short')}>Shorts</Chip>
                  <Chip selected={tipoLista === 'longo'} count={nLongos} onClick={() => setTipoLista('longo')}>Longos</Chip>
                </div>
                <span className="viralbar__acoes">
                  <Button size="sm" variant="brand" icon="sparkle" disabled={ocupado} onClick={() => abrirGerar('claude')}>Criar com IA</Button>
                  <div className="menu">
                    <Button size="sm" aria-label="Mais ações" aria-expanded={menuMais} onClick={() => setMenuMais(m => !m)}>⋯</Button>
                    {menuMais && (
                      <div className="menu__lista menu__lista--baixo menu__lista--dir" role="menu">
                        <button type="button" role="menuitem" className="menu__item" disabled={!ep.transcrito || !cortes.some(x => !analises[x.id] || analises[x.id].desatualizada)}
                                onClick={() => { setMenuMais(false); void analisar() }}>
                          <b>Analisar pendentes ({cortes.filter(x => !analises[x.id] || analises[x.id].desatualizada).length}){ocupado ? ' · na fila' : ''}</b>
                          <small>Dá a nota de viralização aos cortes sem análise</small></button>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenuMais(false); setParaAnalisar(m => (m ? null : new Set())) }}>
                          <b>{paraAnalisar ? 'Cancelar seleção' : 'Escolher quais analisar'}</b><small>Marque cortes na lista e analise só eles</small></button>
                        <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenuMais(false); setSoBoas(v => !v) }}>
                          <b>{soBoas ? 'Mostrar todos os cortes' : `Mostrar só nota ≥ ${meta}`}</b><small>Esconde os cortes analisados abaixo da meta</small></button>
                      </div>
                    )}
                  </div>
                  {paraAnalisar && (
                    <Button size="sm" variant="filled" icon="sparkle" disabled={!ep.transcrito || paraAnalisar.size === 0}
                            onClick={() => { void analisar([...paraAnalisar]); setParaAnalisar(null) }}>
                      Analisar {paraAnalisar.size || ''}{ocupado ? ' (fila)' : ''}
                    </Button>
                  )}
                  {paraAnalisar && (
                    <Button size="sm" variant="filled" disabled={!ep.transcrito || ocupado || paraAnalisar.size === 0}
                            onClick={() => { void melhorar([...paraAnalisar]); setParaAnalisar(null) }}>Melhorar {paraAnalisar.size || ''}</Button>
                  )}
                </span>
              </div>
              {paraAnalisar && (
                <div className="viralbar">
                  <span className="t-meta">Marque os cortes na lista. Cortes novos precisam estar salvos.</span>
                  <span className="viralbar__acoes">
                    <Button size="sm" variant="text" onClick={() => setParaAnalisar(new Set(cortes.filter(x => x.id && (!analises[x.id] || analises[x.id].desatualizada)).map(x => x.id)))}>Pendentes</Button>
                    <Button size="sm" variant="text" onClick={() => setParaAnalisar(new Set(cortes.filter(x => x.id).map(x => x.id)))}>Todos</Button>
                    <Button size="sm" variant="text" onClick={() => setParaAnalisar(new Set())}>Nenhum</Button>
                  </span>
                </div>
              )}
              {soBoas && <span className="t-meta">Mostrando só cortes com nota ≥ {meta} ou ainda sem análise.</span>}
              {ordemLista.length === 0 && (
                <div className="empty empty--sm"><p>{tipoLista === 'longo' ? 'Nenhum vídeo longo ainda. O Claude escolhe capítulos de vários minutos em 16:9.' : 'Nenhum short ainda.'}</p>
                  <Button variant="brand" icon="sparkle" disabled={ocupado || !ep.transcrito} onClick={() => abrirGerar('claude')}>{tipoLista === 'longo' ? 'Criar vídeos longos com IA' : 'Criar shorts com IA'}</Button></div>
              )}
              <ul className="cutlist">
                {ordemLista.map(({ x, i }) => {
                  const d = duracaoFinal(x)
                  const fora = x.tipo !== 'longo' && (d < config.duracao_min || d > config.duracao_max)
                  const est = status?.cortes[x.id]?.estado
                  return (
                    <Fragment key={x.id || i}>
                    <li className={paraAnalisar ? 'cutli' : undefined}>
                      {paraAnalisar && x.id && (
                        <input type="checkbox" className="cutli__check" checked={paraAnalisar.has(x.id)} aria-label={`Analisar o corte ${i + 1}`}
                               onChange={() => setParaAnalisar(m => { const n = new Set(m); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n })} />
                      )}
                      <button className={'cutrow' + (analises[x.id] && analises[x.id].nota < meta ? ' cutrow--abaixo' : '')} aria-current={sel === i} onClick={() => { setSel(i); ir(x.inicio) }}>
                        <span className="cut__num">{i + 1}</span>
                        <span className="cutrow__body"><b className="truncate" title={`${hms(x.inicio)} – ${hms(x.fim)}`}>{x.titulo}</b>
                          <span className="t-meta t-num">{hms(x.inicio)}{x.velocidade !== 1 ? ` · ${x.velocidade}×` : ''}{x.melhorado_de ? ' · melhorado' : ''}{x.trechos && x.trechos.length > 1 ? ' · editado' : ''}
                            {!sujo && est && est !== 'novo' && <span className={'dot dot--' + est} title={est === 'pronto' ? 'Vídeo pronto' : 'Vídeo desatualizado'} />}</span></span>
                        {analises[x.id] && <NotaChip nota={analises[x.id].nota} titulo={`Potencial de viralização: ${analises[x.id].veredito}${analises[x.id].desatualizada ? ' (corte mudou depois da análise)' : ''}`} />}
                        <span className={'cut__dur' + (fora ? ' cut__dur--warn' : '')} title={fora ? `Fora do ideal (${config.duracao_min}–${config.duracao_max} s)` : 'Duração final'}>{Math.round(d)} s</span>
                      </button>
                    </li>
                    </Fragment>
                  )
                })}
              </ul>
              </>
            )
          )}

          {aba === 'transcricao' && (
            trans.length === 0 ? <div className="empty empty--sm"><p>Ainda sem transcrição.</p></div> : (
              <div className="transcript transcript--flat">
                {trans.map(s => (
                  <button key={s.inicio} aria-current={t >= s.inicio && t < s.fim} onClick={() => ir(s.inicio, true)}>
                    <time>{hms(s.inicio)}</time><span>{s.texto}</span>
                  </button>
                ))}
              </div>
            )
          )}

          {aba === 'processo' && <ProcessPanel ep={ep} job={job} temChave={temChave} aoRodar={aoRodar} aoGerar={abrirGerar} aoCancelar={aoCancelar} />}

          {aba === 'videos' && (
            ep.videos.length === 0 ? <div className="empty empty--sm"><Icon name="movie" /><p>Nenhum vídeo gerado ainda.</p></div> : (
              <div className="shorts shorts--side">
                {(status?.videos ?? []).map(v => (
                  <Short key={v.arquivo} ep={ep} v={v.arquivo} info={v} aviso={aviso}
                         aoApagar={async () => {
                           if (!(await confirmar({ titulo: 'Excluir vídeo?', mensagem: <>O vídeo <b>“{v.titulo}”</b> será apagado. O corte continua na lista e você pode gerá-lo de novo.</>, rotulo: 'Excluir vídeo' }))) return
                           void api.apagarVideo(ep.nome, v.arquivo).then(() => { aviso('Vídeo excluído'); atualizarStatus(); aoMudou() })
                         }} />
                ))}
              </div>
            )
          )}
        </div>

        {aba === 'cortes' && (
          <div className="editor__foot">
            <div className="menu">
              <Button icon="add" onClick={() => setMenuNovo(m => !m)} aria-expanded={menuNovo}>Novo</Button>
              {menuNovo && (
                <div className="menu__lista" role="menu">
                  <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenuNovo(false); novo() }}>
                    <b>Corte em branco</b><small>Marque início e fim você mesmo, pelo player</small></button>
                  <button type="button" role="menuitem" className="menu__item" disabled={ocupado || !ep.transcrito} onClick={abrirPedirCorte}>
                    <b>Pedir um corte ao Claude</b><small>Descreva o momento e ele encontra o trecho</small></button>
                </div>
              )}
            </div>
            <Button icon="save" disabled={ocupado || !sujo} onClick={salvar}>Salvar</Button>
            <Button variant="brand" icon="scissors" disabled={ocupado || cortes.length === 0} onClick={() => abrirGerar()}>
              Gerar vídeos{pendentes ? ` (${pendentes})` : ''}…
            </Button>
          </div>
        )}
      </aside>

      <CorteIADialog aberto={pedirCorte} ep={ep} templates={templates} temClaude={temChave} aoFechar={() => setPedirCorte(false)}
                     aoPedir={o => { setPedirCorte(false); setAba('processo'); aoRodar('cortes', false, { opcoes: o }) }} />
      <GerarDialog aberto={gerar} ep={ep} episodios={episodios} templates={templates} cortes={cortes} temClaude={temChave} modoInicial={modoGerar} aoCriouTemplate={aoMudou}
                   aoFechar={() => setGerar(false)} aoGerar={(p: Pedido) => {
                     setGerar(false); setAba('processo')
                     if (p.tipo === 'cortes') aoRodar('cortar', false, { cortes: p.ids, opcoes: p.opcoes })
                     else if (p.tipo === 'claude') aoRodar(p.gerarVideos ? 'tudo' : 'cortes', !p.adicionar, { opcoes: p.opcoes })
                     else aoLote(p.episodios, p.refazer, p.gerarVideos, p.opcoes)
                   }} />
    </div>
  )
}

/* ------------------------------ detalhe do corte ------------------------------ */
function CutDetail({ marca, aoMarca, i, c, ep, trans, video, tocando, agora, analise, analisando, podeAnalisar, aoAnalisar, aoEditar, aoLimite, aoTodos, aoPrevia, aoParar, aoRemover, aoDividir, aoMelhorar, podeMelhorar }: {
  marca: [number, number] | null; aoMarca: (m: [number, number] | null) => void
  i: number; c: Corte; ep: Episodio; trans: Segmento[]; video: React.RefObject<HTMLVideoElement | null>; tocando: boolean
  agora: () => number; analise?: Analise; analisando: boolean; podeAnalisar: boolean; aoAnalisar: () => void
  aoEditar: (p: Partial<Corte>) => void; aoLimite: (lado: Lado, s: number) => void; aoTodos: (v: number) => void
  aoPrevia: (ini: number, fim: number, vel?: number, pular?: [number, number][], tocar?: boolean) => void; aoParar: () => void; aoRemover: () => void; aoDividir: () => void; aoMelhorar: () => void; podeMelhorar: boolean
}) {
  const config = ep.config
  const vel = c.velocidade || 1
  const d = duracaoFinal(c)
  const rem: [number, number] = marca ?? [+(c.inicio + (c.fim - c.inicio) / 3).toFixed(1), +(c.inicio + (c.fim - c.inicio) / 2).toFixed(1)]
  const setRem = (r: [number, number]) => aoMarca(r)
  const partes = mantidos(c)
  const tempoAtual = () => agora()
  const eLongo = c.tipo === 'longo'
  const [thumbAberta, setThumbAberta] = useState(false)
  const [thumbSalva, setThumbSalva] = useState(false)
  const [sub, setSub] = useState<'corte' | 'texto' | 'nota'>('corte')
  const fora = eLongo ? null : d < config.duracao_min ? 'curto' : d > config.duracao_max ? 'longo' : null
  const texto = useMemo(() => trans.filter(s => s.fim > c.inicio && s.inicio < c.fim).map(s => s.texto).join(' '), [trans, c.inicio, c.fim])
  const escala = Math.max((eLongo ? 1800 : config.duracao_max) * 1.25, d)

  // palavras do trecho, para a legenda da prévia (com um pequeno atraso para não buscar a cada arrasto)
  const [palavras, setPalavras] = useState<Palavra[]>([])
  useEffect(() => {
    const id = window.setTimeout(() => { api.palavras(ep.nome, c.inicio - 1, c.fim + 1).then(setPalavras).catch(() => setPalavras([])) }, 250)
    return () => clearTimeout(id)
  }, [ep.nome, c.inicio, c.fim])

  return (
    <section className="card detail" aria-label={`Ajustes do corte ${i + 1}`}>
      <div className="detail__top">
        <span className="cut__num cut__num--lg">{i + 1}</span>
        <input className="input input--title" value={c.titulo} aria-label="Título do corte" onChange={e => aoEditar({ titulo: e.target.value })} />
        <Button size="sm" variant="filled" icon="sparkle" disabled={!podeMelhorar} onClick={aoMelhorar} title="O Claude ajusta, tira tangentes ou divide este corte">Melhorar com Claude</Button>
        <Button size="sm" variant="text" icon="trash" onClick={aoRemover}>Remover</Button>
      </div>

      <div className="tabs" role="tablist" aria-label="Seções do corte" style={{ margin: 0 }}>
        <Chip selected={sub === 'corte'} onClick={() => setSub('corte')}>Corte</Chip>
        <Chip selected={sub === 'texto'} onClick={() => setSub('texto')}>Texto do post</Chip>
        <Chip selected={sub === 'nota'} onClick={() => setSub('nota')}>{analise ? `Nota ${analise.nota.toFixed(1)}` : 'Nota viral'}</Chip>
      </div>

      {sub === 'texto' && (
        <div className="detail__form">
  <label className="field"><span>Descrição do post</span>
    <textarea className="input" value={c.descricao} onChange={e => aoEditar({ descricao: e.target.value })} /></label>
  <label className="field"><span>Hashtags (separadas por espaço)</span>
    <textarea className="input" defaultValue={c.hashtags.join(' ')} onBlur={e => aoEditar({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} /></label>
  {c.motivo && <div className="cut__why"><Icon name="sparkle" /><span>{c.motivo}</span></div>}
  <details className="detail__text">
    <summary>O que é dito neste corte</summary>
    <p>{texto || 'Sem transcrição neste intervalo.'}</p>
  </details>
        </div>
      )}

      {sub === 'corte' && (
      <div className={'detail__cols' + (eLongo ? ' detail__cols--h' : '')}>
        <div className="detail__form">
          <div className="detail__times">
            <TempoCampo passos={eLongo ? PASSOS_LONGO : PASSOS_CURTO} rotulo="Início" valor={c.inicio} aoMudar={s => aoLimite('inicio', s)} aoAgora={() => aoLimite('inicio', agora())} />
            <TempoCampo passos={eLongo ? PASSOS_LONGO : PASSOS_CURTO} rotulo="Fim" valor={c.fim} aoMudar={s => aoLimite('fim', s)} aoAgora={() => aoLimite('fim', agora())} />
          </div>

          <div className="field">
            <span>Velocidade do corte{vel !== 1 ? ` · o vídeo fica com ${Math.round(d)} s` : ''}</span>
            <div className="chips" role="radiogroup" aria-label="Velocidade do corte">
              {VELOCIDADES.map(v => <Chip key={v} selected={vel === v} onClick={() => aoEditar({ velocidade: v })}>{v}×</Chip>)}
              <Button size="sm" variant="text" onClick={() => aoTodos(vel)}>Aplicar a todos</Button>
            </div>
          </div>

          <div className="gauge" aria-label="Duração final do vídeo">
            <div className="gauge__bar">
              <div className="gauge__band" style={eLongo ? { left: '0%', width: '0%' } : { left: `${(config.duracao_min / escala) * 100}%`, width: `${((config.duracao_max - config.duracao_min) / escala) * 100}%` }} />
              <div className={'gauge__mark' + (fora ? ' gauge__mark--warn' : '')} style={{ left: `${Math.min(100, (d / escala) * 100)}%` }} />
            </div>
            <div className="gauge__legend t-meta">
              <b className={fora ? 'warn' : ''}>{Math.round(d)} s</b>
              <span>{eLongo ? 'Vídeo longo (16:9)' : fora === 'curto' ? `Curto demais — o ideal é ${config.duracao_min}–${config.duracao_max} s` : fora === 'longo' ? `Longo demais — o ideal é ${config.duracao_min}–${config.duracao_max} s` : `Dentro do ideal (${config.duracao_min}–${config.duracao_max} s)`}</span>
            </div>
          </div>

          <details className="detail__text" open={partes.length > 1 || !!marca}>
            <summary>Tirar trechos do meio{partes.length > 1 ? ` · ${partes.length} partes mantidas` : ''}</summary>
            <p className="t-meta">Marque um pedaço (tangente, pausa, repetição) e ele é pulado no vídeo final.</p>
            <div className="trechos__row">
              <label className="field"><span>Tirar de (s)</span>
                <input className="input t-num" type="number" step="0.1" value={rem[0]} onChange={e => setRem([Number(e.target.value), rem[1]])} /></label>
              <Button size="sm" variant="text" onClick={() => setRem([+agora().toFixed(1), rem[1]])}>= agora</Button>
              <label className="field"><span>até (s)</span>
                <input className="input t-num" type="number" step="0.1" value={rem[1]} onChange={e => setRem([rem[0], Number(e.target.value)])} /></label>
              <Button size="sm" variant="text" onClick={() => setRem([rem[0], +agora().toFixed(1)])}>= agora</Button>
              <Button size="sm" icon="scissors" disabled={!(rem[1] - rem[0] >= 0.5)} onClick={() => {
                const novo = partes.flatMap(([a, b]) => {
                  if (rem[1] <= a || rem[0] >= b) return [[a, b] as [number, number]]
                  return ([[a, Math.min(b, rem[0])], [Math.max(a, rem[1]), b]] as [number, number][]).filter(([x, y]) => y - x >= 0.3)
                })
                if (novo.length) { aoEditar({ trechos: novo }); aoMarca(null) }
              }}>Tirar este trecho</Button>
            </div>
            {partes.length > 1 && (
              <>
                <div className="trechos__barra" aria-label="Partes mantidas do corte">
                  {partes.map(([a, b], k) => <span key={k} style={{ left: `${((a - c.inicio) / (c.fim - c.inicio)) * 100}%`, width: `${((b - a) / (c.fim - c.inicio)) * 100}%` }} />)}
                </div>
                <div className="trechos__lista t-meta t-num">
                  {partes.map(([a, b], k) => (
                    <span key={k} className="trechos__chip">{hms(a)} – {hms(b)} · {Math.round(b - a)} s
                      <button type="button" aria-label="Descartar esta parte" title="Descartar esta parte" onClick={() => aoEditar({ trechos: partes.filter((_, j) => j !== k) })}>×</button></span>
                  ))}
                  <Button size="sm" variant="text" onClick={() => aoEditar({ trechos: null })}>Restaurar corte inteiro</Button>
                </div>
              </>
            )}
          </details>

          <div className="detail__actions">
            <Button size="sm" icon="scissors" onClick={aoDividir}>Dividir no ponto atual</Button>
          </div>

        </div>

        <div className="detail__preview">
          <span className="t-meta">Prévia do vídeo final · {!eLongo && config.formato === 'vertical' ? '9:16' : '16:9'}{vel !== 1 ? ` · ${vel}×` : ''}</span>
          <Previa video={video} palavras={eLongo ? [] : palavras} config={eLongo ? { ...config, formato: 'horizontal', legendas: false, logo_posicao: config.logo_posicao_longo, logo_tamanho: config.logo_tamanho_longo } : config} tocando={tocando} />
          <div className="detail__actions">
            {tocando ? <Button size="sm" variant="filled" icon="pause" onClick={aoParar}>Pausar</Button>
              : <Button size="sm" variant="filled" icon="play" onClick={() => aoPrevia(c.inicio, c.fim, vel, lacunas(c))}>Ver como vai ficar</Button>}
            <Button size="sm" onClick={() => aoPrevia(mantidos(c)[0][0], mantidos(c)[0][0] + 6 * vel, vel, lacunas(c))}>Início</Button>
            <Button size="sm" onClick={() => { const ps = mantidos(c); const f = ps[ps.length - 1][1]; aoPrevia(Math.max(c.inicio, f - 6 * vel), f, vel, lacunas(c)) }}>Final</Button>
          </div>
          {eLongo && (
            <div className="detail__actions">
              <Button size="sm" variant="filled" onClick={() => setThumbAberta(true)}>Criar thumbnail…</Button>
              {thumbSalva && <span className="t-meta">Thumbnail salva.</span>}
            </div>
          )}
          <ScrubCorte c={c} vel={vel} t={tempoAtual()} aoIr={abs => aoPrevia(abs, partes[partes.length - 1][1], vel, lacunas(c), tocando)} />
          <span className="t-meta">{eLongo ? 'Vídeo longo: 16:9, sem legenda queimada' : config.legendas ? 'Legenda como nos padrões de vídeo' : 'Legendas desligadas nos padrões de vídeo'}</span>
        </div>
      </div>
      )}

      {sub === 'nota' && <ViralCard analise={analise} analisando={analisando} pronto={podeAnalisar} aoAnalisar={aoAnalisar}
                 aoUsarTitulo={t => aoEditar({ titulo: t })} />}
      {eLongo && <ThumbDialog aberto={thumbAberta} ep={ep} corte={c} aoFechar={() => setThumbAberta(false)} aoSalvar={() => { setThumbAberta(false); setThumbSalva(true) }} />}
    </section>
  )
}

const PASSOS_CURTO = [-1, -0.1, 0.1, 1]
const PASSOS_LONGO = [-30, -5, -1, 1, 5, 30]

function TempoCampo({ passos, rotulo, valor, aoMudar, aoAgora }: { passos: number[]; rotulo: string; valor: number; aoMudar: (s: number) => void; aoAgora: () => void }) {
  return (
    <div className="tempo">
      <div className="tempo__row">
        <label className="field"><span>{rotulo} (s)</span>
          <input className="input t-num" type="number" step="0.1" min="0" value={valor} onChange={e => aoMudar(Number(e.target.value))} /></label>
        <span className="tempo__hms t-num">{hms(valor)}</span>
      </div>
      <div className="nudge">
        {passos.map(n => <button key={n} type="button" onClick={() => aoMudar(+(valor + n).toFixed(2))}>{n > 0 ? '+' : '−'}{Math.abs(n)}</button>)}
        <button type="button" className="nudge__now" onClick={aoAgora}>= agora</button>
      </div>
    </div>
  )
}

/** Barra de avançar da prévia do corte: posição dentro do vídeo final (já sem os buracos), com saltos de 5 e 15 s. */
function ScrubCorte({ c, vel, t, aoIr }: { c: Corte; vel: number; t: number; aoIr: (abs: number) => void }) {
  const partes = mantidos(c)
  const total = partes.reduce((s, [a, b]) => s + b - a, 0)
  // posição virtual (s do vídeo final antes da velocidade) a partir do tempo absoluto; dentro de um buraco, fica no começo dele
  let pos = 0
  for (const [a, b] of partes) {
    if (t >= b) pos += b - a
    else { pos += Math.max(0, t - a); break }
  }
  pos = Math.min(total, Math.max(0, pos))
  const ir = (v: number) => {
    let resto = Math.min(total, Math.max(0, v))
    for (const [a, b] of partes) {
      if (resto <= b - a) { aoIr(a + resto); return }
      resto -= b - a
    }
    aoIr(partes[partes.length - 1][1] - 0.1)
  }
  const fmt = (s: number) => { const x = Math.round(s / vel); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}` }
  return (
    <div className="scrub" aria-label="Avançar no vídeo final">
      <input type="range" min={0} max={Math.max(1, Math.round(total * 10) / 10)} step={0.1} value={pos} aria-label="Posição no vídeo final" onChange={e => ir(Number(e.target.value))} />
      <div className="scrub__row t-meta t-num">
        <button type="button" onClick={() => ir(pos - 15 * vel)} aria-label="Voltar 15 segundos">−15 s</button>
        <button type="button" onClick={() => ir(pos - 5 * vel)} aria-label="Voltar 5 segundos">−5 s</button>
        <span>{fmt(pos)} / {fmt(total)}</span>
        <button type="button" onClick={() => ir(pos + 5 * vel)} aria-label="Avançar 5 segundos">+5 s</button>
        <button type="button" onClick={() => ir(pos + 15 * vel)} aria-label="Avançar 15 segundos">+15 s</button>
      </div>
    </div>
  )
}
