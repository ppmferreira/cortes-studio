import { useCallback, useEffect, useRef } from 'react'
import { urlLogo } from '../api'
import { posicaoLogo } from '../lib/logo'
import type { RefObject } from 'react'
import type { Config, Palavra } from '../types'

/**
 * Prévia do vídeo final: mesmo enquadramento (fundo desfocado + vídeo centralizado) e a mesma legenda
 * palavra por palavra da geração. Desenha o <video> do editor num canvas, então não baixa nada de novo.
 */
export function Previa({ video, palavras, config, tocando }: {
  video: RefObject<HTMLVideoElement | null>
  palavras: Palavra[]
  config: Config
  tocando: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const logoImg = useRef<HTMLImageElement | null>(null)
  const vertical = config.formato === 'vertical'
  const W = vertical ? 540 : 960
  const H = vertical ? 960 : 540

  const desenhar = useCallback(() => {
    const cv = canvas.current, v = video.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    if (v && v.videoWidth) {
      if (vertical) {
        const r = Math.max(W / v.videoWidth, H / v.videoHeight)
        const bw = v.videoWidth * r, bh = v.videoHeight * r
        ctx.save(); ctx.filter = 'blur(18px)'; ctx.drawImage(v, (W - bw) / 2, (H - bh) / 2, bw, bh); ctx.restore()
        const fh = v.videoHeight * (W / v.videoWidth)
        ctx.drawImage(v, 0, (H - fh) / 2, W, fh)
      } else {
        const r = Math.min(W / v.videoWidth, H / v.videoHeight)
        ctx.drawImage(v, (W - v.videoWidth * r) / 2, (H - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r)
      }
    }

    const im = logoImg.current
    if (im && config.usar_logo) {  // logo da marca, na mesma posição da geração
      const base = vertical ? 1080 : 1920, k = W / base
      const lw = (base * config.logo_tamanho) / 100, lh = (lw * im.height) / im.width
      const { x, y } = posicaoLogo(config.logo_posicao, vertical, lw, lh, v?.videoWidth ?? 0, v?.videoHeight ?? 0)
      ctx.save(); ctx.globalAlpha = config.logo_opacidade / 100; ctx.drawImage(im, x * k, y * k, lw * k, lh * k); ctx.restore()
    }

    if (config.legendas && palavras.length) {
      const n = Math.max(1, config.palavras_por_legenda)
      const t = v?.currentTime ?? 0
      let bloco = -1
      for (let i = 0; i * n < palavras.length; i++) {
        if (palavras[i * n].inicio <= t + 0.02) bloco = i
        else break
      }
      const atual = bloco >= 0 ? palavras.slice(bloco * n, bloco * n + n) : []
      const prox = palavras[(bloco + 1) * n]
      // some depois da última palavra do bloco (ou quando a próxima começa), como no vídeo final
      const fim = atual.length ? Math.max(atual[atual.length - 1].fim, prox ? Math.min(prox.inicio, atual[atual.length - 1].fim + 0.4) : 0) : 0
      if (atual.length && t <= fim + 0.05) {
        const texto = atual.map(w => w.p).join(' ').toUpperCase()
        const escala = W / (vertical ? 1080 : 1920)
        const tam = config.tamanho_legenda * (vertical ? 5 : 3.2) * escala * (vertical ? 1 : 1920 / 1080 * 0.9)
        ctx.font = `700 ${tam}px ${config.fonte_legenda}, Arial, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
        ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, 5 * escala * (vertical ? 1 : 1.8)); ctx.strokeStyle = '#000'
        ctx.fillStyle = config.cor_legenda
        const margem = (vertical ? { baixo: 380, meio: 0, alto: 300 } : { baixo: 80, meio: 0, alto: 80 })[config.posicao_legenda] * (H / (vertical ? 1920 : 1080))
        const y = config.posicao_legenda === 'baixo' ? H - margem : config.posicao_legenda === 'alto' ? margem + tam : H / 2 + tam / 2
        ctx.strokeText(texto, W / 2, y, W - 60); ctx.fillText(texto, W / 2, y, W - 60)
      }
    }
  }, [video, palavras, config, vertical, W, H])

  // carrega a imagem da logo quando muda
  useEffect(() => {
    if (!config.usar_logo || !config.logo) { logoImg.current = null; desenhar(); return }
    const im = new Image()
    im.onload = () => { logoImg.current = im; desenhar() }
    im.src = urlLogo(config.logo)
  }, [config.logo, config.usar_logo, desenhar])

  // redesenha a cada quadro enquanto toca; parado, redesenha ao buscar/carregar
  useEffect(() => {
    let raf = 0
    const laco = () => { desenhar(); raf = requestAnimationFrame(laco) }
    if (tocando) raf = requestAnimationFrame(laco)
    else desenhar()
    const v = video.current
    const um = () => desenhar()
    v?.addEventListener('seeked', um); v?.addEventListener('loadeddata', um)
    return () => { cancelAnimationFrame(raf); v?.removeEventListener('seeked', um); v?.removeEventListener('loadeddata', um) }
  }, [tocando, desenhar, video])

  return (
    <canvas ref={canvas} width={W} height={H} className={'previa' + (vertical ? '' : ' previa--h')}
            aria-label={`Prévia do vídeo final em ${vertical ? '9:16' : '16:9'}, com legenda`} />
  )
}
