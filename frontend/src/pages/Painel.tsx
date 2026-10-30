import { tituloDe, tituloVideo, urlEntrada, urlSaida } from '../api'
import { Thumb } from '../components/Thumb'
import { duracao } from '../hooks'
import { Icon } from '../ui/Icon'
import { Badge, Button, IconButton, ProgressBar } from '../ui/kit'
import type { Conexao, Episodio, Job } from '../types'

interface Props {
  episodios: Episodio[]
  job: Job | null
  conexao: Conexao
  aoAbrir: (nome: string) => void
  aoRodarTudo: (nome: string) => void
  aoConta: () => void
  aoEnviar: () => void
  aoVideos: () => void
  aoConteudo: () => void
}

export function Painel({ episodios, job, conexao, aoAbrir, aoRodarTudo, aoConta, aoEnviar, aoVideos, aoConteudo }: Props) {
  const recentes = [...episodios].sort((a, b) => b.enviado - a.enviado)
  const ultimo = recentes[0]
  const totalCortes = episodios.reduce((s, e) => s + e.n_cortes, 0)
  const totalVideos = episodios.reduce((s, e) => s + e.videos.length, 0)
  const totalMb = episodios.reduce((s, e) => s + e.mb, 0)
  const videos = recentes.flatMap(e => e.videos.map(v => ({ ep: e, v }))).slice(0, 4)
  const rodando = !!job?.rodando

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Painel do projeto</h1>
        <div className="page-actions">
          <IconButton icon="upload" label="Enviar episódio" onClick={aoEnviar} />
        </div>
      </div>

      <div className="masonry">
        {/* ------------------------- último episódio ------------------------- */}
        <section className="card" aria-label="Último episódio">
          <h2 className="card__title">Último episódio</h2>
          {ultimo ? (
            <>
              <button className="hero" onClick={() => aoAbrir(ultimo.nome)}>
                <Thumb src={urlEntrada(ultimo.nome)} t={90} />
                <span className="hero__title">{tituloDe(ultimo.nome)}</span>
              </button>
              <div className="inline-stats">
                <span><Icon name="scissors" /> {ultimo.n_cortes} cortes</span>
                <span><Icon name="movie" /> {ultimo.videos.length} vídeos</span>
                <span><Icon name="mic" /> {ultimo.transcrito ? 'transcrito' : 'sem transcrição'}</span>
              </div>
              <hr className="rule" />
              <div className="kv"><span>Tamanho do arquivo</span><span className="t-num">{ultimo.mb} MB</span></div>
              <div className="kv"><span>Etapas concluídas</span><span className="t-num">{[ultimo.transcrito, ultimo.n_cortes > 0, ultimo.videos.length > 0].filter(Boolean).length} de 3</span></div>
              <div className="card__foot"><Button variant="tonal" icon="scissors" onClick={() => aoAbrir(ultimo.nome)}>Abrir no editor</Button></div>
            </>
          ) : (
            <div className="empty empty--sm">
              <Icon name="movie" />
              <p>Nenhum episódio ainda. Envie o primeiro para começar.</p>
              <Button variant="brand" icon="upload" onClick={aoEnviar}>Enviar episódio</Button>
            </div>
          )}
        </section>

        {/* ------------------------- processamento ------------------------- */}
        <section className="card" aria-label="Processamento">
          <h2 className="card__title">Processamento</h2>
          {rodando && job ? (
            <div aria-live="polite" className="stack">
              <div className="t-meta">{tituloDe(job.episodio)}{job.lote ? ` · episódio ${job.lote.i + 1} de ${job.lote.n}` : ''}</div>
              <div className="overall__row">
                <span className="t-meta">{job.etapa === 'transcrever' ? 'Transcrevendo' : job.etapa === 'selecionar' ? 'Escolhendo cortes' : 'Gerando vídeos'}</span>
                <span className="overall__pct">{Math.round(job.pct_total)}%</span>
              </div>
              <ProgressBar value={job.pct_total} large label="Progresso total" />
              <div className="t-meta">{job.detalhe || 'Preparando…'}</div>
              <div className="overall__eta t-meta t-num">
                <span>Decorrido: {duracao(job.decorrido_s)}</span>
                {job.eta_s !== null && <span>Resta ~{duracao(job.eta_s)}</span>}
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="empty empty--sm"><Icon name="check" /><p>Nenhum processamento em andamento.</p></div>
              {job?.erro && <div className="alert alert--error"><Icon name="warning" /><span>{job.erro}</span></div>}
              {ultimo && <Button variant="brand" icon="play" onClick={() => aoRodarTudo(ultimo.nome)}>Fazer tudo no último episódio</Button>}
            </div>
          )}
        </section>

        {/* ------------------------- estatísticas ------------------------- */}
        <section className="card" aria-label="Estatísticas do projeto">
          <h2 className="card__title">Estatísticas do projeto</h2>
          <div className="t-meta">Episódios</div>
          <div className="big-number">{episodios.length}</div>
          <hr className="rule" />
          <h3 className="t-heading">Resumo</h3>
          <div className="kv"><span>Cortes escolhidos</span><span className="t-num">{totalCortes}</span></div>
          <div className="kv"><span>Vídeos gerados</span><span className="t-num">{totalVideos}</span></div>
          <div className="kv"><span>Espaço dos episódios</span><span className="t-num">{totalMb >= 1000 ? `${(totalMb / 1000).toFixed(1)} GB` : `${Math.round(totalMb)} MB`}</span></div>
          <hr className="rule" />
          <h3 className="t-heading">Conteúdo principal</h3>
          {[...episodios].sort((a, b) => b.videos.length - a.videos.length).slice(0, 3).map(e => (
            <button key={e.nome} className="kv kv--link" onClick={() => aoAbrir(e.nome)}>
              <span className="truncate">{tituloDe(e.nome)}</span><span className="t-num">{e.videos.length}</span>
            </button>
          ))}
          <div className="card__foot"><Button variant="tonal" onClick={aoConteudo}>Ver todo o conteúdo</Button></div>
        </section>

        {/* ------------------------- vídeos recentes ------------------------- */}
        <section className="card" aria-label="Vídeos gerados">
          <h2 className="card__title">Vídeos gerados</h2>
          {videos.length === 0 && <div className="empty empty--sm"><Icon name="movie" /><p>Os cortes finalizados aparecem aqui.</p></div>}
          <ul className="media-list">
            {videos.map(({ ep, v }) => (
              <li key={ep.nome + v}>
                <Thumb src={urlSaida(ep.nome, v)} t={1} vertical />
                <div className="media-list__body">
                  <span className="media-list__title">{tituloVideo(v)}</span>
                  <span className="t-meta truncate">{tituloDe(ep.nome)}</span>
                </div>
              </li>
            ))}
          </ul>
          {videos.length > 0 && <div className="card__foot"><Button variant="tonal" onClick={aoVideos}>Ver todos os vídeos</Button></div>}
        </section>

        {/* ------------------------- Claude ------------------------- */}
        <section className="card" aria-label="Conexão com o Claude">
          <h2 className="card__title">Claude</h2>
          <div className="stack">
            {conexao.conectado ? <Badge tone="ok">Conta conectada</Badge> : conexao.api ? <Badge tone="ok">Chave de API ativa</Badge> : <Badge tone="err">Não conectado</Badge>}
            <p className="t-muted">
              {conexao.conectado ? `Os cortes são escolhidos com a conta ${conexao.email ?? 'Claude'}.`
                : conexao.api ? 'Os cortes são escolhidos pela API, com cobrança por uso.'
                : 'Entre com sua conta Claude para o “Escolher com Claude” funcionar. Ou monte os cortes à mão no editor.'}
            </p>
            <div><Button variant={conexao.conectado || conexao.api ? 'tonal' : 'brand'} icon="key" onClick={aoConta}>{conexao.conectado || conexao.api ? 'Gerenciar conexão' : 'Entrar com Claude'}</Button></div>
          </div>
        </section>

        {/* ------------------------- como funciona ------------------------- */}
        <section className="card" aria-label="Como funciona">
          <h2 className="card__title">Como funciona</h2>
          <ol className="steps-list">
            <li><b>Envie</b> o episódio (vídeo ou áudio).</li>
            <li><b>Transcrição</b> automática, com o tempo de cada palavra.</li>
            <li><b>Claude</b> escolhe os melhores trechos para cortes.</li>
            <li><b>Ajuste</b> início e fim no editor, se quiser.</li>
            <li><b>Gere</b> os vídeos verticais com legenda.</li>
          </ol>
        </section>
      </div>
    </>
  )
}
