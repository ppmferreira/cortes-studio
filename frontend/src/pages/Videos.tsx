import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, tituloDe } from '../api'
import { Short } from '../components/Short'
import { Icon } from '../ui/Icon'
import { useConfirmar } from '../ui/Confirm'
import { Button, Chip, Switch } from '../ui/kit'
import type { Episodio, EstadoRender, StatusRender, VideoGerado } from '../types'

type Ordem = 'recentes' | 'antigos' | 'titulo' | 'duracao' | 'nota'
type Filtro = 'todos' | EstadoRender

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

/** Biblioteca de vídeos gerados: ordenar, filtrar por estado, agrupar por episódio, e copiar título/descrição/tags. */
export function Videos({ episodios, busca, aviso, aoMudou }: {
  episodios: Episodio[]; busca: string; aviso: (m: string) => void; aoMudou: () => void
}) {
  const confirmar = useConfirmar()
  const [status, setStatus] = useState<Record<string, StatusRender>>({})
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [agrupar, setAgrupar] = useState(true)

  const comVideos = episodios.filter(e => e.videos.length)
  const chave = comVideos.map(e => e.nome + ':' + e.videos.join('|')).join(';')
  const carregar = useCallback(async () => {
    const pares = await Promise.all(comVideos.map(async e => [e.nome, await api.statusRender(e.nome)] as const))
    setStatus(Object.fromEntries(pares))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  useEffect(() => { void carregar() }, [carregar])

  const q = busca.trim().toLowerCase()
  const grupos = useMemo(() => [...episodios].sort((a, b) => b.enviado - a.enviado).map(e => ({
    ep: e,
    videos: (status[e.nome]?.videos ?? [])
      .filter(v => (filtro === 'todos' || v.estado === filtro)
        && (!q || `${v.titulo} ${v.descricao} ${v.hashtags.join(' ')} ${e.nome}`.toLowerCase().includes(q)))
      .sort(comparar(ordem)),
  })).filter(g => g.videos.length), [episodios, status, filtro, ordem, q])

  const total = grupos.reduce((s, g) => s + g.videos.length, 0)
  const todos = grupos.flatMap(g => g.videos.map(v => ({ ep: g.ep, v }))).sort((a, b) => comparar(ordem)(a.v, b.v))
  const contagem = (f: EstadoRender) => Object.values(status).flatMap(s => s.videos).filter(v => v.estado === f).length

  const apagar = async (ep: Episodio, v: VideoGerado) => {
    if (!(await confirmar({ titulo: 'Excluir vídeo?', mensagem: <>O vídeo <b>“{v.titulo}”</b> será apagado do computador. Não dá para desfazer.</>, rotulo: 'Excluir vídeo' }))) return
    void api.apagarVideo(ep.nome, v.arquivo).then(() => { aviso('Vídeo excluído'); aoMudou(); void carregar() })
  }
  const limparRemovidos = async () => {
    const alvo = Object.entries(status).flatMap(([nome, st]) => st.videos.filter(v => v.estado === 'sem_corte').map(v => ({ nome, arquivo: v.arquivo })))
    if (!alvo.length) return
    if (!(await confirmar({ titulo: 'Excluir vídeos de cortes removidos?', mensagem: <>{alvo.length} {alvo.length === 1 ? 'vídeo' : 'vídeos'} de cortes que você já removeu {alvo.length === 1 ? 'será apagado' : 'serão apagados'} do computador. Não dá para desfazer.</>, rotulo: `Excluir ${alvo.length}` }))) return
    await Promise.all(alvo.map(a => api.apagarVideo(a.nome, a.arquivo)))
    aviso(`${alvo.length} ${alvo.length === 1 ? 'vídeo excluído' : 'vídeos excluídos'}`); aoMudou(); void carregar()
  }
  const cartao = (ep: Episodio, v: VideoGerado, mostrarEpisodio: boolean) => (
    <Short key={ep.nome + v.arquivo} ep={ep} v={v.arquivo} info={v} aviso={aviso} mostrarEpisodio={mostrarEpisodio} aoApagar={() => apagar(ep, v)} />
  )

  return (
    <>
      <div className="page-head"><h1 className="page-title">Vídeos gerados</h1></div>

      <div className="lib-bar">
        <div className="tabs" role="tablist" style={{ margin: 0 }}>
          <Chip selected={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</Chip>
          <Chip selected={filtro === 'pronto'} count={contagem('pronto')} onClick={() => setFiltro('pronto')}>Prontos</Chip>
          <Chip selected={filtro === 'desatualizado'} count={contagem('desatualizado')} onClick={() => setFiltro('desatualizado')}>Desatualizados</Chip>
          <Chip selected={filtro === 'sem_corte'} count={contagem('sem_corte')} onClick={() => setFiltro('sem_corte')}>Corte removido</Chip>
        </div>
        <div className="lib-bar__end">
          {contagem('sem_corte') > 0 && <Button size="sm" variant="text" icon="trash" onClick={limparRemovidos}>Excluir vídeos de cortes removidos ({contagem('sem_corte')})</Button>}
          <Switch checked={agrupar} onChange={setAgrupar}>Agrupar por episódio</Switch>
          <label className="toolbar__speed t-meta">Ordenar
            <select className="input" value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} aria-label="Ordenar vídeos">
              {ORDENS.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </label>
        </div>
      </div>

      {total === 0 && (
        <div className="empty">
          <Icon name="movie" /><h2 className="t-heading">{comVideos.length ? 'Nenhum vídeo com esse filtro' : 'Nenhum vídeo gerado'}</h2>
          <p>{comVideos.length ? 'Mude o filtro ou a busca para ver os outros.' : 'Gere os cortes de um episódio no editor e eles aparecem aqui.'}</p>
        </div>
      )}

      {agrupar
        ? grupos.map(g => (
          <section key={g.ep.nome} style={{ marginBottom: 'var(--sp-6)' }}>
            <h2 className="t-heading" style={{ marginBottom: 'var(--sp-3)' }}>{tituloDe(g.ep.nome)} <span className="t-meta">· {g.videos.length} {g.videos.length === 1 ? 'vídeo' : 'vídeos'}</span></h2>
            <div className="shorts shorts--lib">{g.videos.map(v => cartao(g.ep, v, false))}</div>
          </section>
        ))
        : <div className="shorts shorts--lib">{todos.map(({ ep, v }) => cartao(ep, v, true))}</div>}
    </>
  )
}
