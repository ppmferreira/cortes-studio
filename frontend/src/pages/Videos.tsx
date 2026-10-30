import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, hms, tituloDe, urlSaida } from '../api'
import { NotaChip } from '../components/ViralCard'
import { AprendizadoDialog } from '../components/AprendizadoDialog'
import { ThumbDialog } from '../components/ThumbDialog'
import { Icon } from '../ui/Icon'
import { useConfirmar } from '../ui/Confirm'
import { Badge, Button, Chip, Dialog, Switch } from '../ui/kit'
import type { Analise, Corte, Desempenho, Episodio, EstadoRender, Resultado, ResultadoSalvo, StatusRender, VideoGerado } from '../types'

type Ordem = 'recentes' | 'antigos' | 'titulo' | 'duracao' | 'nota'
type Filtro = 'todos' | EstadoRender
type Aba = 'short' | 'longo' | 'thumbs'
type Item = { ep: Episodio; v: VideoGerado }

const ORDENS: { id: Ordem; nome: string }[] = [
  { id: 'recentes', nome: 'Mais recentes' }, { id: 'antigos', nome: 'Mais antigos' },
  { id: 'nota', nome: 'Maior potencial viral' }, { id: 'titulo', nome: 'Título (A–Z)' }, { id: 'duracao', nome: 'Duração (maior primeiro)' },
]

const comparar = (o: Ordem) => (a: VideoGerado, b: VideoGerado) =>
  o === 'recentes' ? b.gerado_em - a.gerado_em
    : o === 'antigos' ? a.gerado_em - b.gerado_em
      : o === 'nota' ? (b.nota ?? -1) - (a.nota ?? -1)
        : o === 'titulo' ? a.titulo.localeCompare(b.titulo, 'pt-BR')
          : (b.duracao ?? 0) - (a.duracao ?? 0)

const chaveDe = (i: Item) => i.ep.nome + '|' + i.v.arquivo
const dur = (s: number) => (s >= 3600 ? hms(s) : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
const textoDe = (v: VideoGerado) => [v.titulo, v.descricao, v.hashtags.join(' ')].filter(Boolean).join('\n\n')
const urlThumb = (ep: Episodio, v: VideoGerado, ver: number) => `${urlSaida(ep.nome, `thumb_${v.corte}.jpg`)}?v=${ver}`

/** Biblioteca: abas Shorts | Vídeos longos | Thumbnails, cartões leves (pôster, sem carregar o vídeo), detalhe em janela e ações em lote. */
export function Videos({ episodios, busca, aviso, aoMudou, ocupado }: {
  episodios: Episodio[]; busca: string; aviso: (m: string) => void; aoMudou: () => void; ocupado: boolean
}) {
  const confirmar = useConfirmar()
  const [status, setStatus] = useState<Record<string, StatusRender>>({})
  const [aba, setAba] = useState<Aba>('short')
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [notaMin, setNotaMin] = useState(0)
  const [epFiltro, setEpFiltro] = useState('')
  const [agrupar, setAgrupar] = useState(true)
  const [modo, setModo] = useState<'lista' | 'grade'>(() => { try { return localStorage.getItem('videos_modo') === 'grade' ? 'grade' : 'lista' } catch { return 'lista' } })
  const mudarModo = (m: 'lista' | 'grade') => { setModo(m); try { localStorage.setItem('videos_modo', m) } catch { /* sem armazenamento */ } }
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aberto, setAberto] = useState<Item | null>(null)
  const [aprend, setAprend] = useState(false)
  const [desemp, setDesemp] = useState<Desempenho | null>(null)
  const recarregarDesemp = useCallback(() => { api.desempenho().then(setDesemp).catch(() => undefined) }, [])
  useEffect(recarregarDesemp, [recarregarDesemp])
  const [ver, setVer] = useState(0)   // muda ao salvar uma thumbnail, para recarregar a imagem

  const comVideos = episodios.filter(e => e.videos.length)
  const chave = comVideos.map(e => e.nome + ':' + e.videos.join('|')).join(';')
  const carregar = useCallback(async () => {
    const pares = await Promise.all(comVideos.map(async e => [e.nome, await api.statusRender(e.nome)] as const))
    setStatus(Object.fromEntries(pares))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  useEffect(() => { void carregar() }, [carregar])

  const q = busca.trim().toLowerCase()
  const todosItens: Item[] = useMemo(() => episodios.flatMap(e => (status[e.nome]?.videos ?? []).map(v => ({ ep: e, v }))), [episodios, status])
  const tipoDe = (v: VideoGerado) => v.tipo ?? 'short'

  const filtrados = useMemo(() => todosItens.filter(({ ep, v }) =>
    (filtro === 'todos' || v.estado === filtro)
    && (!notaMin || (v.nota ?? -1) >= notaMin)
    && (!epFiltro || ep.nome === epFiltro)
    && (!q || `${v.titulo} ${v.descricao} ${v.hashtags.join(' ')} ${ep.nome}`.toLowerCase().includes(q))),
  [todosItens, filtro, notaMin, epFiltro, q])

  const daAba = useMemo(() => filtrados
    .filter(i => aba === 'thumbs' ? i.v.thumb : tipoDe(i.v) === aba)
    .sort((a, b) => comparar(ordem)(a.v, b.v)), [filtrados, aba, ordem])
  const grupos = useMemo(() => episodios.map(e => ({ ep: e, itens: daAba.filter(i => i.ep.nome === e.nome) })).filter(g => g.itens.length), [episodios, daAba])

  const n = (a: Aba) => todosItens.filter(i => a === 'thumbs' ? i.v.thumb : tipoDe(i.v) === a).length
  const contagem = (f: EstadoRender) => todosItens.filter(i => i.v.estado === f).length

  const alternar = (i: Item) => setMarcados(m => { const k = chaveDe(i), s = new Set(m); if (s.has(k)) s.delete(k); else s.add(k); return s })
  const selecionados = todosItens.filter(i => marcados.has(chaveDe(i)))

  const apagar = async (i: Item) => {
    if (!(await confirmar({ titulo: 'Excluir vídeo?', mensagem: <>O vídeo <b>“{i.v.titulo}”</b> será apagado do computador. Não dá para desfazer.</>, rotulo: 'Excluir vídeo' }))) return
    await api.apagarVideo(i.ep.nome, i.v.arquivo)
    aviso('Vídeo excluído'); setAberto(null); aoMudou(); void carregar()
  }
  const apagarLote = async () => {
    if (!selecionados.length) return
    if (!(await confirmar({ titulo: `Excluir ${selecionados.length} ${selecionados.length === 1 ? 'vídeo' : 'vídeos'}?`, mensagem: <>Os arquivos serão apagados do computador. Não dá para desfazer.</>, rotulo: `Excluir ${selecionados.length}` }))) return
    await Promise.all(selecionados.map(i => api.apagarVideo(i.ep.nome, i.v.arquivo)))
    aviso(`${selecionados.length} ${selecionados.length === 1 ? 'vídeo excluído' : 'vídeos excluídos'}`); setMarcados(new Set()); aoMudou(); void carregar()
  }
  const baixarLote = async () => {
    for (const i of selecionados) {
      const a = document.createElement('a'); a.href = urlSaida(i.ep.nome, i.v.arquivo); a.download = i.v.arquivo; a.click()
      await new Promise(r => setTimeout(r, 500))   // o navegador ignora downloads simultâneos demais
    }
  }
  const copiarLote = async () => { await navigator.clipboard?.writeText(selecionados.map(i => textoDe(i.v)).join('\n\n---\n\n')); aviso('Textos copiados') }
  const limparRemovidos = async () => {
    const alvo = todosItens.filter(i => i.v.estado === 'sem_corte')
    if (!alvo.length) return
    if (!(await confirmar({ titulo: 'Excluir vídeos de cortes removidos?', mensagem: <>{alvo.length} {alvo.length === 1 ? 'vídeo' : 'vídeos'} de cortes que você já removeu {alvo.length === 1 ? 'será apagado' : 'serão apagados'} do computador. Não dá para desfazer.</>, rotulo: `Excluir ${alvo.length}` }))) return
    await Promise.all(alvo.map(i => api.apagarVideo(i.ep.nome, i.v.arquivo)))
    aviso(`${alvo.length} ${alvo.length === 1 ? 'vídeo excluído' : 'vídeos excluídos'}`); aoMudou(); void carregar()
  }

  const cartao = (i: Item, mostrarEp: boolean) => {
    const { ep, v } = i, longo = tipoDe(v) === 'longo', marcado = marcados.has(chaveDe(i))
    return (
      <article key={chaveDe(i)} className={'vcard' + (marcado ? ' vcard--on' : '') + (longo || aba === 'thumbs' ? ' vcard--h' : '')}>
        <button type="button" className="vcard__poster" onClick={() => setAberto(i)} aria-label={`Abrir ${v.titulo}`}>
          {aba === 'thumbs'
            ? <img src={urlThumb(ep, v, ver)} alt="" loading="lazy" />
            : <video src={urlSaida(ep.nome, v.arquivo) + '#t=0.8'} preload="metadata" muted playsInline tabIndex={-1} />}
          {v.nota != null && <span className="vcard__nota"><NotaChip nota={v.nota} /></span>}
          {v.duracao != null && aba !== 'thumbs' && <span className="vcard__dur t-num">{dur(v.duracao)}</span>}
        </button>
        <input type="checkbox" className="vcard__check" checked={marcado} onChange={() => alternar(i)} aria-label={`Selecionar ${v.titulo}`} />
        <div className="vcard__body">
          <b className="vcard__title">{v.titulo}</b>
          <span className="t-meta">
            {v.estado === 'desatualizado' && <Badge tone="run">Desatualizado</Badge>}
            {v.estado === 'sem_corte' && <Badge tone="err">Corte removido</Badge>}
            {mostrarEp && <> {tituloDe(ep.nome)}</>}
          </span>
        </div>
      </article>
    )
  }
  /** Linha da lista: miniatura pequena + título, trecho da descrição, episódio e ações rápidas. */
  const linha = (i: Item, mostrarEp: boolean) => {
    const { ep, v } = i, longo = tipoDe(v) === 'longo', marcado = marcados.has(chaveDe(i))
    return (
      <article key={chaveDe(i)} className={'vrow' + (marcado ? ' vrow--on' : '')}>
        <input type="checkbox" checked={marcado} onChange={() => alternar(i)} aria-label={`Selecionar ${v.titulo}`} />
        <button type="button" className={'vrow__poster' + (longo || aba === 'thumbs' ? ' vrow__poster--h' : '')} onClick={() => setAberto(i)} aria-label={`Abrir ${v.titulo}`}>
          {aba === 'thumbs'
            ? <img src={urlThumb(ep, v, ver)} alt="" loading="lazy" />
            : <video src={urlSaida(ep.nome, v.arquivo) + '#t=0.8'} preload="metadata" muted playsInline tabIndex={-1} />}
          {v.duracao != null && aba !== 'thumbs' && <span className="vcard__dur t-num">{dur(v.duracao)}</span>}
        </button>
        <div className="vrow__body">
          <button type="button" className="vrow__title" onClick={() => setAberto(i)}>{v.titulo}</button>
          <span className="t-meta">
            {v.nota != null && <NotaChip nota={v.nota} />}
            {v.estado === 'desatualizado' && <> <Badge tone="run">Desatualizado</Badge></>}
            {v.estado === 'sem_corte' && <> <Badge tone="err">Corte removido</Badge></>}
            {mostrarEp && <> {tituloDe(ep.nome)}</>}
          </span>
          {v.descricao && <p className="vrow__desc">{v.descricao}</p>}
        </div>
        <div className="vrow__actions">
          <Button size="sm" icon="copy" onClick={async () => { await navigator.clipboard?.writeText(textoDe(v)); aviso('Texto copiado') }}>Copiar texto</Button>
          <a className="btn btn--tonal btn--sm" href={urlSaida(ep.nome, aba === 'thumbs' ? `thumb_${v.corte}.jpg` : v.arquivo)} download>Baixar</a>
        </div>
      </article>
    )
  }
  const grade = (lista: Item[], mostrarEp: boolean) => modo === 'lista'
    ? <div className="vlist">{lista.map(i => linha(i, mostrarEp))}</div>
    : <div className={'vgrid vgrid--compacta' + (aba === 'short' ? '' : ' vgrid--h')}>{lista.map(i => cartao(i, mostrarEp))}</div>

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Vídeos gerados</h1>
        <Button icon="sparkle" onClick={() => setAprend(true)}>Aprendizado{desemp ? ` (${Object.values(desemp.resultados).filter(r => r.views != null).length})` : ''}</Button>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 'var(--sp-4)' }}>
        <Chip selected={aba === 'short'} count={n('short')} onClick={() => setAba('short')}>Shorts</Chip>
        <Chip selected={aba === 'longo'} count={n('longo')} onClick={() => setAba('longo')}>Vídeos longos</Chip>
        <Chip selected={aba === 'thumbs'} count={n('thumbs')} onClick={() => setAba('thumbs')}>Thumbnails</Chip>
      </div>

      <div className="lib-bar">
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          <Chip selected={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</Chip>
          <Chip selected={filtro === 'pronto'} count={contagem('pronto')} onClick={() => setFiltro('pronto')}>Prontos</Chip>
          <Chip selected={filtro === 'desatualizado'} count={contagem('desatualizado')} onClick={() => setFiltro('desatualizado')}>Desatualizados</Chip>
          <Chip selected={filtro === 'sem_corte'} count={contagem('sem_corte')} onClick={() => setFiltro('sem_corte')}>Corte removido</Chip>
        </div>
        <div className="lib-bar__end">
          {contagem('sem_corte') > 0 && <Button size="sm" variant="text" icon="trash" onClick={limparRemovidos}>Excluir de cortes removidos ({contagem('sem_corte')})</Button>}
          <label className="toolbar__speed t-meta">Nota
            <select className="input" value={notaMin} onChange={e => setNotaMin(Number(e.target.value))} aria-label="Nota mínima">
              <option value={0}>Qualquer</option><option value={6}>6 ou mais</option><option value={7}>7 ou mais</option><option value={8}>8 ou mais</option>
            </select></label>
          <label className="toolbar__speed t-meta">Episódio
            <select className="input" value={epFiltro} onChange={e => setEpFiltro(e.target.value)} aria-label="Filtrar por episódio">
              <option value="">Todos</option>
              {comVideos.map(e => <option key={e.nome} value={e.nome}>{tituloDe(e.nome).slice(0, 50)}</option>)}
            </select></label>
          <div className="tabs" role="radiogroup" aria-label="Modo de exibição" style={{ margin: 0 }}>
            <Chip selected={modo === 'lista'} onClick={() => mudarModo('lista')}>Lista</Chip>
            <Chip selected={modo === 'grade'} onClick={() => mudarModo('grade')}>Grade</Chip>
          </div>
          <Switch checked={agrupar} onChange={setAgrupar}>Agrupar por episódio</Switch>
          <label className="toolbar__speed t-meta">Ordenar
            <select className="input" value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} aria-label="Ordenar vídeos">
              {ORDENS.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select></label>
        </div>
      </div>

      {selecionados.length > 0 && (
        <div className="batchbar" role="toolbar" aria-label="Ações em lote">
          <b>{selecionados.length} {selecionados.length === 1 ? 'selecionado' : 'selecionados'}</b>
          <Button size="sm" onClick={() => setMarcados(new Set(daAba.map(chaveDe)))}>Selecionar todos da aba</Button>
          <Button size="sm" onClick={baixarLote}>Baixar</Button>
          <Button size="sm" icon="copy" onClick={copiarLote}>Copiar textos</Button>
          <Button size="sm" variant="text" icon="trash" onClick={apagarLote}>Excluir</Button>
          <Button size="sm" variant="text" onClick={() => setMarcados(new Set())}>Limpar seleção</Button>
        </div>
      )}

      {daAba.length === 0 && (
        <div className="empty">
          <Icon name="movie" />
          <h2 className="t-heading">{todosItens.length ? 'Nada nesta aba com esses filtros' : 'Nenhum vídeo gerado'}</h2>
          <p>{todosItens.length
            ? (aba === 'thumbs' ? 'Thumbnails são criadas no editor ou ao abrir um vídeo longo.' : aba === 'longo' ? 'Peça vídeos longos ao Claude no editor (Criar cortes com IA).' : 'Mude os filtros ou a busca para ver os outros.')
            : 'Gere os cortes de um episódio no editor e eles aparecem aqui.'}</p>
        </div>
      )}

      {agrupar
        ? grupos.map(g => (
          <section key={g.ep.nome} style={{ marginBottom: 'var(--sp-6)' }}>
            <h2 className="t-heading" style={{ marginBottom: 'var(--sp-3)' }}>{tituloDe(g.ep.nome)} <span className="t-meta">· {g.itens.length}</span></h2>
            {grade(g.itens, false)}
          </section>
        ))
        : grade(daAba, true)}

      <AprendizadoDialog aberto={aprend} episodio={comVideos[0]?.nome ?? episodios[0]?.nome ?? null} ocupado={ocupado} aviso={aviso}
                         aoFechar={() => { setAprend(false); recarregarDesemp() }} />
      {aberto && <Detalhe item={aberto} ver={ver} aviso={aviso} resultados={desemp?.resultados ?? {}} aoResultado={recarregarDesemp} aoFechar={() => setAberto(null)} aoApagar={() => apagar(aberto)}
                          aoThumb={() => { setVer(x => x + 1); void carregar() }} />}
    </>
  )
}

/* ------------------------------- detalhe ------------------------------- */
function Detalhe({ item, ver, aviso, resultados, aoResultado, aoFechar, aoApagar, aoThumb }: {
  item: Item; ver: number; aviso: (m: string) => void; resultados: Record<string, ResultadoSalvo>; aoResultado: () => void; aoFechar: () => void; aoApagar: () => void; aoThumb: () => void
}) {
  const { ep, v } = item
  const url = urlSaida(ep.nome, v.arquivo)
  const longo = (v.tipo ?? 'short') === 'longo'
  const [analise, setAnalise] = useState<Analise | undefined>()
  const [corte, setCorte] = useState<Corte | undefined>()
  const [thumbAberta, setThumbAberta] = useState(false)
  const [temThumb, setTemThumb] = useState(!!v.thumb)
  const tags = v.hashtags.join(' ')

  useEffect(() => {
    let vivo = true
    if (v.corte) {
      api.analises(ep.nome).then(a => { if (vivo) setAnalise(a[v.corte!]) }).catch(() => undefined)
      if (longo) api.cortes(ep.nome).then(cs => { if (vivo) setCorte(cs.find(c => c.id === v.corte)) }).catch(() => undefined)
    }
    return () => { vivo = false }
  }, [ep.nome, v.corte, longo])

  const copiar = async (texto: string, rotulo: string) => { await navigator.clipboard?.writeText(texto); aviso(`${rotulo} copiado`) }

  return (
    <>
      <Dialog aberto titulo={v.titulo} aoFechar={aoFechar} largo
              rodape={<>
                <Button variant="text" icon="trash" onClick={aoApagar}>Excluir</Button>
                <a className="btn btn--tonal" href={url} download style={{ marginLeft: 'auto' }}>Baixar vídeo</a>
                <Button onClick={aoFechar}>Fechar</Button>
              </>}>
        <div className={'vdet' + (longo ? ' vdet--h' : '')}>
          <video className="vdet__player" src={url} controls preload="metadata" autoPlay />
          <div className="vdet__info">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {v.nota != null && <NotaChip nota={v.nota} />}
              {v.duracao != null && <span className="t-meta t-num">{dur(v.duracao)}</span>}
              <Badge>{longo ? 'Vídeo longo' : 'Short'}</Badge>
              {v.estado === 'desatualizado' && <Badge tone="run">Desatualizado</Badge>}
              {v.estado === 'sem_corte' && <Badge tone="err">Corte removido</Badge>}
            </div>
            <span className="t-meta">{tituloDe(ep.nome)}</span>
            {analise && <p className="vdet__nota"><b>{analise.veredito}.</b> {analise.resumo}</p>}
            {v.descricao && <p className="short__desc">{v.descricao}</p>}
            {tags && <p className="short__tags">{tags}</p>}
            <div className="short__actions">
              <Button size="sm" icon="copy" onClick={() => copiar(v.titulo, 'Título')}>Título</Button>
              <Button size="sm" icon="copy" disabled={!v.descricao} onClick={() => copiar(v.descricao, 'Descrição')}>Descrição</Button>
              <Button size="sm" icon="copy" disabled={!tags} onClick={() => copiar(tags, 'Hashtags')}>Tags</Button>
              <Button size="sm" icon="copy" disabled={!tags} onClick={() => copiar(v.hashtags.map(t => t.replace(/^#/, '')).join(', '), 'Tags com vírgula')}>Tags com vírgula</Button>
              <Button size="sm" icon="copy" onClick={() => copiar(textoDe(v), 'Texto completo')}>Tudo</Button>
            </div>
            {v.corte && <FormResultado ep={ep} v={v} salvo={resultados[`${ep.nome.replace(/\.[^.]+$/, '')}|${v.corte}`]} aviso={aviso} aoSalvar={aoResultado} />}
            {longo && (
              <div className="vdet__thumb">
                <span className="t-meta">Thumbnail</span>
                {temThumb && <img src={urlThumb(ep, v, ver)} alt="Thumbnail do vídeo" />}
                <div className="short__actions">
                  <Button size="sm" variant="filled" disabled={!corte} onClick={() => setThumbAberta(true)}>{temThumb ? 'Editar thumbnail…' : 'Criar thumbnail…'}</Button>
                  {temThumb && <a className="btn btn--tonal btn--sm" href={urlThumb(ep, v, ver)} download={`thumb_${v.corte}.jpg`}>Baixar thumbnail</a>}
                  {temThumb && <Button size="sm" variant="text" icon="trash" onClick={async () => { await api.apagarThumb(ep.nome, v.corte!); setTemThumb(false); aoThumb() }}>Excluir</Button>}
                </div>
              </div>
            )}
          </div>
        </div>
      </Dialog>
      {corte && <ThumbDialog aberto={thumbAberta} ep={ep} corte={corte} aoFechar={() => setThumbAberta(false)}
                             aoSalvar={() => { setThumbAberta(false); setTemThumb(true); aoThumb(); aviso('Thumbnail salva') }} />}
    </>
  )
}

/* ------------------------------- resultado depois de postar ------------------------------- */
const PLATAFORMAS = ['YouTube Shorts', 'TikTok', 'Instagram Reels', 'YouTube (vídeo longo)', 'Outra']

function FormResultado({ ep, v, salvo, aviso, aoSalvar }: { ep: Episodio; v: VideoGerado; salvo?: ResultadoSalvo; aviso: (m: string) => void; aoSalvar: () => void }) {
  const [r, setR] = useState<Resultado>({ plataforma: '', postado_em: '', views: null, curtidas: null, comentarios: null, compartilhamentos: null, retencao_pct: null, observacao: '' })
  useEffect(() => {
    if (salvo) setR({ plataforma: salvo.plataforma, postado_em: salvo.postado_em, views: salvo.views, curtidas: salvo.curtidas, comentarios: salvo.comentarios, compartilhamentos: salvo.compartilhamentos, retencao_pct: salvo.retencao_pct, observacao: salvo.observacao })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!salvo])
  const num = (k: 'views' | 'curtidas' | 'comentarios' | 'compartilhamentos' | 'retencao_pct', rotulo: string) => (
    <label className="field"><span>{rotulo}</span>
      <input className="input t-num" type="number" min={0} max={k === 'retencao_pct' ? 100 : undefined} value={r[k] ?? ''}
             onChange={e => setR({ ...r, [k]: e.target.value === '' ? null : Number(e.target.value) })} /></label>
  )
  return (
    <details className="detail__text" open={!!salvo}>
      <summary>Resultado depois de postar{salvo?.views != null ? ` · ${salvo.views.toLocaleString('pt-BR')} views` : ''}</summary>
      <p className="t-meta">Registre o que aconteceu para o Claude aprender o que funciona no seu canal (botão “Aprendizado” na biblioteca).</p>
      <div className="grid-3">
        <label className="field"><span>Onde postou</span>
          <select className="input" value={r.plataforma} onChange={e => setR({ ...r, plataforma: e.target.value })}>
            <option value="">—</option>{PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="field"><span>Data da postagem</span>
          <input className="input" type="date" value={r.postado_em} onChange={e => setR({ ...r, postado_em: e.target.value })} /></label>
        {num('views', 'Visualizações')}
        {num('curtidas', 'Curtidas')}
        {num('comentarios', 'Comentários')}
        {num('compartilhamentos', 'Compartilhamentos')}
        {num('retencao_pct', 'Retenção média (%)')}
      </div>
      <label className="field"><span>Observação (opcional)</span>
        <input className="input" value={r.observacao} maxLength={500} onChange={e => setR({ ...r, observacao: e.target.value })} placeholder="ex.: postado de manhã; gancho mudou depois" /></label>
      <div className="short__actions">
        <Button size="sm" variant="filled" disabled={r.views == null}
                onClick={async () => { await api.salvarResultado(ep.nome, v.corte!, r); aviso('Resultado salvo'); aoSalvar() }}>Salvar resultado</Button>
      </div>
    </details>
  )
}
