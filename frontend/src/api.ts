import type { Analise, ClaudeStatus, Corte, Importacao, Estado, Etapa, Geral, Job, OpcoesRender, Palavra, Segmento, StatusRender, TemplateIn } from './types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) {
    const d = corpo.detail
    throw new Error(typeof d === 'string' ? d : d ? JSON.stringify(d) : r.statusText)
  }
  return corpo as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const ep = (nome: string) => `/api/episodios/${encodeURIComponent(nome)}`

export const api = {
  estado: () => req<Estado>('/api/estado'),
  job: () => req<Job>('/api/job'),
  rodar: (episodio: string, etapa: Etapa, refazer = false, extra: { cortes?: string[]; opcoes?: OpcoesRender } = {}) =>
    req('/api/rodar', json('POST', { episodio, etapa, refazer, ...extra })),
  rodarLote: (episodios: string[], refazer: boolean, gerarVideos: boolean, opcoes: OpcoesRender) =>
    req('/api/rodar-lote', json('POST', { episodios, refazer, gerar_videos: gerarVideos, opcoes })),
  cancelarJob: () => req('/api/job/cancelar', { method: 'POST' }),
  analises: (nome: string) => req<Record<string, Analise>>(`${ep(nome)}/analises`),
  salvarGeral: (g: Geral) => req('/api/config', json('PUT', g)),
  statusRender: (nome: string, opcoes: OpcoesRender = {}) => req<StatusRender>(`${ep(nome)}/status-render`, json('POST', opcoes)),
  palavras: (nome: string, ini: number, fim: number) => req<Palavra[]>(`${ep(nome)}/palavras?ini=${ini}&fim=${fim}`),
  apagarVideo: (nome: string, video: string) => req(`${ep(nome)}/videos/${encodeURIComponent(video)}`, { method: 'DELETE' }),
  criarTemplate: (t: TemplateIn) => req<{ id: string }>('/api/templates', json('POST', t)),
  editarTemplate: (id: string, t: TemplateIn) => req(`/api/templates/${id}`, json('PUT', t)),
  excluirTemplate: (id: string) => req(`/api/templates/${id}`, { method: 'DELETE' }),
  templatePadrao: (id: string | null) => req('/api/templates-padrao', json('PUT', { id })),
  templateDoEpisodio: (nome: string, id: string | null) => req(`${ep(nome)}/template`, json('PUT', { id })),
  importar: (url: string) => req('/api/importar', json('POST', { url })),
  importarStatus: () => req<Importacao>('/api/importar'),
  apagarLogo: (nome: string) => req(`/api/logos/${encodeURIComponent(nome)}`, { method: 'DELETE' }),
  async enviarLogo(arquivo: File): Promise<{ nome: string }> {
    const fd = new FormData()
    fd.append('arquivo', arquivo)
    const r = await fetch('/api/logos', { method: 'POST', body: fd })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Falha ao enviar a logo')
    return d
  },
  salvarChave: (chave: string) => req('/api/chave', json('PUT', { chave })),
  claude: () => req<ClaudeStatus>('/api/claude'),
  claudeEntrar: () => req<{ url: string | null }>('/api/claude/login', { method: 'POST' }),
  claudeCodigo: (codigo: string) => req('/api/claude/codigo', json('POST', { codigo })),
  claudeCancelar: () => req('/api/claude/cancelar', { method: 'POST' }),
  claudeSair: () => req('/api/claude/logout', { method: 'POST' }),
  cortes: (nome: string) => req<Corte[]>(`${ep(nome)}/cortes`),
  salvarCortes: (nome: string, c: Corte[], apagarVideos: string[] = []) =>
    req<{ n: number; cortes: Corte[] }>(`${ep(nome)}/cortes${apagarVideos.length ? `?apagar_videos=${apagarVideos.join(',')}` : ''}`, json('PUT', c)),
  transcricao: (nome: string) => req<Segmento[]>(`${ep(nome)}/transcricao`),
  legenda: (nome: string, video: string) =>
    req<{ texto: string }>(`${ep(nome)}/legenda/${encodeURIComponent(video)}`),

  upload(arquivo: File, progresso: (pct: number) => void): Promise<{ nome: string }> {
    return new Promise((ok, erro) => {
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      const x = new XMLHttpRequest()
      x.upload.onprogress = e => e.lengthComputable && progresso(Math.round((e.loaded / e.total) * 100))
      x.onload = () => {
        const d = JSON.parse(x.responseText || '{}')
        x.status === 200 ? ok(d) : erro(new Error(d.detail || 'Falha no envio'))
      }
      x.onerror = () => erro(new Error('Falha no envio'))
      x.open('POST', '/api/upload')
      x.send(fd)
    })
  },
}

export const urlEntrada = (nome: string) => `/media/entrada/${encodeURIComponent(nome)}`
export const urlSaida = (episodio: string, video: string) =>
  `/media/saida/${encodeURIComponent(episodio.replace(/\.[^.]+$/, ''))}/${encodeURIComponent(video)}`

export const fmt = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`

export const hms = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const tituloDe = (nome: string) => nome.replace(/\.[^.]+$/, '').replace(/_/g, ' ')

/** "03_Titulo_do_corte_ab12cd.mp4" -> "Titulo do corte" */
export const tituloVideo = (arquivo: string) =>
  arquivo.replace(/\.mp4$/, '').replace(/^\d+_/, '').replace(/_[0-9a-f]{6}$/, '').replace(/_/g, ' ')

export const urlLogo = (nome: string) => `/media/logos/${encodeURIComponent(nome)}`
