import { useState } from 'react'
import { hms } from '../api'

/** Miniatura: primeiro quadro do vídeo no instante `t`, com a duração no canto (como no YouTube). */
export function Thumb({ src, t = 60, className = '', vertical }: { src: string; t?: number; className?: string; vertical?: boolean }) {
  const [dur, setDur] = useState(0)
  return (
    <div className={'thumb' + (vertical ? ' thumb--v' : '') + ' ' + className}>
      <video src={`${src}#t=${t}`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true"
             onLoadedMetadata={e => setDur(e.currentTarget.duration)} />
      {dur > 0 && <span className="thumb__dur">{hms(dur)}</span>}
    </div>
  )
}
