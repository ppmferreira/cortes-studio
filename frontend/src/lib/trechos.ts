import type { Corte } from '../types'

/** Partes mantidas do corte (sem os trechos tirados do meio). Sem `trechos`, o corte inteiro. */
export const mantidos = (c: Corte): [number, number][] => {
  const ps = (c.trechos ?? []).map(([a, b]) => [Math.max(c.inicio, a), Math.min(c.fim, b)] as [number, number]).filter(([a, b]) => b - a >= 0.3).sort((x, y) => x[0] - y[0])
  const fundidas: [number, number][] = []   // partes coladas (menos de 0,3 s entre elas) viram uma só
  for (const [a, b] of ps) {
    const ult = fundidas[fundidas.length - 1]
    if (ult && a - ult[1] < 0.3) ult[1] = Math.max(ult[1], b); else fundidas.push([a, b])
  }
  return fundidas.length ? fundidas : [[c.inicio, c.fim]]
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

/** Trecho selecionado na faixa do ajuste fino: uma parte mantida ou um buraco. */
export interface TrechoSel { tipo: 'gap' | 'parte'; a: number; b: number }

/** Partes mantidas depois de tirar o intervalo [a, b] do corte (pedaços com menos de 0,3 s somem). */
export const tirar = (c: Corte, a: number, b: number): [number, number][] =>
  mantidos(c).flatMap(([x, y]) => {
    if (b <= x || a >= y) return [[x, y] as [number, number]]
    return ([[x, Math.min(y, a)], [Math.max(x, b), y]] as [number, number][]).filter(([p, q]) => q - p >= 0.3)
  })
