import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Badge, Button, Dialog } from '../ui/kit'
import type { Desempenho } from '../types'

const FORCA: Record<string, 'ok' | 'run' | undefined> = { forte: 'ok', media: 'run', fraca: undefined }

/**
 * Aprendizado: resultados reais dos vídeos postados e as lições que o Claude tirou deles.
 * As lições entram como contexto nos próximos pedidos de cortes e de análise. Não é treino do modelo.
 */
export function AprendizadoDialog({ aberto, episodio, ocupado, aoFechar, aviso }: {
  aberto: boolean; episodio: string | null; ocupado: boolean; aoFechar: () => void; aviso: (m: string) => void
}) {
  const [d, setD] = useState<Desempenho | null>(null)
  const carregar = useCallback(() => { api.desempenho().then(setD).catch(() => undefined) }, [])
  useEffect(() => {
    if (!aberto) return
    carregar()
    const id = window.setInterval(carregar, 3000)   // atualiza sozinho quando o Claude termina de escrever as lições
    return () => window.clearInterval(id)
  }, [aberto, carregar])

  const resultados = Object.entries(d?.resultados ?? {})
  const comViews = resultados.filter(([, r]) => r.views != null).length
  const lic = d?.licoes
  const cor = d?.correlacao

  async function atualizar() {
    if (!episodio) return
    try { await api.rodar(episodio, 'aprender'); aviso('O Claude está lendo os resultados. Acompanhe no cartão de processo.') } catch (e) { aviso((e as Error).message) }
  }
  const quando = (t?: number) => (t ? new Date(t * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

  return (
    <Dialog aberto={aberto} titulo="Aprendizado com os resultados" aoFechar={aoFechar} largo
            rodape={<>
              <span className="t-meta" style={{ marginRight: 'auto' }}>{comViews} {comViews === 1 ? 'vídeo' : 'vídeos'} com resultado{lic?.atualizado_em ? ` · lições de ${quando(lic.atualizado_em)}` : ''}</span>
              <Button variant="text" onClick={aoFechar}>Fechar</Button>
              <Button variant="brand" icon="sparkle" disabled={comViews < 3 || ocupado || !episodio} onClick={atualizar}>Atualizar lições com o Claude</Button>
            </>}>
      <p className="t-muted">
        Registre o resultado de cada vídeo depois de postar (no detalhe do vídeo). O Claude procura padrões entre o que foi previsto e o que aconteceu,
        e as lições entram como contexto nas próximas escolhas de cortes e análises. Isso <b>não treina</b> o modelo: com poucos vídeos, as lições são só hipóteses.
      </p>
      {comViews < 3 && <div className="alert alert--warn"><span>Faltam resultados: registre pelo menos 3 vídeos com visualizações para gerar lições ({comViews} até agora).</span></div>}

      {lic?.resumo && (
        <section className="card" style={{ padding: 'var(--sp-4)' }}>
          <h3 className="t-heading">O que os resultados mostram</h3>
          <p>{lic.resumo}</p>
          {lic.calibracao && <p className="t-meta">Nota prevista × resultado: {lic.calibracao}</p>}
        </section>
      )}

      {cor && cor.n >= 3 && (
        <p className="t-meta">
          Correlação entre a nota prevista e as visualizações: <b>{cor.nota ?? '—'}</b> (de −1 a 1, {cor.n} vídeos).
          {cor.n < 8 ? ' Amostra pequena: não conclua nada ainda.' : ''}
          {' '}Por critério: {Object.entries(cor.criterios).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ') || 'sem dados suficientes'}.
        </p>
      )}

      {lic?.licoes?.length ? (
        <section>
          <h3 className="t-heading">Lições em uso nos próximos cortes</h3>
          <ul className="licoes">
            {lic.licoes.map((l, i) => (
              <li key={i}><span>{l.texto}</span> <Badge tone={FORCA[l.forca]}>{l.forca}</Badge> <Badge>{l.tipo === 'longo' ? 'longos' : l.tipo === 'short' ? 'shorts' : 'todos'}</Badge></li>
            ))}
          </ul>
        </section>
      ) : null}

      {resultados.length > 0 && (
        <section>
          <h3 className="t-heading">Resultados registrados</h3>
          <ul className="licoes">
            {resultados.map(([chave, r]) => (
              <li key={chave}>
                <span><b>{r.titulo}</b> · {r.plataforma || 'plataforma não informada'} · {r.views != null ? `${r.views.toLocaleString('pt-BR')} views` : 'sem views'}
                  {r.retencao_pct != null ? ` · retenção ${r.retencao_pct}%` : ''}{r.nota_prevista != null ? ` · previsto ${r.nota_prevista}` : ''}</span>
                <Button size="sm" variant="text" icon="trash" onClick={async () => { await api.apagarResultado(chave); carregar() }}>Remover</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  )
}
