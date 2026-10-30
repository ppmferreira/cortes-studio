import { useEffect, useState } from 'react'
import { Button, Chip, Dialog } from '../ui/kit'
import type { Episodio, OpcoesRender, Template } from '../types'

interface Props {
  aberto: boolean
  ep: Episodio
  templates: Template[]
  temClaude: boolean
  aoFechar: () => void
  aoPedir: (o: OpcoesRender) => void
}

/** Pede ao Claude UM corte específico, descrito em palavras (ex.: "quando falam do Facebook aberto"). */
export function CorteIADialog({ aberto, ep, templates, temClaude, aoFechar, aoPedir }: Props) {
  const [texto, setTexto] = useState('')
  const [longo, setLongo] = useState(false)
  const [tpl, setTpl] = useState('')   // template opcional: seu prompt vai junto com o pedido
  const [dmin, setDmin] = useState(20)
  const [dmax, setDmax] = useState(90)

  useEffect(() => {
    if (!aberto) return
    setTexto(''); setLongo(false); setTpl(''); setDmin(Math.min(20, ep.config.duracao_min)); setDmax(ep.config.duracao_max)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  const escolher = (l: boolean) => { setLongo(l); setTpl(''); if (l) { setDmin(300); setDmax(1500) } else { setDmin(20); setDmax(ep.config.duracao_max) } }
  const doTpl = templates.find(t => t.id === tpl)
  const valido = texto.trim().length >= 5 && dmin >= 5 && dmin < dmax && temClaude && ep.transcrito

  return (
    <Dialog aberto={aberto} titulo="Pedir um corte ao Claude" aoFechar={aoFechar}
            rodape={<>
              <Button variant="text" onClick={aoFechar}>Cancelar</Button>
              <Button variant="brand" icon="sparkle" disabled={!valido} onClick={() => aoPedir({
                qtd_cortes: 1, duracao_min: dmin, duracao_max: dmax, adicionar: true, tipo_corte: longo ? 'longo' : 'short',
                instrucoes_extras: `${doTpl ? `Estilo desejado: ${doTpl.prompt}
- ` : ''}Encontre o trecho que corresponde a este pedido do usuário: “${texto.trim()}”. Escolha só esse trecho, sem repetir os já cortados.`,
              })}>Encontrar este corte</Button>
            </>}>
      <label className="field"><span>O que você quer cortar?</span>
        <textarea className="input" rows={4} value={texto} onChange={e => setTexto(e.target.value)} autoFocus
                  placeholder="Descreva o momento: o assunto, a história ou a frase. Ex.: “quando o convidado conta do dia em que esqueceu o Facebook aberto”" /></label>
      <div className="tabs" role="radiogroup" aria-label="Tipo de corte" style={{ margin: 0 }}>
        <Chip selected={!longo} onClick={() => escolher(false)}>Short (9:16)</Chip>
        <Chip selected={longo} onClick={() => escolher(true)}>Vídeo longo (16:9)</Chip>
      </div>
      <label className="field"><span>Template (opcional)</span>
        <select className="input" value={tpl} onChange={e => setTpl(e.target.value)}>
          <option value="">Nenhum — só o meu pedido</option>
          {templates.filter(t => t.tipo === (longo ? 'longo' : 'short')).map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select></label>
      {doTpl && <span className="t-meta">{doTpl.descricao} O prompt do template vai junto com o seu pedido.</span>}
      <div className="grid-3">
        <label className="field"><span>Duração mínima (s)</span>
          <input className="input t-num" type="number" min={5} value={dmin} onChange={e => setDmin(Number(e.target.value))} /></label>
        <label className="field"><span>Duração máxima (s)</span>
          <input className="input t-num" type="number" min={10} value={dmax} onChange={e => setDmax(Number(e.target.value))} /></label>
      </div>
      {!ep.transcrito && <span className="t-meta warn-text">Transcreva o episódio antes.</span>}
      {!temClaude && <span className="t-meta warn-text">O Claude não está conectado. Clique no ícone da chave no topo.</span>}
      <span className="t-meta">O corte entra na lista sem apagar os que você já tem. Você revisa e ajusta antes de gerar o vídeo.</span>
    </Dialog>
  )
}
