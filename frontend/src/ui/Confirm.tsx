import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Button, Dialog } from './kit'

export interface Acao { id: string; rotulo: string; perigo?: boolean }
export interface Pergunta { titulo: string; mensagem: ReactNode; acoes: Acao[]; cancelar?: string }

type Perguntar = (p: Pergunta) => Promise<string | null>
const Ctx = createContext<Perguntar>(() => Promise.resolve(null))

/** Janela de confirmação do próprio painel (no lugar do confirm() do navegador). Responde com o id da ação, ou null se cancelar. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pergunta | null>(null)
  const resolver = useRef<((v: string | null) => void) | null>(null)
  const perguntar = useCallback<Perguntar>(pergunta => new Promise(res => { resolver.current = res; setP(pergunta) }), [])
  const responder = (v: string | null) => { resolver.current?.(v); resolver.current = null; setP(null) }
  const perigo = !!p?.acoes.some(a => a.perigo)
  return (
    <Ctx.Provider value={perguntar}>
      {children}
      <Dialog aberto={!!p} pequeno titulo={p?.titulo ?? ''} aoFechar={() => responder(null)}
              rodape={p && (
                <>
                  <Button variant="text" onClick={() => responder(null)}>{p.cancelar ?? 'Cancelar'}</Button>
                  {p.acoes.map(a => <Button key={a.id} variant={a.perigo ? 'brand' : 'filled'} onClick={() => responder(a.id)}>{a.rotulo}</Button>)}
                </>
              )}>
        {p && <div className={'confirm' + (perigo ? ' confirm--perigo' : '')}><Icon name={perigo ? 'warning' : 'info'} /><div>{p.mensagem}</div></div>}
      </Dialog>
    </Ctx.Provider>
  )
}

export const usePerguntar = () => useContext(Ctx)

/** Confirmação simples: sim/não. */
export function useConfirmar() {
  const perguntar = usePerguntar()
  return useCallback((o: { titulo: string; mensagem: ReactNode; rotulo?: string; perigo?: boolean }) =>
    perguntar({ titulo: o.titulo, mensagem: o.mensagem, acoes: [{ id: 'sim', rotulo: o.rotulo ?? 'Confirmar', perigo: o.perigo ?? true }] }).then(r => r === 'sim'), [perguntar])
}
