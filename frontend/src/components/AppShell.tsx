import type { ReactNode } from 'react'
import { Button, IconButton } from '../ui/kit'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import type { Rota, Tema } from '../hooks'
import type { Conexao } from '../types'

interface BarProps {
  busca: string
  aoBuscar: (v: string) => void
  aoMenu: () => void
  aoEnviar: () => void
  aoTema: () => void
  aoConta: () => void
  tema: Tema
  conexao: Conexao
}

export function AppBar({ busca, aoBuscar, aoMenu, aoEnviar, aoTema, aoConta, tema, conexao }: BarProps) {
  const inicial = (conexao.email ?? 'C').charAt(0).toUpperCase()
  return (
    <header className="appbar">
      <div className="appbar__start">
        <span className="rail-toggle"><IconButton icon="menu" label="Menu" onClick={aoMenu} /></span>
        <a className="logo" href="#/painel" aria-label="Cortes Studio">
          <span className="logo__mark"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
          Studio
        </a>
      </div>
      <form className="search" role="search" onSubmit={e => e.preventDefault()}>
        <span className="search__icon"><Icon name="search" /></span>
        <input className="search__input" type="search" placeholder="Pesquise nos seus episódios" aria-label="Pesquisar episódios"
               value={busca} onChange={e => aoBuscar(e.target.value)} />
      </form>
      <div className="appbar__end">
        <IconButton icon={tema === 'dark' ? 'sun' : 'moon'} label={tema === 'dark' ? 'Tema claro' : 'Tema escuro'} onClick={aoTema} />
        <Button variant="outline" className="btn--create" icon="upload" onClick={aoEnviar}>Enviar</Button>
        <button type="button" className="avatar" onClick={aoConta} aria-label="Conta Claude" title={conexao.conectado ? `Conectado: ${conexao.email ?? 'conta Claude'}` : 'Conectar ao Claude'}>
          {inicial}
          <span className={'avatar__dot' + (conexao.conectado || conexao.api ? ' avatar__dot--ok' : '')} />
        </button>
      </div>
    </header>
  )
}

const ITENS: { id: Rota; nome: string; icone: IconName }[] = [
  { id: 'painel', nome: 'Painel', icone: 'dashboard' },
  { id: 'conteudo', nome: 'Conteúdo', icone: 'library' },
  { id: 'editor', nome: 'Editor de cortes', icone: 'scissors' },
  { id: 'videos', nome: 'Vídeos gerados', icone: 'movie' },
]

interface RailProps {
  rota: Rota
  aberto: boolean
  aoIr: (r: Rota) => void
  aoFechar: () => void
  aoConfig: () => void
  aoConta: () => void
  conectado: boolean
}

export function Rail({ rota, aberto, aoIr, aoFechar, aoConfig, aoConta, conectado }: RailProps) {
  return (
    <>
      <nav className="rail" data-open={aberto} aria-label="Navegação principal">
        <div className="profile">
          <div className="profile__img"><Icon name="scissors" /></div>
          <div className="profile__name">Cortes Podcast</div>
          <div className="t-meta">Seu projeto</div>
        </div>
        <ul className="rail__list">
          {ITENS.map(i => (
            <li key={i.id}>
              <button className="rail__item" aria-current={rota === i.id ? 'page' : undefined} onClick={() => { aoIr(i.id); aoFechar() }}>
                <Icon name={i.icone} /><span>{i.nome}</span>
              </button>
            </li>
          ))}
        </ul>
        <ul className="rail__list rail__bottom">
          <li><button className="rail__item" onClick={() => { aoConta(); aoFechar() }}><Icon name="key" /><span>{conectado ? 'Conta Claude' : 'Conectar ao Claude'}</span></button></li>
          <li><button className="rail__item" onClick={() => { aoConfig(); aoFechar() }}><Icon name="settings" /><span>Configurações</span></button></li>
        </ul>
      </nav>
      <div className="scrim" data-open={aberto} onClick={aoFechar} />
    </>
  )
}

export function Shell({ barra, trilho, children }: { barra: ReactNode; trilho: ReactNode; children: ReactNode }) {
  return (
    <>
      {barra}
      <div className="shell">
        {trilho}
        <main className="page">{children}</main>
      </div>
    </>
  )
}
