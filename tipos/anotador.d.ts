// Tipos compartilhados entre o overlay (navegador) e o servidor (Node).
// Declarações globais de propósito: o overlay é um script sem módulos.

type TipoSeletor = "data" | "id" | "css" | "aria" | "texto" | "xpath";

interface Seletor {
  tipo: TipoSeletor;
  valor: string;
  unico: boolean;
  pontos: number;
  /** tag do elemento — só para `tipo: "texto"`, refina a busca */
  tag?: string;
}

interface NivelAncestral {
  tag: string;
  id?: string;
  classe?: string;
  role?: string;
}

interface MetaElemento {
  tag: string;
  attrs: Record<string, string>;
  texto: string;
  cadeia: NivelAncestral[];
  /** componentes React do mais próximo ao mais externo (nomes de dev) */
  componentes: string[];
  /** outerHTML no momento da seleção (truncado) */
  html?: string;
  /** tag de abertura do pai */
  htmlPai?: string;
}

interface Localizacao {
  arquivo: string;
  linha: number;
  trecho: string;
  criterios: string[];
  pontos: number;
  /** arquivo alcançável a partir da rota da página (page/layout e seus imports) */
  rota?: boolean;
}

interface RotaAnalise {
  caminho: string;
  entradas: string[];
  /** arquivos importados (transitivamente) a partir das entradas */
  alcance: number;
}

interface SugestaoAplicacao {
  propriedade: string;
  antes: string;
  depois: string;
  classeAtual: string | null;
  sugestao: string | null;
  observacao?: string;
}

interface AnaliseTexto {
  de: string;
  para: string;
  localizacoes: Localizacao[];
}

interface AnaliseAnotacao {
  localizacoes: Localizacao[];
  sugestoes: SugestaoAplicacao[];
  texto?: AnaliseTexto;
}

interface AnaliseLote {
  raiz: string;
  arquivosVarridos: number;
  tailwind: string | null;
  rota?: RotaAnalise;
  anotacoes: Record<string, AnaliseAnotacao>;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ElementoAnotado {
  seletores: Seletor[];
  meta: MetaElemento;
  framePath: string[];
  shadowPath: string[];
  /** rect no viewport no momento da captura */
  rect: Rect;
  /** rect em coordenadas do documento (para recortes de captura) */
  rectPagina?: Rect | null;
  computado: Record<string, string>;
  /** elemento exato clicado, quando o snap subiu para o interativo */
  interno?: { seletores: Seletor[]; meta: MetaElemento };
  localizado?: boolean;
}

interface AlteracaoEstilo {
  propriedade: string;
  antes: string;
  depois: string;
}

interface AlteracaoTexto {
  antes: string;
  depois: string;
}

interface Anotacao {
  id: string;
  ordem: number;
  comentario: string;
  elemento: ElementoAnotado;
  alteracoes: AlteracaoEstilo[];
  texto: AlteracaoTexto | null;
  criadaEm: string;
}

interface ViewportLote {
  largura: number;
  altura: number;
  dpr: number;
  scrollX: number;
  scrollY: number;
}

interface PaginaLote {
  url: string;
  caminho: string;
  titulo: string;
  viewport: ViewportLote;
  tema: string | null;
  userAgent: string;
}

interface Lote {
  id: string;
  ferramenta: "anotador-ui";
  versao: 1;
  enviadoEm: string;
  pagina: PaginaLote;
  anotacoes: Anotacao[];
  /** HTML da página com as edições ao vivo e os pins desenhados */
  instantaneo: string | null;
}

/** Caminhos relativos ao diretório de saída da fila. */
interface CapturaLote {
  pagina?: string;
  anotacoes: Record<string, string>;
  erro?: string;
}

interface RegistroLote {
  id: string;
  recebidoEm: string;
  enviadoEm: string;
  url: string;
  titulo: string;
  quantidade: number;
  caminhoMd: string;
  caminhoJson: string;
}

type EstadoLote = "recebido" | "em_andamento" | "processado" | "desconhecido";

interface StatusLote {
  id: string;
  estado: EstadoLote;
  nota?: string;
  atualizadoEm?: string;
  processadoEm?: string;
  /** perguntas do Claude ainda sem resposta */
  perguntasAbertas?: number;
}

type TipoMensagem = "nota" | "pergunta" | "escolha" | "resposta";

interface Mensagem {
  id: string;
  lote: string;
  /** o agente escreve nota/pergunta/escolha; o usuário escreve resposta */
  autor: "agente" | "usuario";
  /** nome de exibição do agente que escreveu (ex.: "Claude") */
  agente?: string;
  tipo: TipoMensagem;
  texto: string;
  /** opções de uma escolha; numa resposta, as escolhidas */
  opcoes?: string[];
  /** id da pergunta/escolha que esta resposta atende */
  responde?: string;
  multipla?: boolean;
  em: string;
}

interface EventoAnotador {
  tipo: "ola" | "lote" | "progresso" | "processado" | "mensagem" | "conexao" | "avaliacao" | "parecer";
  nome?: string;
  /** app conectado (ola, conexao); null quando desconectou */
  alvo?: string | null;
  id?: string;
  quantidade?: number;
  url?: string;
  resumo?: string;
  caminhoMd?: string;
  capturas?: CapturaLote | null;
  /** arquivos-fonte prováveis, do mais ao menos provável */
  arquivos?: string[];
  nota?: string;
  mensagem?: Mensagem;
}

interface AchadoAuditoria {
  regra: string;
  categoria: "acessibilidade" | "hierarquia" | "consistencia" | "escala" | "layout";
  gravidade: "alta" | "media" | "baixa";
  alvo: string;
  evidencia: string;
  /** melhor seletor do elemento, para destacar e para achar no código */
  seletor: string | null;
  rect: Rect | null;
}

interface ResultadoAuditoria {
  achados: AchadoAuditoria[];
  /** quantos elementos visíveis foram medidos */
  medidos: number;
  em: string;
}

/** estado da árvore de elementos do overlay, para depuração e testes */
interface ResumoArvore {
  aberta: boolean;
  fixado: boolean;
  foco: string | null;
  area: { contidos: number; raiz: string; parciais: number } | null;
  /** uma linha por nó visível: "● " marca o foco, "+ " um indicador de ocultos */
  linhas: string[];
}

interface ConfigOverlay {
  base: string;
  capturas: boolean;
  nome: string;
  /** nome do agente que aplica as anotações, mostrado na interface */
  agente: string;
  /** SVG da marca do provedor, para o avatar da conversa */
  marca: string;
  /** modelo escolhido para a ponte, quando houver */
  modelo: string | null;
}
