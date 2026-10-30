import { api, hms, tituloVideo, urlSaida } from '../api'
import { Badge, Button } from '../ui/kit'
import { NotaChip } from './ViralCard'
import type { Episodio, VideoGerado } from '../types'

const data = (t: number) => new Date(t * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Vídeo pronto: player, título, descrição e hashtags (para colar na postagem) e ações. */
export function Short({ ep, v, info, aviso, aoApagar, mostrarEpisodio }: {
  ep: Episodio; v: string; info?: VideoGerado; aviso: (m: string) => void; aoApagar?: () => void; mostrarEpisodio?: boolean
}) {
  const url = urlSaida(ep.nome, v)
  const titulo = info?.titulo ?? tituloVideo(v)
  const tags = (info?.hashtags ?? []).join(' ')
  const copiar = async (texto: string, rotulo: string) => {
    await navigator.clipboard?.writeText(texto)
    aviso(`${rotulo} copiado`)
  }
  return (
    <div className="short">
      <video src={url} controls preload="metadata" />
      <div className="short__title">{titulo}</div>
      <div className="short__meta">
        {info?.estado === 'desatualizado' && <Badge tone="run">Desatualizado</Badge>}
        {info?.estado === 'sem_corte' && <Badge tone="err">Corte removido</Badge>}
        {info?.nota != null && <NotaChip nota={info.nota} />}
        {info?.duracao != null && <span className="t-meta t-num">{hms(info.duracao)}</span>}
        {info && <span className="t-meta">{data(info.gerado_em)}</span>}
        {mostrarEpisodio && <span className="t-meta truncate">{ep.nome.replace(/\.[^.]+$/, '')}</span>}
      </div>
      {info?.descricao && <p className="short__desc">{info.descricao}</p>}
      {tags && <p className="short__tags">{tags}</p>}
      <div className="short__actions">
        <Button size="sm" icon="copy" onClick={() => copiar(titulo, 'Título')}>Título</Button>
        <Button size="sm" icon="copy" disabled={!info?.descricao} onClick={() => copiar(info?.descricao ?? '', 'Descrição')}>Descrição</Button>
        <Button size="sm" icon="copy" disabled={!tags} onClick={() => copiar(tags, 'Hashtags')}>Tags</Button>
        <Button size="sm" icon="copy" onClick={async () => { const { texto } = await api.legenda(ep.nome, v); await copiar(texto, 'Texto completo') }}>Tudo</Button>
      </div>
      <div className="short__actions">
        <a className="btn btn--tonal btn--sm" href={url} download>Baixar vídeo</a>
        {aoApagar && <Button size="sm" variant="text" icon="trash" onClick={aoApagar}>Excluir</Button>}
      </div>
    </div>
  )
}
