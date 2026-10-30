import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Button, Dialog } from '../ui/kit'
import type { Corte, Episodio } from '../types'

const W = 1280
const H = 720
const AMARELO = '#FFD400'

interface Props {
  aberto: boolean
  ep: Episodio
  corte: Corte
  aoFechar: () => void
  aoSalvar: () => void
}

/**
 * Thumbnail 1280×720 no estilo de canal de podcast: quadro do próprio vídeo, escurecido à esquerda,
 * com duas linhas grandes em Impact (branca e amarela). Tudo é desenhado no navegador e enviado como JPEG.
 */
export function ThumbDialog({ aberto, ep, corte, aoFechar, aoSalvar }: Props) {
  const tela = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const [pronto, setPronto] = useState(false)
  const [t, setT] = useState(corte.inicio)
  const [linha1, setLinha1] = useState('')
  const [linha2, setLinha2] = useState('')
  const [zoom, setZoom] = useState(1)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [tamanho, setTamanho] = useState(150)
  const [escuro, setEscuro] = useState(0.55)
  const [lado, setLado] = useState<'esquerda' | 'direita'>('esquerda')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!aberto) return
    setT(+(corte.inicio + Math.min(30, (corte.fim - corte.inicio) / 4)).toFixed(1))
    setLinha1(corte.thumb?.linha1 ?? ''); setLinha2(corte.thumb?.linha2 ?? '')
    setZoom(1); setDx(0); setDy(0); setErro(''); setPronto(false)
    const v = document.createElement('video')
    v.muted = true; v.preload = 'auto'; v.src = `/media/entrada/${encodeURIComponent(ep.nome)}`
    v.onloadeddata = () => setPronto(true)
    video.current = v
    return () => { v.removeAttribute('src'); v.load(); video.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, corte.id])

  const desenhar = useCallback(() => {
    const c = tela.current, v = video.current
    if (!c || !v || !v.videoWidth) return
    const g = c.getContext('2d')!
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    // quadro com zoom e deslocamento (cobre o 16:9 inteiro)
    const base = Math.max(W / v.videoWidth, H / v.videoHeight) * zoom
    const w = v.videoWidth * base, h = v.videoHeight * base
    g.drawImage(v, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h)
    // degradê para dar contraste ao texto
    const gr = g.createLinearGradient(lado === 'esquerda' ? 0 : W, 0, lado === 'esquerda' ? W * 0.75 : W * 0.25, 0)
    gr.addColorStop(0, `rgba(0,0,0,${escuro + 0.25})`); gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    // texto
    const linhas: [string, string][] = [[linha1.trim().toUpperCase(), '#FFFFFF'], [linha2.trim().toUpperCase(), AMARELO]]
    g.textBaseline = 'alphabetic'; g.textAlign = lado === 'esquerda' ? 'left' : 'right'
    g.lineJoin = 'round'
    const x = lado === 'esquerda' ? 50 : W - 50
    const maxW = W * 0.62
    let y = H - 50 - (linhas[1][0] ? tamanho * 0.95 : 0)
    for (const [txt, cor] of linhas) {
      if (!txt) continue
      let px = tamanho
      g.font = `${px}px Impact, "Arial Black", sans-serif`
      const larg = g.measureText(txt).width
      if (larg > maxW) { px = Math.floor(px * maxW / larg); g.font = `${px}px Impact, "Arial Black", sans-serif` }
      g.lineWidth = Math.max(8, px * 0.09); g.strokeStyle = '#000'
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 12; g.shadowOffsetY = 6
      g.strokeText(txt, x, y)
      g.shadowColor = 'transparent'
      g.fillStyle = cor; g.fillText(txt, x, y)
      y += tamanho * 0.95
    }
  }, [zoom, dx, dy, linha1, linha2, tamanho, escuro, lado])

  // busca o quadro do tempo escolhido e redesenha
  useEffect(() => {
    const v = video.current
    if (!aberto || !pronto || !v) return
    const quando = () => desenhar()
    v.addEventListener('seeked', quando)
    if (Math.abs(v.currentTime - t) > 0.05) v.currentTime = t; else desenhar()
    return () => v.removeEventListener('seeked', quando)
  }, [aberto, pronto, t, desenhar])

  async function salvar() {
    const c = tela.current
    if (!c) return
    setSalvando(true); setErro('')
    try {
      const blob: Blob | null = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Não foi possível gerar a imagem.')
      await api.salvarThumb(ep.nome, corte.id, blob)
      aoSalvar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally { setSalvando(false) }
  }

  function baixar() {
    const c = tela.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/jpeg', 0.92); a.download = `thumb_${corte.id}.jpg`; a.click()
  }

  return (
    <Dialog aberto={aberto} titulo="Thumbnail" aoFechar={aoFechar} largo
            rodape={<>
              {erro && <span className="t-meta warn-text" style={{ marginRight: 'auto' }}>{erro}</span>}
              <Button variant="text" onClick={aoFechar}>Fechar</Button>
              <Button onClick={baixar} disabled={!pronto}>Baixar JPG</Button>
              <Button variant="brand" onClick={salvar} disabled={!pronto || salvando}>{salvando ? 'Salvando…' : 'Salvar na pasta'}</Button>
            </>}>
      <canvas ref={tela} width={W} height={H} style={{ width: '100%', borderRadius: 8, background: '#000', aspectRatio: '16 / 9' }} />
      {!pronto && <span className="t-meta">Carregando o vídeo do episódio…</span>}
      <div className="grid-3">
        <label className="field"><span>Linha 1 (branca)</span>
          <input className="input" value={linha1} maxLength={30} onChange={e => setLinha1(e.target.value)} placeholder="EX.: A VERDADE SOBRE" /></label>
        <label className="field"><span>Linha 2 (amarela)</span>
          <input className="input" value={linha2} maxLength={30} onChange={e => setLinha2(e.target.value)} placeholder="EX.: O TREINAMENTO" /></label>
        <label className="field"><span>Texto à</span>
          <select className="input" value={lado} onChange={e => setLado(e.target.value as 'esquerda' | 'direita')}>
            <option value="esquerda">Esquerda</option><option value="direita">Direita</option></select></label>
      </div>
      <div className="grid-3">
        <label className="field"><span>Quadro do vídeo · {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}</span>
          <input type="range" min={corte.inicio} max={corte.fim} step={0.5} value={t} onChange={e => setT(Number(e.target.value))} /></label>
        <label className="field"><span>Zoom · {zoom.toFixed(2)}×</span>
          <input type="range" min={1} max={2.5} step={0.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
        <label className="field"><span>Tamanho do texto</span>
          <input type="range" min={80} max={220} step={5} value={tamanho} onChange={e => setTamanho(Number(e.target.value))} /></label>
        <label className="field"><span>Enquadrar na horizontal</span>
          <input type="range" min={-400} max={400} step={10} value={dx} onChange={e => setDx(Number(e.target.value))} /></label>
        <label className="field"><span>Enquadrar na vertical</span>
          <input type="range" min={-250} max={250} step={10} value={dy} onChange={e => setDy(Number(e.target.value))} /></label>
        <label className="field"><span>Escurecer fundo</span>
          <input type="range" min={0} max={0.7} step={0.05} value={escuro} onChange={e => setEscuro(Number(e.target.value))} /></label>
      </div>
      <span className="t-meta">A thumbnail usa um quadro do próprio episódio. Arte gerada por IA e recorte de pessoas não são feitos aqui: se quiser esse acabamento, baixe o JPG e finalize em outro editor.</span>
    </Dialog>
  )
}
