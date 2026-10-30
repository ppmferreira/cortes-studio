import { useRef, useState } from 'react'
import { api, urlLogo } from '../api'
import { FONTES, PreviaLegenda, TemplateDialog, VELOCIDADES } from '../components/TemplateDialog'
import { posicaoLogo, POSICOES_LOGO } from '../lib/logo'
import { Icon } from '../ui/Icon'
import { useConfirmar } from '../ui/Confirm'
import { Badge, Button, Chip, Switch } from '../ui/kit'
import type { Estado, Geral, Template, TemplateIn } from '../types'

type Aba = 'templates' | 'geracao' | 'marca'
const CORES = ['#FFFFFF', '#FFE600', '#00E5FF', '#7CFF4D', '#FF4E45']

export function Configuracoes({ estado, aoMudou, aviso, aoConta }: {
  estado: Estado; aoMudou: () => Promise<void> | void; aviso: (m: string) => void; aoConta: () => void
}) {
  const [aba, setAba] = useState<Aba>('templates')
  const [dlg, setDlg] = useState<{ modelo: Template | null; leitura: boolean } | null>(null)
  const [geral, setGeral] = useState<Geral>(estado.geral)
  const arquivoLogo = useRef<HTMLInputElement>(null)
  const confirmar = useConfirmar()
  const mudou = JSON.stringify(geral) !== JSON.stringify(estado.geral)
  const set = (p: Partial<Geral>) => setGeral(g => ({ ...g, ...p }))

  async function acao(f: () => Promise<unknown>, ok: string) {
    try { await f(); aviso(ok); await aoMudou() } catch (e) { aviso((e as Error).message) }
  }
  const salvarTemplate = async (t: TemplateIn) => {
    const alvo = dlg?.modelo
    await acao(() => (alvo && !alvo.builtin ? api.editarTemplate(alvo.id, t) : api.criarTemplate(t)), 'Template salvo')
    setDlg(null)
  }
  const duplicar = (t: Template) => acao(() => api.criarTemplate({ nome: `${t.nome} (cópia)`, descricao: t.descricao, prompt: t.prompt }), 'Template duplicado')

  async function enviarLogo(f: File) {
    try {
      const { nome } = await api.enviarLogo(f)
      const novo = { ...geral, logo: nome }
      setGeral(novo)
      await api.salvarGeral(novo)
      aviso('Logo enviada e selecionada')
      await aoMudou()
    } catch (e) { aviso((e as Error).message) }
  }
  async function excluirLogo() {
    if (!(await confirmar({ titulo: 'Excluir logo?', mensagem: <>A logo <b>“{geral.logo}”</b> será apagada. Os vídeos já gerados não mudam.</>, rotulo: 'Excluir logo' }))) return
    await acao(() => api.apagarLogo(geral.logo), 'Logo excluída')
    const novo = { ...geral, logo: '' }
    setGeral(novo)
    await api.salvarGeral(novo)
  }

  const barraSalvar = (
    <div className="row-between">
      <span className="t-meta">{mudou ? 'Há alterações não salvas.' : ' '}</span>
      <Button variant="filled" disabled={!mudou} onClick={() => acao(() => api.salvarGeral(geral), 'Configurações salvas')}>Salvar</Button>
    </div>
  )
  const num = (k: 'qtd_cortes' | 'duracao_min' | 'duracao_max' | 'palavras_por_legenda', rotulo: string) => (
    <label className="field"><span>{rotulo}</span>
      <input className="input t-num" type="number" min={1} value={geral[k]} onChange={e => set({ [k]: Number(e.target.value) })} /></label>
  )

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Configurações</h1>
        {aba === 'templates' && <Button variant="brand" icon="add" onClick={() => setDlg({ modelo: null, leitura: false })}>Novo template</Button>}
      </div>
      <div className="tabs" role="tablist">
        <Chip selected={aba === 'templates'} count={estado.templates.length} onClick={() => setAba('templates')}>Templates</Chip>
        <Chip selected={aba === 'geracao'} onClick={() => setAba('geracao')}>Geração e vídeo</Chip>
        <Chip selected={aba === 'marca'} onClick={() => setAba('marca')}>Marca e conta</Chip>
      </div>

      {aba === 'templates' && (
        <>
          <p className="t-muted" style={{ marginBottom: 'var(--sp-4)', maxWidth: 720 }}>
            Um template é só o <b>prompt</b>: o briefing que o Claude segue ao escolher os cortes. Quantidade, duração, formato e legenda ficam na janela “Gerar”.
            Dá para usar um template, editar o prompt na hora ou não usar nenhum e escrever o seu.
          </p>
          <label className="field" style={{ maxWidth: 420, marginBottom: 'var(--sp-5)' }}><span>Template padrão ao pedir cortes ao Claude</span>
            <select className="input" value={estado.template_ativo} onChange={e => void acao(() => api.templatePadrao(e.target.value || null), 'Template padrão alterado')}>
              <option value="">Nenhum (eu escrevo o prompt)</option>
              {estado.templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select></label>
          <div className="tpl-grid">
            {estado.templates.map(t => (
              <article key={t.id} className={'card tpl' + (t.id === estado.template_ativo ? ' tpl--on' : '')}>
                <div className="tpl__head">
                  <h2 className="t-heading">{t.nome}</h2>
                  {t.id === estado.template_ativo && <Badge tone="ok">Padrão</Badge>}
                  {t.builtin && <Badge>Pronto</Badge>}
                </div>
                <p className="t-muted">{t.descricao || 'Sem descrição.'}</p>
                <p className="tpl__brief t-meta"><Icon name="sparkle" /> {t.prompt}</p>
                <div className="tpl__foot">
                  <div className="tpl__actions">
                    {t.id !== estado.template_ativo && <Button size="sm" onClick={() => acao(() => api.templatePadrao(t.id), 'Template padrão alterado')}>Usar como padrão</Button>}
                    <Button size="sm" variant="text" onClick={() => setDlg({ modelo: t, leitura: t.builtin })}>{t.builtin ? 'Ver' : 'Editar'}</Button>
                    <Button size="sm" variant="text" onClick={() => duplicar(t)}>Duplicar</Button>
                    {!t.builtin && <Button size="sm" variant="text" icon="trash" aria-label="Excluir template" onClick={async () => { if (await confirmar({ titulo: 'Excluir template?', mensagem: <>O template <b>“{t.nome}”</b> será apagado.</>, rotulo: 'Excluir template' })) void acao(() => api.excluirTemplate(t.id), 'Template excluído') }} />}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {aba === 'geracao' && (
        <div className="geral">
          <p className="t-muted">Estes são os padrões que aparecem preenchidos na janela “Gerar”. Lá você pode mudar só para aquela geração.</p>
          <section className="card">
            <h2 className="card__title">Padrões de geração</h2>
            <div className="form-grid">
              <div className="grid-3">
                {num('qtd_cortes', 'Quantidade de cortes')}
                {num('duracao_min', 'Duração mínima (s)')}
                {num('duracao_max', 'Duração máxima (s)')}
              </div>
              {geral.duracao_min >= geral.duracao_max && <span className="t-meta warn-text">A duração mínima precisa ser menor que a máxima.</span>}
              <div className="field"><span>Velocidade padrão dos cortes</span>
                <div className="chips" role="radiogroup" aria-label="Velocidade padrão">
                  {VELOCIDADES.map(v => <Chip key={v} selected={geral.velocidade_padrao === v} onClick={() => set({ velocidade_padrao: v })}>{v}×</Chip>)}
                </div></div>
              <div className="grid-2">
                <label className="field"><span>Folga antes da fala (s)</span>
                  <input className="input t-num" type="number" step="0.05" min={0} value={geral.folga_inicio} onChange={e => set({ folga_inicio: Number(e.target.value) })} /></label>
                <label className="field"><span>Folga depois da fala (s)</span>
                  <input className="input t-num" type="number" step="0.05" min={0} value={geral.folga_fim} onChange={e => set({ folga_fim: Number(e.target.value) })} /></label>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="card__title">Vídeo e legendas</h2>
            <div className="tpl-form">
              <div className="form-grid">
                <label className="field"><span>Formato</span>
                  <select className="input" value={geral.formato} onChange={e => set({ formato: e.target.value as Geral['formato'] })}>
                    <option value="vertical">Vertical 9:16 (Reels, TikTok, Shorts)</option>
                    <option value="horizontal">Horizontal 16:9 (YouTube)</option>
                  </select></label>
                <Switch checked={geral.legendas} onChange={v => set({ legendas: v })}>Queimar legendas no vídeo</Switch>
                <div className="grid-2">
                  {num('palavras_por_legenda', 'Palavras por vez')}
                  <label className="field"><span>Tamanho · {geral.tamanho_legenda}</span>
                    <input type="range" min={8} max={28} value={geral.tamanho_legenda} onChange={e => set({ tamanho_legenda: Number(e.target.value) })} /></label>
                  <label className="field"><span>Fonte</span>
                    <select className="input" value={geral.fonte_legenda} onChange={e => set({ fonte_legenda: e.target.value })}>
                      {[...new Set([geral.fonte_legenda, ...FONTES])].map(f => <option key={f}>{f}</option>)}
                    </select></label>
                  <div className="field"><span>Cor</span>
                    <div className="chips">
                      {CORES.map(k => <button key={k} type="button" className={'swatch' + (geral.cor_legenda.toUpperCase() === k ? ' swatch--on' : '')} style={{ background: k }} aria-label={`Cor ${k}`} onClick={() => set({ cor_legenda: k })} />)}
                      <input type="color" className="swatch swatch--input" value={geral.cor_legenda} aria-label="Outra cor" onChange={e => set({ cor_legenda: e.target.value.toUpperCase() })} />
                    </div></div>
                </div>
                <div className="field"><span>Posição</span>
                  <div className="chips" role="radiogroup" aria-label="Posição da legenda">
                    {(['baixo', 'meio', 'alto'] as const).map(p => <Chip key={p} selected={geral.posicao_legenda === p} onClick={() => set({ posicao_legenda: p })}>{p === 'baixo' ? 'Embaixo' : p === 'meio' ? 'No meio' : 'No topo'}</Chip>)}
                  </div></div>
              </div>
              <aside className="tpl-form__preview" aria-label="Prévia">
                <PreviaLegenda c={geral} />
                <span className="t-meta">Prévia da legenda</span>
              </aside>
            </div>
          </section>
          {barraSalvar}
        </div>
      )}

      {aba === 'marca' && (
        <div className="geral">
          <section className="card">
            <h2 className="card__title">Marca (logo nos cortes)</h2>
            <div className="marca">
              <div className="form-grid">
                <Switch checked={geral.usar_logo} onChange={v => set({ usar_logo: v })}>Mostrar a logo nos cortes</Switch>
                <label className="field"><span>Logo</span>
                  <select className="input" value={geral.logo} onChange={e => set({ logo: e.target.value })}>
                    <option value="">Sem logo</option>
                    {estado.logos.map(l => <option key={l} value={l}>{l.replace(/\.png$/, '')}</option>)}
                  </select></label>
                <div className="row">
                  <input ref={arquivoLogo} type="file" hidden accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) void enviarLogo(f); e.target.value = '' }} />
                  <Button icon="upload" onClick={() => arquivoLogo.current?.click()}>Enviar nova logo</Button>
                  {geral.logo && <Button variant="text" icon="trash" onClick={excluirLogo}>Excluir esta logo</Button>}
                </div>
                <div className="field"><span>Posição</span>
                  <div className="chips" role="radiogroup" aria-label="Posição da logo">
                    {POSICOES_LOGO.map(p => <Chip key={p.id} selected={geral.logo_posicao === p.id} onClick={() => set({ logo_posicao: p.id })}>{p.nome}</Chip>)}
                  </div></div>
                <label className="field"><span>Tamanho · {geral.logo_tamanho}% da largura</span>
                  <input type="range" min={8} max={45} value={geral.logo_tamanho} onChange={e => set({ logo_tamanho: Number(e.target.value) })} /></label>
                <label className="field"><span>Opacidade · {geral.logo_opacidade}%</span>
                  <input type="range" min={20} max={100} value={geral.logo_opacidade} onChange={e => set({ logo_opacidade: Number(e.target.value) })} /></label>
                <span className="t-meta">Trocar a logo ou a posição deixa os vídeos já gerados como “Desatualizados”.</span>
              </div>
              <PreviaMarca geral={geral} />
            </div>
          </section>

          <section className="card">
            <h2 className="card__title">Geral</h2>
            <div className="form-grid">
              <label className="field"><span>Idioma do episódio</span>
                <select className="input" value={geral.idioma} onChange={e => set({ idioma: e.target.value })}>
                  <option value="pt">Português</option><option value="en">Inglês</option><option value="es">Espanhol</option>
                </select></label>
              <label className="field"><span>Modelo de transcrição (Whisper)</span>
                <select className="input" value={geral.modelo_whisper} onChange={e => set({ modelo_whisper: e.target.value })}>
                  <option value="small">small — mais rápido</option>
                  <option value="medium">medium — equilibrado</option>
                  <option value="large-v3">large-v3 — mais preciso (~5 GB de VRAM)</option>
                </select></label>
              <label className="field"><span>Modelo do Claude (só vale com chave de API)</span>
                <input className="input" value={geral.modelo_claude} onChange={e => set({ modelo_claude: e.target.value })} /></label>
              <div><Button variant="text" icon="key" onClick={aoConta}>Conta Claude e chave de API</Button></div>
            </div>
          </section>
          {barraSalvar}
        </div>
      )}

      {dlg && (
        <TemplateDialog key={dlg.modelo?.id ?? 'novo'} aberto modelo={dlg.modelo} somenteLeitura={dlg.leitura}
                        aoFechar={() => setDlg(null)} aoSalvar={salvarTemplate} />
      )}
    </>
  )
}

/** Prévia da marca: tela 9:16 com um vídeo 16:9 no meio, como nos cortes. */
function PreviaMarca({ geral }: { geral: Geral }) {
  const lw = (1080 * geral.logo_tamanho) / 100
  const { x, y } = posicaoLogo(geral.logo_posicao, true, lw, lw, 1920, 1080)   // a logo é quase sempre quadrada ou redonda
  return (
    <div className="marca__prev">
      <div className="phone marca__phone" aria-label="Prévia da posição da logo">
        <div className="phone__video" />
        {geral.logo && geral.usar_logo && (
          <img src={urlLogo(geral.logo)} alt="" className="marca__logo"
               style={{ left: `${(x / 1080) * 100}%`, top: `${(y / 1920) * 100}%`, width: `${(lw / 1080) * 100}%`, opacity: geral.logo_opacidade / 100 }} />
        )}
      </div>
      <span className="t-meta">Prévia (vídeo 16:9)</span>
    </div>
  )
}
