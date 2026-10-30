import type { PosLogo } from '../types'

export const POSICOES_LOGO: { id: PosLogo; nome: string }[] = [
  { id: 'topo-esquerda', nome: 'Topo à esquerda' },
  { id: 'topo-centro', nome: 'Topo, centro' },
  { id: 'topo-direita', nome: 'Topo à direita' },
  { id: 'centro', nome: 'Centro' },
  { id: 'baixo-esquerda', nome: 'Base à esquerda' },
  { id: 'baixo-centro', nome: 'Base, centro' },
  { id: 'baixo-direita', nome: 'Base à direita' },
]

/**
 * Posição (x, y) da logo na tela final (1080x1920 ou 1920x1080). Igual à do servidor: em 9:16 o vídeo fica
 * no meio e sobra uma faixa em cima e embaixo; "topo-centro" e "baixo-centro" centralizam a logo nela.
 */
export function posicaoLogo(pos: PosLogo, vertical: boolean, lw: number, lh: number, srcW: number, srcH: number) {
  const W = vertical ? 1080 : 1920
  const H = vertical ? 1920 : 1080
  const m = Math.round(W * 0.04)
  const banda = vertical && srcW ? (H - (W * srcH) / srcW) / 2 : 0
  const lado = pos.split('-').pop()
  const x = lado === 'esquerda' ? m : lado === 'direita' ? W - lw - m : Math.floor((W - lw) / 2)
  const cabe = banda >= lh + 2 * m
  let y: number
  if (pos === 'centro') y = Math.floor((H - lh) / 2)
  else if (pos.startsWith('topo')) y = pos === 'topo-centro' && cabe ? Math.round((banda - lh) / 2) : m
  else y = pos === 'baixo-centro' && cabe ? Math.round(H - banda / 2 - lh / 2) : H - lh - m
  return { x, y }
}
