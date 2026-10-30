import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Icon } from '../ui/Icon'
import { Badge, Button, Dialog } from '../ui/kit'
import type { Conexao } from '../types'

export function ConnectDialog({ aberto, conexao, aoFechar, aoSalvarChave, aoMudou, aviso }: {
  aberto: boolean; conexao: Conexao; aoFechar: () => void
  aoSalvarChave: (chave: string) => void; aoMudou: () => void; aviso: (m: string) => void
}) {
  const [chave, setChave] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [codigo, setCodigo] = useState('')
  // callbacks em ref: o App recria as funções a cada render e isso reiniciaria o intervalo
  const cb = useRef({ aoFechar, aoMudou, aviso })
  cb.current = { aoFechar, aoMudou, aviso }

  // enquanto o login está aberto no navegador, consulta até a conta ficar conectada
  useEffect(() => {
    if (!aberto || !entrando) return
    const id = window.setInterval(async () => {
      try {
        const s = await api.claude()
        setUrl(s.url)
        if (s.conectado) { setEntrando(false); cb.current.aviso('Conta Claude conectada'); cb.current.aoMudou(); cb.current.aoFechar() }
        else if (!s.entrando) { setEntrando(false); cb.current.aviso('Login não concluído. Tente de novo.') }
      } catch { /* servidor ocupado: tenta no próximo ciclo */ }
    }, 2000)
    return () => clearInterval(id)
  }, [aberto, entrando])

  async function entrar() {
    setOcupado(true)
    try { const r = await api.claudeEntrar(); setUrl(r.url); setEntrando(true) } catch (e) { aviso((e as Error).message) } finally { setOcupado(false) }
  }
  async function enviarCodigo() {
    setOcupado(true)
    try { await api.claudeCodigo(codigo); setCodigo('') } catch (e) { aviso((e as Error).message) } finally { setOcupado(false) }
  }
  async function cancelar() { await api.claudeCancelar(); setEntrando(false) }
  async function sair() { setOcupado(true); try { await api.claudeSair(); aoMudou() } finally { setOcupado(false) } }

  return (
    <Dialog aberto={aberto} titulo="Conectar ao Claude" aoFechar={() => { if (entrando) void cancelar(); aoFechar() }}>
      <section className="field" style={{ gap: 'var(--sp-3)' }}>
        <h3 className="t-heading">Entrar com sua conta Claude</h3>
        <p className="t-muted">Usa o seu plano do Claude, sem chave de API. A conexão é feita pelo Claude Code instalado neste computador.</p>

        {!conexao.instalado && (
          <div className="alert alert--warn"><Icon name="warning" /><span>Claude Code não encontrado neste computador. Use uma chave de API abaixo.</span></div>
        )}

        {conexao.conectado ? (
          <div className="row-between">
            <Badge tone="ok">Conectado{conexao.email ? ` como ${conexao.email}` : ''}</Badge>
            <Button size="sm" variant="text" disabled={ocupado} onClick={sair}>Sair da conta</Button>
          </div>
        ) : entrando ? (
          <>
            <div className="alert" aria-live="polite">
              <Icon name="info" />
              <span>
                1. Entre na sua conta na página do Claude{url ? <> (<a href={url} target="_blank" rel="noreferrer">abrir página de login</a>)</> : ' que abriu no navegador'}.<br />
                2. Se a página mostrar um código, cole abaixo e confirme. Esta janela atualiza sozinha quando a conta conectar.
              </span>
            </div>
            <div className="row-between">
              <input className="input" aria-label="Código de login" placeholder="Código mostrado pela página (se houver)" value={codigo} onChange={e => setCodigo(e.target.value)} />
              <Button variant="filled" disabled={!codigo.trim() || ocupado} onClick={enviarCodigo}>Confirmar</Button>
            </div>
          </>
        ) : (
          <div><Button variant="brand" icon="sparkle" disabled={!conexao.instalado || ocupado} onClick={entrar}>Entrar com Claude</Button></div>
        )}
        {entrando && <div><Button size="sm" variant="text" onClick={cancelar}>Cancelar</Button></div>}
      </section>

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />

      <section className="field" style={{ gap: 'var(--sp-3)' }}>
        <h3 className="t-heading">Ou use uma chave de API</h3>
        <p className="t-muted">Cobrança por uso, pela Anthropic Console. A chave fica salva só neste computador, em <code>chave_api.txt</code>.</p>
        <input className="input" type="password" autoComplete="off" aria-label="Chave da API" placeholder={conexao.api ? 'Chave definida — cole outra para substituir' : 'sk-ant-…'}
               value={chave} onChange={e => setChave(e.target.value)} />
        <div className="row-between">
          {conexao.api ? <Button size="sm" variant="text" onClick={() => aoSalvarChave('')}>Remover chave</Button> : <span />}
          <Button variant="filled" disabled={!chave.trim()} onClick={() => { aoSalvarChave(chave); setChave('') }}>Salvar chave</Button>
        </div>
      </section>
    </Dialog>
  )
}
