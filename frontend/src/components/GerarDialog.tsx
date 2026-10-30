import { useEffect, useMemo, useState } from 'react'
import { api, hms, tituloDe } from '../api'
import { Icon } from '../ui/Icon'
import { Badge, Button, Chip, Dialog, Switch } from '../ui/kit'
import type { Corte, Episodio, EstadoRender, OpcoesRender, StatusRender, Template } from '../types'

/** O que o usuário pediu. */
export type Pedido =
  | { tipo: 'cortes'; ids: string[]; opcoes: OpcoesRender }                                                   // vídeos dos cortes que já existem
  | { tipo: 'claude'; gerarVideos: boolean; adicionar: boolean; opcoes: OpcoesRender }                                            // este episódio: Claude escolhe os cortes
  | { tipo: 'lote'; episodios: string[]; refazer: boolean; gerarVideos: boolean; opcoes: OpcoesRender }       // vários episódios

interface Props {
  aberto: boolean
  ep: Episodio
  episodios: Episodio[]
  templates: Template[]
  cortes: Corte[]
  temClaude: boolean
  modoInicial?: 'existentes' | 'claude'
  aoFechar: () => void
  aoGerar: (p: Pedido) => void
  aoCriouTemplate?: () => void   // pede ao app para recarregar a lista de templates
}

const ROTULO: Record<EstadoRender, { texto: string; tom?: 'ok' | 'run' | 'err' }> = {
  novo: { texto: 'Novo' },
  pronto: { texto: 'Pronto', tom: 'ok' },
  desatualizado: { texto: 'Desatualizado', tom: 'run' },
  sem_corte: { texto: 'Sem corte', tom: 'err' },
}

/**
 * Gerar: um episódio ou vários; usar os cortes que já existem ou pedir cortes ao Claude (quantidade, duração e prompt);
 * e as opções do vídeo. Tudo vale só para esta geração. O template é só um ponto de partida para o prompt.
 */
export function GerarDialog({ aberto, ep, episodios, templates, cortes, temClaude, modoInicial, aoFechar, aoGerar, aoCriouTemplate }: Props) {
  const foco: 'ia' | 'videos' = modoInicial === 'claude' ? 'ia' : 'videos'   // IA = criar cortes; vídeos = renderizar os cortes
  const [escopo, setEscopo] = useState<'este' | 'varios'>('este')
  const [modo, setModo] = useState<'existentes' | 'claude'>('existentes')
  const [tpl, setTpl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [qtd, setQtd] = useState(6)
  const [dmin, setDmin] = useState(30)
  const [dmax, setDmax] = useState(90)
  const [filtrar, setFiltrar] = useState(true)      // pede o dobro, analisa e fica com os de nota >= meta
  const [notaMin, setNotaMin] = useState(7)
  const [longo, setLongo] = useState(false)   // vídeos longos (capítulos 16:9) em vez de shorts
  const [formato, setFormato] = useState<'vertical' | 'horizontal'>('vertical')
  const [legendas, setLegendas] = useState(true)
  const [gerarVideos, setGerarVideos] = useState(false)
  const [adicionar, setAdicionar] = useState(true)   // mantém os cortes atuais e acrescenta novos
  const [status, setStatus] = useState<StatusRender | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [eps, setEps] = useState<Set<string>>(new Set())
  const [refazerLote, setRefazerLote] = useState(false)
  const [nomeTpl, setNomeTpl] = useState('')
  const [salvandoTpl, setSalvandoTpl] = useState(false)
  const [erroTpl, setErroTpl] = useState('')

  // ao abrir: volta para os padrões do episódio
  useEffect(() => {
    if (!aberto) return
    const c = ep.config
    setEscopo('este')
    setModo(foco === 'ia' ? 'claude' : 'existentes')
    const doEp = templates.find(t => t.id === ep.template)
    if (doEp && doEp.tipo === 'short') { setTpl(doEp.id); setPrompt(c.instrucoes_extras) }
    else { const p = templates.find(t => t.tipo === 'short'); setTpl(p?.id ?? ''); setPrompt(p?.prompt ?? '') }
    setQtd(c.qtd_cortes); setDmin(c.duracao_min); setDmax(c.duracao_max)
    setFormato(c.formato); setLegendas(c.legendas); setLongo(false); setFiltrar(true); setNotaMin(c.nota_minima ?? 7)
    setGerarVideos(false); setAdicionar(true); setMarcados(new Set()); setEps(new Set([ep.nome])); setRefazerLote(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  // estado de cada corte (só importa quando se usam os cortes existentes)
  useEffect(() => {
    if (!aberto || escopo !== 'este' || modo !== 'existentes') return
    let vivo = true
    api.statusRender(ep.nome, { formato, legendas }).then(s => {
      if (!vivo) return
      setStatus(s)
      setMarcados(prev => (prev.size ? new Set([...prev].filter(id => s.cortes[id])) : new Set(cortes.filter(c => s.cortes[c.id]?.estado !== 'pronto').map(c => c.id))))
    })
    return () => { vivo = false }
  }, [aberto, escopo, modo, ep.nome, formato, legendas, cortes])

  const escolherTemplate = (id: string) => {
    setTpl(id)
    setPrompt(templates.find(t => t.id === id)?.prompt ?? '')   // sem template: você escreve o seu
  }
  const escolherTipo = (l: boolean) => {
    setLongo(l)
    const c = ep.config
    const p = templates.find(t => t.tipo === (l ? 'longo' : 'short'))   // primeiro template do tipo (o prompt acompanha)
    setTpl(p?.id ?? ''); setPrompt(p?.prompt ?? '')
    if (l) { setQtd(3); setDmin(480); setDmax(1500) } else { setQtd(c.qtd_cortes); setDmin(c.duracao_min); setDmax(c.duracao_max) }
  }
  const escolherEscopo = (e: 'este' | 'varios') => { setEscopo(e); setGerarVideos(e === 'varios') }

  const estadoDe = (id: string): EstadoRender => status?.cortes[id]?.estado ?? 'novo'
  const alternar = (id: string) => setMarcados(m => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const alternarEp = (nome: string) => setEps(m => { const n = new Set(m); if (n.has(nome)) n.delete(nome); else n.add(nome); return n })

  const sobrepostos = useMemo(() => {
    const out: { a: number; b: number; seg: number }[] = []
    cortes.forEach((x, i) => cortes.forEach((y, j) => {
      if (j <= i) return
      const seg = Math.min(x.fim, y.fim) - Math.max(x.inicio, y.inicio)
      if (seg > 0.5) out.push({ a: i, b: j, seg })
    }))
    return out
  }, [cortes])
  const emConflito = useMemo(() => new Set(sobrepostos.flatMap(s => [cortes[s.a].id, cortes[s.b].id])), [sobrepostos, cortes])
  const conflitoMarcado = sobrepostos.filter(s => marcados.has(cortes[s.a].id) && marcados.has(cortes[s.b].id))

  const ids = cortes.filter(c => marcados.has(c.id)).map(c => c.id)
  const substituem = ids.filter(id => estadoDe(id) !== 'novo').length
  const segundos = cortes.filter(c => marcados.has(c.id)).reduce((s, c) => s + (c.fim - c.inicio) / (c.velocidade || 1), 0)

  const opcoesVideo: OpcoesRender = { formato, legendas }
  const opcoesSelecao: OpcoesRender = { qtd_cortes: qtd, duracao_min: dmin, duracao_max: dmax, instrucoes_extras: prompt.trim(), filtrar_por_nota: filtrar && qtd > 1 && notaMin > 0, nota_minima: notaMin, ...(longo ? { tipo_corte: 'longo' as const } : {}) }
  const selecaoValida = qtd >= 1 && dmin >= 5 && dmin < dmax

  const lista = [...eps]
  const precisaClaude = escopo === 'este' ? modo === 'claude' : lista.some(n => refazerLote || (episodios.find(e => e.nome === n)?.n_cortes ?? 0) === 0)
  const semClaude = precisaClaude && !temClaude

  let podeGerar: boolean, rotuloBotao: string, resumo: string
  if (escopo === 'este' && modo === 'existentes') {
    podeGerar = ids.length > 0
    rotuloBotao = `Gerar ${ids.length || ''} ${ids.length === 1 ? 'vídeo' : 'vídeos'}`
    resumo = ids.length ? `${ids.length} ${ids.length === 1 ? 'vídeo' : 'vídeos'} · ${hms(segundos)} no total${substituem ? ` · ${substituem} ${substituem === 1 ? 'será substituído' : 'serão substituídos'}` : ''}` : 'Nenhum corte marcado'
  } else if (escopo === 'este') {
    podeGerar = selecaoValida && !semClaude
    rotuloBotao = gerarVideos ? 'Escolher cortes e gerar' : 'Escolher cortes'
    resumo = `${cortes.length && adicionar ? 'Mais ' : 'Até '}${qtd} ${longo ? 'vídeos longos' : 'cortes'} de ${dmin} a ${dmax} s${gerarVideos ? ' e os vídeos em seguida' : '. Você revisa antes de gerar os vídeos'}`
  } else {
    podeGerar = lista.length > 0 && selecaoValida && !semClaude
    rotuloBotao = `Rodar em ${lista.length || ''} ${lista.length === 1 ? 'episódio' : 'episódios'}`
    resumo = lista.length ? `${lista.length} ${lista.length === 1 ? 'episódio' : 'episódios'}, um depois do outro` : 'Nenhum episódio marcado'
  }

  function confirmar() {
    if (escopo === 'este' && modo === 'existentes') aoGerar({ tipo: 'cortes', ids, opcoes: opcoesVideo })
    else if (escopo === 'este') {
      const somar = cortes.length > 0 && adicionar
      aoGerar({ tipo: 'claude', gerarVideos, adicionar: somar, opcoes: { ...opcoesVideo, ...opcoesSelecao, ...(somar ? { adicionar: true } : {}) } })
    }
    else aoGerar({ tipo: 'lote', episodios: lista, refazer: refazerLote, gerarVideos, opcoes: { ...opcoesVideo, ...opcoesSelecao } })
  }

  const doTemplate = templates.find(t => t.id === tpl)
  const promptNovo = prompt.trim() !== '' && prompt.trim() !== (doTemplate?.prompt ?? '')   // prompt escrito ou editado: dá para guardar

  async function salvarTemplate() {
    setSalvandoTpl(true); setErroTpl('')
    try {
      const r = await api.criarTemplate({ nome: nomeTpl.trim(), descricao: '', prompt: prompt.trim(), tipo: longo ? 'longo' : 'short' })
      aoCriouTemplate?.()
      setTpl(r.id); setNomeTpl('')
    } catch (e) { setErroTpl(e instanceof Error ? e.message : 'Não foi possível salvar.') }
    finally { setSalvandoTpl(false) }
  }
  const campoSelecao = (
    <fieldset className="fs">
      <legend>Como o Claude escolhe os cortes</legend>
      <div className="tabs" role="radiogroup" aria-label="Tipo de corte" style={{ margin: 0 }}>
        <Chip selected={!longo} onClick={() => escolherTipo(false)}>Shorts (9:16)</Chip>
        <Chip selected={longo} onClick={() => escolherTipo(true)}>Vídeos longos (16:9)</Chip>
      </div>
      {longo && <span className="t-meta">Capítulos completos de vários minutos, em 16:9, sem legenda queimada. A thumbnail sai do editor de cada corte.</span>}
      <div className="grid-3">
        <label className="field"><span>Quantidade de cortes</span>
          <input className="input t-num" type="number" min={1} value={qtd} onChange={e => setQtd(Number(e.target.value))} /></label>
        <label className="field"><span>Duração mínima (s)</span>
          <input className="input t-num" type="number" min={5} value={dmin} onChange={e => setDmin(Number(e.target.value))} /></label>
        <label className="field"><span>Duração máxima (s)</span>
          <input className="input t-num" type="number" min={10} value={dmax} onChange={e => setDmax(Number(e.target.value))} /></label>
      </div>
      {dmin >= dmax && <span className="t-meta warn-text">A duração mínima precisa ser menor que a máxima.</span>}
      <label className="field"><span>Template (ponto de partida do prompt)</span>
        <select className="input" value={tpl} onChange={e => escolherTemplate(e.target.value)}>
          <option value="">Nenhum — eu escrevo o prompt</option>
          {templates.filter(t => t.tipo === (longo ? 'longo' : 'short')).map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select></label>
      {doTemplate?.descricao && <span className="t-meta">{doTemplate.descricao}</span>}
      <label className="field"><span>Prompt para o Claude{doTemplate && prompt.trim() !== doTemplate.prompt ? ' · editado' : ''}</span>
        <textarea className="input" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder="Diga o que procurar: tipo de momento, tom, estrutura do trecho, o que evitar… (vale só para esta geração)" /></label>
      {promptNovo && (
        <div className="row" style={{ alignItems: 'flex-end', gap: 'var(--sp-3)' }}>
          <label className="field" style={{ flex: 1 }}><span>Guardar este prompt como template ({longo ? 'vídeo longo' : 'short'})</span>
            <input className="input" value={nomeTpl} maxLength={60} onChange={e => setNomeTpl(e.target.value)} placeholder="Nome do template" /></label>
          <Button size="sm" disabled={!nomeTpl.trim() || salvandoTpl} onClick={salvarTemplate}>{salvandoTpl ? 'Salvando…' : 'Salvar template'}</Button>
        </div>
      )}
      {erroTpl && <span className="t-meta warn-text">{erroTpl}</span>}
      <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <Switch checked={filtrar} onChange={setFiltrar}>Ficar só com cortes de nota viral a partir de</Switch>
        <input className="input t-num" type="number" min={1} max={10} step={0.5} value={notaMin} disabled={!filtrar} style={{ width: 80 }}
               onChange={e => setNotaMin(Number(e.target.value))} aria-label="Nota mínima" />
      </div>
      {filtrar && <span className="t-meta">O Claude escolhe o dobro de candidatos, analisa todos e mantém os melhores que chegarem a {notaMin}. Demora um pouco mais, mas evita cortes fracos.</span>}
      <Switch checked={gerarVideos} onChange={setGerarVideos}>Gerar os vídeos logo depois de escolher os cortes (senão você revisa os cortes antes)</Switch>
    </fieldset>
  )

  return (
    <Dialog aberto={aberto} titulo={foco === 'ia' ? 'Criar cortes com IA' : 'Gerar vídeos'} aoFechar={aoFechar} largo
            rodape={<>
              <span className="t-meta" style={{ marginRight: 'auto' }}>{resumo}</span>
              <Button variant="text" onClick={aoFechar}>Cancelar</Button>
              <Button variant="brand" icon="scissors" disabled={!podeGerar} onClick={confirmar}>{rotuloBotao}</Button>
            </>}>
      {foco === 'ia' && (
      <div className="tabs" role="tablist" style={{ margin: 0 }}>
        <Chip selected={escopo === 'este'} onClick={() => escolherEscopo('este')}>Só este episódio</Chip>
        <Chip selected={escopo === 'varios'} count={episodios.length} onClick={() => escolherEscopo('varios')}>Vários episódios</Chip>
      </div>
      )}

      {escopo === 'este' && (
        <>
          {modo === 'claude' && (
            <>
              {cortes.length > 0 && (
                <div className="field"><span>O que fazer com os {cortes.length} cortes atuais</span>
                <div className="gerar__modo" role="radiogroup" aria-label="O que fazer com os cortes atuais">
                  <label className={'gerar__card' + (adicionar ? ' gerar__card--on' : '')}>
                    <input type="radio" name="atuais" checked={adicionar} onChange={() => setAdicionar(true)} />
                    <span><b>Manter os {cortes.length} cortes e adicionar novos</b><span className="t-meta">O Claude evita os trechos que já foram cortados</span></span>
                  </label>
                  <label className={'gerar__card' + (!adicionar ? ' gerar__card--on' : '')}>
                    <input type="radio" name="atuais" checked={!adicionar} onChange={() => setAdicionar(false)} />
                    <span><b>Não usar os cortes que já existem</b><span className="t-meta">Substitui os {cortes.length} por cortes novos</span></span>
                  </label>
                </div>
                </div>
              )}
              {campoSelecao}
              {cortes.length > 0 && !adicionar && (
                <div className="alert alert--warn"><Icon name="warning" /><span>Os {cortes.length} cortes atuais serão substituídos. Os vídeos já gerados continuam na aba Vídeos, marcados como “Corte removido”.</span></div>
              )}
            </>
          )}

          {modo === 'existentes' && (
            <>
              <div className="row-between">
                <span className="t-meta">Marque o que gerar. Cortes “Pronto” já têm vídeo em dia e ficam de fora, a menos que você os marque.</span>
                <span className="gerar__quick">
                  <Button size="sm" variant="text" onClick={() => setMarcados(new Set(cortes.filter(c => estadoDe(c.id) !== 'pronto').map(c => c.id)))}>Só pendentes</Button>
                  <Button size="sm" variant="text" onClick={() => setMarcados(new Set(cortes.map(c => c.id)))}>Todos</Button>
                  <Button size="sm" variant="text" onClick={() => setMarcados(new Set())}>Nenhum</Button>
                </span>
              </div>
              <ul className="gerar__list">
                {cortes.map((c, i) => {
                  const st = estadoDe(c.id), vel = c.velocidade || 1, r = ROTULO[st]
                  return (
                    <li key={c.id}>
                      <label className={'gerar__row' + (marcados.has(c.id) ? ' gerar__row--on' : '')}>
                        <input type="checkbox" checked={marcados.has(c.id)} onChange={() => alternar(c.id)} />
                        <span className="cut__num">{i + 1}</span>
                        <span className="gerar__body">
                          <b className="truncate">{c.titulo}{c.tipo === 'longo' && <> <Badge>Longo</Badge></>}</b>
                          <span className="t-meta t-num">{hms(c.inicio)} – {hms(c.fim)} · {Math.round((c.fim - c.inicio) / vel)} s{vel !== 1 ? ` (${vel}×)` : ''}</span>
                        </span>
                        {emConflito.has(c.id) && <span className="gerar__warn" title="Este corte repete trecho de outro"><Icon name="warning" /></span>}
                        <Badge tone={r.tom}>{r.texto}</Badge>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {sobrepostos.length > 0 && (
                <div className={'alert ' + (conflitoMarcado.length ? 'alert--error' : 'alert--warn')}>
                  <Icon name="warning" />
                  <span>
                    {sobrepostos.map(s => `Cortes ${s.a + 1} e ${s.b + 1} repetem ${Math.round(s.seg)} s do mesmo trecho`).join('. ')}.
                    {conflitoMarcado.length ? ' Os dois estão marcados: o trecho vai aparecer em dois vídeos.' : ''}
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {escopo === 'varios' && (
        <>
          <div className="row-between">
            <span className="t-meta">Cada episódio é transcrito (se precisar), recebe cortes escolhidos pelo Claude e, se você quiser, já tem os vídeos gerados. Um de cada vez.</span>
            <span className="gerar__quick">
              <Button size="sm" variant="text" onClick={() => setEps(new Set(episodios.map(e => e.nome)))}>Todos</Button>
              <Button size="sm" variant="text" onClick={() => setEps(new Set())}>Nenhum</Button>
            </span>
          </div>
          <ul className="gerar__list">
            {episodios.map(e => (
              <li key={e.nome}>
                <label className={'gerar__row gerar__row--ep' + (eps.has(e.nome) ? ' gerar__row--on' : '')}>
                  <input type="checkbox" checked={eps.has(e.nome)} onChange={() => alternarEp(e.nome)} />
                  <span className="gerar__body">
                    <b className="truncate">{tituloDe(e.nome)}</b>
                    <span className="t-meta">{e.mb} MB · {e.n_cortes} cortes · {e.videos.length} vídeos</span>
                  </span>
                  <Badge tone={e.transcrito ? 'ok' : undefined}>{e.transcrito ? 'Transcrito' : 'Sem transcrição'}</Badge>
                </label>
              </li>
            ))}
          </ul>
          <Switch checked={refazerLote} onChange={setRefazerLote}>Refazer os cortes dos episódios que já têm cortes (senão só entram os que ainda não têm)</Switch>
          {campoSelecao}
        </>
      )}

      {semClaude && (
        <div className="alert alert--error"><Icon name="warning" /><span>O Claude não está conectado. Clique no ícone da chave no topo para entrar com sua conta, ou use os cortes que já existem.</span></div>
      )}

      {(escopo === 'varios' || modo === 'existentes' || gerarVideos) && !(modo === 'claude' && longo) && (
        <fieldset className="fs">
          <legend>Vídeo</legend>
          <div className="gerar__opts">
            <label className="field"><span>Formato</span>
              <select className="input" value={formato} onChange={e => setFormato(e.target.value as 'vertical' | 'horizontal')}>
                <option value="vertical">Vertical 9:16</option>
                <option value="horizontal">Horizontal 16:9</option>
              </select></label>
            <Switch checked={legendas} onChange={setLegendas}>Legendas nos shorts (vídeos longos seguem o padrão: sem legenda)</Switch>
            <span className="t-meta">Fonte, cor, posição e logo vêm dos padrões em Configurações.</span>
          </div>
        </fieldset>
      )}
    </Dialog>
  )
}
