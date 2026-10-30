import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Job } from './types'

/** Consulta o job em background (1s enquanto roda, 3s parado) e avisa quando ele termina. */
export function useJob(aoTerminar: () => void) {
  const [job, setJob] = useState<Job | null>(null)
  const rodandoAntes = useRef(false)
  const terminar = useRef(aoTerminar)
  terminar.current = aoTerminar

  const atualizar = useCallback(async () => {
    const j = await api.job()
    setJob(j)
    if (rodandoAntes.current && !j.rodando) terminar.current()
    rodandoAntes.current = j.rodando
    return j.rodando
  }, [])

  useEffect(() => {
    let vivo = true
    let timer = 0
    const tick = async () => {
      let proximo = 5000
      try { proximo = (await atualizar()) ? 1000 : 3000 } catch { /* servidor fora do ar: tenta de novo */ }
      if (vivo) timer = window.setTimeout(tick, proximo)
    }
    tick()
    return () => { vivo = false; clearTimeout(timer) }
  }, [atualizar])

  return { job, atualizar }
}

export function useToast() {
  const [msg, setMsg] = useState('')
  const t = useRef(0)
  const toast = useCallback((m: string) => {
    setMsg(m)
    clearTimeout(t.current)
    t.current = window.setTimeout(() => setMsg(''), 3500)
  }, [])
  return { msg, toast }
}

export type Tema = 'dark' | 'light'

export function useTema() {
  const [tema, setTema] = useState<Tema>(() => (document.documentElement.dataset.theme as Tema) || 'dark')
  const alternar = useCallback(() => {
    setTema(t => {
      const novo: Tema = t === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = novo
      try { localStorage.setItem('tema', novo) } catch { /* modo privado */ }
      return novo
    })
  }, [])
  return { tema, alternar }
}

/** Formata segundos como "1 h 05 min", "12 min 30 s" ou "45 s". */
export function duracao(s: number): string {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`
  if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
  return `${s} s`
}

export type Rota = 'painel' | 'conteudo' | 'editor' | 'videos' | 'config'
const ROTAS: Rota[] = ['painel', 'conteudo', 'editor', 'videos', 'config']

/** Rota por hash (#/painel, #/conteudo…), para o botão Voltar do navegador funcionar. */
export function useRota() {
  const ler = (): Rota => {
    const r = location.hash.replace(/^#\//, '') as Rota
    return ROTAS.includes(r) ? r : 'painel'
  }
  const [rota, setRota] = useState<Rota>(ler)
  useEffect(() => {
    const f = () => setRota(ler())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const ir = useCallback((r: Rota) => { location.hash = `/${r}` }, [])
  return { rota, ir }
}
