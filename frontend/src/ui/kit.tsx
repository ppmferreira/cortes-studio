import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/* ---------------------------------- Button ---------------------------------- */
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'tonal' | 'filled' | 'brand' | 'outline' | 'text'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  block?: boolean
}

export function Button({ variant = 'tonal', size = 'md', icon, block, className = '', children, ...rest }: BtnProps) {
  const cls = `btn btn--${variant}${size !== 'md' ? ` btn--${size}` : ''}${block ? ' btn--block' : ''} ${className}`
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, small, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; small?: boolean }) {
  return (
    <button type="button" className={'icon-btn' + (small ? ' icon-btn--sm' : '')} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  )
}

/* ---------------------------------- Chip ---------------------------------- */
export function Chip({ selected, count, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={!!selected} className="chip" {...rest}>
      {children}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  )
}

export function Badge({ tone, children }: { tone?: 'ok' | 'run' | 'err'; children: ReactNode }) {
  return <span className={'badge' + (tone ? ` badge--${tone}` : '')}>{children}</span>
}

/* ------------------------------- ProgressBar ------------------------------- */
export function ProgressBar({ value, large, label }: { value: number | null; large?: boolean; label: string }) {
  const indet = value === null
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={indet ? undefined : Math.round(pct)}
      className={'progress' + (large ? ' progress--lg' : '') + (indet ? ' progress--indeterminate' : '') + (pct >= 100 ? ' progress--done' : '')}
    >
      <div className="progress__fill" style={indet ? undefined : { width: `${pct}%` }} />
    </div>
  )
}

/* ---------------------------------- Switch ---------------------------------- */
export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch__box" />
      <span>{children}</span>
    </label>
  )
}

/* ---------------------------------- Dialog ---------------------------------- */
/** <dialog> nativo: foco preso, Esc fecha e leitores de tela anunciam como modal. */
export function Dialog({ aberto, titulo, aoFechar, rodape, largo, pequeno, children }: {
  aberto: boolean; titulo: string; aoFechar: () => void; rodape?: ReactNode; largo?: boolean; pequeno?: boolean; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])
  return (
    <dialog ref={ref} className={'dialog' + (largo ? ' dialog--wide' : '') + (pequeno ? ' dialog--sm' : '')} aria-label={titulo} onClose={aoFechar}
            onClick={e => { if (e.target === ref.current) aoFechar() }}>
      {aberto && (
        <>
          <div className="dialog__head">
            <h2 className="t-heading">{titulo}</h2>
            <IconButton icon="close" label="Fechar" onClick={aoFechar} />
          </div>
          <div className="dialog__body">{children}</div>
          {rodape && <div className="dialog__foot">{rodape}</div>}
        </>
      )}
    </dialog>
  )
}
