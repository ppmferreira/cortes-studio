import { useState } from 'react'
import { duracao } from '../hooks'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Badge, Button, ProgressBar, Switch } from '../ui/kit'
import type { Episodio, Etapa, Job } from '../types'

interface Props {
  ep: Episodio
  job: Job | null
  temChave: boolean
  aoRodar: (etapa: Etapa, refazer: boolean) => void
  aoCancelar?: () => void
  aoGerar?: (modo: 'existentes' | 'claude') => void   // abre a janela Gerar
}

type Estado = 'done' | 'active' | 'queued' | 'idle'

const ETAPAS: { id: Exclude<Etapa, 'tudo'>; nome: string; acao: string; icone: IconName }[] = [
  { id: 'transcrever', nome: 'Transcrever o áudio', acao: 'Transcrever', icone: 'mic' },
  { id: 'selecionar', nome: 'Escolher os cortes (Claude)', acao: 'Escolher', icone: 'sparkle' },
  { id: 'cortar', nome: 'Gerar os vídeos', acao: 'Escolher…', icone: 'scissors' },
]

export function ProcessPanel({ ep, job, temChave, aoRodar, aoGerar, aoCancelar }: Props) {
  const [refazer, setRefazer] = useState(false)
  const meu = !!job && job.episodio === ep.nome && job.plano.length > 0
  const rodando = !!job?.rodando
  const outro = rodando && !meu

  const feitoNoDisco: Record<string, boolean> = {
    transcrever: ep.transcrito, selecionar: ep.n_cortes > 0, cortar: ep.videos.length > 0,
  }
  const estado = (id: string): Estado => {
    if (meu && job) {
      if (job.feitas.includes(id)) return 'done'
      if (job.rodando && job.etapa === id) return 'active'
      if (job.rodando && job.plano.includes(id)) return 'queued'
    }
    return feitoNoDisco[id] ? 'done' : 'idle'
  }

  const terminou = meu && job && !job.rodando && !job.erro && job.plano.every(e => job.feitas.includes(e))
  const total = meu && job ? job.pct_total : 0
  const rotuloStatus = job?.erro && meu ? <Badge tone="err">Erro</Badge> : rodando && meu ? <Badge tone="run">Processando</Badge> : terminou ? <Badge tone="ok">Concluído</Badge> : <Badge>Ocioso</Badge>

  return (
    <section className="card process" aria-label="Processamento">
      <div className="card__head">
        <h2 className="t-heading">Processamento</h2>
        <span className="row">{rotuloStatus}{rodando && aoCancelar && <Button size="sm" variant="text" onClick={aoCancelar}>Cancelar</Button>}</span>
      </div>

      {!temChave && (
        <div className="alert alert--warn" style={{ marginBottom: 'var(--sp-4)' }}>
          <Icon name="warning" />
          <span>Sem chave da API: “Escolher com Claude” não funciona. Defina a chave (ícone <b>🔑</b> no topo) ou monte os cortes à mão.</span>
        </div>
      )}
      {outro && (
        <div className="alert" style={{ marginBottom: 'var(--sp-4)' }}>
          <Icon name="info" /><span>Processando outro episódio: <b>{job?.episodio}</b>.</span>
        </div>
      )}

      {(meu || terminou) && job && (
        <div className="overall" aria-live="polite">
          <div className="overall__row">
            <span className="t-meta">Progresso total{job.lote ? ` · episódio ${job.lote.i + 1} de ${job.lote.n}` : ''}</span>
            <span className="overall__pct">{Math.round(total)}%</span>
          </div>
          <ProgressBar value={total} large label="Progresso total" />
          {rodando && (
            <>
              <div className="t-meta">{job.detalhe || 'Preparando…'}</div>
              <div className="overall__eta t-meta t-num">
                <span>Decorrido: {duracao(job.decorrido_s)}</span>
                <span>{job.eta_s !== null ? `Resta ~${duracao(job.eta_s)} nesta etapa` : 'Calculando tempo restante…'}</span>
              </div>
            </>
          )}
        </div>
      )}

      <ol className="stages">
        {ETAPAS.map((e, idx) => {
          const st = estado(e.id)
          const ativa = st === 'active' && job
          return (
            <li key={e.id} className="stage" data-state={st}>
              <span className="stage__icon"><Icon name={st === 'done' ? 'check' : e.icone} /></span>
              <div className="stage__body">
                <span className="stage__name">{idx + 1}. {e.nome}</span>
                {ativa ? (
                  <>
                    <ProgressBar value={job.pct_etapa} label={e.nome} />
                    <span className="t-meta t-num">{job.pct_etapa !== null ? `${job.pct_etapa.toFixed(0)}% · ` : ''}{job.detalhe}</span>
                  </>
                ) : (
                  <span className="t-meta">{{ done: 'Concluída', queued: 'Na fila', idle: 'Pendente', active: '' }[st]}</span>
                )}
              </div>
              <Button size="sm" disabled={rodando} onClick={() => (aoGerar && e.id !== 'transcrever' ? aoGerar(e.id === 'cortar' ? 'existentes' : 'claude') : aoRodar(e.id, e.id === 'selecionar'))}>{st === 'done' && e.id !== 'cortar' ? 'Refazer' : e.acao}</Button>
            </li>
          )
        })}
      </ol>

      <Button variant="brand" size="lg" block icon="play" disabled={rodando} onClick={() => aoRodar('tudo', refazer)}>
        Fazer tudo automaticamente
      </Button>
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <Switch checked={refazer} onChange={setRefazer}>Refazer a escolha dos cortes</Switch>
      </div>

      {job?.erro && meu && <div className="alert alert--error" style={{ marginTop: 'var(--sp-4)' }}><Icon name="warning" /><span>{job.erro}</span></div>}
      {meu && job?.log.trim() && (
        <details className="log" style={{ marginTop: 'var(--sp-3)' }}>
          <summary>Detalhes técnicos</summary>
          <pre>{job.log}</pre>
        </details>
      )}
    </section>
  )
}
