import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { Button, Chip, Dialog } from '../ui/kit'

/** Enviar episódio: arquivo do computador ou link (YouTube e outros sites). */
export function EnviarDialog({ aberto, ocupado, aoFechar, aoEscolherArquivo, aoImportar }: {
  aberto: boolean; ocupado: boolean; aoFechar: () => void; aoEscolherArquivo: () => void; aoImportar: (url: string) => void
}) {
  const [aba, setAba] = useState<'arquivo' | 'link'>('arquivo')
  const [url, setUrl] = useState('')
  const valido = /^https?:\/\/\S+$/.test(url.trim())
  return (
    <Dialog aberto={aberto} titulo="Enviar episódio" aoFechar={aoFechar}>
      <div className="tabs" role="tablist" style={{ margin: 0 }}>
        <Chip selected={aba === 'arquivo'} onClick={() => setAba('arquivo')}>Arquivo do computador</Chip>
        <Chip selected={aba === 'link'} onClick={() => setAba('link')}>Link (URL)</Chip>
      </div>

      {aba === 'arquivo' ? (
        <div className="envio__zona">
          <Icon name="upload" />
          <p>Escolha o vídeo ou o áudio inteiro do episódio.<br /><span className="t-meta">Também dá para arrastar o arquivo para qualquer lugar da tela.</span></p>
          <Button variant="brand" icon="upload" onClick={() => { aoFechar(); aoEscolherArquivo() }}>Escolher arquivo</Button>
        </div>
      ) : (
        <form className="envio__link" onSubmit={e => { e.preventDefault(); if (valido && !ocupado) { aoImportar(url.trim()); setUrl(''); aoFechar() } }}>
          <label className="field"><span>Link do vídeo</span>
            <input className="input" type="url" autoFocus placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <p className="t-meta">O vídeo é baixado direto para o computador (até 1080p) e entra na biblioteca. Funciona com YouTube e a maioria dos sites de vídeo.
            Use só conteúdo seu ou que você tenha autorização para usar.</p>
          {ocupado && <div className="alert alert--warn"><Icon name="info" /><span>Já existe uma importação em andamento. Espere terminar.</span></div>}
          <div className="row-between"><span /><Button variant="brand" icon="download" disabled={!valido || ocupado} onClick={() => { aoImportar(url.trim()); setUrl(''); aoFechar() }}>Importar vídeo</Button></div>
        </form>
      )}
    </Dialog>
  )
}
