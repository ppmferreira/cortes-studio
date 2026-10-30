import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, hms, tituloDe, urlEntrada } from '../api'
import { GerarDialog } from '../components/GerarDialog'
import type { Pedido } from '../components/GerarDialog'
import { Previa } from '../components/Previa'
import { NotaChip, ViralCard } from '../components/ViralCard'
import { TranscreverBanner } from '../components/TranscreverBanner'
import { ProcessPanel } from '../components/ProcessPanel'
import { Short } from '../components/Short'
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
const duracaoFinal = (c: Corte) => (c.fim - c.inicio) / (c.velocidade || 1)

export function Editor({ ep, job, episodios, templates, temChave, aoRodar, aoLote, aoMudou, aoCancelar, aviso }: Props) {
  const config = ep.config
  const perguntar = usePerguntar()
  const confirmar = useConfirmar()
  const player = useRef<HTMLVideoElement>(null)
  const parar = useRef<number | null>(null)          // segundo em que a prévia de um trecho deve parar
  const [cortes, setCortes] = useState<Corte[]>([])
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
  const apagarAoSalvar = useRef<string[]>([])   // cortes removidos cujo vídeo o usuário quer apagar junto
  const [modoGerar, setModoGerar] = useState<'existentes' | 'claude' | undefined>()
  const ocupado = !!job?.rodando

  const atualizarStatus = useCallback(() => {
    api.statusRender(ep.nome).then(setStatus).catch(() => undefined)
    api.analises(ep.nome).then(setAnalises).catch(() => undefined)
  }, [ep.nome])

  // recarrega do disco ao trocar de episódio ou quando uma etapa muda os dados
  useEffect(() => {
    api.cortes(ep.nome).then(c => { setCortes(c); setSujo(false); setSel(s => (s !== null && s < c.length ? s : c.length ? 0 : null)) })
    api.transcricao(ep.nome).then(setTrans)
    setSemPlayer(false)
  }, [ep.nome, ep.n_cortes, ep.transcrito])
  useEffect(atualizarStatus, [atualizarStatus, ep.videos.join('|'), ep.n_cortes])
  // quando um processo termina (o Claude pode ter trocado os cortes) recarrega, sem perder edição não salva
  const sujoRef = useRef(false)
  sujoRef.current = sujo
  const rodandoJob = !!job?.rodando
  useEffect(() => {
    if (rodandoJob || sujoRef.current) return
    api.cortes(ep.nome).then(c => { setCortes(c); setSel(x => (x !== null && x < c.length ? x : c.length ? 0 : null)) })
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
  const previa = (ini: number, fim: number, v = 1) => {
    const p = player.current
    if (!p) return
    p.playbackRate = v
    p.currentTime = Math.max(0, ini)
    parar.current = fim
    void p.play()
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

  const novo = useCallback(() => {
    const t0 = agora()
    setCortes(cs => { setSel(cs.length); return [...cs, { id: '', velocidade: config.velocidade_padrao, inicio: t0, fim: t0 + 45, titulo: 'Novo corte', motivo: '', descricao: '', hashtags: [] }] })
    setSujo(true); setAba('cortes')
  }, [config.velocidade_padrao])

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
      setCortes(r.cortes); setSujo(false); atualizarStatus()
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
  const janela = c ? { w0: Math.max(0, c.inicio - 20), w1: Math.min(limite || c.fim + 20, c.fim + 20) } : null
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
              <div className="track-title"><b>Ajuste fino</b><span className="t-meta">corte {sel + 1} · janela de {hms(janela.w0)} a {hms(janela.w1)}</span></div>
              <Track fino somenteSel w0={janela.w0} w1={janela.w1} t={t} cortes={cortes} sel={sel}
                     aoBuscar={s => ir(s)} aoSelecionar={() => undefined} aoMudar={mudarLimite} />
            </>
          )}
          <div className="shortcuts t-meta">
            <span><kbd>Espaço</kbd> tocar/pausar</span><span><kbd>←</kbd><kbd>→</kbd> ±5 s (<kbd>Shift</kbd> ±1 s)</span>
            <span><kbd>I</kbd> início aqui</span><span><kbd>O</kbd> fim aqui</span><span><kbd>N</kbd> novo corte</span><span><kbd>S</kbd> dividir o corte aqui</span>
          </div>
        </section>

        {c && sel !== null ? (
          <CutDetail key={sel} i={sel} c={c} ep={ep} trans={trans} video={player} tocando={tocando} agora={agora}
                     analise={analises[c.id]} analisando={ocupado && job?.etapa === 'analisar'} podeAnalisar={!!c.id && ep.transcrito && !ocupado}
                     aoAnalisar={() => analisar(c.id ? [c.id] : undefined)}
                     aoEditar={p => editar(sel, p)} aoLimite={(lado, s) => mudarLimite(sel, lado, s)}
                     aoTodos={v => { setCortes(cs => cs.map(x => ({ ...x, velocidade: v }))); setSujo(true) }}
                     aoPrevia={previa} aoParar={() => { player.current?.pause(); parar.current = null }} aoRemover={() => remover(sel)} aoDividir={() => dividir(sel)} />
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
              <div className="viralbar">
                <span className="t-meta">Potencial de viralização (0 a 10)</span>
                <Button size="sm" icon="sparkle" disabled={ocupado || !ep.transcrito} onClick={() => analisar()}>
                  {cortes.some(x => !analises[x.id] || analises[x.id].desatualizada) ? `Analisar (${cortes.filter(x => !analises[x.id] || analises[x.id].desatualizada).length})` : 'Tudo analisado'}
                </Button>
              </div>
              <ul className="cutlist">
                {cortes.map((x, i) => {
                  const d = duracaoFinal(x)
                  const fora = d < config.duracao_min || d > config.duracao_max
                  const est = status?.cortes[x.id]?.estado
                  return (
                    <li key={x.id || i}>
                      <button className="cutrow" aria-current={sel === i} onClick={() => { setSel(i); ir(x.inicio) }}>
                        <span className="cut__num">{i + 1}</span>
                        <span className="cutrow__body"><b className="truncate">{x.titulo}</b>
                          <span className="t-meta t-num">{hms(x.inicio)} – {hms(x.fim)}{x.velocidade !== 1 ? ` · ${x.velocidade}×` : ''}
                            {!sujo && est && est !== 'novo' && <span className={'dot dot--' + est} title={est === 'pronto' ? 'Vídeo pronto' : 'Vídeo desatualizado'} />}</span></span>
                        {analises[x.id] && <NotaChip nota={analises[x.id].nota} titulo={`Potencial de viralização: ${analises[x.id].veredito}${analises[x.id].desatualizada ? ' (corte mudou depois da análise)' : ''}`} />}
                        <span className={'cut__dur' + (fora ? ' cut__dur--warn' : '')} title={fora ? `Fora do ideal (${config.duracao_min}–${config.duracao_max} s)` : 'Duração final'}>{Math.round(d)} s</span>
                      </button>
                    </li>
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
            <Button icon="add" onClick={novo}>Novo</Button>
            <Button icon="save" disabled={ocupado || !sujo} onClick={salvar}>Salvar</Button>
            <Button variant="brand" icon="scissors" disabled={ocupado || cortes.length === 0} onClick={() => abrirGerar()}>
              Gerar vídeos{pendentes ? ` (${pendentes})` : ''}…
            </Button>
          </div>
        )}
      </aside>

      <GerarDialog aberto={gerar} ep={ep} episodios={episodios} templates={templates} cortes={cortes} temClaude={temChave} modoInicial={modoGerar}
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
function CutDetail({ i, c, ep, trans, video, tocando, agora, analise, analisando, podeAnalisar, aoAnalisar, aoEditar, aoLimite, aoTodos, aoPrevia, aoParar, aoRemover, aoDividir }: {
  i: number; c: Corte; ep: Episodio; trans: Segmento[]; video: React.RefObject<HTMLVideoElement | null>; tocando: boolean
  agora: () => number; analise?: Analise; analisando: boolean; podeAnalisar: boolean; aoAnalisar: () => void
  aoEditar: (p: Partial<Corte>) => void; aoLimite: (lado: Lado, s: number) => void; aoTodos: (v: number) => void
  aoPrevia: (ini: number, fim: number, vel?: number) => void; aoParar: () => void; aoRemover: () => void; aoDividir: () => void
}) {
  const config = ep.config
  const vel = c.velocidade || 1
  const d = (c.fim - c.inicio) / vel
  const fora = d < config.duracao_min ? 'curto' : d > config.duracao_max ? 'longo' : null
  const texto = useMemo(() => trans.filter(s => s.fim > c.inicio && s.inicio < c.fim).map(s => s.texto).join(' '), [trans, c.inicio, c.fim])
  const escala = Math.max(config.duracao_max * 1.25, d)

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
        <Button size="sm" variant="text" icon="trash" onClick={aoRemover}>Remover</Button>
      </div>

      <div className="detail__cols">
        <div className="detail__form">
          <div className="detail__times">
            <TempoCampo rotulo="Início" valor={c.inicio} aoMudar={s => aoLimite('inicio', s)} aoAgora={() => aoLimite('inicio', agora())} />
            <TempoCampo rotulo="Fim" valor={c.fim} aoMudar={s => aoLimite('fim', s)} aoAgora={() => aoLimite('fim', agora())} />
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
              <div className="gauge__band" style={{ left: `${(config.duracao_min / escala) * 100}%`, width: `${((config.duracao_max - config.duracao_min) / escala) * 100}%` }} />
              <div className={'gauge__mark' + (fora ? ' gauge__mark--warn' : '')} style={{ left: `${Math.min(100, (d / escala) * 100)}%` }} />
            </div>
            <div className="gauge__legend t-meta">
              <b className={fora ? 'warn' : ''}>{Math.round(d)} s</b>
              <span>{fora === 'curto' ? `Curto demais — o ideal é ${config.duracao_min}–${config.duracao_max} s` : fora === 'longo' ? `Longo demais — o ideal é ${config.duracao_min}–${config.duracao_max} s` : `Dentro do ideal (${config.duracao_min}–${config.duracao_max} s)`}</span>
            </div>
          </div>

          <div className="detail__actions">
            <Button size="sm" onClick={() => aoPrevia(c.inicio, c.inicio + 6 * vel, vel)}>Ver início</Button>
            <Button size="sm" onClick={() => aoPrevia(Math.max(c.inicio, c.fim - 6 * vel), c.fim, vel)}>Ver final</Button>
            <Button size="sm" icon="scissors" onClick={aoDividir}>Dividir no ponto atual</Button>
          </div>

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

        <div className="detail__preview">
          <span className="t-meta">Prévia do vídeo final · {config.formato === 'vertical' ? '9:16' : '16:9'}{vel !== 1 ? ` · ${vel}×` : ''}</span>
          <Previa video={video} palavras={palavras} config={config} tocando={tocando} />
          <div className="detail__actions">
            {tocando ? <Button size="sm" variant="filled" icon="pause" onClick={aoParar}>Pausar</Button>
              : <Button size="sm" variant="filled" icon="play" onClick={() => aoPrevia(c.inicio, c.fim, vel)}>Ver como vai ficar</Button>}
          </div>
          <span className="t-meta">{config.legendas ? 'Legenda como nos padrões de vídeo' : 'Legendas desligadas nos padrões de vídeo'}</span>
        </div>
      </div>

      <ViralCard analise={analise} analisando={analisando} pronto={podeAnalisar} aoAnalisar={aoAnalisar}
                 aoUsarTitulo={t => aoEditar({ titulo: t })} />
    </section>
  )
}

function TempoCampo({ rotulo, valor, aoMudar, aoAgora }: { rotulo: string; valor: number; aoMudar: (s: number) => void; aoAgora: () => void }) {
  return (
    <div className="tempo">
      <div className="tempo__row">
        <label className="field"><span>{rotulo} (s)</span>
          <input className="input t-num" type="number" step="0.1" min="0" value={valor} onChange={e => aoMudar(Number(e.target.value))} /></label>
        <span className="tempo__hms t-num">{hms(valor)}</span>
      </div>
      <div className="nudge">
        {[-1, -0.1, 0.1, 1].map(n => <button key={n} type="button" onClick={() => aoMudar(+(valor + n).toFixed(2))}>{n > 0 ? '+' : '−'}{Math.abs(n)}</button>)}
        <button type="button" className="nudge__now" onClick={aoAgora}>= agora</button>
      </div>
    </div>
  )
}
