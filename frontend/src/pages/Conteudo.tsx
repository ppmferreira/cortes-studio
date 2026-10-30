import { tituloDe, urlEntrada } from '../api'
import { Thumb } from '../components/Thumb'
import { Icon } from '../ui/Icon'
import { Badge, Button } from '../ui/kit'
import type { Episodio } from '../types'

function status(e: Episodio) {
  if (e.videos.length) return <Badge tone="ok">Cortes gerados</Badge>
  if (e.n_cortes) return <Badge tone="run">Cortes escolhidos</Badge>
  if (e.transcrito) return <Badge>Transcrito</Badge>
  return <Badge>Novo</Badge>
}

export function Conteudo({ episodios, busca, aoAbrir, aoEnviar }: {
  episodios: Episodio[]; busca: string; aoAbrir: (nome: string) => void; aoEnviar: () => void
}) {
  const lista = [...episodios].sort((a, b) => b.enviado - a.enviado)
    .filter(e => e.nome.toLowerCase().includes(busca.trim().toLowerCase()))
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Conteúdo do canal</h1>
        <div className="page-actions"><Button variant="tonal" icon="upload" onClick={aoEnviar}>Enviar episódio</Button></div>
      </div>
      {lista.length === 0 ? (
        <div className="empty">
          <Icon name="library" />
          <h2 className="t-heading">{busca ? 'Nenhum episódio encontrado' : 'Nenhum episódio ainda'}</h2>
          <p>{busca ? `Nada corresponde a “${busca}”.` : 'Envie o primeiro episódio para começar.'}</p>
        </div>
      ) : (
        <div className="table" role="table" aria-label="Episódios">
          <div className="table__row table__head" role="row">
            <span role="columnheader">Episódio</span><span role="columnheader">Status</span>
            <span role="columnheader" className="num">Cortes</span><span role="columnheader" className="num">Vídeos</span>
            <span role="columnheader" className="num">Tamanho</span>
          </div>
          {lista.map(e => (
            <button key={e.nome} className="table__row table__body" role="row" onClick={() => aoAbrir(e.nome)}>
              <span className="table__title">
                <Thumb src={urlEntrada(e.nome)} t={60} />
                <span className="table__name"><b className="truncate">{tituloDe(e.nome)}</b><span className="t-meta truncate">{e.nome}</span></span>
              </span>
              <span>{status(e)}</span>
              <span className="num t-num">{e.n_cortes}</span>
              <span className="num t-num">{e.videos.length}</span>
              <span className="num t-num">{e.mb} MB</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
