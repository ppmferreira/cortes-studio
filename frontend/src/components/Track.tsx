import { useRef } from 'react'
import { hms } from '../api'
import { lacunas } from '../lib/trechos'
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
  marca?: [number, number] | null                     // trecho marcado (Shift + arrastar) para tirar do corte
  aoMarcar?: (a: number, b: number) => void
  aoRestaurar?: (i: number, a: number, b: number) => void   // clicar num buraco o devolve ao corte
}

const PASSOS_FINO = [1, 2, 5, 10, 15, 30]
const PASSOS_GERAL = [10, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Linha do tempo com régua, blocos de corte e alças arrastáveis no corte selecionado. */
export function Track({ w0, w1, t, cortes, sel, somenteSel, fino, aoBuscar, aoSelecionar, aoMudar, marca, aoMarcar, aoRestaurar }: Props) {
  const lane = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ i: number; lado: Lado } | null>(null)
  const marcando = useRef<number | null>(null)
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
      <div className="track__lane" ref={lane} onClick={e => { if (!e.shiftKey) aoBuscar(tempoDe(e.clientX)) }}
           onPointerDown={e => { if (e.shiftKey && aoMarcar && e.target === e.currentTarget || (e.shiftKey && aoMarcar && (e.target as HTMLElement).closest('.track__cut'))) { e.currentTarget.setPointerCapture(e.pointerId); marcando.current = tempoDe(e.clientX) } }}
           onPointerMove={e => { if (marcando.current !== null && aoMarcar) { const t2 = tempoDe(e.clientX); aoMarcar(Math.round(Math.min(marcando.current, t2) * 10) / 10, Math.round(Math.max(marcando.current, t2) * 10) / 10) } }}
           onPointerUp={e => { if (marcando.current !== null) { e.currentTarget.releasePointerCapture(e.pointerId); marcando.current = null } }}>
        {ticks.map(s => <i key={s} className="track__tick" style={{ left: `${x(s)}%` }} />)}
        {cortes.map((c, i) => {
          if ((somenteSel && i !== sel) || c.fim < w0 || c.inicio > w1) return null
          const a = Math.max(c.inicio, w0), b = Math.min(c.fim, w1)
          return (
            <div key={i} className="track__cut" data-sel={sel === i}
                 style={{ left: `${x(a)}%`, width: `${Math.max(x(b) - x(a), 0.5)}%` }}
                 title={`${i + 1}. ${c.titulo}`}
                 onClick={e => { e.stopPropagation(); aoSelecionar(i) }}>
              {lacunas(c).map(([g0, g1], k) => (
                <i key={k} className="track__gap" title="Trecho pulado no vídeo final"
                   style={{ left: `${((g0 - c.inicio) / (c.fim - c.inicio)) * 100}%`, width: `${((g1 - g0) / (c.fim - c.inicio)) * 100}%` }}>
                  {aoRestaurar && fino && (
                    <button type="button" className="track__gapbtn" aria-label="Devolver este trecho ao corte" title="Devolver este trecho ao corte"
                            onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); aoRestaurar(i, g0, g1) }}>↺ devolver</button>
                  )}
                </i>
              ))}
              <span className="track__num">{i + 1}</span>
              {sel === i && c.inicio >= w0 && alca(i, 'inicio')}
              {sel === i && c.fim <= w1 && alca(i, 'fim')}
            </div>
          )
        })}
        {marca && marca[1] > w0 && marca[0] < w1 && (
          <div className="track__marca" style={{ left: `${x(Math.max(marca[0], w0))}%`, width: `${x(Math.min(marca[1], w1)) - x(Math.max(marca[0], w0))}%` }} />
        )}
        {t >= w0 && t <= w1 && <div className="track__head" style={{ left: `${x(t)}%` }} />}
      </div>
    </div>
  )
}
