export interface Episodio {
  nome: string
  mb: number
  enviado: number
  audio: boolean
  transcrito: boolean
  n_cortes: number
  videos: string[]
  template: string
  template_nome: string
  config: Config
}

export type PosLogo = 'topo-esquerda' | 'topo-centro' | 'topo-direita' | 'centro' | 'baixo-esquerda' | 'baixo-centro' | 'baixo-direita'

export interface LogoCfg {
  logo: string
  logo_posicao: PosLogo
  logo_tamanho: number
  logo_opacidade: number
}

/** Padrões de geração e de vídeo/legenda (valem para todos os episódios). */
export interface EstiloCfg {
  qtd_cortes: number
  duracao_min: number
  duracao_max: number
  formato: 'vertical' | 'horizontal'
  legendas: boolean
  palavras_por_legenda: number
  tamanho_legenda: number
  fonte_legenda: string
  cor_legenda: string
  posicao_legenda: 'baixo' | 'meio' | 'alto'
  folga_inicio: number
  folga_fim: number
  velocidade_padrao: number
  usar_logo: boolean
}

/** Configuração efetiva de um episódio: os padrões globais mais o prompt do template padrão. */
export interface Config extends EstiloCfg, LogoCfg {
  instrucoes_extras: string
}

/** Template = só o prompt (briefing) que o Claude segue ao escolher os cortes. */
export interface Template {
  id: string
  nome: string
  descricao: string
  builtin: boolean
  prompt: string
}

export interface Geral extends EstiloCfg, LogoCfg {
  idioma: string
  modelo_whisper: string
  modelo_claude: string
}

export interface ClaudeStatus {
  instalado: boolean
  conectado: boolean
  email: string | null
  api: boolean
  entrando: boolean
  url: string | null
}

export type Conexao = Omit<ClaudeStatus, 'entrando' | 'url'>

export interface Estado {
  episodios: Episodio[]
  geral: Geral
  logos: string[]
  templates: Template[]
  template_ativo: string
  chave: boolean
  conexao: Conexao
}

export interface Corte {
  inicio: number
  fim: number
  titulo: string
  motivo: string
  descricao: string
  hashtags: string[]
  id: string
  velocidade: number
}

export interface Segmento {
  inicio: number
  fim: number
  texto: string
}

export type Etapa = 'tudo' | 'cortes' | 'transcrever' | 'selecionar' | 'cortar' | 'analisar'

export interface Job {
  rodando: boolean
  etapa: string
  episodio: string
  erro: string | null
  plano: string[]
  feitas: string[]
  pct_total: number
  pct_etapa: number | null
  detalhe: string
  decorrido_s: number
  eta_s: number | null
  lote: { i: number; n: number } | null
  log: string
}

export interface Palavra {
  p: string
  inicio: number
  fim: number
}

export type EstadoRender = 'novo' | 'pronto' | 'desatualizado' | 'sem_corte'

export interface StatusRender {
  cortes: Record<string, { estado: EstadoRender; arquivo: string | null }>
  videos: VideoGerado[]
}

/** Vídeo gerado, com o texto que vai junto na postagem. */
export interface VideoGerado {
  arquivo: string
  titulo: string
  descricao: string
  hashtags: string[]
  corte: string | null
  estado: EstadoRender
  gerado_em: number
  duracao: number | null
  nota: number | null
}

export interface OpcoesRender {
  formato?: 'vertical' | 'horizontal'
  legendas?: boolean
  template?: string
  qtd_cortes?: number
  duracao_min?: number
  duracao_max?: number
  instrucoes_extras?: string
  adicionar?: boolean
}

export interface TemplateIn {
  nome: string
  descricao: string
  prompt: string
}

export interface Importacao {
  rodando: boolean
  url: string
  pct: number | null
  detalhe: string
  erro: string | null
  nome: string | null
}

export interface CriterioViral {
  nome: string
  nota: number
  peso: number
  porque: string
}

/** Análise de potencial de viralização de um corte (nota de 0 a 10, calculada por média ponderada dos critérios). */
export interface Analise {
  nota: number
  veredito: string
  resumo: string
  criterios: Record<string, CriterioViral>
  pontos_fortes: string[]
  melhorias: string[]
  titulo_alternativo: string
  aviso: string
  desatualizada: boolean
}
