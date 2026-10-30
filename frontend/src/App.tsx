import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { AppBar, Rail, Shell } from './components/AppShell'
import { ConnectDialog } from './components/Dialogs'
import { EnviarDialog } from './components/EnviarDialog'
import { JobCard } from './components/JobCard'
import { useJob, useRota, useTema, useToast } from './hooks'
import { Conteudo } from './pages/Conteudo'
import { Configuracoes } from './pages/Configuracoes'
import { Editor } from './pages/Editor'
import { Painel } from './pages/Painel'
import { Videos } from './pages/Videos'
import { Icon } from './ui/Icon'
import { useConfirmar } from './ui/Confirm'
import { Button, ProgressBar } from './ui/kit'
import type { Estado, Etapa, Importacao, OpcoesRender } from './types'

export default function App() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [offline, setOffline] = useState(false)
  const [atual, setAtual] = useState<string | null>(() => localStorage.getItem('ep'))
  const [busca, setBusca] = useState('')
  const [menu, setMenu] = useState(false)
  const [dialogo, setDialogo] = useState<'conta' | null>(null)
  const [envio, setEnvio] = useState<{ nome: string; pct: number } | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [enviarAberto, setEnviarAberto] = useState(false)
  const [imp, setImp] = useState<Importacao | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { rota, ir } = useRota()
  const { tema, alternar } = useTema()
  const { msg, toast } = useToast()
  const confirmar = useConfirmar()

  const carregar = useCallback(async () => {
    try { setEstado(await api.estado()); setOffline(false) } catch { setOffline(true) }
  }, [])
  const { job, atualizar } = useJob(carregar)
  useEffect(() => { void carregar() }, [carregar])

  const escolher = (nome: string) => { setAtual(nome); try { localStorage.setItem('ep', nome) } catch { /* ignora */ } }
  const abrir = (nome: string) => { escolher(nome); ir('editor') }

  async function enviar(f: File) {
    setEnvio({ nome: f.name, pct: 0 })
    try {
      const { nome } = await api.upload(f, pct => setEnvio({ nome: f.name, pct }))
      escolher(nome); toast('Episódio enviado'); await carregar()
    } catch (e) { toast((e as Error).message) } finally { setEnvio(null) }
  }

  // importação por link: acompanha o download e abre o episódio quando terminar
  useEffect(() => {
    if (!imp?.rodando) return
    const id = window.setInterval(async () => {
      try {
        const s = await api.importarStatus()
        setImp(s)
        if (!s.rodando) {
          if (s.erro) toast(`Importação falhou: ${s.erro}`)
          else if (s.nome) { escolher(s.nome); ir('editor'); toast('Episódio importado'); void carregar() }
        }
      } catch { /* servidor ocupado */ }
    }, 1000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp?.rodando])

  async function importar(url: string) {
    try { await api.importar(url); setImp(await api.importarStatus()) } catch (e) { toast((e as Error).message) }
  }

  // arrastar um arquivo para qualquer lugar da janela
  useEffect(() => {
    let nivel = 0
    const tem = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const dentro = (e: DragEvent) => { if (tem(e)) { e.preventDefault(); nivel++; setArrastando(true) } }
    const fora = (e: DragEvent) => { if (tem(e)) { nivel = Math.max(0, nivel - 1); if (!nivel) setArrastando(false) } }
    const solto = (e: DragEvent) => { if (!tem(e)) return; e.preventDefault(); nivel = 0; setArrastando(false); const f = e.dataTransfer?.files[0]; if (f) void enviar(f) }
    const sobre = (e: DragEvent) => { if (tem(e)) e.preventDefault() }
    window.addEventListener('dragenter', dentro); window.addEventListener('dragleave', fora)
    window.addEventListener('drop', solto); window.addEventListener('dragover', sobre)
    return () => { window.removeEventListener('dragenter', dentro); window.removeEventListener('dragleave', fora); window.removeEventListener('drop', solto); window.removeEventListener('dragover', sobre) }
  })

  async function rodar(etapa: Etapa, refazer = false, nome?: string, extra?: { cortes?: string[]; opcoes?: OpcoesRender }) {
    const alvo = nome ?? atual ?? estado?.episodios[0]?.nome
    if (!alvo) return
    try {
      const r = await api.rodar(alvo, etapa, refazer, extra) as { fila?: number }
      if (r?.fila) toast('Análise na fila: começa sozinha quando o processo atual terminar')
      await atualizar()
    } catch (e) { toast((e as Error).message) }
  }

  async function cancelarProcesso() {
    if (!(await confirmar({ titulo: 'Cancelar o processo?', mensagem: <>O que já foi concluído é mantido. A transcrição para no próximo trecho; o Claude e a geração de vídeo são interrompidos na hora.</>, rotulo: 'Cancelar processo' }))) return
    try { await api.cancelarJob(); toast('Cancelando…'); await atualizar() } catch (e) { toast((e as Error).message) }
  }
  const verProcesso = () => { if (job?.episodio) { escolher(job.episodio); ir('editor') } }

  async function rodarLote(episodios: string[], refazer: boolean, gerarVideos: boolean, opcoes: OpcoesRender) {
    try { await api.rodarLote(episodios, refazer, gerarVideos, opcoes); await atualizar() } catch (e) { toast((e as Error).message) }
  }
  async function salvarChave(chave: string) {
    await api.salvarChave(chave); toast(chave.trim() ? 'Chave salva' : 'Chave removida'); await carregar()
  }

  if (offline && !estado) {
    return (
      <div className="empty" style={{ minHeight: '100vh', alignContent: 'center' }}>
        <Icon name="warning" /><h2 className="t-heading">Servidor fora do ar</h2>
        <p>Abra o <code>iniciar.bat</code> para ligar o servidor.</p>
        <Button variant="filled" onClick={carregar}>Tentar de novo</Button>
      </div>
    )
  }
  if (!estado) {
    return (
      <div style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }} aria-busy="true">
        <div className="skeleton" style={{ height: 40, width: 220 }} />
        <div className="skeleton" style={{ height: 280, maxWidth: 900 }} />
      </div>
    )
  }

  const ep = estado.episodios.find(e => e.nome === atual) ?? estado.episodios[0]
  const conectado = estado.conexao.conectado || estado.conexao.api

  const buscar = (v: string) => { setBusca(v); if (v && rota !== 'conteudo' && rota !== 'videos') ir('conteudo') }

  return (
    <>
      <Shell
        barra={<AppBar busca={busca} aoBuscar={buscar} aoMenu={() => setMenu(m => !m)} aoEnviar={() => setEnviarAberto(true)}
                       aoTema={alternar} aoConta={() => setDialogo('conta')} tema={tema} conexao={estado.conexao} />}
        trilho={<Rail rota={rota} aberto={menu} aoIr={r => { setBusca(''); ir(r) }} aoFechar={() => setMenu(false)}
                      aoConfig={() => ir('config')} aoConta={() => setDialogo('conta')} conectado={conectado} />}
      >
        {rota === 'painel' && (
          <Painel episodios={estado.episodios} job={job} conexao={estado.conexao} aoAbrir={abrir}
                  aoRodarTudo={nome => { escolher(nome); void rodar('tudo', false, nome) }}
                  aoConta={() => setDialogo('conta')} aoEnviar={() => setEnviarAberto(true)}
                  aoVideos={() => ir('videos')} aoConteudo={() => ir('conteudo')} />
        )}
        {rota === 'conteudo' && <Conteudo episodios={estado.episodios} busca={busca} aoAbrir={abrir} aoEnviar={() => setEnviarAberto(true)} />}
        {rota === 'config' && <Configuracoes estado={estado} aoMudou={carregar} aviso={toast} aoConta={() => setDialogo('conta')} />}
        {rota === 'videos' && <Videos ocupado={!!job?.rodando} episodios={estado.episodios} busca={busca} aviso={toast} aoMudou={carregar} />}
        {rota === 'editor' && (!ep ? (
          <div className="empty">
            <Icon name="movie" />
            <h2 className="t-heading">Nenhum episódio para editar</h2>
            <p>Envie um episódio para começar a escolher os cortes.</p>
            <Button variant="brand" size="lg" icon="upload" onClick={() => setEnviarAberto(true)}>Enviar episódio</Button>
          </div>
        ) : (
          <Editor key={ep.nome} ep={ep} job={job} episodios={estado.episodios} templates={estado.templates} temChave={estado.chave} aoLote={rodarLote} aoCancelar={cancelarProcesso}
                  aoRodar={(etapa, refazer, extra) => rodar(etapa, refazer, undefined, extra)}
                  aoMudou={carregar} aviso={toast} />
        ))}
      </Shell>

      <EnviarDialog aberto={enviarAberto} ocupado={!!imp?.rodando} aoFechar={() => setEnviarAberto(false)}
                    aoEscolherArquivo={() => input.current?.click()} aoImportar={importar} />
      <input ref={input} type="file" hidden accept="video/*,audio/*,.mkv"
             onChange={e => { const f = e.target.files?.[0]; if (f) void enviar(f); e.target.value = '' }} />

      <ConnectDialog aberto={dialogo === 'conta'} conexao={estado.conexao} aoFechar={() => setDialogo(null)} aoSalvarChave={salvarChave} aoMudou={carregar} aviso={toast} />

      {arrastando && (
        <div className="dropzone-overlay"><div><Icon name="upload" /><h2 className="t-heading">Solte o episódio para enviar</h2></div></div>
      )}
      <div className="toast-stack">
      {envio && (
        <div className="toast upload-toast" role="status" style={{ width: 360 }}>
          <div className="truncate">Enviando {envio.nome}</div>
          <ProgressBar value={envio.pct} label="Envio do episódio" />
          <span className="t-meta">{envio.pct}%</span>
        </div>
      )}
      {imp?.rodando && (
        <div className="toast upload-toast" role="status" style={{ width: 360 }}>
          <div className="truncate">Importando vídeo…</div>
          <ProgressBar value={imp.pct} label="Importação do vídeo" />
          <span className="t-meta">{imp.detalhe}{imp.pct !== null ? ` · ${Math.round(imp.pct)}%` : ''}</span>
        </div>
      )}
      {msg && !envio && <div className="toast" role="status">{msg}</div>}
        {job?.rodando && <JobCard job={job} aoVer={verProcesso} aoCancelar={cancelarProcesso} />}
      </div>
    </>
  )
}
