import type { Corte } from '../types'

/** Partes mantidas do corte (sem os trechos tirados do meio). Sem `trechos`, o corte inteiro. */
export const mantidos = (c: Corte): [number, number][] => {
  const ps = (c.trechos ?? []).map(([a, b]) => [Math.max(c.inicio, a), Math.min(c.fim, b)] as [number, number]).filter(([a, b]) => b - a >= 0.3).sort((x, y) => x[0] - y[0])
  return ps.length ? ps : [[c.inicio, c.fim]]
}

/** Buracos do corte: o que fica entre `inicio` e `fim` mas é pulado no vídeo final. */
export const lacunas = (c: Corte): [number, number][] => {
  const out: [number, number][] = []
  let atual = c.inicio
  for (const [a, b] of mantidos(c)) {
    if (a - atual >= 0.3) out.push([atual, a])
    atual = Math.max(atual, b)
  }
  if (c.fim - atual >= 0.3) out.push([atual, c.fim])
  return out
}
