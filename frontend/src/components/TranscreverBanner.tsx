import { duracao } from '../hooks'
import { Icon } from '../ui/Icon'
import { Badge, Button, ProgressBar } from '../ui/kit'
import { ROTULO_ETAPA } from './JobCard'
import { tituloDe } from '../api'
import type { Episodio, Job } from '../types'

/** Aparece no editor enquanto o episódio não foi transcrito: botão para começar e, depois, a porcentagem ao vivo. */
export function TranscreverBanner({ ep, job, aoTranscrever, aoClaude, aoCancelar }: {
  ep: Episodio; job: Job | null
  aoTranscrever: () => void; aoClaude: () => void; aoCancelar: () => void
}) {
  const rodando = !!job?.rodando
  const meu = rodando && job?.episodio === ep.nome

  if (meu && job) {
    const transcrevendo = job.etapa === 'transcrever'
    const valor = transcrevendo ? job.pct_etapa : job.pct_total
    return (
      <section className="card banner banner--run" aria-live="polite" aria-label="Progresso da transcrição">
        <div className="banner__head">
          <Icon name="mic" />
          <h2 className="t-heading">{transcrevendo ? 'Transcrevendo o episódio…' : `${ROTULO_ETAPA[job.etapa] ?? 'Processando'}…`}</h2>
          <span className="banner__pct t-num">{valor !== null ? `${Math.round(valor)}%` : ''}</span>
        </div>
        <ProgressBar value={valor} large label="Progresso da transcrição" />
        <div className="overall__eta t-meta t-num">
          <span>{job.detalhe || 'Preparando…'}</span>
          <span>Decorrido {duracao(job.decorrido_s)}{job.eta_s !== null ? ` · resta ~${duracao(job.eta_s)}` : ''}</span>
        </div>
        <div className="row-between">
          <span className="t-meta">Pode navegar pelo painel: o processo continua em segundo plano.</span>
          <Button size="sm" variant="text" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </section>
    )
  }

  if (rodando && job) {
    return (
      <section className="card banner" aria-label="Transcrição">
        <div className="banner__head"><Icon name="mic" /><h2 className="t-heading">Este episódio ainda não foi transcrito</h2></div>
        <div className="alert"><Icon name="info" /><span>Há outro processo rodando agora: <b>{ROTULO_ETAPA[job.etapa]?.toLowerCase() ?? 'processo'}</b> em <b>{tituloDe(job.episodio)}</b>. O painel faz um processo por vez; a transcrição fica disponível quando ele terminar, ou você pode cancelá-lo.</span></div>
        <div className="row">
          <Button variant="brand" icon="mic" disabled>Transcrever este episódio</Button>
          <Button variant="text" onClick={aoCancelar}>Cancelar o processo atual</Button>
        </div>
      </section>
    )
  }

  return (
    <section className="card banner" aria-label="Transcrição">
      <div className="banner__head"><Icon name="mic" /><h2 className="t-heading">Este episódio ainda não foi transcrito</h2><Badge>Passo 1 de 3</Badge></div>
      <p className="t-muted">A transcrição é o primeiro passo: com o texto e o tempo de cada palavra o Claude escolhe os cortes e o painel monta as legendas. Roda na sua placa de vídeo e leva em torno de 1 minuto para cada 5 minutos de episódio.</p>
      <div className="row">
        <Button variant="brand" size="lg" icon="mic" onClick={aoTranscrever}>Transcrever este episódio</Button>
        <Button icon="sparkle" onClick={aoClaude}>Transcrever e pedir cortes ao Claude</Button>
      </div>
    </section>
  )
}
