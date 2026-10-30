import { useState } from 'react'
import { Button, Dialog } from '../ui/kit'
import type { EstiloCfg, Template, TemplateIn } from '../types'

export const FONTES = ['Arial', 'Impact', 'Verdana', 'Tahoma', 'Segoe UI', 'Bahnschrift', 'Trebuchet MS']
export const VELOCIDADES = [1, 1.1, 1.25, 1.5, 1.75, 2]

type EstiloLegenda = Pick<EstiloCfg, 'formato' | 'legendas' | 'palavras_por_legenda' | 'tamanho_legenda' | 'fonte_legenda' | 'cor_legenda' | 'posicao_legenda'>

/** Mostra como a legenda fica no vídeo (posição, tamanho, cor, fonte), sem precisar gerar nada. */
export function PreviaLegenda({ c }: { c: EstiloLegenda }) {
  const vertical = c.formato === 'vertical'
  const pos = { baixo: vertical ? '19.8%' : '8%', meio: '50%', alto: vertical ? '84%' : '88%' }[c.posicao_legenda]
  const tam = c.tamanho_legenda * (vertical ? 5 : 3.2) / (vertical ? 1080 : 1920) * 100   // % da largura
  return (
    <div className={'phone' + (vertical ? '' : ' phone--h')} aria-label="Prévia da legenda">
      <div className="phone__video" />
      {c.legendas && (
        <span className="phone__cap" style={{ bottom: pos, transform: c.posicao_legenda === 'meio' ? 'translate(-50%, 50%)' : 'translateX(-50%)',
                                               color: c.cor_legenda, fontFamily: `${c.fonte_legenda}, Arial, sans-serif`, fontSize: `${tam * 1.9}cqw` }}>
          {'ISSO MUDA TUDO'.split(' ').slice(0, c.palavras_por_legenda).join(' ')}
        </span>
      )}
    </div>
  )
}

interface Props {
  aberto: boolean
  modelo: Template | null          // null = novo
  somenteLeitura: boolean          // template pronto: só ver/duplicar
  aoFechar: () => void
  aoSalvar: (t: TemplateIn) => void
}

/** Template = nome + o prompt que o Claude segue ao escolher os cortes. */
export function TemplateDialog({ aberto, modelo, somenteLeitura, aoFechar, aoSalvar }: Props) {
  const [nome, setNome] = useState(modelo?.nome ?? '')
  const [descricao, setDescricao] = useState(modelo?.descricao ?? '')
  const [prompt, setPrompt] = useState(modelo?.prompt ?? '')
  const [tipo, setTipo] = useState<'short' | 'longo'>(modelo?.tipo ?? 'short')
  const valido = nome.trim().length > 0 && prompt.trim().length > 0
  return (
    <Dialog aberto={aberto} titulo={somenteLeitura ? `Template: ${modelo?.nome}` : modelo ? 'Editar template' : 'Novo template'} aoFechar={aoFechar} largo
            rodape={<>
              <Button variant="text" onClick={aoFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</Button>
              {!somenteLeitura && <Button variant="filled" disabled={!valido} onClick={() => aoSalvar({ nome: nome.trim(), descricao: descricao.trim(), prompt: prompt.trim(), tipo })}>Salvar template</Button>}
            </>}>
      {somenteLeitura && <div className="alert"><span>Templates prontos não podem ser editados. Use “Duplicar” para criar o seu a partir deste.</span></div>}
      <label className="field"><span>Nome</span>
        <input className="input" value={nome} disabled={somenteLeitura} maxLength={60} onChange={e => setNome(e.target.value)} placeholder="ex.: Momentos engraçados do convidado" /></label>
      <label className="field"><span>Serve para</span>
        <select className="input" value={tipo} disabled={somenteLeitura} onChange={e => setTipo(e.target.value as 'short' | 'longo')}>
          <option value="short">Shorts (9:16)</option>
          <option value="longo">Vídeos longos (16:9)</option>
        </select></label>
      <label className="field"><span>Descrição (opcional)</span>
        <input className="input" value={descricao} disabled={somenteLeitura} onChange={e => setDescricao(e.target.value)} placeholder="Para que serve este template" /></label>
      <label className="field"><span>Prompt para o Claude</span>
        <textarea className="input" rows={8} value={prompt} disabled={somenteLeitura} onChange={e => setPrompt(e.target.value)}
                  placeholder="Diga ao Claude o que procurar: tipo de momento, tom, estrutura do trecho, o que evitar…" /></label>
      <p className="t-meta">A quantidade de cortes, a duração, o formato e a legenda não fazem parte do template: você define isso na janela “Gerar” (ou nos padrões em Configurações).</p>
    </Dialog>
  )
}
