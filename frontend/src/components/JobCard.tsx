import { tituloDe } from '../api'
import { duracao } from '../hooks'
import { Button, ProgressBar } from '../ui/kit'
import type { Job } from '../types'

export const ROTULO_ETAPA: Record<string, string> = {
  transcrever: 'Transcrevendo o áudio',
  selecionar: 'Claude escolhendo os cortes',
  cortar: 'Gerando os vídeos',
  analisar: 'Analisando o potencial de viralização',
  melhorar: 'Claude melhorando os cortes',
  aprender: 'Claude aprendendo com os resultados',
}

/** Processo em andamento, visível em qualquer página do painel, com progresso, tempo restante e cancelar. */
export function JobCard({ job, aoVer, aoCancelar }: { job: Job; aoVer: () => void; aoCancelar: () => void }) {
  return (
    <div className="toast jobcard" role="status" aria-live="polite" style={{ width: 360 }}>
      <div className="row-between">
        <b className="truncate">{ROTULO_ETAPA[job.etapa] ?? 'Processando'}</b>
        <span className="t-num"><b>{Math.round(job.pct_total)}%</b></span>
      </div>
      <span className="t-meta truncate">{tituloDe(job.episodio)}{job.lote ? ` · episódio ${job.lote.i + 1} de ${job.lote.n}` : ''}</span>
      <ProgressBar value={job.pct_total} label="Progresso do processo" />
      <span className="t-meta truncate">
        {job.detalhe || 'Preparando…'}{job.eta_s !== null ? ` · resta ~${duracao(job.eta_s)}` : ''}
      </span>
      <div className="row-between">
        <Button size="sm" variant="text" onClick={aoVer}>Ver episódio</Button>
        <Button size="sm" variant="text" onClick={aoCancelar}>Cancelar</Button>
      </div>
    </div>
  )
}
