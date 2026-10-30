import { Icon } from '../ui/Icon'
import { Badge, Button } from '../ui/kit'
import type { Analise } from '../types'

/** Cor da nota (0-10): vermelho até 4, âmbar até 6,5, verde acima. */
export const tomNota = (n: number) => (n >= 8 ? 'alta' : n >= 6.5 ? 'boa' : n >= 5 ? 'media' : 'baixa')

export function NotaChip({ nota, titulo }: { nota: number; titulo?: string }) {
  return <span className={'nota nota--' + tomNota(nota)} title={titulo ?? 'Potencial de viralização (0 a 10)'}>{nota.toFixed(1)}</span>
}

/** Potencial de viralização de um corte: a nota, como ela foi calculada, o que está bom e o que melhorar. */
export function ViralCard({ analise, analisando, aoAnalisar, aoUsarTitulo, pronto }: {
  analise?: Analise
  analisando: boolean
  aoAnalisar: () => void
  aoUsarTitulo: (t: string) => void
  pronto: boolean          // corte salvo e com transcrição
}) {
  if (!analise) {
    return (
      <section className="card viral viral--vazio" aria-label="Potencial de viralização">
        <div>
          <h3 className="t-heading">Potencial de viralização</h3>
          <p className="t-muted">O Claude dá uma nota de 0 a 10 para este corte e explica o porquê: gancho, retenção, emoção, clareza, compartilhamento e formato.</p>
        </div>
        <Button variant="brand" icon="sparkle" disabled={analisando || !pronto} onClick={aoAnalisar}>{analisando ? 'Analisando…' : 'Analisar este corte'}</Button>
      </section>
    )
  }
  const tom = tomNota(analise.nota)
  return (
    <section className="card viral" aria-label="Potencial de viralização">
      <div className="viral__head">
        <div className={'viral__nota viral__nota--' + tom} aria-label={`Nota ${analise.nota} de 10`}>
          <b>{analise.nota.toFixed(1)}</b><span>/ 10</span>
        </div>
        <div className="viral__resumo">
          <div className="row"><h3 className="t-heading">{analise.veredito}</h3>{analise.desatualizada && <Badge tone="run">Corte mudou</Badge>}</div>
          <p>{analise.resumo}</p>
        </div>
        <Button size="sm" icon="sparkle" disabled={analisando} onClick={aoAnalisar}>{analisando ? 'Analisando…' : 'Reanalisar'}</Button>
      </div>

      {analise.desatualizada && <div className="alert alert--warn"><Icon name="warning" /><span>O corte mudou depois desta análise. Reanalise para a nota refletir a versão atual.</span></div>}

      <div className="viral__criterios">
        <h4 className="t-meta">Como a nota foi calculada (média ponderada)</h4>
        {Object.entries(analise.criterios).map(([k, c]) => (
          <div key={k} className="criterio">
            <div className="criterio__top">
              <span className="criterio__nome">{c.nome}</span>
              <span className="t-meta">peso {c.peso}%</span>
              <b className="t-num">{c.nota}/10</b>
            </div>
            <div className="criterio__barra" aria-hidden="true"><i className={'criterio__fill nota--' + tomNota(c.nota)} style={{ width: `${c.nota * 10}%` }} /></div>
            <p className="criterio__porque t-meta">{c.porque}</p>
          </div>
        ))}
      </div>

      <div className="viral__cols">
        {analise.pontos_fortes.length > 0 && (
          <div><h4 className="t-meta">O que está funcionando</h4><ul>{analise.pontos_fortes.map(x => <li key={x}>{x}</li>)}</ul></div>
        )}
        {analise.melhorias.length > 0 && (
          <div><h4 className="t-meta">O que melhorar</h4><ul>{analise.melhorias.map(x => <li key={x}>{x}</li>)}</ul></div>
        )}
      </div>

      {analise.titulo_alternativo && (
        <div className="viral__titulo">
          <span className="t-meta">Título alternativo sugerido</span>
          <div className="row-between"><b>{analise.titulo_alternativo}</b><Button size="sm" onClick={() => aoUsarTitulo(analise.titulo_alternativo)}>Usar este título</Button></div>
        </div>
      )}
      <p className="t-meta viral__aviso"><Icon name="info" /> {analise.aviso}</p>
    </section>
  )
}
