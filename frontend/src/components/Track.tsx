import { useRef } from 'react'
import { hms } from '../api'
import type { Corte } from '../types'

type Lado = 'inicio' | 'fim'

interface Props {
  w0: number               // início da janela visível (s)
  w1: number               // fim da janela visível (s)
  t: number                // posição do player (s)
  cortes: Corte[]
  sel: number | null
  somenteSel?: boolean     // ajuste fino: mostra só o corte selecionado
  fino?: boolean           // régua em segundos em vez de minutos
  aoBuscar: (s: number) => void
  aoSelecionar: (i: number) => void
  aoMudar: (i: number, lado: Lado, s: number) => void
}

const PASSOS_FINO = [1, 2, 5, 10, 15, 30]
const PASSOS_GERAL = [10, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Linha do tempo com régua, blocos de corte e alças arrastáveis no corte selecionado. */
export function Track({ w0, w1, t, cortes, sel, somenteSel, fino, aoBuscar, aoSelecionar, aoMudar }: Props) {
  const lane = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ i: number; lado: Lado } | null>(null)
  const span = Math.max(w1 - w0, 1)
  const x = (s: number) => ((s - w0) / span) * 100
  const tempoDe = (cx: number) => {
    const r = lane.current!.getBoundingClientRect()
    return w0 + Math.min(1, Math.max(0, (cx - r.left) / r.width)) * span
  }

  const passos = fino ? PASSOS_FINO : PASSOS_GERAL
  const passo = passos.find(p => p >= span / 8) ?? passos[passos.length - 1]
  const ticks: number[] = []
  for (let s = Math.ceil(w0 / passo) * passo; s <= w1; s += passo) ticks.push(s)

  const alca = (i: number, lado: Lado) => (
    <span
      className={'track__handle track__handle--' + lado}
      role="slider" aria-label={lado === 'inicio' ? `Início do corte ${i + 1}` : `Fim do corte ${i + 1}`}
      aria-valuenow={Math.round(cortes[i][lado])}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); arrasto.current = { i, lado } }}
      onPointerMove={e => { if (arrasto.current) aoMudar(i, lado, Math.round(tempoDe(e.clientX) * 10) / 10) }}
      onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); arrasto.current = null }}
    />
  )

  return (
    <div className={'track' + (fino ? ' track--fino' : '')}>
      <div className="track__ruler" aria-hidden="true">
        {ticks.map(s => <span key={s} style={{ left: `${x(s)}%` }}>{hms(s)}</span>)}
      </div>
      <div className="track__lane" ref={lane} onClick={e => aoBuscar(tempoDe(e.clientX))}>
        {ticks.map(s => <i key={s} className="track__tick" style={{ left: `${x(s)}%` }} />)}
        {cortes.map((c, i) => {
          if ((somenteSel && i !== sel) || c.fim < w0 || c.inicio > w1) return null
          const a = Math.max(c.inicio, w0), b = Math.min(c.fim, w1)
          return (
            <div key={i} className="track__cut" data-sel={sel === i}
                 style={{ left: `${x(a)}%`, width: `${Math.max(x(b) - x(a), 0.5)}%` }}
                 title={`${i + 1}. ${c.titulo}`}
                 onClick={e => { e.stopPropagation(); aoSelecionar(i) }}>
              <span className="track__num">{i + 1}</span>
              {sel === i && c.inicio >= w0 && alca(i, 'inicio')}
              {sel === i && c.fim <= w1 && alca(i, 'fim')}
            </div>
          )
        })}
        {t >= w0 && t <= w1 && <div className="track__head" style={{ left: `${x(t)}%` }} />}
      </div>
    </div>
  )
}
