// Interface do anotador: barra, seleção, pins/balões, painel de propriedades, fila e envio.

type ElementoEstilizavel = HTMLElement | SVGElement;

interface SnapshotEdicao {
  alteracoes: AlteracaoEstilo[];
  texto: AlteracaoTexto | null;
  comentario: string;
  style: string;
  anexos?: AnexoImagem[];
}

interface AnotacaoLocal extends Anotacao {
  estilosOriginais: string;
  textoOriginal: string | null;
  confirmada: boolean;
  enviadaEm?: string | null;
  snapshotEdicao?: SnapshotEdicao;
}

interface LoteLocal {
  execucao?: ExecucaoLoteUI | null;
  id: string;
  enviadoEm: string;
  estado: EstadoLote;
  nota?: string;
  perguntasAbertas?: number;
  /** resumo do que foi anotado, para o cabeçalho da conversa */
  resumo?: string;
}

interface ConversaAberta {
  carregando?: boolean;
  erroLeitura?: string;
  execucao?: ExecucaoLoteUI | null;
  erroExecucao?: string;
  lote: LoteLocal;
  mensagens: Mensagem[];
  /** opções marcadas por pergunta ainda não enviada */
  selecao: Map<string, Set<string>>;
}

interface DadosPersistidos {
  anotacoes?: AnotacaoLocal[];
  enviadas?: AnotacaoLocal[];
  lotes?: LoteLocal[];
  armado?: boolean;
  rascunho?: AnotacaoLocal;
  painelAberto?: boolean;
  conversaRascunho?: { loteId: string; texto: string; selecao: Array<[string, string[]]> };
  posicaoPagina?: { x: number; y: number };
  chat?: { nome: string; estado: string };
  idiomaDitado?: IdiomaDitado;
}

interface AreaSelecionada {
  /** retângulo em coordenadas do documento */
  rect: Rect;
  /** elementos inteiramente dentro da área */
  contidos: Set<Element>;
  /** ancestral comum dos contidos */
  raiz: Element;
  parciais: number;
  truncado: boolean;
}

interface EstadoArvore {
  aberta: boolean;
  /** elemento em foco quando não há seleção nem área (segue o cursor) */
  foco: Element | null;
  /** não segue o cursor */
  fixado: boolean;
  abertos: WeakSet<Element>;
  fechados: WeakSet<Element>;
  area: AreaSelecionada | null;
  /** linha com foco de teclado */
  linhaFocada: Element | null;
}

interface GestoArea {
  /** Origem fixa no documento, mesmo se a página rolar durante o gesto. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** passou do limiar de arrasto: é uma área, não um clique */
  ativo: boolean;
  pointerId: number;
}

interface Estado {
  armado: boolean;
  anotacoes: AnotacaoLocal[];
  enviadas: AnotacaoLocal[];
  lotes: LoteLocal[];
  atual: AnotacaoLocal | null;
  elementos: Map<string, ElementoEstilizavel>;
  hoverEl: Element | null;
  proporcaoTravada: boolean;
  arrastando: boolean;
  ditado: { botao: HTMLButtonElement; parar: () => void; concluir?: () => void } | null;
  conversa: ConversaAberta | null;
  arvore: EstadoArvore;
  /** elemento exato sob o cursor no clique que criou o rascunho atual */
  exato: Element | null;
  gestoArea: GestoArea | null;
  envioEmAndamento: Set<string> | null;
}

interface Posicao {
  left: number;
  top: number;
}

interface Ui {
  superficieSelecao: HTMLDivElement;
  caixaHover: HTMLDivElement;
  caixaSel: HTMLDivElement;
  dica: HTMLDivElement;
  camadaPins: HTMLDivElement;
  toast: HTMLDivElement;
  barra: HTMLDivElement;
  btnLimpar: HTMLButtonElement;
  btnEnviar: HTMLButtonElement;
  contador: HTMLSpanElement;
  estado: HTMLButtonElement;
  modoSel: HTMLButtonElement;
  modoNav: HTMLButtonElement;
  balao: HTMLDivElement | null;
  entradaBalao: HTMLInputElement | null;
  painel: HTMLDivElement;
  comentarioPainel: HTMLTextAreaElement;
  painelTag: HTMLSpanElement;
  painelComp: HTMLSpanElement;
  painelCorpo: HTMLDivElement;
  btnExcluir: HTMLButtonElement;
  fila: HTMLDivElement;
  conversa: HTMLDivElement | null;
  alcaBarra: HTMLButtonElement;
  alcaPainel: HTMLButtonElement;
  religar: HTMLDivElement | null;
  caixaArea: HTMLDivElement;
  btnArvore: HTMLButtonElement;
  arvore: HTMLDivElement | null;
  arvoreCorpo: HTMLDivElement | null;
  arvoreSub: HTMLSpanElement | null;
  btnFixar: HTMLButtonElement | null;
  btnLimparArea: HTMLButtonElement | null;
  camadaRealces: HTMLDivElement;
  btnDesign: HTMLButtonElement;
  design: HTMLDivElement | null;
  btnAvaliar: HTMLButtonElement;
  avaliacao: HTMLDivElement | null;
  btnAgente: HTMLButtonElement;
  menuAgentes: HTMLDivElement | null;
}

interface OpcoesArrasto {
  aoMover?: () => void;
  /** o elemento inteiro arrasta; clique sem deslocar chama aoClique */
  arrastarTudo?: boolean;
  aoClique?: () => void;
}

const CFG: ConfigOverlay = window.__ANOTADOR_CFG ?? { base: "/__anotador", capturas: true, nome: "", agente: "Claude", marca: "", modelo: null, norma: null };
let AGENTE = CFG.agente || "Claude";
let MARCA_AGENTE = CFG.marca || "";
let MODELO = CFG.modelo || null;
const CHAVE_ARMAZENAMENTO = "anotador-ui:" + location.pathname;
const CHAVE_DESLIGADO = "anotador-ui:desligado";
const CHAVE_DITADO_PENDENTE = "anotador-ui:ditado-pendente";
const CHAVE_IDIOMA_DITADO = "anotador-ui:idioma-ditado";
const IDIOMAS_DITADO = {
  pt: { nome: "Português (Brasil)", navegador: "pt-BR" },
  en: { nome: "Inglês", navegador: "en-US" },
  es: { nome: "Espanhol", navegador: "es-ES" },
  fr: { nome: "Francês", navegador: "fr-FR" },
  de: { nome: "Alemão", navegador: "de-DE" },
  it: { nome: "Italiano", navegador: "it-IT" },
} as const;
type IdiomaDitado = keyof typeof IDIOMAS_DITADO;
function validarIdiomaDitado(valor: unknown): IdiomaDitado {
  return typeof valor === "string" && Object.hasOwn(IDIOMAS_DITADO, valor) ? valor as IdiomaDitado : "pt";
}
let idiomaDitado: IdiomaDitado = (() => {
  try { return validarIdiomaDitado(localStorage.getItem(CHAVE_IDIOMA_DITADO)); }
  catch { return "pt"; }
})();
let restaurandoConversa = false;

const ICONES = {
  fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  lixeira: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  mira: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
  cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  alca: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
  arvore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M9 12h11M14 18h6"/></svg>',
  fixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3z"/></svg>',
  seta: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l6 6-6 6z"/></svg>',
  paleta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.7-9-7.7Z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
  recarregar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
};

const PROPRIEDADES_COMPUTADAS = [
  "color", "background-color", "opacity", "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "text-align", "border-radius", "border-color", "border-width", "border-style", "width", "height",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "display", "position", "gap",
];

const estado: Estado = {
  armado: true,
  anotacoes: [],
  enviadas: [],
  lotes: [],
  atual: null,
  elementos: new Map(),
  hoverEl: null,
  proporcaoTravada: false,
  arrastando: false,
  ditado: null,
  conversa: null,
  arvore: { aberta: false, foco: null, fixado: false, abertos: new WeakSet(), fechados: new WeakSet(), area: null, linhaFocada: null },
  exato: null,
  gestoArea: null,
  envioEmAndamento: null,
};

let host: HTMLDivElement | null = null;
let raiz: HTMLDivElement | null = null;
const ui = { balao: null, entradaBalao: null, religar: null, conversa: null, arvore: null, arvoreCorpo: null, arvoreSub: null, btnFixar: null, btnLimparArea: null, design: null, avaliacao: null } as Ui;

// ---------- utilidades ----------
interface TextoInterface { chaveInterface: string; parametros?: Record<string, string | number> }
interface RuntimeIdiomasInterface {
  t: (texto: string, parametros?: Record<string, string | number>) => string;
  registrar: (dicionarios: { en: Record<string, string>; es: Record<string, string> }) => void;
  idioma: () => "pt-BR" | "en" | "es";
  observar: (callback: () => void) => () => void;
}
const idiomasInterface = (window as unknown as { __anotador_i18n?: RuntimeIdiomasInterface }).__anotador_i18n;
idiomasInterface?.registrar({
  "en": {
    "Selecionar": "Select",
    "Navegar": "Browse",
    "Enviar": "Send",
    "Anotando": "Annotating",
    "Anotador": "Annotator",
    "Endereço da página": "Page address",
    "Endereço completo da página": "Full page address",
    "Descartar todas as anotações pendentes": "Discard all pending annotations",
    "Ver lotes enviados": "View sent batches",
    "Clique seleciona elementos (Alt+A alterna)": "Click to select elements (Alt+A toggles)",
    "Usar a página normalmente (Alt+A alterna)": "Use the page normally (Alt+A toggles)",
    "Arrastar a barra (duplo clique recoloca)": "Drag the toolbar (double-click to reset)",
    "Estrutura de elementos: árvore para escolher o nível certo (Alt+R)": "Element tree: choose the right level (Alt+R)",
    "Sistema de design: o que a página pinta e o que o projeto declara (Alt+D)": "Design system: rendered page and project definitions (Alt+D)",
    "Avaliar a página: régua objetiva e parecer do agente (Alt+E)": "Evaluate the page: checks and agent review (Alt+E)",
    "Escolher agente e modelo": "Choose agent and model",
    "Menu do anotador (abre em nova aba)": "Annotator menu (opens in a new tab)",
    "Abrir menu do anotador em nova aba": "Open annotator menu in a new tab",
    "Ocultar anotador (Alt+Shift+A)": "Hide annotator (Alt+Shift+A)",
    "Recarregar página preservando anotações": "Reload page and keep annotations",
    "Ver fila e lotes": "View queue and batches",
    "Extrair design de um site": "Extract a website's design",
    "Quem recebe as anotações": "Who receives the annotations",
    "Carregando agentes…": "Loading agents…",
    "Trocar agente": "Switch agent",
    "Usar a configuração padrão do agente.": "Use the agent's default settings.",
    "Modelo": "Model",
    "Raciocínio": "Reasoning",
    "Agente": "Agent",
    "Padrão": "Default",
    "Padrão do agente": "Agent default",
    "Mínimo": "Minimal",
    "Baixo": "Low",
    "Médio": "Medium",
    "Alto": "High",
    "Muito alto": "Very high",
    "Máximo": "Maximum",
    "Guardar": "Save",
    "Aplicar": "Apply",
    "Cancelar": "Cancel",
    "Confirmar": "Confirm",
    "Excluir": "Delete",
    "Fechar": "Close",
    "Descreva essas alterações...": "Describe these changes...",
    "Adicionar um comentário...": "Add a comment...",
    "Adicionar um comentário…": "Add a comment…",
    "Arrastar o painel (duplo clique recoloca)": "Drag the panel (double-click to reset)",
    "Fechar painel": "Close panel",
    "Texto": "Text",
    "Cor do texto": "Text color",
    "Fundo": "Background",
    "Opacity": "Opacity",
    "Opacidade": "Opacity",
    "Fonte": "Font",
    "Tamanho da fonte": "Font size",
    "Peso da fonte": "Font weight",
    "Altura da linha": "Line height",
    "Alinhamento": "Alignment",
    "Raio da borda": "Border radius",
    "Cor da borda": "Border color",
    "Largura da borda": "Border width",
    "Largura": "Width",
    "Altura": "Height",
    "Preenchimento": "Padding",
    "Margem": "Margin",
    "cima, direita, baixo, esquerda": "top, right, bottom, left",
    "Localizar elemento na página": "Locate element on the page",
    "melhor seletor encontrado": "best selector found",
    "Tirar print da tela": "Take screenshot",
    "Capturar o site e anexar a imagem a esta anotação": "Capture the site and attach the image to this annotation",
    "Capturando…": "Capturing…",
    "Contexto da seleção": "Selection context",
    "Elementos da área": "Elements in this area",
    "Fechar seletor de cor": "Close color picker",
    "Saturação e brilho": "Saturation and brightness",
    "Setas esquerda e direita ajustam a saturação; acima e abaixo ajustam o brilho.": "Left and right arrows adjust saturation; up and down adjust brightness.",
    "Matiz": "Hue",
    "Opacidade da cor": "Color opacity",
    "Cor hexadecimal": "Hex color",
    "Vermelho": "Red",
    "Verde": "Green",
    "Azul": "Blue",
    "Escolher {cor}": "Choose {cor}",
    "Conversas": "Conversations",
    "Nova conversa": "New conversation",
    "+ Nova": "+ New",
    "Uso": "Usage",
    "Visualizar uso da conta": "View account usage",
    "Visualizar uso da conta e renovação dos limites": "View account usage and limit resets",
    "Ampliar ou reduzir chat": "Expand or shrink chat",
    "Ampliar chat": "Expand chat",
    "Fechar chat": "Close chat",
    "Agente da conversa": "Conversation agent",
    "Modelo da conversa": "Conversation model",
    "Sessões de {agente}": "Sessions for {agente}",
    "Histórico no agente": "History in the agent",
    "Carregando sessões…": "Loading sessions…",
    "Ainda não há conversas deste agente no projeto.": "This agent has no conversations in the project yet.",
    "Lista parcial das sessões localizadas neste projeto.": "Partial list of sessions found in this project.",
    "Mensagens da conversa": "Conversation messages",
    "Abra uma sessão para enviar mensagens": "Open a session to send messages",
    "Converse sobre o projeto…": "Chat about the project…",
    "Mensagem para o agente": "Message for the agent",
    "Enter envia · Shift+Enter quebra linha": "Enter sends · Shift+Enter adds a new line",
    "Enviar mensagem": "Send message",
    "Configurar conversa": "Conversation settings",
    "Agente, modelo e raciocínio": "Agent, model and reasoning",
    "Fechar configuração": "Close settings",
    "Ditar mensagem": "Dictate message",
    "Comandos do agente": "Agent commands",
    "Ver todos os comandos deste agente": "View all commands for this agent",
    "Carregando…": "Loading…",
    "Respondendo…": "Responding…",
    "Atualizando modelo e raciocínio…": "Updating model and reasoning…",
    "Tentar novamente": "Try again",
    "Voltar às sessões": "Back to sessions",
    "Copiar": "Copy",
    "Copiado": "Copied",
    "Copiar código": "Copy code",
    "Uso e contexto": "Usage and context",
    "Ver detalhes": "View details",
    "Ver consumo da sessão, contexto e limites da conta": "View session usage, context and account limits",
    "Ver detalhes de uso e contexto": "View usage and context details",
    "Ocupação do contexto da sessão": "Session context usage",
    "O agente não informou a ocupação da janela de contexto": "The agent did not report context window usage",
    "Ocupação do contexto informada pelo agente": "Context usage reported by the agent",
    "Não informado": "Not reported",
    "Tipo de consumo": "Usage type",
    "Fechar detalhes do consumo": "Close usage details",
    "Sessão": "Session",
    "Conta": "Account",
    "Uso desta sessão": "Session usage",
    "Entrada acumulada": "Total input",
    "Saída acumulada": "Total output",
    "Leitura de cache": "Cache reads",
    "Escrita de cache": "Cache writes",
    "Custo reportado": "Reported cost",
    "Contexto usado": "Context used",
    "Janela do modelo": "Model context window",
    "Último turno · tokens": "Last turn · tokens",
    "Último turno · custo": "Last turn · cost",
    "Sobre /compact": "About /compact",
    "Abra a sessão para consultar consumo e contexto.": "Open the session to view usage and context.",
    "Esta orientação não executa comandos nem envia mensagens.": "This guidance does not run commands or send messages.",
    "Limites compartilhados pelas sessões desta conta. /compact não renova esses limites.": "Limits are shared across this account's sessions. /compact does not reset these limits.",
    "Consultando os limites da conta…": "Checking account limits…",
    "Atualizando limites…": "Updating limits…",
    "Semanal": "Weekly",
    "5 horas": "5 hours",
    "Leitura anterior": "Previous reading",
    "Consultando…": "Checking…",
    "Ver limites": "View limits",
    "Renovação não informada": "Reset time not reported",
    "Renova em {tempo} · {instante}": "Resets in {tempo} · {instante}",
    "Transcrição parcial": "Partial transcript",
    "Transcrição": "Transcript",
    "Concluir ditado": "Finish dictation",
    "Cancelar ditado": "Cancel dictation",
    "Parar gravação": "Stop recording",
    "Idioma do ditado": "Dictation language",
    "Estrutura de elementos": "Element tree",
    "Sistema de design": "Design system",
    "Cores": "Colors",
    "Tipografia": "Typography",
    "Espaçamentos": "Spacing",
    "Formas": "Shapes",
    "Sombras": "Shadows",
    "Propriedades do elemento": "Element properties",
    "Conversar com os agentes": "Chat with agents",
    "Abrir chat dos agentes": "Open agent chat",
    "Travar proporção largura/altura": "Lock width/height ratio",
    "Escolher cor do texto": "Choose text color",
    "Escolher fundo": "Choose background",
    "Escolher cor da borda": "Choose border color",
    "Enviando…": "Sending…",
    "Ditar comentário": "Dictate comment",
    "Chat: conversas por agente e modelo": "Chat: conversations by agent and model",
    "Abrir chat": "Open chat",
    "Você": "You",
    "O projeto também pode começar com uma conversa.": "Your project can also start with a conversation.",
    "Peça uma explicação, discuta uma mudança ou continue uma sessão existente.": "Ask for an explanation, discuss a change or continue an existing session.",
    "Não foi possível abrir esta sessão": "This session could not be opened",
    "Abrindo sessão…": "Opening session…",
    "Abrindo sessão de {agente}…": "Opening {agente} session…",
    "A sessão anterior e seus rascunhos foram preservados. Escolha outra sessão ou tente abrir esta novamente.": "Your previous session and drafts were preserved. Choose another session or try opening this one again.",
    "Fechar comandos": "Close commands",
    "Carregando comandos…": "Loading commands…",
    "Nenhum comando encontrado para essa busca.": "No commands found for this search.",
    "Avisos do Anotador em 80% e 95%. Consumo acumulado não representa o contexto atual.": "Annotator warnings at 80% and 95%. Total usage does not represent current context.",
    "Este agente ainda não informou o consumo. Valores ausentes não significam consumo zero.": "This agent has not reported usage yet. Missing values do not mean zero usage.",
    "Há espaço no contexto. Não há indicação de compactar pelo uso atual.": "There is room in the context. Current usage does not suggest compacting.",
    "Sem uma medida de contexto, não é possível avaliar se /compact é necessário.": "Without a context measurement, we cannot determine whether /compact is needed.",
    "Contexto medido na última entrada do agente; a próxima mensagem ainda não está incluída.": "Context measured at the agent's last input; the next message is not included yet.",
    "Contexto do último evento de uso informado pelo agente.": "Context from the last usage event reported by the agent.",
    "A sessão nativa ainda não foi identificada. Não execute /compact em outra conversa esperando alterar esta.": "The native session has not been identified yet. Running /compact in another conversation will not change this one.",
    "Preparando ditado…": "Preparing dictation…",
    "Controles do ditado": "Dictation controls",
    "Parar ditado e revisar": "Stop dictation and review",
    "Usar texto ditado": "Use dictated text",
    "Conta · {agente}": "Account · {agente}",
    "Consumo e limites · {agente}": "Usage and limits · {agente}",
    "Custo reportado: {valor}": "Reported cost: {valor}",
    "{valor} usado": "{valor} used",
    "Dados de {instante}": "Data from {instante}",
    "Consultado em {instante}": "Checked at {instante}",
    "Fonte: {origem}": "Source: {origem}",
    "Contexto próximo do limite. Considere /compact antes de continuar.": "Context is close to its limit. Consider /compact before continuing.",
    "O contexto está ficando cheio. Considere /compact se a conversa vai continuar.": "Context is filling up. Consider /compact if you will continue this conversation.",
    "Contexto próximo do limite. Verifique os recursos de compactação do agente antes de continuar.": "Context is close to its limit. Check the agent's compaction features before continuing.",
    "O contexto está ficando cheio. Verifique os recursos de compactação do agente se a conversa vai continuar.": "Context is filling up. Check the agent's compaction features if you will continue this conversation.",
    "Histórico disponível da sessão. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Available session history. Cache and reasoning are reported by the agent and are not added to the total again. The reported cost is not an invoice.",
    "Uso registrado neste chat; pode não incluir o histórico anterior. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Usage recorded in this chat; earlier history may be excluded. Cache and reasoning are reported by the agent and are not added to the total again. The reported cost is not an invoice.",
    "Cobertura parcial: o agente não informou todos os valores. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Partial coverage: the agent did not report all values. Cache and reasoning are reported by the agent and are not added to the total again. The reported cost is not an invoice."
  },
  "es": {
    "Selecionar": "Seleccionar",
    "Navegar": "Navegar",
    "Enviar": "Enviar",
    "Anotando": "Anotando",
    "Anotador": "Anotador",
    "Endereço da página": "Dirección de la página",
    "Endereço completo da página": "Dirección completa de la página",
    "Descartar todas as anotações pendentes": "Descartar todas las anotaciones pendientes",
    "Ver lotes enviados": "Ver lotes enviados",
    "Clique seleciona elementos (Alt+A alterna)": "Haz clic para seleccionar elementos (Alt+A alterna)",
    "Usar a página normalmente (Alt+A alterna)": "Usar la página normalmente (Alt+A alterna)",
    "Arrastar a barra (duplo clique recoloca)": "Arrastrar la barra (doble clic para restablecer)",
    "Estrutura de elementos: árvore para escolher o nível certo (Alt+R)": "Árbol de elementos: elige el nivel correcto (Alt+R)",
    "Sistema de design: o que a página pinta e o que o projeto declara (Alt+D)": "Sistema de diseño: página renderizada y definiciones del proyecto (Alt+D)",
    "Avaliar a página: régua objetiva e parecer do agente (Alt+E)": "Evaluar la página: comprobaciones y revisión del agente (Alt+E)",
    "Escolher agente e modelo": "Elegir agente y modelo",
    "Menu do anotador (abre em nova aba)": "Menú del anotador (se abre en una nueva pestaña)",
    "Abrir menu do anotador em nova aba": "Abrir el menú del anotador en una nueva pestaña",
    "Ocultar anotador (Alt+Shift+A)": "Ocultar anotador (Alt+Shift+A)",
    "Recarregar página preservando anotações": "Recargar la página y conservar las anotaciones",
    "Ver fila e lotes": "Ver cola y lotes",
    "Extrair design de um site": "Extraer el diseño de un sitio",
    "Quem recebe as anotações": "Quién recibe las anotaciones",
    "Carregando agentes…": "Cargando agentes…",
    "Trocar agente": "Cambiar agente",
    "Usar a configuração padrão do agente.": "Usar la configuración predeterminada del agente.",
    "Modelo": "Modelo",
    "Raciocínio": "Razonamiento",
    "Agente": "Agente",
    "Padrão": "Predeterminado",
    "Padrão do agente": "Predeterminado del agente",
    "Mínimo": "Mínimo",
    "Baixo": "Bajo",
    "Médio": "Medio",
    "Alto": "Alto",
    "Muito alto": "Muy alto",
    "Máximo": "Máximo",
    "Guardar": "Guardar",
    "Aplicar": "Aplicar",
    "Cancelar": "Cancelar",
    "Confirmar": "Confirmar",
    "Excluir": "Eliminar",
    "Fechar": "Cerrar",
    "Descreva essas alterações...": "Describe estos cambios...",
    "Adicionar um comentário...": "Añadir un comentario...",
    "Adicionar um comentário…": "Añadir un comentario…",
    "Arrastar o painel (duplo clique recoloca)": "Arrastrar el panel (doble clic para restablecer)",
    "Fechar painel": "Cerrar panel",
    "Texto": "Texto",
    "Cor do texto": "Color del texto",
    "Fundo": "Fondo",
    "Opacity": "Opacidad",
    "Opacidade": "Opacidad",
    "Fonte": "Fuente",
    "Tamanho da fonte": "Tamaño de fuente",
    "Peso da fonte": "Grosor de fuente",
    "Altura da linha": "Altura de línea",
    "Alinhamento": "Alineación",
    "Raio da borda": "Radio del borde",
    "Cor da borda": "Color del borde",
    "Largura da borda": "Ancho del borde",
    "Largura": "Ancho",
    "Altura": "Alto",
    "Preenchimento": "Relleno",
    "Margem": "Margen",
    "cima, direita, baixo, esquerda": "arriba, derecha, abajo, izquierda",
    "Localizar elemento na página": "Localizar elemento en la página",
    "melhor seletor encontrado": "mejor selector encontrado",
    "Tirar print da tela": "Tomar captura de pantalla",
    "Capturar o site e anexar a imagem a esta anotação": "Capturar el sitio y adjuntar la imagen a esta anotación",
    "Capturando…": "Capturando…",
    "Contexto da seleção": "Contexto de la selección",
    "Elementos da área": "Elementos del área",
    "Fechar seletor de cor": "Cerrar selector de color",
    "Saturação e brilho": "Saturación y brillo",
    "Setas esquerda e direita ajustam a saturação; acima e abaixo ajustam o brilho.": "Las flechas izquierda y derecha ajustan la saturación; arriba y abajo ajustan el brillo.",
    "Matiz": "Tono",
    "Opacidade da cor": "Opacidad del color",
    "Cor hexadecimal": "Color hexadecimal",
    "Vermelho": "Rojo",
    "Verde": "Verde",
    "Azul": "Azul",
    "Escolher {cor}": "Elegir {cor}",
    "Conversas": "Conversaciones",
    "Nova conversa": "Nueva conversación",
    "+ Nova": "+ Nueva",
    "Uso": "Uso",
    "Visualizar uso da conta": "Ver uso de la cuenta",
    "Visualizar uso da conta e renovação dos limites": "Ver uso de la cuenta y renovación de límites",
    "Ampliar ou reduzir chat": "Ampliar o reducir chat",
    "Ampliar chat": "Ampliar chat",
    "Fechar chat": "Cerrar chat",
    "Agente da conversa": "Agente de la conversación",
    "Modelo da conversa": "Modelo de la conversación",
    "Sessões de {agente}": "Sesiones de {agente}",
    "Histórico no agente": "Historial en el agente",
    "Carregando sessões…": "Cargando sesiones…",
    "Ainda não há conversas deste agente no projeto.": "Este agente aún no tiene conversaciones en el proyecto.",
    "Lista parcial das sessões localizadas neste projeto.": "Lista parcial de las sesiones encontradas en este proyecto.",
    "Mensagens da conversa": "Mensajes de la conversación",
    "Abra uma sessão para enviar mensagens": "Abre una sesión para enviar mensajes",
    "Converse sobre o projeto…": "Conversa sobre el proyecto…",
    "Mensagem para o agente": "Mensaje para el agente",
    "Enter envia · Shift+Enter quebra linha": "Enter envía · Shift+Enter añade una nueva línea",
    "Enviar mensagem": "Enviar mensaje",
    "Configurar conversa": "Configurar conversación",
    "Agente, modelo e raciocínio": "Agente, modelo y razonamiento",
    "Fechar configuração": "Cerrar configuración",
    "Ditar mensagem": "Dictar mensaje",
    "Comandos do agente": "Comandos del agente",
    "Ver todos os comandos deste agente": "Ver todos los comandos de este agente",
    "Carregando…": "Cargando…",
    "Respondendo…": "Respondiendo…",
    "Atualizando modelo e raciocínio…": "Actualizando modelo y razonamiento…",
    "Tentar novamente": "Volver a intentar",
    "Voltar às sessões": "Volver a las sesiones",
    "Copiar": "Copiar",
    "Copiado": "Copiado",
    "Copiar código": "Copiar código",
    "Uso e contexto": "Uso y contexto",
    "Ver detalhes": "Ver detalles",
    "Ver consumo da sessão, contexto e limites da conta": "Ver consumo de sesión, contexto y límites de cuenta",
    "Ver detalhes de uso e contexto": "Ver detalles de uso y contexto",
    "Ocupação do contexto da sessão": "Uso del contexto de la sesión",
    "O agente não informou a ocupação da janela de contexto": "El agente no informó el uso de la ventana de contexto",
    "Ocupação do contexto informada pelo agente": "Uso de contexto informado por el agente",
    "Não informado": "No informado",
    "Tipo de consumo": "Tipo de consumo",
    "Fechar detalhes do consumo": "Cerrar detalles de consumo",
    "Sessão": "Sesión",
    "Conta": "Cuenta",
    "Uso desta sessão": "Uso de esta sesión",
    "Entrada acumulada": "Entrada acumulada",
    "Saída acumulada": "Salida acumulada",
    "Leitura de cache": "Lecturas de caché",
    "Escrita de cache": "Escrituras de caché",
    "Custo reportado": "Coste informado",
    "Contexto usado": "Contexto utilizado",
    "Janela do modelo": "Ventana de contexto del modelo",
    "Último turno · tokens": "Último turno · tokens",
    "Último turno · custo": "Último turno · coste",
    "Sobre /compact": "Acerca de /compact",
    "Abra a sessão para consultar consumo e contexto.": "Abre la sesión para consultar consumo y contexto.",
    "Esta orientação não executa comandos nem envia mensagens.": "Esta orientación no ejecuta comandos ni envía mensajes.",
    "Limites compartilhados pelas sessões desta conta. /compact não renova esses limites.": "Las sesiones de esta cuenta comparten los límites. /compact no renueva estos límites.",
    "Consultando os limites da conta…": "Consultando los límites de la cuenta…",
    "Atualizando limites…": "Actualizando límites…",
    "Semanal": "Semanal",
    "5 horas": "5 horas",
    "Leitura anterior": "Lectura anterior",
    "Consultando…": "Consultando…",
    "Ver limites": "Ver límites",
    "Renovação não informada": "Renovación no informada",
    "Renova em {tempo} · {instante}": "Se renueva en {tempo} · {instante}",
    "Transcrição parcial": "Transcripción parcial",
    "Transcrição": "Transcripción",
    "Concluir ditado": "Finalizar dictado",
    "Cancelar ditado": "Cancelar dictado",
    "Parar gravação": "Detener grabación",
    "Idioma do ditado": "Idioma del dictado",
    "Estrutura de elementos": "Árbol de elementos",
    "Sistema de design": "Sistema de diseño",
    "Cores": "Colores",
    "Tipografia": "Tipografía",
    "Espaçamentos": "Espaciado",
    "Formas": "Formas",
    "Sombras": "Sombras",
    "Propriedades do elemento": "Propiedades del elemento",
    "Conversar com os agentes": "Conversar con los agentes",
    "Abrir chat dos agentes": "Abrir chat de agentes",
    "Travar proporção largura/altura": "Bloquear proporción ancho/alto",
    "Escolher cor do texto": "Elegir color del texto",
    "Escolher fundo": "Elegir fondo",
    "Escolher cor da borda": "Elegir color del borde",
    "Enviando…": "Enviando…",
    "Ditar comentário": "Dictar comentario",
    "Chat: conversas por agente e modelo": "Chat: conversaciones por agente y modelo",
    "Abrir chat": "Abrir chat",
    "Você": "Tú",
    "O projeto também pode começar com uma conversa.": "Tu proyecto también puede comenzar con una conversación.",
    "Peça uma explicação, discuta uma mudança ou continue uma sessão existente.": "Pide una explicación, comenta un cambio o continúa una sesión existente.",
    "Não foi possível abrir esta sessão": "No se pudo abrir esta sesión",
    "Abrindo sessão…": "Abriendo sesión…",
    "Abrindo sessão de {agente}…": "Abriendo sesión de {agente}…",
    "A sessão anterior e seus rascunhos foram preservados. Escolha outra sessão ou tente abrir esta novamente.": "Se conservaron tu sesión anterior y tus borradores. Elige otra sesión o intenta abrir esta de nuevo.",
    "Fechar comandos": "Cerrar comandos",
    "Carregando comandos…": "Cargando comandos…",
    "Nenhum comando encontrado para essa busca.": "No se encontraron comandos para esta búsqueda.",
    "Avisos do Anotador em 80% e 95%. Consumo acumulado não representa o contexto atual.": "Avisos del Anotador al80% y95%. El consumo acumulado no representa el contexto actual.",
    "Este agente ainda não informou o consumo. Valores ausentes não significam consumo zero.": "Este agente aún no ha informado el consumo. Los valores ausentes no significan consumo cero.",
    "Há espaço no contexto. Não há indicação de compactar pelo uso atual.": "Hay espacio en el contexto. El uso actual no indica que sea necesario compactar.",
    "Sem uma medida de contexto, não é possível avaliar se /compact é necessário.": "Sin una medida del contexto, no se puede evaluar si es necesario usar /compact.",
    "Contexto medido na última entrada do agente; a próxima mensagem ainda não está incluída.": "Contexto medido en la última entrada del agente; el siguiente mensaje aún no está incluido.",
    "Contexto do último evento de uso informado pelo agente.": "Contexto del último evento de uso informado por el agente.",
    "A sessão nativa ainda não foi identificada. Não execute /compact em outra conversa esperando alterar esta.": "La sesión nativa aún no se ha identificado. Ejecutar /compact en otra conversación no cambiará esta.",
    "Preparando ditado…": "Preparando dictado…",
    "Controles do ditado": "Controles de dictado",
    "Parar ditado e revisar": "Detener dictado y revisar",
    "Usar texto ditado": "Usar texto dictado",
    "Conta · {agente}": "Cuenta · {agente}",
    "Consumo e limites · {agente}": "Consumo y límites · {agente}",
    "Custo reportado: {valor}": "Coste informado: {valor}",
    "{valor} usado": "{valor} utilizado",
    "Dados de {instante}": "Datos de {instante}",
    "Consultado em {instante}": "Consultado el {instante}",
    "Fonte: {origem}": "Fuente: {origem}",
    "Contexto próximo do limite. Considere /compact antes de continuar.": "El contexto está cerca del límite. Considera /compact antes de continuar.",
    "O contexto está ficando cheio. Considere /compact se a conversa vai continuar.": "El contexto se está llenando. Considera /compact si vas a continuar la conversación.",
    "Contexto próximo do limite. Verifique os recursos de compactação do agente antes de continuar.": "El contexto está cerca del límite. Revisa las funciones de compactación del agente antes de continuar.",
    "O contexto está ficando cheio. Verifique os recursos de compactação do agente se a conversa vai continuar.": "El contexto se está llenando. Revisa las funciones de compactación del agente si vas a continuar la conversación.",
    "Histórico disponível da sessão. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Historial disponible de la sesión. El agente informa caché y razonamiento; no se suman otra vez al total. El coste informado no es una factura.",
    "Uso registrado neste chat; pode não incluir o histórico anterior. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Uso registrado en este chat; puede excluir el historial anterior. El agente informa caché y razonamiento; no se suman otra vez al total. El coste informado no es una factura.",
    "Cobertura parcial: o agente não informou todos os valores. Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Cobertura parcial: el agente no informó todos los valores. El agente informa caché y razonamiento; no se suman otra vez al total. El coste informado no es una factura."
  }
});
idiomasInterface?.registrar({
  en: {
    "O servidor não confirmou o pedido de avaliação.": "The server did not confirm the evaluation request.",
    "Conferindo agente…": "Checking agent…",
    "Não foi possível confirmar o agente que receberá o parecer.": "Could not confirm which agent will receive the review request.",
    "O agente foi alterado em outra aba. Confira o nome atualizado antes de pedir o parecer.": "The agent was changed in another tab. Check the updated name before requesting the review.",
    "A integração enviou uma opção incompatível com o agente instalado. Atualize o Anotador antes de tentar novamente.": "The integration sent an option incompatible with the installed agent. Update Annotator before trying again.",
    "O parecer ainda não chegou. Consulte novamente para verificar o retorno.": "The review has not arrived yet. Check again for a response.",
    "Não foi possível consultar o parecer: {erro}": "Could not check the review: {erro}",
    "o servidor demorou para responder": "the server took too long to respond",
    "O agente não concluiu a avaliação.": "The agent did not complete the evaluation.",
    "O agente encerrou a execução sem devolver um parecer.": "The agent finished running without returning a review.",
    "Preparando o dossiê da página…": "Preparing the page report…",
    "{agente} está avaliando a página…": "{agente} is evaluating the page…",
    "Pedido enviado. Aguardando o parecer de {agente}…": "Request sent. Waiting for {agente}’s review…",
    "Consultar novamente": "Check again",
    "Arrastar": "Drag",
    "Avaliação da página": "Page evaluation",
    "Abrir conversa da avaliação": "Open evaluation conversation",
    "Trocar agente": "Change agent",
    "Trocar agente e iniciar nova conversa": "Change agent and start a new conversation",
    "Nova conversa de avaliação": "New evaluation conversation",
    "Nova avaliação": "New evaluation",
    "Iniciar com {agente}": "Start with {agente}",
    "Foco da nova avaliação (opcional)": "Focus for the new evaluation (optional)",
    "Nenhum agente instalado está disponível para avaliar a página.": "No installed agent is available to evaluate the page.",
    "Acompanhar no chat": "Follow in chat",
    "Sessão {id}": "Session {id}",
    "Conversa {id}": "Conversation {id}",
    "Aguarde o envio atual antes de abrir a avaliação no chat.": "Wait for the current message to finish sending before opening the evaluation chat.",
    "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.": "Evaluation in progress. Follow the messages here and continue the conversation when it finishes.",
    "A execução terminou sem um parecer estruturado. As mensagens disponíveis foram preservadas.": "The run ended without a structured review. Available messages have been preserved.",
    "A execução foi interrompida. As mensagens disponíveis foram preservadas.": "The run was interrupted. Available messages have been preserved.",
    "{elementos} elementos medidos, {achados} achado": "{elementos} elements measured, {achados} finding",
    "{elementos} elementos medidos, {achados} achados": "{elementos} elements measured, {achados} findings",
    "{elementos} elementos, {achados} achado da régua e {norma} da norma": "{elementos} elements, {achados} automated finding and {norma} from standards",
    "{elementos} elementos, {achados} achados da régua e {norma} da norma": "{elementos} elements, {achados} automated findings and {norma} from standards",
    "medindo…": "measuring…",
    "Medir de novo": "Measure again",
    "Medido na página": "Page measurements",
    "Medido pela régua": "Automated checks",
    "Nada fora do lugar nas regras objetivas.": "No issues found by the automated checks.",
    "Parecer de {agente}": "Review by {agente}",
    "ou escreva a resposta…": "or type your answer…",
    "Sem apontamentos além do que já foi medido.": "No additional findings beyond the measurements.",
    "O que {agente} deve olhar com atenção? (opcional)": "What should {agente} focus on? (optional)",
    "Pedir de novo": "Request again",
    "Pedir parecer a {agente}": "Request a review from {agente}",
    "Pedido de parecer enviado a {agente}.": "Review request sent to {agente}."
  },
  es: {
    "O servidor não confirmou o pedido de avaliação.": "El servidor no confirmó la solicitud de evaluación.",
    "Conferindo agente…": "Comprobando agente…",
    "Não foi possível confirmar o agente que receberá o parecer.": "No se pudo confirmar qué agente recibirá la solicitud de revisión.",
    "O agente foi alterado em outra aba. Confira o nome atualizado antes de pedir o parecer.": "El agente cambió en otra pestaña. Comprueba el nombre actualizado antes de pedir la revisión.",
    "A integração enviou uma opção incompatível com o agente instalado. Atualize o Anotador antes de tentar novamente.": "La integración envió una opción incompatible con el agente instalado. Actualiza el Anotador antes de intentarlo de nuevo.",
    "O parecer ainda não chegou. Consulte novamente para verificar o retorno.": "La revisión aún no ha llegado. Vuelve a consultar para comprobar la respuesta.",
    "Não foi possível consultar o parecer: {erro}": "No se pudo consultar la revisión: {erro}",
    "o servidor demorou para responder": "el servidor tardó demasiado en responder",
    "O agente não concluiu a avaliação.": "El agente no completó la evaluación.",
    "O agente encerrou a execução sem devolver um parecer.": "El agente terminó la ejecución sin devolver una revisión.",
    "Preparando o dossiê da página…": "Preparando el informe de la página…",
    "{agente} está avaliando a página…": "{agente} está evaluando la página…",
    "Pedido enviado. Aguardando o parecer de {agente}…": "Solicitud enviada. Esperando la revisión de {agente}…",
    "Consultar novamente": "Volver a consultar",
    "Arrastar": "Arrastrar",
    "Avaliação da página": "Evaluación de la página",
    "Abrir conversa da avaliação": "Abrir conversación de la evaluación",
    "Trocar agente": "Cambiar agente",
    "Trocar agente e iniciar nova conversa": "Cambiar agente e iniciar una nueva conversación",
    "Nova conversa de avaliação": "Nueva conversación de evaluación",
    "Nova avaliação": "Nueva evaluación",
    "Iniciar com {agente}": "Iniciar con {agente}",
    "Foco da nova avaliação (opcional)": "Enfoque de la nueva evaluación (opcional)",
    "Nenhum agente instalado está disponível para avaliar a página.": "No hay ningún agente instalado disponible para evaluar la página.",
    "Acompanhar no chat": "Seguir en el chat",
    "Sessão {id}": "Sesión {id}",
    "Conversa {id}": "Conversación {id}",
    "Aguarde o envio atual antes de abrir a avaliação no chat.": "Espera a que se envíe el mensaje actual antes de abrir el chat de evaluación.",
    "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.": "Evaluación en curso. Sigue los mensajes aquí y continúa la conversación cuando termine.",
    "A execução terminou sem um parecer estruturado. As mensagens disponíveis foram preservadas.": "La ejecución terminó sin una revisión estructurada. Se conservaron los mensajes disponibles.",
    "A execução foi interrompida. As mensagens disponíveis foram preservadas.": "La ejecución se interrumpió. Se conservaron los mensajes disponibles.",
    "{elementos} elementos medidos, {achados} achado": "{elementos} elementos medidos, {achados} hallazgo",
    "{elementos} elementos medidos, {achados} achados": "{elementos} elementos medidos, {achados} hallazgos",
    "{elementos} elementos, {achados} achado da régua e {norma} da norma": "{elementos} elementos, {achados} hallazgo automático y {norma} de las normas",
    "{elementos} elementos, {achados} achados da régua e {norma} da norma": "{elementos} elementos, {achados} hallazgos automáticos y {norma} de las normas",
    "medindo…": "midiendo…",
    "Medir de novo": "Volver a medir",
    "Medido na página": "Mediciones de la página",
    "Medido pela régua": "Comprobaciones automáticas",
    "Nada fora do lugar nas regras objetivas.": "Las comprobaciones automáticas no detectaron problemas.",
    "Parecer de {agente}": "Revisión de {agente}",
    "ou escreva a resposta…": "o escribe tu respuesta…",
    "Sem apontamentos além do que já foi medido.": "No hay observaciones adicionales a las mediciones.",
    "O que {agente} deve olhar com atenção? (opcional)": "¿En qué debe centrarse {agente}? (opcional)",
    "Pedir de novo": "Solicitar de nuevo",
    "Pedir parecer a {agente}": "Solicitar una revisión a {agente}",
    "Pedido de parecer enviado a {agente}.": "Solicitud de revisión enviada a {agente}."
  }
});
idiomasInterface?.registrar({
  "en": {
    "Claude Code não está conectado neste servidor.": "Claude Code is not signed in on this server.",
    "O login do Claude Code neste servidor expirou.": "The Claude Code login on this server has expired.",
    "O login do Claude Code não autoriza a consulta dos limites.": "The Claude Code login does not allow access to account limits.",
    "Como conectar o Claude Code": "How to connect Claude Code",
    "No terminal do computador que executa o Anotador, faça login com:": "Sign in from a terminal on the computer running Anotador:",
    "Conclua a autorização no navegador e volte aqui para verificar os limites.": "Complete authorization in your browser, then return here to check the limits.",
    "Ajuda de conexão do Claude Code": "Claude Code sign-in help",
    "Conectar conta": "Connect account",
    "Verificar novamente": "Check again",
    "Verificando…": "Checking…",
    "Última tentativa: {instante}": "Last attempt: {instante}",
    "Limites da conta de {agente}": "{agente} account limits",
    "Este agente não informou os limites da conta.": "This agent has not reported account limits.",
    "Última leitura disponível.": "Last available reading.",
    "Os dados podem estar desatualizados.": "The data may be out of date.",
    "Horário de renovação atingido · {instante}": "Reset time reached · {instante}",
    "{valor} dias": "{valor} days",
    "{valor} horas": "{valor} hours",
    "{valor} minutos": "{valor} minutes",
    "{janela}: {valor} usado. {renovacao}": "{janela}: {valor} used. {renovacao}",
    "Uso da conta · {agente}. {descricao}": "Account usage · {agente}. {descricao}",
    "Uso da conta · {janela}": "Account usage · {janela}",
    "Visualizar uso da conta. {descricao}": "View account usage. {descricao}",
    "Claude · limites da conta": "Claude · account limits",
    "Codex · limites da conta": "Codex · account limits",
    "Não disponível": "Not available",
    "Não informada": "Not reported",
    "Aplicativos OAuth": "OAuth apps",
    "Rotinas": "Routines",
    "Janela de uso": "Usage window",
    "Limite principal": "Primary limit",
    "Limite adicional": "Additional limit",
    "Tokens: {valor}": "Tokens: {valor}",
    "Consulta do consumo: {instante}": "Usage checked at: {instante}",
    "Medição do contexto: {instante}": "Context measured at: {instante}",
    "Histórico disponível da sessão.": "Available session history.",
    "Uso registrado neste chat; pode não incluir o histórico anterior.": "Usage recorded in this chat; earlier history may not be included.",
    "Cobertura parcial: o agente não informou todos os valores.": "Partial coverage: the agent did not report every value.",
    "Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "Cache and reasoning are reported by the agent and are not added to the total again. The reported cost is not an invoice.",
    "Compactação · {agente}": "Compaction · {agente}",
    "Retome esta mesma sessão no {agente} e use /compact. A compactação resume o histórico e pode reduzir detalhes.": "Resume this same session in {agente} and use /compact. Compaction summarizes the history and may reduce detail.",
    "O suporte a /compact no {agente} não foi verificado. Consulte os recursos de contexto desse agente antes de usar o comando.": "Support for /compact in {agente} has not been verified. Check this agent's context features before using the command.",
    "Sessão nativa:": "Native session:",
    "Não foi possível confirmar os limites da conta deste agente.": "Could not confirm this agent's account limits.",
    "Os limites da conta estão indisponíveis agora.": "Account limits are currently unavailable.",
    "A consulta dos limites demorou demais.": "Checking the limits took too long.",
    "O provedor não retornou limites válidos para esta conta.": "The provider did not return valid limits for this account.",
    "O login do Claude não está disponível para consultar os limites desta conta.": "The Claude login is unavailable for checking this account's limits.",
    "O login do Claude expirou ou não permite consultar os limites. Conecte sua conta novamente no Claude.": "The Claude login has expired or cannot access limits. Sign in to Claude again.",
    "A conta do Claude não autorizou a consulta dos limites. O login precisa permitir a leitura do perfil.": "The Claude account did not allow access to limits. The login must allow profile access.",
    "O Claude limitou as consultas de uso. A atualização será tentada novamente em instantes.": "Claude limited usage queries. An update will be attempted again shortly.",
    "Não foi possível consultar os limites do Claude agora.": "Could not check Claude limits right now.",
    "A consulta dos limites do Claude demorou demais. Tente novamente em instantes.": "Checking Claude limits took too long. Try again shortly.",
    "Não foi possível atualizar os limites da conta agora.": "Could not update account limits right now.",
    "Este agente ainda não fornece uma consulta de limites de conta integrada ao anotador.": "This agent does not yet provide account limit queries through Anotador.",
    "O Codex encerrou a consulta sem informar os limites.": "Codex ended the query without reporting limits.",
    "A consulta dos limites do Codex demorou demais. Tente novamente em instantes.": "Checking Codex limits took too long. Try again shortly.",
    "O Codex não disponibilizou limites para este login. Use uma conta ChatGPT conectada ao Codex.": "Codex did not provide limits for this login. Use a ChatGPT account connected to Codex.",
    "O Codex CLI não está disponível para consultar os limites.": "Codex CLI is unavailable for checking limits.",
    "A consulta dos limites do Codex foi interrompida.": "The Codex limit query was interrupted."
  },
  "es": {
    "Claude Code não está conectado neste servidor.": "Claude Code no ha iniciado sesión en este servidor.",
    "O login do Claude Code neste servidor expirou.": "El inicio de sesión de Claude Code en este servidor ha caducado.",
    "O login do Claude Code não autoriza a consulta dos limites.": "El inicio de sesión de Claude Code no permite consultar los límites.",
    "Como conectar o Claude Code": "Cómo conectar Claude Code",
    "No terminal do computador que executa o Anotador, faça login com:": "Inicia sesión desde una terminal del equipo que ejecuta Anotador:",
    "Conclua a autorização no navegador e volte aqui para verificar os limites.": "Completa la autorización en el navegador y vuelve aquí para consultar los límites.",
    "Ajuda de conexão do Claude Code": "Ayuda para iniciar sesión en Claude Code",
    "Conectar conta": "Conectar cuenta",
    "Verificar novamente": "Volver a comprobar",
    "Verificando…": "Comprobando…",
    "Última tentativa: {instante}": "Último intento: {instante}",
    "Limites da conta de {agente}": "Límites de la cuenta de {agente}",
    "Este agente não informou os limites da conta.": "Este agente no ha informado los límites de la cuenta.",
    "Última leitura disponível.": "Última lectura disponible.",
    "Os dados podem estar desatualizados.": "Los datos pueden estar desactualizados.",
    "Horário de renovação atingido · {instante}": "Hora de renovación alcanzada · {instante}",
    "{valor} dias": "{valor} días",
    "{valor} horas": "{valor} horas",
    "{valor} minutos": "{valor} minutos",
    "{janela}: {valor} usado. {renovacao}": "{janela}: {valor} usado. {renovacao}",
    "Uso da conta · {agente}. {descricao}": "Uso de la cuenta · {agente}. {descricao}",
    "Uso da conta · {janela}": "Uso de la cuenta · {janela}",
    "Visualizar uso da conta. {descricao}": "Ver uso de la cuenta. {descricao}",
    "Claude · limites da conta": "Claude · límites de la cuenta",
    "Codex · limites da conta": "Codex · límites de la cuenta",
    "Não disponível": "No disponible",
    "Não informada": "No informada",
    "Aplicativos OAuth": "Aplicaciones OAuth",
    "Rotinas": "Rutinas",
    "Janela de uso": "Ventana de uso",
    "Limite principal": "Límite principal",
    "Limite adicional": "Límite adicional",
    "Tokens: {valor}": "Tokens: {valor}",
    "Consulta do consumo: {instante}": "Consumo consultado el: {instante}",
    "Medição do contexto: {instante}": "Contexto medido el: {instante}",
    "Histórico disponível da sessão.": "Historial disponible de la sesión.",
    "Uso registrado neste chat; pode não incluir o histórico anterior.": "Uso registrado en este chat; puede no incluir el historial anterior.",
    "Cobertura parcial: o agente não informou todos os valores.": "Cobertura parcial: el agente no informó todos los valores.",
    "Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.": "El agente informa la caché y el razonamiento; no se suman de nuevo al total. El coste informado no es una factura.",
    "Compactação · {agente}": "Compactación · {agente}",
    "Retome esta mesma sessão no {agente} e use /compact. A compactação resume o histórico e pode reduzir detalhes.": "Retoma esta misma sesión en {agente} y usa /compact. La compactación resume el historial y puede reducir detalles.",
    "O suporte a /compact no {agente} não foi verificado. Consulte os recursos de contexto desse agente antes de usar o comando.": "No se ha verificado la compatibilidad con /compact en {agente}. Consulta las funciones de contexto del agente antes de usar el comando.",
    "Sessão nativa:": "Sesión nativa:",
    "Não foi possível confirmar os limites da conta deste agente.": "No se pudieron confirmar los límites de la cuenta de este agente.",
    "Os limites da conta estão indisponíveis agora.": "Los límites de la cuenta no están disponibles ahora.",
    "A consulta dos limites demorou demais.": "La consulta de los límites tardó demasiado.",
    "O provedor não retornou limites válidos para esta conta.": "El proveedor no devolvió límites válidos para esta cuenta.",
    "O login do Claude não está disponível para consultar os limites desta conta.": "El inicio de sesión de Claude no está disponible para consultar los límites de esta cuenta.",
    "O login do Claude expirou ou não permite consultar os limites. Conecte sua conta novamente no Claude.": "El inicio de sesión de Claude ha caducado o no permite consultar los límites. Vuelve a iniciar sesión en Claude.",
    "A conta do Claude não autorizou a consulta dos limites. O login precisa permitir a leitura do perfil.": "La cuenta de Claude no autorizó la consulta de los límites. El inicio de sesión debe permitir leer el perfil.",
    "O Claude limitou as consultas de uso. A atualização será tentada novamente em instantes.": "Claude limitó las consultas de uso. Se intentará actualizar de nuevo en breve.",
    "Não foi possível consultar os limites do Claude agora.": "No se pudieron consultar los límites de Claude ahora.",
    "A consulta dos limites do Claude demorou demais. Tente novamente em instantes.": "La consulta de los límites de Claude tardó demasiado. Inténtalo de nuevo en breve.",
    "Não foi possível atualizar os limites da conta agora.": "No se pudieron actualizar los límites de la cuenta ahora.",
    "Este agente ainda não fornece uma consulta de limites de conta integrada ao anotador.": "Este agente aún no permite consultar los límites de la cuenta desde Anotador.",
    "O Codex encerrou a consulta sem informar os limites.": "Codex finalizó la consulta sin informar los límites.",
    "A consulta dos limites do Codex demorou demais. Tente novamente em instantes.": "La consulta de los límites de Codex tardó demasiado. Inténtalo de nuevo en breve.",
    "O Codex não disponibilizou limites para este login. Use uma conta ChatGPT conectada ao Codex.": "Codex no proporcionó límites para este inicio de sesión. Usa una cuenta de ChatGPT conectada a Codex.",
    "O Codex CLI não está disponível para consultar os limites.": "Codex CLI no está disponible para consultar los límites.",
    "A consulta dos limites do Codex foi interrompida.": "La consulta de los límites de Codex se interrumpió."
  }
});

idiomasInterface?.registrar({
  "en": {
    "Modelos Gemini": "Gemini models",
    "Modelos Claude e GPT": "Claude and GPT models",
    "O Antigravity CLI não está disponível para consultar os limites.": "Antigravity CLI is unavailable for checking limits.",
    "Não foi possível consultar os limites do Antigravity. Verifique o login no CLI.": "Could not check Antigravity limits. Check your CLI login.",
    "A consulta dos limites do Antigravity demorou demais. Tente novamente em instantes.": "Checking Antigravity limits took too long. Try again shortly.",
    "O Antigravity não informou limites válidos nesta consulta.": "Antigravity did not report valid limits for this query."
  },
  "es": {
    "Modelos Gemini": "Modelos Gemini",
    "Modelos Claude e GPT": "Modelos Claude y GPT",
    "O Antigravity CLI não está disponível para consultar os limites.": "Antigravity CLI no está disponible para consultar los límites.",
    "Não foi possível consultar os limites do Antigravity. Verifique o login no CLI.": "No se pudieron consultar los límites de Antigravity. Comprueba el inicio de sesión en el CLI.",
    "A consulta dos limites do Antigravity demorou demais. Tente novamente em instantes.": "La consulta de los límites de Antigravity tardó demasiado. Inténtalo de nuevo en breve.",
    "O Antigravity não informou limites válidos nesta consulta.": "Antigravity no informó límites válidos en esta consulta."
  }
});
const textosDaInterface = new Set<{ no: WeakRef<Node>; fonte: TextoInterface; atributo?: string }>();
let limpezaIdiomasAgendada = false;
function vincularTextoInterface(no: Node, fonte: TextoInterface, atributo?: string): void {
  textosDaInterface.add({ no: new WeakRef(no), fonte, atributo });
  if (textosDaInterface.size <= 512 || limpezaIdiomasAgendada) return;
  limpezaIdiomasAgendada = true;
  queueMicrotask(() => {
    limpezaIdiomasAgendada = false;
    for (const vinculo of textosDaInterface) if (!vinculo.no.deref()?.isConnected) textosDaInterface.delete(vinculo);
  });
}
function textoInterface(chaveInterface: string, parametros?: Record<string, string | number>): TextoInterface { return { chaveInterface, parametros }; }
function traduzirInterface(texto: string, parametros?: Record<string, string | number>): string {
  return idiomasInterface?.t(texto, parametros) ?? texto.replace(/\{(\w+)\}/g, (original, chave: string) => String(parametros?.[chave] ?? original));
}
function idiomaInterface(): string { return idiomasInterface?.idioma() ?? "pt-BR"; }
function eTextoInterface(valor: unknown): valor is TextoInterface { return !!valor && typeof valor === "object" && "chaveInterface" in valor; }
function atualizarTextosInterface(): void {
  for (const vinculo of textosDaInterface) {
    const no = vinculo.no.deref();
    if (!no?.isConnected) { textosDaInterface.delete(vinculo); continue; }
    const texto = traduzirInterface(vinculo.fonte.chaveInterface, vinculo.fonte.parametros);
    if (vinculo.atributo && no instanceof Element) no.setAttribute(vinculo.atributo, texto);
    else no.textContent = texto;
  }
  if (raiz) raiz.lang = idiomaInterface();
  raiz?.querySelectorAll("select").forEach(atualizarSeletorPersonalizado);
}
function definirTextoInterface(no: HTMLElement, chave: string, parametros?: Record<string, string | number>): void {
  const fonte = textoInterface(chave, parametros), texto = document.createTextNode(traduzirInterface(chave, parametros));
  no.replaceChildren(texto); vincularTextoInterface(texto, fonte);
}
// Vínculos explícitos: nenhuma varredura ou substituição do conteúdo da página,
// mensagens, códigos, URLs ou valores digitados pelo usuário.
idiomasInterface?.observar(atualizarTextosInterface);

type Filho = Node | TextoInterface | string | number | null | undefined | false | Filho[];
type Atributos = Record<string, TextoInterface | string | number | boolean | null | undefined | EventListener>;

function uuid(): string {
  if (window.crypto && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Atributos | null, ...filhos: Filho[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (eTextoInterface(v)) {
      el.setAttribute(k, traduzirInterface(v.chaveInterface, v.parametros));
      vincularTextoInterface(el, v, k);
    }
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k === "style") el.style.cssText = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  const anexar = (f: Filho): void => {
    if (f === null || f === undefined || f === false) return;
    if (Array.isArray(f)) {
      f.forEach(anexar);
      return;
    }
    if (eTextoInterface(f)) {
      const no = document.createTextNode(traduzirInterface(f.chaveInterface, f.parametros));
      vincularTextoInterface(no, f); el.append(no); return;
    }
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  };
  filhos.forEach(anexar);
  return el;
}

function estilizavel(el: Element | null): el is ElementoEstilizavel {
  const janela = el?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
  return !!el && !!janela && (el instanceof janela.HTMLElement || el instanceof janela.SVGElement);
}

function ignorar(n: Node): boolean {
  if (!host) return false;
  if (n === host || host.contains(n)) return true;
  const r = n.getRootNode();
  return r instanceof ShadowRoot && r.host === host;
}

function rgbParaHex(cor: string): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(cor);
  if (!m) return "#000000";
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

function hexParaRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return "rgb(" + [m[1], m[2], m[3]].map((x) => parseInt(x ?? "0", 16)).join(", ") + ")";
}

function px(v: string): string {
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

function estilosComputados(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const saida: Record<string, string> = {};
  for (const p of PROPRIEDADES_COMPUTADAS) saida[p] = cs.getPropertyValue(p);
  return saida;
}

function soTexto(el: Element): boolean {
  return Array.from(el.childNodes).every((n) => n.nodeType === 3);
}

function valorComputado(a: AnotacaoLocal, el: Element, propriedade: string): string {
  return a.elemento.computado[propriedade] ?? getComputedStyle(el).getPropertyValue(propriedade);
}

function valorAtual(a: AnotacaoLocal, el: Element, propriedade: string): string {
  return a.alteracoes.find((x) => x.propriedade === propriedade)?.depois ?? valorComputado(a, el, propriedade);
}

let temporizadorToast: ReturnType<typeof setTimeout> | null = null;
function avisar(msg: string, ms = 2600): void {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  if (temporizadorToast) clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => (ui.toast.hidden = true), ms);
}

// ---------- persistência local ----------
function dadosParaGuardar(preservarEdicao = false): DadosPersistidos {
  const dados: DadosPersistidos = {
    anotacoes: estado.anotacoes.map(serializarAnotacao),
    enviadas: estado.enviadas.map(serializarAnotacao),
    lotes: estado.lotes,
    armado: estado.armado,
  };
  if (preservarEdicao && estado.atual) {
    dados.rascunho = { ...serializarAnotacao(estado.atual), confirmada: estado.atual.confirmada, snapshotEdicao: estado.atual.snapshotEdicao };
    dados.painelAberto = !ui.painel.hidden;
  }
  if (preservarEdicao) {
    dados.idiomaDitado = idiomaDitado;
    dados.posicaoPagina = { x: scrollX, y: scrollY };
    try {
      const chat = localStorage.getItem("anotador-ui:chat:" + encodeURIComponent(CFG.nome) + ":" + location.pathname);
      if (chat && JSON.parse(chat)?.versao === 1) dados.chat = { nome: CFG.nome, estado: chat };
    } catch { /* a fila principal continua disponível sem rascunhos do chat */ }
    if (estado.conversa) dados.conversaRascunho = {
      loteId: estado.conversa.lote.id,
      texto: ui.conversa?.querySelector<HTMLTextAreaElement>(".entrada textarea")?.value ?? "",
      selecao: Array.from(estado.conversa.selecao, ([id, valores]) => [id, Array.from(valores)]),
    };
  }
  return dados;
}

function salvar(preservarEdicao = false): boolean {
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(dadosParaGuardar(preservarEdicao)));
    return true;
  } catch {
    /* sem armazenamento: a fila vive só em memória */
    return false;
  }
}

function serializarAnotacao(a: AnotacaoLocal): AnotacaoLocal {
  return {
    id: a.id,
    ordem: a.ordem,
    comentario: a.comentario,
    elemento: a.elemento,
    alteracoes: a.alteracoes,
    texto: a.texto,
    criadaEm: a.criadaEm,
    anexos: a.anexos,
    area: a.area,
    estilosOriginais: a.estilosOriginais,
    textoOriginal: a.textoOriginal,
    confirmada: true,
    enviadaEm: a.enviadaEm ?? null,
  };
}

function restaurar(): void {
  let dados: DadosPersistidos | null = null;
  try {
    dados = JSON.parse(localStorage.getItem(CHAVE_ARMAZENAMENTO) ?? "null") as DadosPersistidos | null;
  } catch {
    dados = null;
  }
  if (!dados) return;
  if (dados.posicaoPagina && Number.isFinite(dados.posicaoPagina.x) && Number.isFinite(dados.posicaoPagina.y)) {
    window.scrollTo(dados.posicaoPagina.x, dados.posicaoPagina.y);
  }
  estado.anotacoes = dados.anotacoes ?? [];
  estado.enviadas = dados.enviadas ?? [];
  estado.lotes = dados.lotes ?? [];
  if (typeof dados.armado === "boolean") estado.armado = dados.armado;
  for (const a of estado.anotacoes) {
    if (a.area) continue;
    const el = localizarPorSeletores(a.elemento.seletores, a.elemento.framePath, a.elemento.shadowPath);
    if (estilizavel(el)) {
      estado.elementos.set(a.id, el);
      quandoHidratado(el, () => reaplicar(a, el));
    }
  }
  for (const a of estado.enviadas) {
    if (a.area) continue;
    const el = localizarPorSeletores(a.elemento.seletores, a.elemento.framePath, a.elemento.shadowPath);
    if (estilizavel(el)) estado.elementos.set(a.id, el);
  }
  if (dados.rascunho) {
    const rascunho = dados.rascunho;
    const a = estado.anotacoes.find((a) => a.id === rascunho.id) ?? rascunho;
    const el = a.area ? null : estado.elementos.get(a.id) ?? localizarPorSeletores(a.elemento.seletores, a.elemento.framePath, a.elemento.shadowPath);
    if (a.area) {
      abrirEdicao(a);
      if (rascunho.snapshotEdicao) a.snapshotEdicao = rascunho.snapshotEdicao;
      if (dados.painelAberto) abrirPainel(a);
    } else if (estilizavel(el)) {
      estado.elementos.set(a.id, el);
      quandoHidratado(el, () => {
        reaplicar(a, el);
        abrirEdicao(a);
        if (rascunho.snapshotEdicao) a.snapshotEdicao = rascunho.snapshotEdicao;
        if (dados.painelAberto) abrirPainel(a);
      });
    }
  }
  const conversa = dados.conversaRascunho;
  const lote = conversa && estado.lotes.find((l) => l.id === conversa.loteId);
  if (lote && conversa) {
    restaurandoConversa = true;
    void abrirConversa(lote).then(() => {
      if (estado.conversa?.lote.id !== lote.id) return;
      estado.conversa.selecao = new Map((conversa.selecao ?? []).map(([id, valores]) => [id, new Set(valores)]));
      renderizarConversa();
      const campo = ui.conversa?.querySelector<HTMLTextAreaElement>(".entrada textarea");
      if (campo) {
        campo.value = conversa.texto;
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }).finally(() => { restaurandoConversa = false; });
  }
}

function recarregarPagina(): void {
  if (capturasEmAndamento.size) { avisar("Aguarde o print terminar de anexar antes de recarregar."); return; }
  if (estado.envioEmAndamento) {
    avisar("Aguarde o envio terminar para recarregar sem perder as anotações.");
    return;
  }
  if (!salvar(true)) {
    avisar("Não consegui guardar as anotações. A página foi mantida aberta.", 6000);
    return;
  }
  location.reload();
}

function temFibra(no: object): boolean {
  return Object.keys(no).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$"));
}

function reactPresente(): boolean {
  return temFibra(document) || temFibra(document.documentElement) || temFibra(document.body) || "__next_f" in window || !!document.getElementById("__next");
}

// Um `style` inline aplicado antes da hidratação vira "hydration mismatch" no console do React.
function quandoHidratado(el: Element, fn: () => void, limiteMs = 6000): void {
  if (!reactPresente() || temFibra(el)) {
    fn();
    return;
  }
  const inicio = Date.now();
  const temporizador = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(temporizador);
      return;
    }
    if (temFibra(el) || Date.now() - inicio > limiteMs) {
      clearInterval(temporizador);
      fn();
    }
  }, 80);
}

function reaplicar(a: AnotacaoLocal, el: ElementoEstilizavel): void {
  for (const alt of a.alteracoes) el.style.setProperty(alt.propriedade, alt.depois);
  if (a.texto && soTexto(el)) el.textContent = a.texto.depois;
}

// ---------- montagem ----------
function montar(): void {
  if (host) return;
  host = document.createElement("div");
  host.id = "__anotador_host";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const sombra = host.attachShadow({ mode: "open" });
  if ("adoptedStyleSheets" in sombra && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const folha = new CSSStyleSheet();
    folha.replaceSync(CSS_OVERLAY);
    sombra.adoptedStyleSheets = [folha];
  } else {
    sombra.append(h("style", { html: CSS_OVERLAY }));
  }
  raiz = h("div", { class: "an-raiz", lang: idiomaInterface() });
  sombra.append(raiz);
  document.documentElement.appendChild(host);

  // Mantém o gesto no documento superior inclusive sobre iframes; os controles vêm acima.
  ui.superficieSelecao = h("div", { "aria-hidden": "true", style: "position:fixed;inset:0;pointer-events:auto;cursor:crosshair;" });
  raiz.append(ui.superficieSelecao);
  ui.caixaHover = h("div", { class: "an-caixa" });
  ui.caixaSel = h("div", { class: "an-caixa selecao" });
  ui.dica = h("div", { class: "an-dica" });
  ui.camadaPins = h("div");
  ui.camadaRealces = h("div");
  ui.toast = h("div", { class: "an-toast", hidden: true });
  ui.caixaArea = h("div", { class: "an-area" }, h("span", { class: "n", hidden: true }));
  raiz.append(ui.caixaHover, ui.caixaSel, ui.caixaArea, ui.camadaRealces, ui.dica, ui.camadaPins);
  montarBarra(raiz);
  montarPainel(raiz);
  montarArvore(raiz);
  ui.fila = h("div", { class: "an-fila", hidden: true });
  raiz.append(ui.fila, ui.toast);

  restaurar();
  atualizarBarra();
  renderizarPins();
  aplicarModo();
  ligarEventosGlobais();
  vigiarRemocao();
  if (lerArvoreAberta()) abrirArvore(false);
  void acompanharLotes();
  void migrarAcessoDoNavegador();
  retomarDitadoPendente();
  window.__anotadorDebug = {
    pendentes: () => estado.anotacoes.map(serializarAnotacao),
    enviadas: () => estado.enviadas.map(serializarAnotacao),
    lotes: () => estado.lotes.map((l) => ({ ...l })),
    atual: () => (estado.atual ? serializarAnotacao(estado.atual) : null),
    armado: () => estado.armado,
    conversa: () => (estado.conversa ? { lote: estado.conversa.lote.id, mensagens: estado.conversa.mensagens.map((m) => ({ ...m })) } : null),
    abrirConversa: (id: string) => {
      const l = estado.lotes.find((x) => x.id === id);
      if (l) void abrirConversa(l);
      return !!l;
    },
    arvore: () => resumoArvore(),
    abrirArvore: () => abrirArvore(),
    auditar: () => auditarPagina(),
    auditarNorma: async () => {
      const base = auditarPagina();
      await completarComNorma(base);
      return base;
    },
    contexto: () => contextoDaPagina(),
  };
  window.__anotadorCarregado = true;
}

function vigiarRemocao(): void {
  const obs = new MutationObserver(() => {
    if (host && !host.isConnected) document.documentElement.appendChild(host);
  });
  obs.observe(document.documentElement, { childList: true });
}

// ---------- barra ----------
let fecharUrlDaBarra: (() => boolean) | null = null;

function montarUrlDaBarra(titulo: HTMLDivElement, raizUi: HTMLDivElement): void {
  const endereco = h("span", { class: "an-url-completa" }, location.href);
  const tooltip = h("div", { id: "an-endereco-completo", class: "an-tooltip-url", role: "tooltip", hidden: true },
    h("span", { class: "an-url-rotulo" }, textoInterface("Endereço da página")), endereco);
  raizUi.append(tooltip);
  titulo.tabIndex = 0;
  titulo.setAttribute("role", "group");
  titulo.setAttribute("aria-label", "Endereço completo da página");
  titulo.setAttribute("aria-describedby", tooltip.id);
  let sobreTitulo = false, sobreTooltip = false;
  let espera: ReturnType<typeof setTimeout> | null = null;
  let acompanhar: ReturnType<typeof setInterval> | null = null;
  const cancelarEspera = () => { if (espera) clearTimeout(espera); espera = null; };
  const posicionar = () => {
    if (tooltip.hidden) return;
    const r = titulo.getBoundingClientRect();
    if (!r.width || !r.height || raizUi.hidden || estado.arrastando) { fechar(); return; }
    tooltip.style.left = Math.max(12, Math.min(r.left, innerWidth - tooltip.offsetWidth - 12)) + "px";
    const abaixo = r.bottom + 12;
    tooltip.style.top = Math.max(12, Math.min(abaixo + tooltip.offsetHeight <= innerHeight - 12 ? abaixo : r.top - tooltip.offsetHeight - 12,
      innerHeight - tooltip.offsetHeight - 12)) + "px";
  };
  const atualizar = () => {
    if (endereco.textContent !== location.href) {
      endereco.textContent = location.href;
      const curta = titulo.querySelector(".url");
      if (curta) curta.textContent = "• " + location.host + location.pathname;
    }
    posicionar();
  };
  const fechar = (): boolean => {
    const estavaAberto = !tooltip.hidden || espera !== null;
    cancelarEspera();
    tooltip.hidden = true;
    if (acompanhar) clearInterval(acompanhar);
    acompanhar = null;
    return estavaAberto;
  };
  fecharUrlDaBarra = fechar;
  const abrir = () => {
    cancelarEspera();
    if (estado.arrastando || raizUi.hidden || !titulo.isConnected) return;
    tooltip.hidden = false;
    atualizar();
    if (!acompanhar) acompanhar = setInterval(atualizar, 200);
  };
  const sair = () => {
    cancelarEspera();
    espera = setTimeout(() => {
      espera = null;
      if (!sobreTitulo && !sobreTooltip && titulo.getRootNode() instanceof ShadowRoot && (titulo.getRootNode() as ShadowRoot).activeElement !== titulo) fechar();
    }, 160);
  };
  titulo.addEventListener("pointerenter", (evento) => {
    if (evento.pointerType === "touch") return;
    sobreTitulo = true; cancelarEspera(); espera = setTimeout(abrir, 220);
  });
  titulo.addEventListener("pointerleave", () => { sobreTitulo = false; sair(); });
  titulo.addEventListener("focus", abrir);
  titulo.addEventListener("blur", sair);
  titulo.addEventListener("pointerdown", fechar);
  tooltip.addEventListener("pointerenter", () => { sobreTooltip = true; cancelarEspera(); });
  tooltip.addEventListener("pointerleave", () => { sobreTooltip = false; sair(); });
  window.addEventListener("pointerdown", (evento) => {
    if (!evento.composedPath().includes(titulo) && !evento.composedPath().includes(tooltip)) fechar();
  }, true);
  window.addEventListener("resize", posicionar, { passive: true });
  window.addEventListener("pagehide", fechar);
  document.addEventListener("visibilitychange", () => { if (document.hidden) fechar(); });
}

function montarBarra(raizUi: HTMLDivElement): void {
  ui.btnLimpar = h("button", { class: "an-ico", title: textoInterface("Descartar todas as anotações pendentes"), html: ICONES.lixeira, onclick: limparFila });
  ui.contador = h("span", { class: "n" }, "0");
  ui.btnEnviar = h("button", { class: "an-enviar", title: "Enviar anotações para " + AGENTE, onclick: () => void enviar() }, textoInterface("Enviar"), ui.contador);
  ui.estado = h("button", {
    class: "an-estado",
    title: textoInterface("Ver lotes enviados"),
    onclick: () => {
      const alvo = estado.lotes.find(l => l.id === ui.estado.dataset.loteId) ?? estado.lotes.filter((l) => (l.perguntasAbertas ?? 0) > 0).pop() ?? estado.lotes.filter((l) => l.estado !== "processado").pop() ?? estado.lotes[estado.lotes.length - 1];
      if (alvo) void abrirConversa(alvo);
      else alternarFila(true);
    },
  });
  ui.modoSel = h("button", { class: "ativo", title: textoInterface("Clique seleciona elementos (Alt+A alterna)"), onclick: () => definirModo(true) }, textoInterface("Selecionar"));
  ui.modoNav = h("button", { title: textoInterface("Usar a página normalmente (Alt+A alterna)"), onclick: () => definirModo(false) }, textoInterface("Navegar"));
  ui.alcaBarra = h("button", { class: "an-alca", title: textoInterface("Arrastar a barra (duplo clique recoloca)"), html: ICONES.alca });
  ui.btnArvore = h("button", { class: "an-ico", title: textoInterface("Estrutura de elementos: árvore para escolher o nível certo (Alt+R)"), html: ICONES.arvore, onclick: () => alternarArvore() });
  ui.btnDesign = h("button", { class: "an-ico", title: textoInterface("Sistema de design: o que a página pinta e o que o projeto declara (Alt+D)"), html: ICONES.paleta, onclick: () => void alternarExplorador() });
  ui.btnAvaliar = h("button", { class: "an-ico", title: textoInterface("Avaliar a página: régua objetiva e parecer do agente (Alt+E)"), html: ICONES.lupa, onclick: () => void alternarAvaliacao() });
  ui.btnAgente = h(
    "button",
    { class: "an-agente-atual", title: `Recebendo as anotações: ${AGENTE}${MODELO ? " · " + MODELO : ""}. Clique para trocar de agente ou modelo`, "aria-label": textoInterface("Escolher agente e modelo"), "aria-expanded": "false", onclick: () => void alternarAgentes() },
    h("span", { class: "marca", html: CFG.marca })
  );
  const titulo = h("div", { class: "titulo" }, h("span", { class: "an-titulo-prefixo" }, textoInterface("Anotando")), h("span", { class: "url" }, "• " + location.host + location.pathname));
  ui.barra = h(
    "div",
    { class: "an-barra" },
    ui.alcaBarra,
    h("a", { class: "an-ico an-menu-principal", href: CFG.base + "/", target: "_blank", rel: "noopener", title: textoInterface("Menu do anotador (abre em nova aba)"), "aria-label": textoInterface("Abrir menu do anotador em nova aba"), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>' }),
    h("button", { class: "an-ico", title: textoInterface("Ocultar anotador (Alt+Shift+A)"), html: ICONES.fechar, onclick: desligar }),
    h("button", { type: "button", class: "an-ico an-recarregar", title: textoInterface("Recarregar página preservando anotações"), "aria-label": textoInterface("Recarregar página preservando anotações"), html: ICONES.recarregar, onclick: recarregarPagina }),
    ui.btnLimpar,
    h("span", { class: "an-sep" }),
    titulo,
    h("span", { class: "an-sep" }),
    h("button", { class: "an-ico", title: textoInterface("Ver fila e lotes"), html: ICONES.lista, onclick: () => alternarFila() }),
    ui.btnArvore,
    ui.btnDesign,
    h("a", { class: "an-ico an-extrair", href: CFG.base + "/extrair", target: "_blank", rel: "noopener", title: textoInterface("Extrair design de um site"), "aria-label": textoInterface("Extrair design de um site"), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg>' }),
    ui.btnAvaliar,
    ui.btnAgente,
    typeof botaoChat === "function" ? botaoChat() : null,
    h("div", { class: "an-modo" }, ui.modoSel, ui.modoNav),
    ui.btnEnviar,
    ui.estado
  );
  raizUi.append(ui.barra);
  montarUrlDaBarra(titulo, raizUi);
  tornarArrastavel(ui.barra, [ui.alcaBarra, titulo], "barra", {
    aoMover: () => {
      fecharUrlDaBarra?.();
      if (!ui.fila.hidden) posicionarFila();
      posicionarAgentes();
    },
  });
}

// ---------------------------------------------------------------------------
// TROCAR DE AGENTE SEM SAIR DA PÁGINA
// ---------------------------------------------------------------------------
//
// Quem está anotando quer saber quem vai receber o lote, e às vezes trocar antes de
// enviar. Isso morava só na página de conexão, que obriga a sair do app e perder a
// seleção. Aqui a barra mostra a marca de quem está na escuta e abre a lista.

interface AgenteNoOverlay {
  id: string;
  nome: string;
  instalado: boolean;
  ponte: boolean;
  marca: string;
  como: string;
  modelos?: ModeloNoOverlay[];
}

interface ModeloNoOverlay {
  valor: string;
  titulo: string;
  descricao?: string;
  esforcos: string[];
  esforcoPadrao?: string;
  padrao?: boolean;
}

interface EstadoAgentes {
  agentes: AgenteNoOverlay[];
  ponte: { agente: string; modelo?: string | null; esforco?: string | null } | null;
  ouvintes: Array<{ agente?: string; rotulo?: string }>;
}

/** A chave da sessão, quando a página foi aberta de outra máquina. */
let chaveDaVisita: string | null = null;
function chaveGuardada(): string | null {
  if (chaveDaVisita) return chaveDaVisita;
  try {
    return sessionStorage.getItem("anotador.chave") || localStorage.getItem("anotador-ui:chave");
  } catch {
    return null;
  }
}

async function migrarAcessoDoNavegador(): Promise<void> {
  const chave = chaveGuardada();
  if (!chave) return;
  try {
    const r = await pedirApi("/acesso/sessao", {});
    if (!r.ok) return;
    chaveDaVisita = null;
    sessionStorage.removeItem("anotador.chave");
    localStorage.removeItem("anotador-ui:chave");
  } catch { /* Uma falha temporária mantém o acesso anterior disponível. */ }
}

async function pedirApi(caminho: string, corpo?: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; dados: Record<string, unknown> }> {
  const chave = chaveGuardada();
  const cabecalhos: Record<string, string> = {};
  if (chave) cabecalhos["x-anotador-chave"] = chave;
  if (corpo !== undefined) cabecalhos["content-type"] = "application/json";
  const r = await fetch(CFG.base + caminho, corpo === undefined ? { cache: "no-store", headers: cabecalhos, signal } : { method: "POST", headers: cabecalhos, body: JSON.stringify(corpo), signal });
  let dados: Record<string, unknown> = {};
  try {
    dados = (await r.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  return { ok: r.ok, status: r.status, dados };
}

function fecharAgentes(): void {
  if (ui.menuAgentes) ui.menuAgentes.hidden = true;
  ui.btnAgente?.setAttribute("aria-expanded", "false");
}

async function alternarAgentes(): Promise<void> {
  if (!ui.menuAgentes) {
    ui.menuAgentes = h("div", { class: "an-agentes", hidden: true });
    raiz?.append(ui.menuAgentes);
    window.addEventListener("pointerdown", (e) => {
      if (!ui.menuAgentes || ui.menuAgentes.hidden) return;
      const caminho = e.composedPath();
      if (!caminho.includes(ui.menuAgentes) && !caminho.includes(ui.btnAgente) && !caminho.some((el) => el instanceof Element && el.classList.contains("an-seletor-popup"))) fecharAgentes();
    }, true);
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || ui.menuAgentes?.hidden || fecharSeletorAberto) return;
      fecharAgentes();
      ui.btnAgente.focus();
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    window.addEventListener("resize", posicionarAgentes, { passive: true });
  }
  if (!ui.menuAgentes.hidden) {
    fecharAgentes();
    return;
  }
  ui.menuAgentes.hidden = false;
  ui.btnAgente.setAttribute("aria-expanded", "true");
  ui.menuAgentes.replaceChildren(h("div", { class: "an-agentes-vazio" }, "procurando agentes nesta máquina…"));
  posicionarAgentes();
  try {
    const { ok, dados } = await pedirApi("/agentes");
    if (!ok) throw new Error(String(dados["erro"] ?? "Não foi possível carregar os agentes."));
    renderizarAgentes(dados as unknown as EstadoAgentes);
  } catch (erro) {
    ui.menuAgentes.replaceChildren(h("div", { class: "an-agentes-aviso" }, erro instanceof Error ? erro.message : "Não foi possível carregar os agentes."));
  }
}

function posicionarAgentes(): void {
  if (!ui.menuAgentes || ui.menuAgentes.hidden || !ui.btnAgente) return;
  const r = ui.btnAgente.getBoundingClientRect();
  ui.menuAgentes.style.left = Math.max(8, Math.min(r.left, innerWidth - ui.menuAgentes.offsetWidth - 8)) + "px";
  ui.menuAgentes.style.top = Math.max(8, Math.min(r.bottom + 8, innerHeight - ui.menuAgentes.offsetHeight - 8)) + "px";
}

function renderizarAgentes(estadoAgentes: EstadoAgentes): void {
  if (!ui.menuAgentes) return;
  const lista = Array.isArray(estadoAgentes.agentes) ? estadoAgentes.agentes : [];
  const ouvindo = (estadoAgentes.ouvintes ?? []).map((o) => (o.agente ?? "").toLowerCase());
  const ponte = estadoAgentes.ponte?.agente ?? null;

  const itens = lista.map((a) => {
    const escutando = ouvindo.some((o) => o.includes(a.id) || (a.id === "claude" && o.includes("claude")));
    const situacao = escutando
      ? "ouvindo agora, recebe o lote direto"
      : ponte === a.id
        ? "chamado por linha de comando a cada lote"
        : a.instalado
          ? a.ponte
            ? a.modelos?.length ? "instalado; clique para escolher o modelo" : "instalado; clique para passar os lotes a ele"
            : a.como
          : "não encontrado nesta máquina";
    const podeEscolher = a.instalado && a.ponte;
    const item = h(
      "button",
      {
        type: "button",
        class: "an-agente" + (escutando || ponte === a.id ? " ativo" : "") + (podeEscolher ? "" : " inerte"),
        title: a.como,
        disabled: !podeEscolher,
        onclick: () => a.modelos?.length ? mostrarModelos(a, estadoAgentes) : void escolherAgente(a),
      },
      h("span", { class: "marca", html: a.marca }),
      h("span", { class: "col" }, h("span", { class: "nome" }, a.nome), h("span", { class: "sit" }, situacao)),
      escutando ? h("span", { class: "selo-vivo" }, "ao vivo") : null
    );
    return item;
  });

  const desligar = ponte
    ? [h("button", { type: "button", class: "an-agente apagar", onclick: () => void escolherAgente(null) }, h("span", { class: "col" }, h("span", { class: "nome" }, "Não chamar ninguém"), h("span", { class: "sit" }, "os lotes ficam na fila até alguém ouvir")))]
    : [];
  ui.menuAgentes.replaceChildren(h("div", { class: "an-agentes-topo" }, textoInterface("Quem recebe as anotações")), ...itens, ...desligar);
  posicionarAgentes();
}

function mostrarModelos(a: AgenteNoOverlay, anterior: EstadoAgentes): void {
  if (!ui.menuAgentes) return;
  const modelos = a.modelos ?? [];
  const selecionado = anterior.ponte?.agente === a.id ? anterior.ponte : null;
  const modelo = h("select", { class: "an-modelo-select", "aria-label": textoInterface("Modelo") },
    h("option", { value: "" }, textoInterface("Padrão do agente")),
    ...modelos.map((m) => h("option", { value: m.valor }, m.titulo)));
  modelo.value = selecionado?.modelo ?? modelos.find((m) => m.padrao)?.valor ?? "";
  const esforco = h("select", { class: "an-esforco-select", "aria-label": textoInterface("Raciocínio") });
  const controleModelo = criarSeletorPersonalizado(modelo, "Modelo");
  const controleEsforco = criarSeletorPersonalizado(esforco, "Raciocínio");
  const descricao = h("div", { class: "an-agentes-aviso" });
  const ajustarEsforcos = () => {
    const m = modelos.find((m) => m.valor === modelo.value);
    esforco.replaceChildren(...(m?.esforcos ?? []).map((e) => h("option", { value: e }, ({ low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Muito alto", max: "Máximo" } as Record<string, string>)[e] ?? e)));
    if (!m?.esforcos.length) esforco.append(h("option", { value: "" }, "Padrão do modelo"));
    esforco.disabled = !m?.esforcos.length;
    const anteriorEsforco = selecionado?.modelo === modelo.value ? selecionado.esforco : null;
    esforco.value = anteriorEsforco && m?.esforcos.includes(anteriorEsforco) ? anteriorEsforco : m?.esforcoPadrao ?? m?.esforcos[0] ?? "";
    atualizarSeletorPersonalizado(esforco);
    descricao.textContent = m?.descricao ?? "Usar a configuração padrão do agente.";
  };
  modelo.addEventListener("change", ajustarEsforcos);
  ajustarEsforcos();
  const aplicar = h("button", { type: "button", class: "an-modelo-aplicar an-ok-pequeno" }, "Usar seleção");
  aplicar.addEventListener("click", () => {
    aplicar.disabled = true;
    void escolherAgente(a, modelo.value || null, esforco.value || null).finally(() => { aplicar.disabled = false; });
  });
  ui.menuAgentes.replaceChildren(
    h("button", { type: "button", class: "an-agente", onclick: () => renderizarAgentes(anterior) }, "← Agentes"),
    h("div", { class: "an-agentes-topo" }, a.nome),
    h("div", { class: "an-modelo-campo" }, textoInterface("Modelo"), h("div", { class: "an-campo an-campo-selecao" }, modelo, controleModelo)),
    descricao,
    h("div", { class: "an-modelo-campo" }, textoInterface("Raciocínio"), h("div", { class: "an-campo an-campo-selecao" }, esforco, controleEsforco)),
    h("div", { class: "an-modelo-acoes" }, aplicar)
  );
  controleModelo.focus();
  posicionarAgentes();
}

function atualizarAgenteAtual(a: AgenteNoOverlay | null, modelo: string | null, esforco: string | null): void {
  AGENTE = a?.nome ?? CFG.agente;
  MARCA_AGENTE = a?.marca ?? CFG.marca;
  const titulo = a?.modelos?.find((m) => m.valor === modelo)?.titulo ?? modelo;
  MODELO = titulo ? titulo + (esforco ? ` · ${esforco}` : "") : null;
  atualizarRotuloAgenteAtual();
}

async function sincronizarAgenteAtual(): Promise<void> {
  const anterior = AGENTE;
  const r = await pedirApi("/agente/atual", undefined, AbortSignal.timeout(8000));
  if (!r.ok || typeof r.dados.agente !== "string" || typeof r.dados.marca !== "string") throw new Error(traduzirInterface("Não foi possível confirmar o agente que receberá o parecer."));
  if (AGENTE !== anterior) return;
  AGENTE = r.dados.agente;
  MARCA_AGENTE = r.dados.marca;
  MODELO = typeof r.dados.modelo === "string" ? r.dados.modelo : null;
  atualizarRotuloAgenteAtual();
}

function atualizarRotuloAgenteAtual(): void {
  ui.btnAgente.title = `Recebendo as anotações: ${AGENTE}${MODELO ? " · " + MODELO : ""}. Clique para trocar de agente ou modelo`;
  ui.btnAgente.replaceChildren(h("span", { class: "marca", html: MARCA_AGENTE }));
  ui.btnAgente.setAttribute("aria-label", `Escolher agente e modelo: ${AGENTE}${MODELO ? " · " + MODELO : ""}`);
  ui.btnEnviar.title = "Enviar anotações para " + AGENTE;
  atualizarBarra();
}

async function escolherAgente(a: AgenteNoOverlay | null, modelo: string | null = null, esforco: string | null = null): Promise<void> {
  try {
  const r = await pedirApi("/agente/ponte", { agente: a ? a.id : null, modelo, esforco });
  if (r.status === 403) {
    conectarNavegador(() => escolherAgente(a, modelo, esforco));
    return;
  }
  if (!r.ok) {
    avisar(String(r.dados["erro"] ?? "não consegui trocar o agente"), 6000);
    return;
  }
  avisar(a ? `${a.nome} passa a receber os lotes` : "Nenhum agente será chamado automaticamente", 4000);
  atualizarAgenteAtual(a, modelo, esforco);
  fecharAgentes();
  } catch (erro) {
    avisar("Não foi possível salvar a seleção: " + (erro instanceof Error ? erro.message : String(erro)), 6000);
  }
}

/**
 * O link compartilhado conecta o navegador com cookie HttpOnly, válido entre abas.
 * Preserva a seleção para tentar novamente após abrir o link.
 */
function conectarNavegador(tentarNovamente: () => Promise<void>): void {
  if (!ui.menuAgentes) return;
  const confirmar = h("button", { type: "button", class: "an-ok-pequeno" }, "Já conectei · tentar novamente");
  confirmar.addEventListener("click", () => {
    confirmar.disabled = true;
    void tentarNovamente().finally(() => { confirmar.disabled = false; });
  });
  ui.menuAgentes.replaceChildren(
    h("div", { class: "an-agentes-topo" }, "Conectar este navegador"),
    h("div", { class: "an-agentes-aviso" }, "Abra o link de acesso compartilhado por quem iniciou o Anotador. O acesso fica salvo neste navegador e vale também para as outras abas."),
    h("div", { class: "an-modelo-acoes" }, confirmar)
  );
  posicionarAgentes();
  confirmar.focus();
}

// ---------- arrastar ----------
function chavePosicao(chave: string): string {
  return "anotador-ui:pos:" + chave;
}

function lerPosicao(chave: string): Posicao | null {
  try {
    const bruto = localStorage.getItem(chavePosicao(chave));
    if (!bruto) return null;
    const p = JSON.parse(bruto) as Partial<Posicao>;
    return typeof p.left === "number" && typeof p.top === "number" ? { left: p.left, top: p.top } : null;
  } catch {
    return null;
  }
}

function gravarPosicao(chave: string, pos: Posicao | null): void {
  try {
    if (pos) localStorage.setItem(chavePosicao(chave), JSON.stringify(pos));
    else localStorage.removeItem(chavePosicao(chave));
  } catch {
    /* sem armazenamento: a posição vale só nesta página */
  }
}

function limitar(el: HTMLElement, pos: Posicao): Posicao {
  return {
    left: Math.max(8, Math.min(pos.left, Math.max(8, innerWidth - el.offsetWidth - 8))),
    top: Math.max(8, Math.min(pos.top, Math.max(8, innerHeight - el.offsetHeight - 8))),
  };
}

function aplicarPosicao(el: HTMLElement, pos: Posicao): void {
  el.style.left = pos.left + "px";
  el.style.top = pos.top + "px";
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
}

function restaurarPosicao(el: HTMLElement, chave: string): void {
  const pos = lerPosicao(chave);
  if (pos) aplicarPosicao(el, limitar(el, pos));
}

function tornarArrastavel(el: HTMLElement, alcas: HTMLElement[], chave: string, opcoes: OpcoesArrasto = {}): void {
  restaurarPosicao(el, chave);
  for (const alca of alcas) {
    alca.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const origem = e.target as Element;
      if (!opcoes.arrastarTudo && !alca.classList.contains("an-alca") && origem.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      // Uma alça pode estar dentro de outro cabeçalho arrastável. Só quem
      // recebeu o gesto inicia a captura; o bubbling criava dois arrastos.
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const inicioX = e.clientX;
      const inicioY = e.clientY;
      let moveu = false;
      let terminou = false;
      estado.arrastando = true;
      raiz?.classList.add("arrastando");
      el.classList.add("arrastando");
      const mover = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        if (!(ev.buttons & 1)) { terminar(false); return; }
        if (!moveu && Math.hypot(ev.clientX - inicioX, ev.clientY - inicioY) < 4) return;
        moveu = true;
        aplicarPosicao(el, limitar(el, { left: ev.clientX - dx, top: ev.clientY - dy }));
        opcoes.aoMover?.();
      };
      const terminar = (clique: boolean) => {
        if (terminou) return;
        terminou = true;
        alca.removeEventListener("pointermove", mover);
        document.removeEventListener("pointerup", soltar, true);
        alca.removeEventListener("pointercancel", soltar);
        alca.removeEventListener("lostpointercapture", cancelar);
        window.removeEventListener("blur", cancelar);
        try {
          alca.releasePointerCapture(e.pointerId);
        } catch {
          /* já liberado */
        }
        estado.arrastando = false;
        raiz?.classList.remove("arrastando");
        el.classList.remove("arrastando");
        if (moveu) {
          const fim = el.getBoundingClientRect();
          gravarPosicao(chave, { left: fim.left, top: fim.top });
        } else if (clique) {
          opcoes.aoClique?.();
        }
      };
      const soltar = (ev: PointerEvent) => {
        if (ev.pointerId === e.pointerId) terminar(ev.type === "pointerup");
      };
      const cancelar = () => terminar(false);
      alca.addEventListener("pointermove", mover);
      document.addEventListener("pointerup", soltar, true);
      alca.addEventListener("pointercancel", soltar);
      alca.addEventListener("lostpointercapture", cancelar);
      window.addEventListener("blur", cancelar);
      try { alca.setPointerCapture(e.pointerId); } catch { terminar(false); }
    });
    if (!opcoes.arrastarTudo) {
      alca.addEventListener("dblclick", () => {
        gravarPosicao(chave, null);
        el.style.left = "";
        el.style.top = "";
        el.style.right = "";
        el.style.bottom = "";
        el.style.transform = "";
        opcoes.aoMover?.();
      });
    }
  }
}

function ajustarFlutuantes(): void {
  const flutuantes: Array<[HTMLElement | null, string]> = [
    [ui.barra, "barra"],
    [ui.painel, "painel"],
    [ui.religar, "religar"],
    [ui.conversa, "conversa"],
    [ui.arvore, "arvore"],
    [ui.design, "design"],
    [ui.avaliacao, "avaliacao"],
  ];
  for (const [el, chave] of flutuantes) {
    if (!el || el.hidden || !el.style.left) continue;
    const pos = limitar(el, { left: parseFloat(el.style.left), top: parseFloat(el.style.top) });
    aplicarPosicao(el, pos);
    gravarPosicao(chave, pos);
  }
  if (!ui.fila.hidden) posicionarFila();
}

function posicionarFila(): void {
  const r = ui.barra.getBoundingClientRect();
  const largura = Math.min(440, innerWidth - 24);
  ui.fila.style.width = largura + "px";
  ui.fila.style.left = Math.max(12, Math.min(r.left + r.width / 2 - largura / 2, innerWidth - largura - 12)) + "px";
  ui.fila.style.top = Math.min(r.bottom + 8, Math.max(8, innerHeight - 240)) + "px";
}

function atualizarBarra(): void {
  const n = estado.anotacoes.length;
  ui.contador.textContent = String(n);
  ui.btnEnviar.disabled = n === 0 || estado.envioEmAndamento !== null;
  ui.btnLimpar.disabled = n === 0 || estado.envioEmAndamento !== null;
  ui.modoSel.classList.toggle("ativo", estado.armado);
  ui.modoNav.classList.toggle("ativo", !estado.armado);
  const comPergunta = estado.lotes.filter((l) => (l.perguntasAbertas ?? 0) > 0).pop();
  const emAndamento = estado.lotes.filter((l) => l.estado === "em_andamento").pop();
  const aguardando = estado.lotes.find((l) => l.estado === "recebido" || l.estado === "desconhecido");
  const ultimo = estado.lotes[estado.lotes.length - 1];
  const falha = estado.lotes.filter(l => l.estado !== "processado" && l.execucao?.terminadoEm && l.execucao.codigo !== 0).pop();
  ui.estado.dataset.loteId = (comPergunta ?? emAndamento ?? falha ?? aguardando ?? ultimo)?.id ?? "";
  if (estado.envioEmAndamento) {
    ui.estado.className = "an-estado";
    ui.estado.textContent = "Enviando…";
  } else if (comPergunta) {
    ui.estado.className = "an-estado pergunta";
    ui.estado.textContent = traduzirInterface("Responder") + ((comPergunta.perguntasAbertas ?? 1) > 1 ? " (" + comPergunta.perguntasAbertas + ")" : "");
    ui.estado.title = `${AGENTE} precisa de uma resposta sua · clique para responder`;
  } else if (emAndamento) {
    ui.estado.className = "an-estado andamento";
    ui.estado.textContent = traduzirInterface("Em andamento");
    ui.estado.title = (emAndamento.nota || `${AGENTE} está trabalhando no lote`) + " · clique para ver os lotes";
  } else if (falha) {
    ui.estado.className = "an-estado erro";
    ui.estado.textContent = traduzirInterface("Falha no agente");
    ui.estado.title = (falha.execucao?.erro || traduzirInterface("A execução falhou. Abra o lote para ver os detalhes."));
  } else if (aguardando) {
    ui.estado.className = "an-estado";
    ui.estado.textContent = traduzirInterface("Aguardando");
    ui.estado.title = `O lote chegou e espera ${AGENTE} começar · clique para ver os lotes`;
  } else if (ultimo) {
    ui.estado.className = "an-estado ok";
    ui.estado.textContent = traduzirInterface("Concluído");
    ui.estado.title = (ultimo.nota ?? "") + " · clique para ver os lotes";
  } else {
    ui.estado.textContent = "";
  }
  ui.estado.setAttribute("aria-label", ui.estado.title || ui.estado.textContent || "Status dos lotes");
  atualizarReligar();
  agendarReposicao();
}

function resumir(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function definirModo(armado: boolean): void {
  estado.armado = armado;
  aplicarModo();
  atualizarBarra();
  salvar();
}

function aplicarModo(): void {
  ui.superficieSelecao.hidden = !estado.armado;
  document.documentElement.style.cursor = estado.armado && raiz && !raiz.hidden ? "crosshair" : "";
  if (!estado.armado) {
    ui.caixaHover.style.display = "none";
    ui.dica.style.display = "none";
  }
}

function desligar(): void {
  pararDitado();
  if (typeof pausarAcompanhamentoChat === "function") pausarAcompanhamentoChat();
  if (!raiz) return;
  try {
    sessionStorage.setItem(CHAVE_DESLIGADO, "1");
  } catch {
    /* sem armazenamento */
  }
  if (estado.atual) cancelarEdicao();
  raiz.hidden = true;
  document.documentElement.style.cursor = "";
  if (ui.religar) return;
  ui.religar = h(
    "div",
    { class: "an-religar", title: "Reabrir anotador (Alt+Shift+A) · arraste para mover" },
    h("span", { class: "an-alca", html: ICONES.alca }),
    h("span", { class: "an-religar-ico", html: ICONES.sliders }),
    h("span", { class: "rotulo" }, textoInterface("Anotador")),
    h("span", { class: "n", hidden: true }, "0")
  );
  raiz.parentNode?.append(ui.religar);
  tornarArrastavel(ui.religar, [ui.religar], "religar", { arrastarTudo: true, aoClique: religar });
  atualizarReligar();
}

function atualizarReligar(): void {
  if (!ui.religar) return;
  const n = estado.anotacoes.length;
  const contador = ui.religar.querySelector<HTMLSpanElement>(".n");
  if (contador) {
    contador.textContent = String(n);
    contador.hidden = n === 0;
  }
  const aberto = estado.lotes.filter((l) => l.estado !== "processado").pop();
  const perguntas = estado.lotes.reduce((s, l) => s + (l.perguntasAbertas ?? 0), 0);
  ui.religar.classList.toggle("aguardando", !!aberto);
  ui.religar.classList.toggle("pergunta", perguntas > 0);
  if (contador && perguntas > 0) {
    contador.textContent = "?";
    contador.hidden = false;
  }
  const situacao = perguntas > 0 ? `${AGENTE} perguntou — abra para responder. ` : aberto ? (aberto.estado === "em_andamento" ? `${AGENTE}: ${aberto.nota || "trabalhando"}. ` : `Lote aguardando ${AGENTE}. `) : n ? `${n} anotação(ões) na fila. ` : "";
  ui.religar.title = situacao + "Reabrir anotador (Alt+Shift+A). Arraste para mover.";
}

function religar(): void {
  if (!raiz) return;
  try {
    sessionStorage.removeItem(CHAVE_DESLIGADO);
  } catch {
    /* sem armazenamento */
  }
  ui.religar?.remove();
  ui.religar = null;
  raiz.hidden = false;
  aplicarModo();
  renderizarPins();
  if (typeof retomarAcompanhamentoChat === "function") retomarAcompanhamentoChat();
}

// ---------- eventos globais ----------
function ligarEventosGlobais(): void {
  document.addEventListener("mousemove", aoMover, true);
  for (const tipo of ["pointerdown", "mousedown", "mouseup", "pointerup", "pointercancel", "click", "auxclick", "dblclick"]) {
    document.addEventListener(tipo, interceptar as EventListener, true);
  }
  document.addEventListener("pointermove", aoMoverPonteiro, true);
  document.addEventListener("keydown", aoTeclar, true);
  window.addEventListener("scroll", agendarReposicao, { passive: true, capture: true });
  window.addEventListener("resize", agendarReposicao, { passive: true });
}

function dentroDoOverlay(e: Event): boolean {
  const alvo = (e.composedPath()[0] ?? e.target) as Node | null;
  if (alvo === ui.superficieSelecao) return false;
  return !!alvo && ignorar(alvo);
}

function aoMover(e: MouseEvent): void {
  if (estado.arrastando || estado.gestoArea?.ativo) return;
  if (!raiz || !estado.armado || raiz.hidden || dentroDoOverlay(e)) {
    if (estado.hoverEl) {
      estado.hoverEl = null;
      // Sobre a árvore, a caixa passa a mostrar o nó apontado na lista.
      if (!dentroDe(e, ui.arvoreCorpo)) ui.caixaHover.style.display = "none";
      ui.dica.style.display = "none";
    }
    return;
  }
  const alvo = elementoProfundoNoPonto(e.clientX, e.clientY, ignorar);
  let el = alvo.el;
  if (el && !e.altKey) el = encaixarNoInterativo(el);
  estado.hoverEl = el;
  destacar(ui.caixaHover, el);
  if (el) agendarFocoArvore(el);
  if (el && !ui.balao) {
    ui.dica.textContent = alvo.crossOrigin ? "iframe cross-origin — captura indisponível" : descrever(el) + (e.altKey ? "  (exato)" : "");
    const r = rectTopo(el);
    ui.dica.style.left = Math.max(0, Math.min(r.left, innerWidth - 320)) + "px";
    ui.dica.style.top = (r.top > 28 ? r.top - 26 : r.top + r.height + 6) + "px";
    ui.dica.style.display = "block";
  } else {
    ui.dica.style.display = "none";
  }
}

function destacar(caixa: HTMLDivElement, el: Element | null): void {
  if (!el) {
    caixa.style.display = "none";
    return;
  }
  const r = rectTopo(el);
  caixa.style.left = r.left + "px";
  caixa.style.top = r.top + "px";
  caixa.style.width = r.width + "px";
  caixa.style.height = r.height + "px";
  caixa.style.display = "block";
}

function interceptar(e: MouseEvent): void {
  // O fim do gesto de área vale mesmo sobre o overlay (o cursor pode soltar em cima de um painel).
  if (estado.gestoArea && (e.type === "pointerup" || e.type === "pointercancel")) concluirGestoArea(e as PointerEvent, e.type === "pointercancel");
  if (!raiz || !estado.armado || raiz.hidden || dentroDoOverlay(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "pointerdown") {
    const pe = e as PointerEvent;
    if (pe.button === 0 && pe.isPrimary) iniciarGestoArea(pe);
    return;
  }
  if (e.type !== "click") return;
  if (Date.now() < suprimirCliqueAte) {
    suprimirCliqueAte = 0;
    return;
  }
  const alvo = elementoProfundoNoPonto(e.clientX, e.clientY, ignorar);
  if (!alvo.el) return;
  const el = e.altKey ? alvo.el : encaixarNoInterativo(alvo.el);
  if (!estilizavel(el)) return;
  iniciarAnotacao(el, alvo);
}

function aoTeclar(e: KeyboardEvent): void {
  const soAlt = e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
  if (soAlt && e.key.toLowerCase() === "r" && raiz && !raiz.hidden) {
    e.preventDefault();
    alternarArvore();
    return;
  }
  if (soAlt && e.key.toLowerCase() === "d" && raiz && !raiz.hidden) {
    e.preventDefault();
    void alternarExplorador();
    return;
  }
  if (soAlt && e.key.toLowerCase() === "e" && raiz && !raiz.hidden) {
    e.preventDefault();
    void alternarAvaliacao();
    return;
  }
  if (soAlt && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && raiz && !raiz.hidden && estado.armado) {
    e.preventDefault();
    e.stopImmediatePropagation();
    navegarHierarquia(e.key);
    return;
  }
  if (dentroDoOverlay(e) && e.key !== "Escape") return;
  if (e.altKey && e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    if (raiz?.hidden) religar();
    else desligar();
    return;
  }
  if (e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    definirModo(!estado.armado);
    avisar(estado.armado ? "Modo Selecionar" : "Modo Navegar");
    return;
  }
  if (e.key === "Escape") {
    const voz = e.composedPath().find((no): no is HTMLElement => no instanceof HTMLElement && no.classList.contains("an-voz-controles"));
    if (voz) {
      e.preventDefault();
      e.stopImmediatePropagation();
      voz.querySelector<HTMLButtonElement>(".an-voz-cancelar")?.click();
      return;
    }
    if (fecharUrlDaBarra?.()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (typeof chatUI !== "undefined" && chatUI.painel && !chatUI.painel.hidden && dentroDe(e, chatUI.painel)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const comandos = chatUI.painel.querySelector<HTMLElement>(".an-chat-comandos:not([hidden])");
      if (comandos) { comandos.hidden = true; return; }
      if (typeof fecharConfiguracaoChat === "function" && fecharConfiguracaoChat()) return;
      fecharChat();
      return;
    }
    if (!ui.fila.hidden) {
      ui.fila.hidden = true;
      return;
    }
    if (estado.conversa && dentroDe(e, ui.conversa)) {
      fecharConversa();
      return;
    }
    if (estado.atual) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelarEdicao();
      return;
    }
    if (estado.arvore.area) {
      limparArea();
      return;
    }
    if (avaliacao.aberto && dentroDe(e, ui.avaliacao)) {
      fecharAvaliacao();
      return;
    }
    if (design.aberto && dentroDe(e, ui.design)) {
      fecharExplorador();
      return;
    }
    if (estado.arvore.aberta && dentroDe(e, ui.arvore)) fecharArvore();
  }
}

let reposicaoAgendada = false;
function agendarReposicao(): void {
  if (reposicaoAgendada) return;
  reposicaoAgendada = true;
  requestAnimationFrame(() => {
    reposicaoAgendada = false;
    ajustarFlutuantes();
    renderizarPins();
    if (estado.arvore.area || estado.gestoArea?.ativo) redesenharAreaAtual();
    if (estado.atual) {
      destacarAnotacao(estado.atual);
    }
  });
}

// ---------- anotações ----------
function proximaOrdem(): number {
  return estado.anotacoes.concat(estado.enviadas).reduce((m, a) => Math.max(m, a.ordem), 0) + 1;
}

function iniciarAnotacao(el: ElementoEstilizavel, alvo: AlvoNoPonto): void {
  if (estado.atual && !estado.atual.confirmada) cancelarEdicao();
  const existente = estado.anotacoes.find((a) => estado.elementos.get(a.id) === el);
  if (existente) {
    abrirEdicao(existente);
    return;
  }
  const a: AnotacaoLocal = {
    id: uuid(),
    ordem: proximaOrdem(),
    comentario: "",
    elemento: {
      seletores: construirSeletores(el, alvo.doc),
      meta: metadados(el),
      framePath: alvo.framePath,
      shadowPath: caminhoShadow(el),
      rect: rectTopo(el),
      computado: estilosComputados(el),
      contextoVisual: capturarContextoVisual(el),
    },
    alteracoes: [],
    texto: null,
    criadaEm: new Date().toISOString(),
    estilosOriginais: el.getAttribute("style") ?? "",
    textoOriginal: soTexto(el) ? el.textContent : null,
    confirmada: false,
  };
  if (alvo.el && alvo.el !== el) a.elemento.interno = { seletores: construirSeletores(alvo.el, alvo.doc), meta: metadados(alvo.el) };
  estado.elementos.set(a.id, el);
  estado.exato = alvo.el;
  abrirEdicao(a);
}

function abrirEdicao(a: AnotacaoLocal): void {
  if (estado.envioEmAndamento?.has(a.id)) {
    avisar("Aguarde o envio desta anotação terminar.");
    return;
  }
  estado.atual = a;
  const el = estado.elementos.get(a.id) ?? null;
  a.snapshotEdicao = {
    alteracoes: a.alteracoes.map((x) => ({ ...x })),
    texto: a.texto ? { ...a.texto } : null,
    comentario: a.comentario,
    style: el?.getAttribute("style") ?? "",
    anexos: a.anexos?.slice(),
  };
  destacarAnotacao(a);
  renderizarPins();
  abrirBalao(a);
  // Ação direta do usuário: renderiza já, sem esperar o debounce do MutationObserver.
  if (estado.arvore.aberta) renderizarArvore();
}

function cancelarEdicao(): void {
  const a = estado.atual;
  if (!a) return;
  capturasEmAndamento.get(a.id)?.abort();
  if (a.confirmada && a.snapshotEdicao) a.anexos = a.snapshotEdicao.anexos?.slice();
  const el = estado.elementos.get(a.id) ?? null;
  if (!a.confirmada) {
    reverterElemento(a, el);
    estado.elementos.delete(a.id);
  } else if (a.snapshotEdicao) {
    if (el) {
      el.style.cssText = a.snapshotEdicao.style;
      if (soTexto(el)) el.textContent = a.snapshotEdicao.texto ? a.snapshotEdicao.texto.depois : (a.textoOriginal ?? el.textContent);
    }
    a.alteracoes = a.snapshotEdicao.alteracoes;
    a.texto = a.snapshotEdicao.texto;
    a.comentario = a.snapshotEdicao.comentario;
  }
  fecharEdicao();
}

function reverterElemento(a: AnotacaoLocal, el: ElementoEstilizavel | null): void {
  if (!el) return;
  el.style.cssText = a.estilosOriginais;
  if (a.textoOriginal !== null && soTexto(el)) el.textContent = a.textoOriginal;
}

function fecharEdicao(): void {
  estado.atual = null;
  estado.exato = null;
  ui.caixaSel.style.display = "none";
  ui.painel.hidden = true;
  ui.balao?.remove();
  ui.balao = null;
  ui.entradaBalao = null;
  pararDitado();
  renderizarPins();
  atualizarBarra();
  salvar();
  if (estado.arvore.aberta) renderizarArvore();
}

function confirmarEdicao(): void {
  const a = estado.atual;
  if (!a) return;
  if (capturasEmAndamento.has(a.id)) { avisar("Aguarde o print terminar de anexar."); return; }
  a.comentario = a.comentario.trim();
  if (!a.comentario && a.alteracoes.length === 0 && !a.texto && !a.anexos?.length) {
    avisar("Escreva um comentário, altere uma propriedade ou anexe um print.");
    return;
  }
  if (!a.confirmada) {
    a.confirmada = true;
    estado.anotacoes.push(a);
  }
  delete a.snapshotEdicao;
  fecharEdicao();
  avisar("Anotação " + a.ordem + " na fila.");
}

function excluirAnotacao(a: AnotacaoLocal): void {
  if (estado.envioEmAndamento?.has(a.id)) {
    avisar("Aguarde o envio desta anotação terminar.");
    return;
  }
  capturasEmAndamento.get(a.id)?.abort();
  reverterElemento(a, estado.elementos.get(a.id) ?? null);
  estado.anotacoes = estado.anotacoes.filter((x) => x !== a);
  estado.elementos.delete(a.id);
  if (estado.atual === a) {
    estado.atual = null;
    fecharEdicao();
  } else {
    renderizarPins();
    atualizarBarra();
    salvar();
  }
}

function limparFila(): void {
  if (estado.anotacoes.length === 0 || estado.envioEmAndamento) return;
  if (!confirm("Descartar " + estado.anotacoes.length + " anotação(ões) pendente(s) e reverter as alterações?")) return;
  for (const a of estado.anotacoes.slice()) excluirAnotacao(a);
  avisar("Fila limpa.");
}

// ---------- pins e balão ----------
function renderizarPins(): void {
  ui.camadaPins.textContent = "";
  const todas: Array<{ a: AnotacaoLocal; enviada: boolean; rascunho: boolean }> = [
    ...estado.enviadas.map((a) => ({ a, enviada: true, rascunho: false })),
    ...estado.anotacoes.map((a) => ({ a, enviada: false, rascunho: false })),
  ];
  if (estado.atual && !estado.atual.confirmada) todas.push({ a: estado.atual, enviada: false, rascunho: true });
  for (const { a, enviada, rascunho } of todas) {
    let el = estado.elementos.get(a.id) ?? null;
    if (!a.area && (!el || !elementoNoContexto(el, a.elemento.framePath, a.elemento.shadowPath))) {
      const novo = localizarPorSeletores(a.elemento.seletores, a.elemento.framePath, a.elemento.shadowPath);
      el = estilizavel(novo) ? novo : null;
      if (el) {
        estado.elementos.set(a.id, el);
        if (!enviada) reaplicar(a, el);
      } else estado.elementos.delete(a.id);
    }
    const r = rectAnotacao(a);
    const pin = h(
      "button",
      {
        class: "an-pin" + (enviada ? " enviado" : "") + (!el && !a.area ? " perdido" : ""),
        title: (a.comentario || "(sem comentário)") + (el || a.area ? "" : " — elemento não localizado nesta versão da página"),
        style: "left:" + r.left + "px;top:" + r.top + "px;" + (rascunho ? "opacity:.75" : ""),
        onclick: (e: Event) => {
          e.stopPropagation();
          if (enviada) {
            avisar("Anotação " + a.ordem + " já enviada" + (a.comentario ? ": " + a.comentario : "."));
            return;
          }
          if (estado.atual === a) return;
          if (estado.atual) cancelarEdicao();
          abrirEdicao(a);
        },
      },
      String(a.ordem)
    );
    ui.camadaPins.append(pin);
  }
  if (ui.balao && estado.atual) posicionarBalao(estado.atual);
}

function abrirBalao(a: AnotacaoLocal): void {
  ui.balao?.remove();
  const entrada = h("input", {
    type: "text",
    placeholder: textoInterface("Adicionar um comentário..."),
    value: a.comentario,
    oninput: (e: Event) => {
      a.comentario = (e.target as HTMLInputElement).value;
      if (ui.comentarioPainel.value !== a.comentario) ui.comentarioPainel.value = a.comentario;
    },
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        confirmarEdicao();
      }
    },
  });
  const btnMic = h("button", { class: "an-ico an-microfone-comentario", title: textoInterface("Ditar comentário"), "aria-label": textoInterface("Ditar comentário"), "aria-pressed": "false", html: ICONES.mic });
  btnMic.addEventListener("click", () => alternarDitado(entrada, btnMic, a));
  ui.balao = h(
    "div",
    { class: "an-balao" },
    h("button", { class: "an-ico", title: a.area ? "Detalhes da área selecionada" : "Propriedades do elemento", html: ICONES.sliders, onclick: () => abrirPainel(a) }),
    entrada,
    criarIdiomaDitado(),
    btnMic,
    a.confirmada ? h("button", { class: "an-ico", title: "Excluir anotação", html: ICONES.lixeira, onclick: () => excluirAnotacao(a) }) : null,
    h("button", { class: "an-ico", title: "Confirmar (Enter)", html: ICONES.ok, style: "color:var(--an-ok-claro)", onclick: confirmarEdicao })
  );
  ui.camadaPins.after(ui.balao);
  ui.entradaBalao = entrada;
  ui.dica.style.display = "none";
  posicionarBalao(a);
  if (ui.painel.hidden) {
    entrada.focus();
    setTimeout(() => entrada.focus(), 0);
  }
}

function posicionarBalao(a: AnotacaoLocal): void {
  const r = rectAnotacao(a);
  if (!ui.balao) return;
  const largura = Math.min(520, Math.max(300, innerWidth - 24));
  let left = r.left + 18;
  if (left + largura > innerWidth - 12) left = Math.max(12, innerWidth - 12 - largura);
  const altura = ui.balao.getBoundingClientRect().height || 42;
  let top = r.top - altura - 10;
  if (top < 56) top = r.top + r.height + 10;
  top = Math.max(12, Math.min(top, innerHeight - altura - 12));
  if (a.area && ui.arvore && !ui.arvore.hidden) {
    const arvore = ui.arvore.getBoundingClientRect();
    if (left < arvore.right && left + largura > arvore.left && top < arvore.bottom && top + 42 > arvore.top) {
      if (arvore.right + 12 + largura <= innerWidth - 12) left = arvore.right + 12;
      else if (arvore.bottom + 54 <= innerHeight) top = arvore.bottom + 12;
    }
  }
  ui.balao.style.left = left + "px";
  ui.balao.style.top = top + "px";
}

// ---------- ditado ----------
function sincronizarIdiomaDitado(): void {
  raiz?.querySelectorAll<HTMLSelectElement>(".an-idioma-ditado select").forEach((seletor) => {
    seletor.value = idiomaDitado;
    atualizarSeletorPersonalizado(seletor);
    const botao = seletor.parentElement?.querySelector<HTMLButtonElement>(".an-seletor-botao");
    if (botao) botao.title = "Idioma do ditado: " + IDIOMAS_DITADO[idiomaDitado].nome;
  });
}

function criarIdiomaDitado(): HTMLDivElement {
  const seletor = h("select");
  for (const [codigo, idioma] of Object.entries(IDIOMAS_DITADO)) {
    seletor.append(h("option", { value: codigo }, idioma.nome));
  }
  seletor.value = idiomaDitado;
  const botao = criarSeletorPersonalizado(seletor, "Idioma do ditado", opcao => opcao.value.toUpperCase());
  botao.title = "Idioma do ditado: " + IDIOMAS_DITADO[idiomaDitado].nome;
  seletor.addEventListener("change", () => {
    idiomaDitado = validarIdiomaDitado(seletor.value);
    try { localStorage.setItem(CHAVE_IDIOMA_DITADO, idiomaDitado); } catch { /* preferência mantida nesta página */ }
    sincronizarIdiomaDitado();
  });
  return h("div", { class: "an-idioma-ditado" }, seletor, botao);
}

window.addEventListener("storage", evento => {
  if (evento.key !== CHAVE_IDIOMA_DITADO) return;
  idiomaDitado = validarIdiomaDitado(evento.newValue);
  sincronizarIdiomaDitado();
});

interface ControlesDitado {
  status: (texto: string, ouvindo?: boolean) => void;
  previa: (texto: string, final?: boolean) => void;
  processando: () => void;
  fechar: () => void;
}

// Indicador de atividade do reconhecimento, sem gravar áudio nem simular volume.
function montarControlesDitado(campo: HTMLInputElement | HTMLTextAreaElement, parar: () => void, cancelar: () => void): ControlesDitado {
  const balao = campo.closest<HTMLElement>(".an-balao, .an-chat-entrada, .an-conversa .entrada");
  if (!balao) return { status: () => undefined, previa: () => undefined, processando: () => undefined, fechar: () => undefined };
  const voltarAoCampo = (acao: () => void): void => {
    acao();
    if (campo.isConnected) campo.focus({ preventScroll: true });
  };
  const status = h("span", { class: "an-voz-status", role: "status", "aria-live": "polite", "aria-atomic": "true" }, textoInterface("Preparando ditado…"));
  const atividade = h("span", { class: "an-voz-atividade", "aria-hidden": "true" }, ...Array.from({ length: 22 }, () => h("i")));
  const tituloPrevia = h("span", { class: "an-voz-previa-rotulo" }, textoInterface("Transcrição parcial"));
  const textoPrevia = h("div", { class: "an-voz-previa-texto" });
  const previa = h("div", { class: "an-voz-previa", "aria-label": textoInterface("Transcrição parcial"), "aria-live": "polite", "aria-atomic": "true", hidden: true }, tituloPrevia, textoPrevia);
  const barra = h("div", { class: "an-voz-controles", role: "group", "aria-label": textoInterface("Controles do ditado") },
    h("button", { class: "an-ico an-voz-cancelar", type: "button", title: textoInterface("Cancelar ditado"), "aria-label": textoInterface("Cancelar ditado"), html: ICONES.fechar, onclick: () => voltarAoCampo(cancelar) }),
    h("div", { class: "an-voz-centro" }, atividade, status),
    h("button", { class: "an-ico an-voz-parar", type: "button", title: textoInterface("Parar ditado e revisar"), "aria-label": textoInterface("Parar ditado e revisar"), html: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>', onclick: () => voltarAoCampo(parar) }),
    h("button", { class: "an-ico an-voz-usar", type: "button", title: textoInterface("Usar texto ditado"), "aria-label": textoInterface("Usar texto ditado"), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>', onclick: () => voltarAoCampo(parar) }),
    previa,
  );
  balao.classList.add("an-ditando");
  balao.append(barra);
  const reposicionar = new ResizeObserver(() => { if (balao === ui.balao && estado.atual) posicionarBalao(estado.atual); });
  reposicionar.observe(barra);
  barra.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  return {
    status: (texto, ouvindo = false) => { status.textContent = texto; barra.classList.toggle("ouvindo", ouvindo); },
    previa: (texto, final = false) => {
      const seguirFim = previa.scrollHeight - previa.scrollTop - previa.clientHeight < 28;
      textoPrevia.textContent = texto || "O texto aparece aqui enquanto você fala.";
      tituloPrevia.textContent = final ? "Transcrição" : "Transcrição parcial";
      previa.setAttribute("aria-label", tituloPrevia.textContent);
      previa.hidden = false;
      if (seguirFim) previa.scrollTop = previa.scrollHeight;
    },
    processando: () => {
      for (const botao of barra.querySelectorAll<HTMLButtonElement>(".an-voz-parar, .an-voz-usar")) botao.disabled = true;
    },
    fechar: () => {
      const devolverFoco = barra.contains(host?.shadowRoot?.activeElement ?? null);
      reposicionar.disconnect();
      barra.remove();
      balao.classList.remove("an-ditando");
      if (devolverFoco && campo.isConnected) campo.focus({ preventScroll: true });
    },
  };
}

function mensagemErroVoz(erro: string): string {
  switch (erro) {
    case "not-allowed": return "Permita o microfone nas permissões deste site no navegador e tente novamente.";
    case "audio-capture": return "Não consegui acessar o microfone. Verifique se ele está conectado e disponível.";
    case "network": return "O serviço de ditado não respondeu. Verifique a conexão e tente novamente.";
    case "service-not-allowed": return "Este navegador não disponibilizou o serviço de ditado. Tente abrir a página no Chrome.";
    case "no-speech": return "Não detectei fala. Clique no microfone e tente novamente.";
    case "language-not-supported": return "O idioma escolhido não está disponível para ditado neste navegador.";
    case "aborted": return "Ditado interrompido.";
    default: return "Não consegui iniciar o ditado. Verifique a permissão do microfone e tente novamente.";
  }
}

function alternarDitado(campo: HTMLInputElement, botao: HTMLButtonElement, a: AnotacaoLocal): void {
  iniciarDitado(campo, botao, (texto) => {
    a.comentario = texto;
    if (estado.atual === a) ui.comentarioPainel.value = texto;
    salvar(true);
  });
}

function iniciarDitado(campo: HTMLInputElement | HTMLTextAreaElement, botao: HTMLButtonElement, aoAtualizar?: (texto: string) => void): void {
  if (estado.ditado) {
    if (estado.ditado.botao === botao && estado.ditado.concluir) estado.ditado.concluir();
    else pararDitado();
    return;
  }
  const idioma = idiomaDitado;
  if (!window.isSecureContext) {
    if (CFG.https) void continuarDitadoSeguro(campo, botao);
    else avisar("O microfone precisa de uma conexão segura. O responsável pelo Anotador precisa habilitar o acesso HTTPS.", 7000);
    return;
  }
  // A presença de SpeechRecognition não garante que o serviço do navegador
  // funcione. Prefere o transcritor do Anotador quando ele está instalado.
  const controlador = new AbortController();
  let controles: ControlesDitado | null = null;
  const sessao = { botao, parar: (): void => {
    controlador.abort();
    controles?.fechar();
    if (estado.ditado === sessao) estado.ditado = null;
  } };
  estado.ditado = sessao;
  controles = montarControlesDitado(campo, sessao.parar, sessao.parar);
  controles.status("Preparando microfone…");
  const timeout = setTimeout(() => controlador.abort(), 8000);
  void (async () => {
    try {
      const capacidade = await pedirApi("/voz/capacidade", undefined, controlador.signal);
      if (controlador.signal.aborted || !campo.isConnected || estado.ditado !== sessao) return;
      if (capacidade.status === 403) throw new Error(typeof capacidade.dados.erro === "string" ? capacidade.dados.erro : "Reconecte este navegador ao Anotador para usar o microfone.");
      sessao.parar();
      if (capacidade.ok && capacidade.dados.disponivel === true) {
        iniciarGravacaoLocal(campo, botao, idioma, aoAtualizar);
      } else iniciarReconhecimentoNavegador(campo, botao, idioma, aoAtualizar);
    } catch (erro) {
      if (estado.ditado === sessao) {
        sessao.parar();
        avisar(erro instanceof Error && erro.name !== "AbortError" ? erro.message : "Não consegui conectar o microfone ao Anotador. Seu texto continua aqui; tente novamente.", 7000);
      }
    } finally { clearTimeout(timeout); }
  })();
}

function iniciarGravacaoLocal(campo: HTMLInputElement | HTMLTextAreaElement, botao: HTMLButtonElement, idioma: IdiomaDitado, aoAtualizar?: (texto: string) => void): void {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    avisar("Este navegador não permite gravar o microfone nesta página. Abra o endereço seguro em um navegador com gravação de áudio.", 7000);
    return;
  }
  let controlador = new AbortController();
  let stream: MediaStream | null = null;
  let gravador: MediaRecorder | null = null;
  let encerrado = false;
  let transcrevendo = false;
  let bytes = 0;
  let inicio = 0;
  let duracao: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let tempoTranscricao: ReturnType<typeof setInterval> | undefined;
  const controladorParcial = new AbortController();
  let parcialEmCurso: Promise<void> | null = null;
  let ultimaParcial = 0;
  let previaIndisponivel = false;
  let audioGuardado: { audio: string; mime: string; idioma: IdiomaDitado } | null = null;
  let repetir: HTMLButtonElement | null = null;
  const partes: Blob[] = [];
  let controles: ControlesDitado | null = null;
  const liberarMicrofone = (): void => { stream?.getTracks().forEach((trilha) => trilha.stop()); };
  const limpar = (): void => {
    if (encerrado) return;
    encerrado = true;
    clearInterval(vigiar);
    clearInterval(duracao);
    clearInterval(tempoTranscricao);
    clearTimeout(timeout);
    audioGuardado = null;
    window.removeEventListener("pagehide", sessao.parar);
    liberarMicrofone();
    botao.classList.remove("grav");
    botao.setAttribute("aria-pressed", "false");
    controles?.fechar();
    if (estado.ditado === sessao) estado.ditado = null;
  };
  const cancelar = (): void => {
    controlador.abort();
    controladorParcial.abort();
    limpar();
    if (gravador && gravador.state !== "inactive") { try { gravador.stop(); } catch { /* já terminou */ } }
    partes.length = 0;
  };
  const concluir = (): void => {
    if (encerrado || transcrevendo || !gravador || gravador.state === "inactive") return;
    transcrevendo = true;
    clearInterval(duracao);
    controles?.status("Preparando áudio…");
    controles?.processando();
    botao.classList.remove("grav");
    botao.setAttribute("aria-pressed", "false");
    gravador.stop();
    liberarMicrofone();
  };
  const sessao = { botao, parar: cancelar, concluir };
  const vigiar = setInterval(() => { if (!campo.isConnected) cancelar(); }, 500);
  estado.ditado = sessao;
  controles = montarControlesDitado(campo, concluir, cancelar);
  controles.status("Aguardando permissão…");
  window.addEventListener("pagehide", cancelar);
  const falhar = (mensagem: string): void => { cancelar(); avisar(mensagem, 7000); };
  const lerAudio = (blob: Blob): Promise<string> => new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(",", 2)[1] ?? "");
    leitor.onerror = () => rejeitar(new Error("Não consegui ler a gravação. Tente novamente."));
    leitor.readAsDataURL(blob);
  });
  const atualizarParcial = (): void => {
    if (encerrado || transcrevendo || previaIndisponivel || parcialEmCurso || !gravador || gravador.state !== "recording" || Date.now() - ultimaParcial < 3000) return;
    ultimaParcial = Date.now();
    // Cada amostra inclui o cabeçalho do primeiro chunk. A parcial nunca muda
    // o rascunho; a gravação completa é transcrita novamente ao parar.
    const blob = new Blob(partes, { type: gravador.mimeType || "audio/webm" });
    const limite = setTimeout(() => controladorParcial.abort(), 30000);
    parcialEmCurso = (async () => {
      try {
        const audio = await lerAudio(blob);
        if (encerrado || controladorParcial.signal.aborted) return;
        const resposta = await pedirApi("/voz/transcrever", { audio, mime: blob.type, idioma, parcial: true }, controladorParcial.signal);
        if (encerrado || !campo.isConnected || estado.ditado !== sessao) return;
        if (!resposta.ok || typeof resposta.dados.texto !== "string") throw new Error("Prévia indisponível");
        if (resposta.dados.texto.trim()) controles?.previa(resposta.dados.texto.trim());
      } catch {
        if (!encerrado) previaIndisponivel = true;
      } finally { clearTimeout(limite); parcialEmCurso = null; }
    })();
  };
  const transcrever = async (): Promise<void> => {
    if (encerrado || transcrevendo || !audioGuardado || !campo.isConnected || estado.ditado !== sessao) return;
    transcrevendo = true;
    controlador = new AbortController();
    if (repetir) repetir.hidden = true;
    const iniciadoEm = performance.now();
    const decorrido = (): string => {
      const segundos = Math.max(0, Math.floor((performance.now() - iniciadoEm) / 1000));
      return Math.floor(segundos / 60) + ":" + String(segundos % 60).padStart(2, "0");
    };
    const atualizarEspera = (): void => controles?.status("Transcrevendo · " + decorrido());
    atualizarEspera();
    tempoTranscricao = setInterval(atualizarEspera, 1000);
    timeout = setTimeout(() => controlador.abort(), 135000);
    try {
      const resposta = await pedirApi("/voz/transcrever", audioGuardado, controlador.signal);
      if (encerrado || !campo.isConnected || estado.ditado !== sessao) return;
      if (!resposta.ok || typeof resposta.dados.texto !== "string") throw new Error(typeof resposta.dados.erro === "string" ? resposta.dados.erro : "Não consegui transcrever a gravação.");
      const texto = resposta.dados.texto.trim();
      if (!texto) { limpar(); avisar("Não detectei fala nesta gravação. Clique no microfone e tente novamente.", 6000); return; }
      const novo = (campo.value ? campo.value.replace(/\s+$/, "") + " " : "") + texto;
      if (campo.maxLength > 0 && novo.length > campo.maxLength) throw new Error("O texto reconhecido ultrapassou o tamanho da mensagem. Encurte o rascunho e tente novamente.");
      campo.value = novo;
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      aoAtualizar?.(novo);
      limpar();
      campo.focus({ preventScroll: true });
      avisar("Áudio transcrito. Revise o texto antes de enviar.");
    } catch (erro) {
      if (encerrado || !campo.isConnected || estado.ditado !== sessao) return;
      transcrevendo = false;
      controles?.status("Transcrição falhou · " + decorrido());
      const barra = campo.closest(".an-balao, .an-chat-entrada, .an-conversa .entrada")?.querySelector<HTMLElement>(".an-voz-controles");
      if (barra) {
        barra.querySelectorAll<HTMLElement>(".an-voz-parar, .an-voz-usar").forEach(botao => { botao.hidden = true; });
        if (!repetir) {
          repetir = h("button", { type: "button", class: "an-btn an-voz-repetir", title: "Transcrever novamente a mesma gravação", "aria-label": "Tentar transcrever novamente", style: "flex:none;padding:5px 8px;font-size:11px", onclick: () => void transcrever() }, textoInterface("Tentar novamente"));
          barra.insertBefore(repetir, barra.querySelector(".an-voz-previa"));
        }
        repetir.hidden = false;
      }
      const motivo = erro instanceof Error && erro.name !== "AbortError" ? erro.message : "A transcrição demorou demais.";
      avisar(motivo + " A gravação foi mantida; tente novamente ou cancele.", 8000);
    } finally {
      clearInterval(tempoTranscricao);
      clearTimeout(timeout);
    }
  };
  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (encerrado || !campo.isConnected) { liberarMicrofone(); return; }
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((tipo) => MediaRecorder.isTypeSupported(tipo));
      gravador = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      gravador.addEventListener("dataavailable", (evento: BlobEvent) => {
        if (encerrado || !evento.data.size) return;
        bytes += evento.data.size;
        if (bytes > 8 * 1024 * 1024) { falhar("A gravação ficou grande demais. Grave uma mensagem mais curta (até 2 minutos)."); return; }
        partes.push(evento.data);
        atualizarParcial();
      });
      gravador.addEventListener("error", () => falhar("A gravação foi interrompida pelo navegador. Seu texto foi preservado; tente novamente."));
      gravador.addEventListener("stop", () => {
        liberarMicrofone();
        if (encerrado) return;
        if (!transcrevendo) { falhar("O microfone foi desconectado. Seu texto foi preservado; tente novamente."); return; }
        void (async () => {
          try {
            const blob = new Blob(partes, { type: gravador?.mimeType || mime || "audio/webm" });
            partes.length = 0;
            if (!blob.size) throw new Error("A gravação ficou vazia. Clique no microfone e tente novamente.");
            const audio = await lerAudio(blob);
            if (encerrado || !campo.isConnected) return;
            audioGuardado = { audio, mime: blob.type, idioma };
            if (parcialEmCurso) {
              controles?.status("Finalizando prévia…");
              await parcialEmCurso;
            }
            if (encerrado || !campo.isConnected) return;
            transcrevendo = false;
            await transcrever();
          } catch (erro) {
            if (!encerrado) falhar(erro instanceof Error && erro.name !== "AbortError" ? erro.message : "A transcrição demorou demais. Seu texto foi preservado; tente uma gravação mais curta.");
          }
        })();
      });
      gravador.start(1000);
      inicio = Date.now();
      ultimaParcial = inicio;
      controles?.previa("");
      botao.classList.add("grav");
      botao.setAttribute("aria-pressed", "true");
      const atualizarTempo = (): void => {
        const segundos = Math.floor((Date.now() - inicio) / 1000);
        if (segundos >= 120) { concluir(); return; }
        controles?.status("Gravando " + Math.floor(segundos / 60) + ":" + String(segundos % 60).padStart(2, "0") + (previaIndisponivel ? " · revisão ao parar" : " · pare para revisar"), true);
      };
      atualizarTempo();
      duracao = setInterval(atualizarTempo, 1000);
      avisar("Gravando… acompanhe a prévia abaixo e pare para revisar o texto completo.", 4500);
    } catch (erro) {
      if (!encerrado) falhar(mensagemErroVoz(erro instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(erro.name) ? "not-allowed" : "audio-capture"));
    }
  })();
}

function iniciarReconhecimentoNavegador(campo: HTMLInputElement | HTMLTextAreaElement, botao: HTMLButtonElement, idioma: IdiomaDitado, aoAtualizar?: (texto: string) => void): void {
  if (estado.ditado) {
    pararDitado();
    return;
  }
  const original = campo.value;
  const base = original ? original.replace(/\s+$/, "") + " " : "";
  const restaurar = (): void => {
    campo.value = original;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    aoAtualizar?.(original);
  };
  const atualizar = (texto: string): void => {
    campo.value = (base + texto).replace(/\s+/g, " ");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    aoAtualizar?.(campo.value);
  };
  if (!window.isSecureContext) {
    if (CFG.https) void continuarDitadoSeguro(campo, botao);
    else avisar("O microfone precisa de uma conexão segura. O responsável pelo Anotador precisa habilitar o acesso HTTPS.", 7000);
    return;
  }
  const Reconhecimento = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Reconhecimento) {
    avisar("Este navegador não oferece ditado. Tente abrir a página no Chrome.", 6000);
    return;
  }
  const rec = new Reconhecimento();
  rec.lang = IDIOMAS_DITADO[idioma].navegador;
  rec.interimResults = true;
  rec.continuous = true;
  let encerrado = false;
  let controles: ControlesDitado | null = null;
  const limpar = (): void => {
    if (encerrado) return;
    encerrado = true;
    clearInterval(vigiarCampo);
    window.removeEventListener("pagehide", pararDitado);
    botao.classList.remove("grav");
    botao.setAttribute("aria-pressed", "false");
    controles?.fechar();
    if (estado.ditado === sessao) estado.ditado = null;
  };
  const sessao = { botao, parar: (): void => {
    limpar();
    try { rec.abort(); } catch { /* o navegador já encerrou */ }
  } };
  const vigiarCampo = setInterval(() => { if (!campo.isConnected) sessao.parar(); }, 500);
  estado.ditado = sessao;
  controles = montarControlesDitado(campo, sessao.parar, () => { sessao.parar(); restaurar(); });
  controles.status("Aguardando permissão…");
  window.addEventListener("pagehide", pararDitado);
  rec.addEventListener("start", () => {
    if (encerrado) return;
    botao.classList.add("grav");
    botao.setAttribute("aria-pressed", "true");
    controles?.status("Ouvindo…", true);
    controles?.previa("");
    avisar("Ouvindo… pare para revisar ou use o texto ditado.");
  });
  rec.onresult = (ev: SpeechRecognitionEvent) => {
    if (encerrado || !campo.isConnected) return;
    let texto = "";
    for (let i = 0; i < ev.results.length; i++) texto += (ev.results[i]?.[0]?.transcript ?? "") + " ";
    atualizar(texto);
    controles?.previa(texto.trim());
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    if (encerrado) return;
    avisar(mensagemErroVoz(ev.error), 6000);
    sessao.parar();
  };
  rec.onend = limpar;
  avisar("Aguardando a permissão do microfone…", 8000);
  try { rec.start(); }
  catch (erro) {
    sessao.parar();
    avisar(mensagemErroVoz(erro instanceof DOMException && erro.name === "NotAllowedError" ? "not-allowed" : ""), 6000);
  }
}

async function continuarDitadoSeguro(campo: HTMLInputElement | HTMLTextAreaElement, botao: HTMLButtonElement): Promise<void> {
  if (capturasEmAndamento.size || estado.envioEmAndamento) {
    avisar("Aguarde o print ou o envio terminar antes de ligar o microfone.");
    return;
  }
  if (!salvar(true)) {
    avisar("Não consegui guardar o rascunho. A página foi mantida aberta.", 6000);
    return;
  }
  const controlador = new AbortController();
  let controles: ControlesDitado | null = null;
  const sessao = { botao, parar: (): void => {
    controlador.abort();
    controles?.fechar();
    if (estado.ditado === sessao) estado.ditado = null;
    window.removeEventListener("pagehide", sessao.parar);
  } };
  estado.ditado = sessao;
  controles = montarControlesDitado(campo, sessao.parar, sessao.parar);
  controles.status("Conectando microfone…");
  window.addEventListener("pagehide", sessao.parar);
  const destinoCampo = campo.closest(".an-chat") ? "chat" : campo.closest(".an-conversa") ? "conversa" : "anotacao";
  const voltar = location.pathname + location.search + location.hash;
  const timeout = setTimeout(() => controlador.abort(), 15000);
  try {
    // Recolhe de novo se o usuário editou o painel durante a requisição: a troca
    // de protocolo não pode descartar a última letra digitada ou um novo print.
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const armazenamento = JSON.stringify(dadosParaGuardar(true));
      const r = await pedirApi("/voz/continuar", { voltar, armazenamento, campo: destinoCampo }, controlador.signal);
      if (controlador.signal.aborted || !campo.isConnected) return;
      if (!r.ok || typeof r.dados.url !== "string") {
        throw new Error(typeof r.dados.erro === "string" ? r.dados.erro : "Não consegui conectar o microfone. Tente novamente.");
      }
      if (armazenamento !== JSON.stringify(dadosParaGuardar(true))) continue;
      const destino = new URL(r.dados.url, location.href);
      if (destino.protocol !== "https:" || destino.hostname !== location.hostname
        || (destino.port || "443") !== (location.port || "80") || destino.pathname !== CFG.base + "/voz/retomar") {
        throw new Error("O endereço seguro do microfone não corresponde a esta página.");
      }
      salvar(true);
      avisar("Conectando nesta aba. Se o navegador pedir, confirme o certificado desta máquina.", 10000);
      location.assign(destino.href);
      return;
    }
    avisar("O rascunho mudou durante a conexão. Clique no microfone para continuar.", 6000);
  } catch (erro) {
    if (!controlador.signal.aborted) avisar(erro instanceof Error ? erro.message : "Não consegui conectar o microfone. Tente novamente.", 7000);
    else if (estado.ditado === sessao) avisar("A conexão demorou. O rascunho continua aqui; tente novamente.", 6000);
  } finally {
    clearTimeout(timeout);
    sessao.parar();
  }
}

function retomarDitadoPendente(): void {
  let intencao: { campo?: string; voltar?: string; criadaEm?: number } | null = null;
  try {
    intencao = JSON.parse(sessionStorage.getItem(CHAVE_DITADO_PENDENTE) ?? "null");
    sessionStorage.removeItem(CHAVE_DITADO_PENDENTE);
  } catch { return; }
  if (!intencao || !window.isSecureContext || typeof intencao.criadaEm !== "number"
    || Date.now() - intencao.criadaEm > 5 * 60_000 || intencao.criadaEm > Date.now()
    || intencao.voltar !== location.pathname + location.search + location.hash
    || !["anotacao", "conversa", "chat"].includes(intencao.campo ?? "")) return;
  if (intencao.campo === "chat") {
    void retomarDitadoChat().then((iniciou) => { if (!iniciou) avisar("Conversa restaurada. Clique no microfone do chat para ditar.", 7000); });
    return;
  }
  const inicio = Date.now();
  // A página pode hidratar os elementos depois do load. A intenção é consumida
  // uma única vez; um reload normal nunca liga o microfone por conta própria.
  const tentar = (): void => {
    const botao = intencao?.campo === "conversa"
      ? ui.conversa?.querySelector<HTMLButtonElement>('[title="Ditar resposta"]')
      : ui.balao?.querySelector<HTMLButtonElement>('.an-microfone-comentario');
    if (botao?.isConnected && !restaurandoConversa) {
      if (document.visibilityState !== "visible") {
        avisar("Rascunho restaurado. Clique no microfone para ditar.", 7000);
        return;
      }
      botao.click();
    } else if (Date.now() - inicio < 8000) setTimeout(tentar, 80);
    else avisar("Rascunho guardado. Selecione o elemento e clique no microfone para ditar.", 7000);
  };
  setTimeout(tentar, 0);
}

function pararDitado(): void {
  const ditado = estado.ditado;
  if (!ditado) return;
  estado.ditado = null;
  ditado.parar();
}

// ---------- painel de propriedades ----------
function montarPainel(raizUi: HTMLDivElement): void {
  ui.comentarioPainel = h("textarea", {
    rows: 1,
    placeholder: textoInterface("Descreva essas alterações..."),
    oninput: (e: Event) => {
      const campo = e.target as HTMLTextAreaElement;
      if (estado.atual) estado.atual.comentario = campo.value;
      if (ui.entradaBalao) ui.entradaBalao.value = campo.value;
      campo.style.height = "auto";
      campo.style.height = Math.min(96, campo.scrollHeight) + "px";
    },
  });
  ui.painelTag = h("span", { class: "tag mono" });
  ui.painelComp = h("span", { class: "comp mono" });
  ui.painelCorpo = h("div", { class: "corpo" });
  ui.btnExcluir = h("button", { class: "an-btn perigo", onclick: () => estado.atual && excluirAnotacao(estado.atual) }, textoInterface("Excluir"));
  ui.alcaPainel = h("button", { class: "an-alca", title: textoInterface("Arrastar o painel (duplo clique recoloca)"), html: ICONES.alca });
  const sub = h(
    "div",
    { class: "sub" },
    h("span", null, ui.painelTag, ui.painelComp),
    h("span", { class: "acoes" }, ui.alcaPainel, h("button", { class: "an-ico", title: textoInterface("Fechar painel"), html: ICONES.fechar, onclick: () => (ui.painel.hidden = true) }))
  );
  ui.painel = h(
    "div",
    { class: "an-painel", hidden: true },
    h("div", { class: "cab" }, h("span", { class: "an-ico", html: ICONES.sliders }), ui.comentarioPainel),
    sub,
    ui.painelCorpo,
    h(
      "div",
      { class: "an-rodape" },
      ui.btnExcluir,
      h("span", { class: "esp" }),
      h("button", { class: "an-btn", onclick: cancelarEdicao }, textoInterface("Cancelar")),
      h("button", { class: "an-ok", title: textoInterface("Confirmar"), html: ICONES.ok, onclick: confirmarEdicao })
    )
  );
  raizUi.append(ui.painel);
  tornarArrastavel(ui.painel, [ui.alcaPainel, sub], "painel");
}

function abrirPainel(a: AnotacaoLocal): void {
  if (a.area) { abrirPainelArea(a); return; }
  const el = estado.elementos.get(a.id);
  if (!el) {
    avisar("Elemento não localizado nesta versão da página.");
    return;
  }
  ui.comentarioPainel.value = a.comentario;
  ui.painelTag.textContent = el.tagName.toLowerCase();
  ui.painelComp.textContent = a.elemento.meta.componentes.slice(0, 3).join(" ‹ ");
  ui.painelComp.title = a.elemento.meta.componentes.join(" ‹ ");
  ui.btnExcluir.hidden = !a.confirmada;
  ui.painelCorpo.textContent = "";
  ui.painelCorpo.append(...construirCampos(a, el));
  ui.painel.hidden = false;
  restaurarPosicao(ui.painel, "painel");
  setTimeout(() => ui.comentarioPainel.focus(), 0);
}

function registrar(a: AnotacaoLocal, el: ElementoEstilizavel, propriedade: string, depois: string): void {
  const antes = valorComputado(a, el, propriedade);
  const idx = a.alteracoes.findIndex((x) => x.propriedade === propriedade);
  if (depois === "") {
    if (idx >= 0) a.alteracoes.splice(idx, 1);
    el.style.removeProperty(propriedade);
    return;
  }
  el.style.setProperty(propriedade, depois);
  const registro: AlteracaoEstilo = { propriedade, antes, depois };
  if (idx >= 0) a.alteracoes[idx] = registro;
  else a.alteracoes.push(registro);
}

function linha(rotulo: string, campo: HTMLElement, sub?: string, larga = false): HTMLDivElement {
  return h("div", { class: "an-linha" + (larga ? " larga" : "") }, h("label", null, textoInterface(rotulo), sub ? h("span", { class: "sub" }, textoInterface(sub)) : null), campo);
}

function secao(...filhos: Filho[]): HTMLDivElement {
  return h("div", { class: "an-secao" }, ...filhos);
}

function campoTexto(a: AnotacaoLocal, el: ElementoEstilizavel): HTMLDivElement {
  const permitido = soTexto(el);
  const wrap = h("div", { class: "an-campo" + (a.texto ? " alterado" : "") });
  const entrada = h("input", {
    type: "text",
    class: "mono",
    value: permitido ? (el.textContent ?? "") : "(elemento com filhos)",
    disabled: !permitido,
    oninput: (e: Event) => {
      const valor = (e.target as HTMLInputElement).value;
      const antes = a.textoOriginal ?? el.textContent ?? "";
      el.textContent = valor;
      a.texto = valor === antes ? null : { antes, depois: valor };
      wrap.classList.toggle("alterado", !!a.texto);
    },
  });
  wrap.append(entrada);
  return linha("Texto", wrap);
}

function campoCor(a: AnotacaoLocal, el: ElementoEstilizavel, rotulo: string, propriedade: string): HTMLDivElement {
  const atual = valorAtual(a, el, propriedade);
  const txt = h("input", { type: "text", class: "mono", value: atual });
  const sw = criarSeletorCor(rotulo, () => getComputedStyle(el).getPropertyValue(propriedade), (valor) => {
    txt.value = valor;
    aplicar(valor);
  });
  const wrap = h("div", { class: "an-campo" + (a.alteracoes.some((x) => x.propriedade === propriedade) ? " alterado" : "") }, sw, txt);
  const aplicar = (valor: string) => {
    if (valor && !CSS.supports(propriedade, valor)) { txt.setAttribute("aria-invalid", "true"); return; }
    txt.removeAttribute("aria-invalid");
    registrar(a, el, propriedade, valor);
    sw.style.background = getComputedStyle(el).getPropertyValue(propriedade);
    wrap.classList.toggle("alterado", valor !== "");
  };
  txt.addEventListener("change", () => {
    aplicar(txt.value.trim());
  });
  return linha(rotulo, wrap);
}

interface OpcoesNumero {
  semUnidade?: boolean;
  sub?: string;
  depois?: (valor: string) => void;
}

function campoNumero(a: AnotacaoLocal, el: ElementoEstilizavel, rotulo: string, propriedade: string, opcoes: OpcoesNumero = {}): { linha: HTMLDivElement; entrada: HTMLInputElement } {
  const atual = valorAtual(a, el, propriedade);
  const alterado = a.alteracoes.some((x) => x.propriedade === propriedade);
  const entrada = h("input", { type: "text", class: "mono", inputmode: "decimal", value: opcoes.semUnidade ? atual : px(atual) });
  const wrap = h("div", { class: "an-campo" + (alterado ? " alterado" : "") }, entrada, opcoes.semUnidade ? null : h("span", { class: "un" }, "px"));
  const aplicar = () => {
    const v = entrada.value.trim();
    if (v === "") {
      registrar(a, el, propriedade, "");
      wrap.classList.remove("alterado");
      return;
    }
    const valor = opcoes.semUnidade || /[a-z%)]$/i.test(v) ? v : v + "px";
    registrar(a, el, propriedade, valor);
    opcoes.depois?.(valor);
    wrap.classList.add("alterado");
  };
  entrada.addEventListener("change", aplicar);
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const n = parseFloat(entrada.value) || 0;
      const passo = e.shiftKey ? 10 : 1;
      entrada.value = String(Math.round((n + (e.key === "ArrowUp" ? passo : -passo)) * 100) / 100);
      e.preventDefault();
      aplicar();
    }
  });
  return { linha: linha(rotulo, wrap, opcoes.sub), entrada };
}

function campoSelecao(a: AnotacaoLocal, el: ElementoEstilizavel, rotulo: string, propriedade: string, valores: string[]): HTMLDivElement {
  const atual = valorAtual(a, el, propriedade);
  const sel = h("select", null, ...valores.map((v) => h("option", { value: v, selected: v === atual }, v)));
  if (!valores.includes(atual)) sel.prepend(h("option", { value: atual, selected: true }, atual));
  const wrap = h("div", { class: "an-campo an-campo-selecao" + (a.alteracoes.some((x) => x.propriedade === propriedade) ? " alterado" : "") }, sel, criarSeletorPersonalizado(sel, rotulo));
  sel.addEventListener("change", () => {
    registrar(a, el, propriedade, sel.value);
    wrap.classList.add("alterado");
  });
  return linha(rotulo, wrap);
}

function campoFonte(a: AnotacaoLocal, el: ElementoEstilizavel): HTMLDivElement {
  const propriedade = "font-family";
  const sugestoes = ["var(--font-sans)", "var(--font-mono)", "system-ui, sans-serif", "Inter, system-ui, sans-serif", "ui-monospace, monospace", "Georgia, serif"];
  const lista = h("datalist", { id: "an-fontes" }, ...sugestoes.map((v) => h("option", { value: v })));
  const entrada = h("input", { type: "text", class: "mono", list: "an-fontes", value: valorAtual(a, el, propriedade) });
  const wrap = h("div", { class: "an-campo" + (a.alteracoes.some((x) => x.propriedade === propriedade) ? " alterado" : "") }, entrada, lista);
  entrada.addEventListener("change", () => {
    registrar(a, el, propriedade, entrada.value.trim());
    wrap.classList.toggle("alterado", entrada.value.trim() !== "");
  });
  return linha("Fonte", wrap);
}

function campoQuatro(a: AnotacaoLocal, el: ElementoEstilizavel, rotulo: string, prefixo: string): HTMLDivElement {
  const campos = ["top", "right", "bottom", "left"].map((lado) => {
    const propriedade = prefixo + "-" + lado;
    const alterado = a.alteracoes.some((x) => x.propriedade === propriedade);
    const entrada = h("input", { type: "text", class: "mono", inputmode: "decimal", title: lado, value: px(valorAtual(a, el, propriedade)) });
    const wrap = h("div", { class: "an-campo" + (alterado ? " alterado" : "") }, entrada);
    entrada.addEventListener("change", () => {
      const v = entrada.value.trim();
      registrar(a, el, propriedade, v === "" ? "" : /[a-z%)]$/i.test(v) ? v : v + "px");
      wrap.classList.toggle("alterado", v !== "");
    });
    return wrap;
  });
  return linha(rotulo, h("div", { class: "an-quatro" }, ...campos), "cima, direita, baixo, esquerda", true);
}

function resumoContextoVisual(contexto: ContextoVisualAnotacao): HTMLElement {
  const nomes = { alvo: "Elemento", pai: "Container pai", avo: "Container externo" };
  const medida = (valor: number) => Number(valor.toFixed(1)) + " px";
  return h("details", { class: "an-contexto" },
    h("summary", null, textoInterface("Contexto da seleção")),
    h("p", null, "Referência capturada ao selecionar, incluída com seu comentário. Tela: " + contexto.viewport.largura + " × " + contexto.viewport.altura + " px."),
    ...contexto.nos.map((no) => h("div", { class: "an-contexto-no" },
      h("div", { class: "an-contexto-titulo" }, h("strong", null, nomes[no.relacao]), h("span", null, medida(no.rect.width) + " × " + medida(no.rect.height))),
      h("code", null, no.seletor?.valor || no.tag),
      h("p", null, [
        "Layout: " + no.estilos["display"],
        "espaço interno: " + no.estilos["padding"],
        "fonte: " + no.estilos["font-size"],
      ].join(" · ")),
      no.scrollWidth > no.clientWidth + 1 && no.clientWidth > 0
        ? h("p", { class: "an-contexto-excede" }, "Conteúdo mais largo que a área interna: " + no.scrollWidth + " / " + no.clientWidth + " px. Overflow horizontal: " + no.estilos["overflow-x"] + ".")
        : null,
    )),
  );
}

function construirCampos(a: AnotacaoLocal, el: ElementoEstilizavel): HTMLElement[] {
  const melhor = a.elemento.seletores[0];
  const seletor = h(
    "div",
    { class: "an-seletor" },
    h(
      "div",
      { class: "melhor" },
      h("button", { type: "button", class: "an-ico an-localizar", title: textoInterface("Localizar elemento na página"), "aria-label": textoInterface("Localizar elemento na página"), style: "width:20px;height:20px", html: ICONES.mira, onclick: () => {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        destacar(ui.caixaSel, el);
        avisar("Elemento destacado na página.");
      } }),
      h("code", { title: textoInterface("melhor seletor encontrado") }, melhor ? melhor.valor : "(sem seletor)"),
      melhor ? h("span", { class: "pts", title: melhor.unico ? "único na página" : "não único" }, (melhor.unico ? "único · " : "") + melhor.pontos) : null
    )
  );
  const cls = a.elemento.meta.attrs["class"];
  if (cls) seletor.append(h("div", { class: "melhor", style: "margin-top:4px" }, h("code", { class: "classes" }, "." + cls.split(/\s+/).join(" ."))));
  const print = h("button", { type: "button", class: "an-btn an-tirar-print", title: textoInterface("Capturar o site e anexar a imagem a esta anotação"), disabled: capturasEmAndamento.has(a.id) || (a.anexos?.length ?? 0) >= 3 }, textoInterface("Tirar print da tela"));
  const anexos = h("div", { class: "an-anexos", "aria-live": "polite" });
  const atualizarAnexos = () => {
    renderizarAnexos(a, anexos, print);
    // O painel pode ter sido fechado e reconstruído durante a captura.
    if (estado.atual === a && !anexos.isConnected) {
      const areaAtual = ui.painelCorpo.querySelector<HTMLElement>(".an-anexos");
      const botaoAtual = ui.painelCorpo.querySelector<HTMLButtonElement>(".an-tirar-print");
      if (areaAtual && botaoAtual) renderizarAnexos(a, areaAtual, botaoAtual);
    }
  };
  print.addEventListener("click", () => void tirarPrintDaTela(a, print, atualizarAnexos));
  seletor.append(h("div", { class: "an-seletor-acoes" }, print));
  seletor.append(anexos);
  atualizarAnexos();
  if (a.elemento.contextoVisual) seletor.append(resumoContextoVisual(a.elemento.contextoVisual));

  const r0 = el.getBoundingClientRect();
  const proporcao = r0.height ? r0.width / r0.height : 1;
  let largura: { linha: HTMLDivElement; entrada: HTMLInputElement } | null = null;
  let altura: { linha: HTMLDivElement; entrada: HTMLInputElement } | null = null;
  const sincronizarProporcao = (origem: "width" | "height", v: string) => {
    if (!estado.proporcaoTravada || !largura || !altura) return;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return;
    if (origem === "width") {
      const novo = px(String(n / proporcao));
      altura.entrada.value = novo;
      registrar(a, el, "height", novo + "px");
    } else {
      const novo = px(String(n * proporcao));
      largura.entrada.value = novo;
      registrar(a, el, "width", novo + "px");
    }
  };
  largura = campoNumero(a, el, "Largura", "width", { depois: (v) => sincronizarProporcao("width", v) });
  altura = campoNumero(a, el, "Altura", "height", { depois: (v) => sincronizarProporcao("height", v) });
  const trava = h("button", { class: "an-ico", title: textoInterface("Travar proporção largura/altura"), html: ICONES.cadeado, style: estado.proporcaoTravada ? "color:#7ee2b0" : "" });
  trava.addEventListener("click", () => {
    estado.proporcaoTravada = !estado.proporcaoTravada;
    trava.style.color = estado.proporcaoTravada ? "#7ee2b0" : "";
  });

  return [
    secao(seletor),
    secao(campoTexto(a, el)),
    secao(campoCor(a, el, "Cor do texto", "color"), campoCor(a, el, "Fundo", "background-color"), campoNumero(a, el, "Opacity", "opacity", { semUnidade: true }).linha),
    secao(
      campoFonte(a, el),
      campoNumero(a, el, "Tamanho da fonte", "font-size").linha,
      campoSelecao(a, el, "Peso da fonte", "font-weight", ["100", "200", "300", "400", "500", "600", "700", "800", "900"]),
      campoNumero(a, el, "Altura da linha", "line-height").linha,
      campoSelecao(a, el, "Alinhamento", "text-align", ["start", "left", "center", "right", "justify"])
    ),
    secao(
      campoNumero(a, el, "Raio da borda", "border-radius").linha,
      campoCor(a, el, "Cor da borda", "border-color"),
      campoNumero(a, el, "Largura da borda", "border-width", {
        depois: (v) => {
          if (parseFloat(v) > 0 && getComputedStyle(el).borderStyle === "none") registrar(a, el, "border-style", "solid");
        },
      }).linha
    ),
    secao(h("div", { class: "an-titulo-sec" }, trava), largura.linha, altura.linha, campoQuatro(a, el, "Preenchimento", "padding"), campoQuatro(a, el, "Margem", "margin")),
  ];
}

// ---------- fila ----------
function alternarFila(forcar?: boolean): void {
  const abrir = typeof forcar === "boolean" ? forcar : ui.fila.hidden;
  if (!abrir) {
    ui.fila.hidden = true;
    return;
  }
  ui.fila.textContent = "";
  if (estado.lotes.length) {
    ui.fila.append(h("div", { class: "cab-lotes" }, "Lotes enviados"));
    for (const l of estado.lotes.slice(-5).reverse()) {
      const rotulo = l.estado === "processado" ? `Aplicado por ${AGENTE}` : l.estado === "em_andamento" ? `${AGENTE} trabalhando` : `Aguardando ${AGENTE}`;
      const hora = new Date(l.enviadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const perguntas = l.perguntasAbertas ?? 0;
      ui.fila.append(
        h(
          "div",
          {
            class: "item lote " + l.estado,
            title: "Abrir conversa deste lote",
            onclick: () => {
              ui.fila.hidden = true;
              void abrirConversa(l);
            },
          },
          h("span", { class: "num" }, perguntas ? "?" : l.estado === "processado" ? "✓" : "…"),
          h(
            "div",
            { class: "txt" },
            h("div", { class: "com" }, rotulo + " · " + hora),
            perguntas ? h("div", { class: "perg" }, perguntas > 1 ? `${perguntas} perguntas de ${AGENTE} aguardam resposta` : `${AGENTE} fez uma pergunta — clique para responder`) : null,
            l.nota ? h("div", { class: "nota" }, l.nota) : null
          )
        )
      );
    }
    ui.fila.append(h("div", { class: "cab-lotes" }, "Fila atual"));
  }
  if (estado.anotacoes.length === 0) ui.fila.append(h("div", { class: "vazio" }, "Nenhuma anotação pendente. Clique num elemento para começar."));
  for (const a of estado.anotacoes) {
    const meta = a.elemento.meta;
    const comp = meta.componentes[0];
    const quantas = a.alteracoes.length + (a.texto ? 1 : 0);
    ui.fila.append(
      h(
        "div",
        { class: "item" },
        h("span", { class: "num" }, String(a.ordem)),
        h(
          "div",
          { class: "txt" },
          h("div", { class: "el mono" }, (comp ? comp + " › " : "") + meta.tag + (meta.texto ? ' "' + meta.texto.slice(0, 40) + '"' : "")),
          a.comentario ? h("div", { class: "com" }, a.comentario) : null,
          quantas ? h("div", { class: "alt" }, quantas + " alteração(ões): " + a.alteracoes.map((x) => x.propriedade).concat(a.texto ? ["texto"] : []).join(", ")) : null
        ),
        h("button", {
          class: "an-ico",
          title: "Editar",
          html: ICONES.sliders,
          onclick: () => {
            ui.fila.hidden = true;
            if (estado.atual) cancelarEdicao();
            abrirEdicao(a);
            abrirPainel(a);
          },
        }),
        h("button", {
          class: "an-ico",
          title: textoInterface("Excluir"),
          html: ICONES.lixeira,
          onclick: () => {
            excluirAnotacao(a);
            alternarFila(true);
          },
        })
      )
    );
  }
  ui.fila.hidden = false;
  posicionarFila();
}

// ---------- envio ----------
function rectPagina(rect: Rect): Rect {
  return { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height };
}

const capturasEmAndamento = new Map<string, AbortController>();

function renderizarAnexos(a: AnotacaoLocal, destino: HTMLElement, botao: HTMLButtonElement): void {
  destino.replaceChildren();
  const anexos = a.anexos ?? [];
  botao.disabled = capturasEmAndamento.has(a.id) || anexos.length >= 3;
  if (!anexos.length) return;
  destino.append(h("p", { class: "an-anexos-nota" }, anexos.length + "/3 prints anexados. Serão incluídos ao enviar a anotação."));
  for (const [indice, anexo] of anexos.entries()) {
    const url = CFG.base + "/anexos/" + encodeURIComponent(anexo.id) + "/imagem";
    destino.append(h("div", { class: "an-anexo" },
      h("a", { href: url, target: "_blank", rel: "noopener", title: "Abrir print " + (indice + 1) },
        h("img", { src: url, alt: "Print " + (indice + 1) + " da página anotada", loading: "lazy" })),
      h("div", { class: "an-anexo-info" },
        h("strong", null, "Print " + (indice + 1)),
        h("span", null, anexo.largura + " × " + anexo.altura + " px"),
        h("a", { href: url, download: "anotacao-" + a.ordem + "-print-" + (indice + 1) + ".png" }, "Baixar")),
      h("button", { type: "button", class: "an-ico", title: "Remover print " + (indice + 1) + " da anotação", "aria-label": "Remover print " + (indice + 1) + " da anotação", html: ICONES.fechar, onclick: () => {
        a.anexos = (a.anexos ?? []).filter((item) => item.id !== anexo.id);
        salvar(true);
        renderizarAnexos(a, destino, botao);
      } }),
    ));
  }
}

async function tirarPrintDaTela(a: AnotacaoLocal, botao: HTMLButtonElement, atualizarAnexos: () => void): Promise<void> {
  if (capturasEmAndamento.has(a.id) || (a.anexos?.length ?? 0) >= 3) return;
  const controle = new AbortController();
  capturasEmAndamento.set(a.id, controle);
  salvar(true);
  botao.disabled = true;
  definirTextoInterface(botao, "Capturando…");
  try {
    const chave = chaveGuardada();
    const r = await fetch(CFG.base + "/anexos/captura", {
      method: "POST",
      signal: controle.signal,
      headers: { "content-type": "application/json", ...(chave ? { "x-anotador-chave": chave } : {}) },
      body: JSON.stringify({
        anotacaoId: a.id,
        instantaneo: instantaneoHtml([a]),
        pagina: { url: location.href, caminho: location.pathname, viewport: { largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio || 1, scrollX, scrollY } },
      }),
    });
    if (!r.ok) {
      const erro = await r.json().catch(() => ({})) as { erro?: string };
      throw new Error(r.status === 403 ? "Conecte este navegador pelo link de acesso do Anotador e tente novamente. Seu comentário continua aqui." : (erro.erro ?? `HTTP ${r.status}`));
    }
    const corpo = await r.json() as { anexo?: AnexoImagem };
    if (!corpo.anexo || !corpo.anexo.id || corpo.anexo.anotacaoId !== a.id) throw new Error("O servidor não confirmou o anexo.");
    if (controle.signal.aborted || (estado.atual !== a && !estado.anotacoes.includes(a))) return;
    a.anexos = [...(a.anexos ?? []), corpo.anexo];
    salvar(true);
    avisar("Print anexado. A imagem será incluída quando você enviar esta anotação.");
  } catch (erro) {
    if (!controle.signal.aborted) avisar("Não foi possível anexar o print: " + (erro instanceof Error ? erro.message : String(erro)), 6000);
  } finally {
    if (capturasEmAndamento.get(a.id) === controle) capturasEmAndamento.delete(a.id);
    definirTextoInterface(botao, "Tirar print da tela");
    atualizarAnexos();
  }
}

function instantaneoHtml(anotacoes: AnotacaoLocal[]): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const n of clone.querySelectorAll("#__anotador_host, script, nextjs-portal, [data-nextjs-toast], link[rel=preload], link[rel=modulepreload]")) n.remove();
  const head = clone.querySelector("head") ?? clone.insertBefore(document.createElement("head"), clone.firstChild);
  head.insertBefore(h("base", { href: location.origin + "/" }), head.firstChild);
  const body = clone.querySelector("body");
  if (body) {
    for (const a of anotacoes) {
      const el = estado.elementos.get(a.id);
      if (!a.area && (!el || !el.isConnected)) continue;
      const r = a.area?.rectPagina ?? rectPagina(rectAnotacao(a));
      body.append(
        h("div", {
          style: "position:absolute;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border:2px solid #1d4ed8;border-radius:3px;box-sizing:border-box;pointer-events:none;z-index:2147483000",
        }),
        h(
          "div",
          {
            style: "position:absolute;left:" + (r.left - 12) + "px;top:" + (r.top - 12) + "px;width:24px;height:24px;border-radius:999px;background:#2563eb;color:#fff;border:2px solid #fff;font:700 12px/20px system-ui,sans-serif;text-align:center;z-index:2147483001",
          },
          String(a.ordem)
        )
      );
    }
  }
  return "<!doctype html>\n" + clone.outerHTML;
}

async function enviar(): Promise<void> {
  if (estado.anotacoes.length === 0 || estado.envioEmAndamento) return;
  if (capturasEmAndamento.size) { avisar("Aguarde o print terminar de anexar antes de enviar."); return; }
  if (estado.atual) cancelarEdicao();
  const anotacoes = estado.anotacoes.slice();
  const idsEnviados = new Set(anotacoes.map((a) => a.id));
  estado.envioEmAndamento = idsEnviados;
  atualizarBarra();
  let falhou = false;
  try {
    const lote: Lote = {
      id: uuid(),
      ferramenta: "anotador-ui",
      versao: 1,
      enviadoEm: new Date().toISOString(),
      pagina: {
        url: location.href,
        caminho: location.pathname,
        titulo: document.title,
        viewport: { largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio || 1, scrollX, scrollY },
        tema: document.documentElement.getAttribute("data-theme"),
        userAgent: navigator.userAgent,
      },
      anotacoes: anotacoes.map((a) => {
        const el = estado.elementos.get(a.id);
        const vivo = !!el && el.isConnected;
        return {
          id: a.id,
          ordem: a.ordem,
          comentario: a.comentario,
          elemento: { ...a.elemento, rect: rectAnotacao(a), rectPagina: a.area?.rectPagina ?? (vivo ? rectPagina(rectTopo(el)) : null), localizado: a.area ? true : vivo },
          alteracoes: a.alteracoes,
          texto: a.texto,
          criadaEm: a.criadaEm,
          anexos: a.anexos,
          area: a.area,
        };
      }),
      instantaneo: CFG.capturas ? instantaneoHtml(anotacoes) : null,
    };
    const resp = await fetch(CFG.base + "/lotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lote) });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const corpo = (await resp.json()) as { id?: string };
    const agora = new Date().toISOString();
    for (const a of anotacoes) {
      a.enviadaEm = agora;
      estado.enviadas.push(a);
    }
    estado.anotacoes = estado.anotacoes.filter((a) => !idsEnviados.has(a.id));
    estado.lotes.push({
      id: corpo.id ?? lote.id,
      enviadoEm: agora,
      estado: "recebido",
      resumo: anotacoes.map((a) => a.comentario || a.elemento.meta.tag).join(" · ").slice(0, 120),
    });
    renderizarPins();
    salvar();
    avisar(anotacoes.length + " anotação(ões) enviada(s) ao chat.");
    void acompanharLotes();
  } catch (erro) {
    falhou = true;
    avisar("Não foi possível enviar: " + (erro instanceof Error ? erro.message : String(erro)), 5000);
  } finally {
    estado.envioEmAndamento = null;
    atualizarBarra();
    if (falhou) {
      ui.estado.className = "an-estado erro";
      ui.estado.textContent = "Falha ao enviar — fila preservada";
    }
  }
}

let acompanhando = false;
async function acompanharLotes(): Promise<void> {
  if (acompanhando) return;
  acompanhando = true;
  const inicio = Date.now();
  // Lote processado ainda pode receber nota/pergunta do Claude por alguns minutos.
  const relevante = (l: LoteLocal) => l.estado !== "processado" || Date.now() - new Date(l.enviadoEm).getTime() < 15 * 60 * 1000 || estado.conversa?.lote.id === l.id;
  while (estado.lotes.some(relevante) && (Date.now() - inicio < 45 * 60 * 1000 || (!!estado.conversa && !ui.conversa?.hidden && !raiz?.hidden))) {
    await new Promise((r) => setTimeout(r, 2500));
    for (const l of estado.lotes) {
      if (!relevante(l)) continue;
      try {
        const resp = await fetch(CFG.base + "/lotes/" + encodeURIComponent(l.id) + "/status", { cache: "no-store" });
        if (!resp.ok) continue;
        const s = (await resp.json()) as StatusLote;
        l.execucao = s.execucao;
        const abertas = s.perguntasAbertas ?? 0;
        if (abertas !== (l.perguntasAbertas ?? 0)) {
          const novas = abertas > (l.perguntasAbertas ?? 0);
          l.perguntasAbertas = abertas;
          if (novas) {
            avisar(`${AGENTE} fez uma pergunta — responda na conversa do lote.`, 6000);
            if (raiz && !raiz.hidden) void abrirConversa(l);
          }
          if (estado.conversa?.lote.id === l.id) await recarregarConversa();
        }
        if (s.estado !== l.estado || (s.nota ?? "") !== (l.nota ?? "")) {
          const comecou = s.estado === "em_andamento" && l.estado !== "em_andamento";
          l.estado = s.estado;
          l.nota = s.nota ?? "";
          if (comecou) avisar(`${AGENTE} começou` + (s.nota ? ": " + s.nota : "."), 4000);
          if (s.estado === "processado") avisar(`${AGENTE} aplicou o lote` + (s.nota ? ": " + s.nota : "."), 6000);
          if (estado.conversa?.lote.id === l.id) await recarregarConversa();
        }
      } catch {
        /* servidor indisponível no momento; tenta de novo */
      }
    }
    // Mensagens podem chegar sem mudar o estado ou o número de perguntas.
    if (estado.conversa && !ui.conversa?.hidden && !raiz?.hidden) await recarregarConversa();
    atualizarBarra();
    salvar();
  }
  acompanhando = false;
}

// ---------- conversa dos lotes ----------
idiomasInterface?.registrar({
  "en": {
    "Anotações do lote": "Batch annotations",
    "Redimensionar conversa": "Resize conversation",
    "Ampliar ou reduzir conversa": "Expand or restore conversation",
    "Histórico de lotes": "Batch history",
    "Recarregar histórico": "Reload history",
    "Consultando status": "Checking status",
    "Aguardando início": "Waiting to start",
    "Concluído": "Completed",
    "Em andamento": "In progress",
    "Aguardando": "Waiting",
    "Responder": "Reply",
    "Falha no agente": "Agent failed",
    "Falha na execução": "Execution failed",
    "Execução encerrada": "Execution ended",
    "O agente encerrou a execução sem confirmar a conclusão do lote.": "The agent ended the execution without confirming completion of the batch.",
    "Agente em execução": "Agent running",
    "Conversas do agente": "Agent conversations",
    "Agente e modelo": "Agent and model",
    "O lote foi recebido. O agente ainda não publicou uma atualização.": "The batch was received. The agent has not posted an update yet.",
    "O agente está executando. As atualizações publicadas aparecem abaixo.": "The agent is running. Published updates appear below.",
    "Nenhuma mensagem neste lote.": "No messages in this batch.",
    "As respostas e ações publicadas pelo agente aparecem aqui.": "The agent’s published replies and actions appear here.",
    "Não foi possível atualizar este lote. Tente novamente.": "Could not update this batch. Try again.",
    "A execução terminou com código {codigo}. O lote ainda não foi concluído.": "Execution ended with code {codigo}. The batch has not been completed.",
    "A execução falhou. Abra o lote para ver os detalhes.": "Execution failed. Open the batch for details.",
    "Aguarde a operação do chat terminar.": "Wait for the chat operation to finish.",
    "Este agente não está disponível no chat. Escolha um agente na configuração.": "This agent is unavailable in chat. Choose an agent in settings.",
    "Escolha uma sessão do agente para consultar mensagens, consumo e contexto. O lote permanece no seu histórico.": "Choose an agent session to view messages, usage and context. The batch remains in your history."
  },
  "es": {
    "Anotações do lote": "Anotaciones del lote",
    "Redimensionar conversa": "Redimensionar conversación",
    "Ampliar ou reduzir conversa": "Ampliar o restaurar conversación",
    "Histórico de lotes": "Historial de lotes",
    "Recarregar histórico": "Recargar historial",
    "Consultando status": "Consultando estado",
    "Aguardando início": "Esperando inicio",
    "Concluído": "Completado",
    "Em andamento": "En curso",
    "Aguardando": "Esperando",
    "Responder": "Responder",
    "Falha no agente": "Error del agente",
    "Falha na execução": "La ejecución falló",
    "Execução encerrada": "Ejecución finalizada",
    "O agente encerrou a execução sem confirmar a conclusão do lote.": "El agente terminó la ejecución sin confirmar que el lote se haya completado.",
    "Agente em execução": "Agente en ejecución",
    "Conversas do agente": "Conversaciones del agente",
    "Agente e modelo": "Agente y modelo",
    "O lote foi recebido. O agente ainda não publicou uma atualização.": "Se recibió el lote. El agente aún no ha publicado una actualización.",
    "O agente está executando. As atualizações publicadas aparecem abaixo.": "El agente está ejecutándose. Las actualizaciones publicadas aparecen abajo.",
    "Nenhuma mensagem neste lote.": "No hay mensajes en este lote.",
    "As respostas e ações publicadas pelo agente aparecem aqui.": "Las respuestas y acciones publicadas por el agente aparecen aquí.",
    "Não foi possível atualizar este lote. Tente novamente.": "No se pudo actualizar este lote. Inténtalo de nuevo.",
    "A execução terminou com código {codigo}. O lote ainda não foi concluído.": "La ejecución terminó con código {codigo}. El lote aún no se ha completado.",
    "A execução falhou. Abra o lote para ver os detalhes.": "La ejecución falló. Abre el lote para ver los detalles.",
    "Aguarde a operação do chat terminar.": "Espera a que termine la operación del chat.",
    "Este agente não está disponível no chat. Escolha um agente na configuração.": "Este agente no está disponible en el chat. Elige un agente en la configuración.",
    "Escolha uma sessão do agente para consultar mensagens, consumo e contexto. O lote permanece no seu histórico.": "Elige una sesión del agente para consultar mensajes, consumo y contexto. El lote permanece en tu historial."
  }
});
const rascunhosConversa = new Map<string, string>();
interface ExecucaoLoteUI {
  loteId?: string; agente: string; modelo?: string | null; erro?: string; iniciadoEm: string;
  terminadoEm: string | null; codigo: number | null; motivo?: string;
}
let execucoesConversa: { em: number; lista: ExecucaoLoteUI[] } = { em: 0, lista: [] };
async function lerExecucaoConversa(lote: LoteLocal): Promise<ExecucaoLoteUI | null> {
  if (Date.now() - execucoesConversa.em > 4000) {
    const r = await pedirApi("/agentes");
    if (r.ok && Array.isArray(r.dados.execucoes)) {
      execucoesConversa = { em: Date.now(), lista: r.dados.execucoes as ExecucaoLoteUI[] };
    }
  }
  const prefixo = lote.id.slice(0, 8);
  const conhecidos = new Set([...historicoConversa.keys(), ...estado.lotes.map(l => l.id)]);
  const prefixoUnico = [...conhecidos].filter(id => id.startsWith(prefixo)).length === 1;
  return execucoesConversa.lista.filter(e => typeof e.agente === "string" && (e.loteId === lote.id || (!e.loteId && prefixoUnico && e.motivo === `lote ${prefixo} sem ninguém ouvindo` && Date.parse(e.iniciadoEm) >= Date.parse(lote.enviadoEm) && Date.parse(e.iniciadoEm) - Date.parse(lote.enviadoEm) < 300000)))
    .sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm))[0] ?? null;
}
const historicoConversa = new Map<string, LoteLocal>();
let erroHistoricoConversa = false;
let tamanhoConversa: { largura: number; altura: number } | null = null;
let conversaAmpliada = false;
let redimensionandoConversa = false;
let atualizacaoConversaPendente = false;
const CHAVE_TAMANHO_CONVERSA = "anotador-ui:conversa:tamanho";
try {
  const salvo = JSON.parse(localStorage.getItem(CHAVE_TAMANHO_CONVERSA) || "null");
  if (salvo && Number.isFinite(salvo.largura) && Number.isFinite(salvo.altura)) tamanhoConversa = salvo;
} catch { /* dimensão padrão */ }

function guardarRascunhoConversa(): void {
  const painel = ui.conversa;
  const id = painel?.dataset.loteId;
  const campo = painel?.querySelector<HTMLTextAreaElement>(".entrada textarea");
  if (id && campo) rascunhosConversa.set(id, campo.value);
  if (rascunhosConversa.size > 100) rascunhosConversa.delete(rascunhosConversa.keys().next().value!);
}
function ajustarTamanhoConversa(): void {
  const painel = ui.conversa;
  if (!painel || painel.hidden) return;
  const maxW = Math.max(160, innerWidth - 16), maxH = Math.max(180, innerHeight - 16);
  const largura = conversaAmpliada ? maxW : Math.min(maxW, Math.max(Math.min(300, maxW), tamanhoConversa?.largura ?? 420));
  const altura = conversaAmpliada ? maxH : Math.min(maxH, Math.max(Math.min(280, maxH), tamanhoConversa?.altura ?? Math.min(innerHeight * .74, 680)));
  painel.style.width = largura + "px"; painel.style.height = altura + "px";
  if (conversaAmpliada) aplicarPosicao(painel, { left: 8, top: 8 });
  else {
    const r = painel.getBoundingClientRect();
    aplicarPosicao(painel, limitar(painel, { left: r.left, top: r.top }));
  }
}
function controleTamanhoConversa(): HTMLElement {
  const controle = h("button", { type: "button", class: "an-conversa-redimensionar", title: textoInterface("Redimensionar conversa"), "aria-label": textoInterface("Redimensionar conversa"), html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 13 8-8m-3 8 3-3"/></svg>' });
  const ajustar = (largura: number, altura: number): void => {
    conversaAmpliada = false;
    tamanhoConversa = { largura: Math.min(innerWidth - 16, Math.max(Math.min(300, innerWidth - 16), largura)), altura: Math.min(innerHeight - 16, Math.max(Math.min(280, innerHeight - 16), altura)) };
    ajustarTamanhoConversa();
  };
  const gravar = (): void => { try { localStorage.setItem(CHAVE_TAMANHO_CONVERSA, JSON.stringify(tamanhoConversa)); } catch { /* em memória */ } };
  controle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !ui.conversa) return;
    e.preventDefault(); e.stopPropagation();
    const r = ui.conversa.getBoundingClientRect(), x = e.clientX, y = e.clientY;
    redimensionandoConversa = true; controle.focus({ preventScroll: true }); controle.setPointerCapture(e.pointerId);
    const abortar = new AbortController();
    const mover = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      if (!(ev.buttons & 1)) { soltar(); return; }
      ajustar(r.width + ev.clientX - x, r.height + ev.clientY - y);
    };
    const soltar = (ev?: Event): void => {
      if (ev instanceof PointerEvent && ev.pointerId !== e.pointerId) return;
      abortar.abort();
      redimensionandoConversa = false; gravar();
      controle.removeEventListener("pointermove", mover); controle.removeEventListener("pointerup", soltar); controle.removeEventListener("pointercancel", soltar); controle.removeEventListener("lostpointercapture", soltar);
      if (controle.hasPointerCapture(e.pointerId)) controle.releasePointerCapture(e.pointerId);
      if (atualizacaoConversaPendente) { atualizacaoConversaPendente = false; renderizarConversa(); }
    };
    window.addEventListener("blur", soltar, { signal: abortar.signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) soltar(); }, { signal: abortar.signal });
    controle.addEventListener("pointermove", mover); controle.addEventListener("pointerup", soltar); controle.addEventListener("pointercancel", soltar); controle.addEventListener("lostpointercapture", soltar);
  });
  controle.addEventListener("keydown", (e) => {
    if (!e.key.startsWith("Arrow") || !ui.conversa) return;
    e.preventDefault(); e.stopPropagation(); const r = ui.conversa.getBoundingClientRect(), passo = e.shiftKey ? 40 : 16;
    ajustar(r.width + (e.key === "ArrowRight" ? passo : e.key === "ArrowLeft" ? -passo : 0), r.height + (e.key === "ArrowDown" ? passo : e.key === "ArrowUp" ? -passo : 0)); gravar();
  });
  return controle;
}
function agenteConversa(c: ConversaAberta): string {
  return c.execucao?.agente || [...c.mensagens].reverse().find(m => m.autor === "agente" && m.agente)?.agente || AGENTE;
}
async function atualizarHistoricoConversa(): Promise<void> {
  try {
    const r = await pedirApi("/lotes");
    if (!r.ok || !Array.isArray(r.dados.lotes)) throw new Error("histórico indisponível");
    for (const bruto of r.dados.lotes.slice(-100)) {
      const l = bruto as Partial<RegistroLote>;
      if (typeof l.id !== "string" || !/^[\w-]{1,128}$/.test(l.id) || typeof l.enviadoEm !== "string" || !Number.isFinite(Date.parse(l.enviadoEm))) continue;
      historicoConversa.set(l.id, estado.lotes.find(x => x.id === l.id) ?? { id: l.id, enviadoEm: l.enviadoEm, estado: "desconhecido", resumo: typeof l.titulo === "string" ? l.titulo.slice(0, 120) : "" });
    }
    erroHistoricoConversa = false;
  } catch { erroHistoricoConversa = true; }
  if (estado.conversa) renderizarConversa();
}
async function abrirControlesConversa(destino: "sessoes" | "conta" | "configuracao"): Promise<void> {
  const c = estado.conversa;
  if (!c || c.carregando) return;
  guardarRascunhoConversa();
  if (await abrirChatDoLote(agenteConversa(c), destino)) {
    if (estado.conversa === c) fecharConversa();
  }
}
function controlesConversa(painel: HTMLElement, c: ConversaAberta, rotuloEstado: string): void {
  const historico = h("select", { "aria-label": textoInterface("Histórico de lotes") });
  const lotes = new Map([...historicoConversa, ...estado.lotes.map(l => [l.id, l] as const)]);
  for (const l of [...lotes.values()].sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm))) {
    historico.append(h("option", { value: l.id }, new Date(l.enviadoEm).toLocaleString(idiomaInterface(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " · " + (l.resumo || l.id)));
  }
  historico.value = c.lote.id;
  historico.addEventListener("change", () => { const escolhido = lotes.get(historico.value); if (escolhido) void abrirConversa(escolhido); });
  const navegacao = h("div", { class: "an-conversa-navegacao" }, h("label", { class: "an-conversa-historico" }, textoInterface("Histórico de lotes"), historico, criarSeletorPersonalizado(historico, traduzirInterface("Histórico de lotes"))));
  if (erroHistoricoConversa) navegacao.append(h("button", { type: "button", class: "an-btn", onclick: () => void atualizarHistoricoConversa() }, textoInterface("Recarregar histórico")));
  painel.append(navegacao);
  const ultima = [...c.mensagens].reverse().find(m => m.autor === "agente");
  const falhou = !!c.erroExecucao || !!(c.execucao?.terminadoEm && c.execucao.codigo !== 0);
  const rodando = c.execucao && !c.execucao.terminadoEm;
  const encerrouSemConfirmar = !!c.execucao?.terminadoEm && c.execucao.codigo === 0 && c.lote.estado !== "processado";
  const situacao = c.lote.estado === "processado" ? rotuloEstado : falhou ? "Falha na execução" : rodando ? "Agente em execução" : encerrouSemConfirmar ? "Execução encerrada" : rotuloEstado;
  const atividade = c.erroExecucao || (encerrouSemConfirmar ? traduzirInterface("O agente encerrou a execução sem confirmar a conclusão do lote.") : falhou ? traduzirInterface("A execução terminou com código {codigo}. O lote ainda não foi concluído.", { codigo: c.execucao?.codigo ?? "?" }) : c.lote.nota || ultima?.texto);
  const box = h("div", { class: "an-conversa-atividade" + (falhou ? " falha" : ""), role: "status" }, h("strong", null, textoInterface(situacao)), h("span", null, atividade || textoInterface(rodando ? "O agente está executando. As atualizações publicadas aparecem abaixo." : c.lote.estado === "processado" ? "Nenhuma mensagem neste lote." : "O lote foi recebido. O agente ainda não publicou uma atualização.")));
  if (c.execucao) box.append(h("small", null, [c.execucao.agente, c.execucao.modelo, hora(c.execucao.iniciadoEm), c.execucao.terminadoEm ? hora(c.execucao.terminadoEm) : ""].filter(Boolean).join(" · ")));
  painel.append(box);
  if (c.erroLeitura) painel.append(h("div", { class: "an-conversa-erro", role: "alert" }, textoInterface(c.erroLeitura), h("button", { type: "button", class: "an-btn", onclick: () => void recarregarConversa() }, textoInterface("Tentar novamente"))));
  painel.append(h("div", { class: "an-conversa-atalhos" },
    h("button", { type: "button", class: "an-btn", disabled: c.carregando || !!c.erroLeitura, onclick: () => void abrirControlesConversa("sessoes") }, textoInterface("Conversas do agente")),
    h("button", { type: "button", class: "an-btn", disabled: c.carregando || !!c.erroLeitura, onclick: () => void abrirControlesConversa("conta") }, textoInterface("Uso da conta")),
    h("button", { type: "button", class: "an-btn", disabled: c.carregando || !!c.erroLeitura, onclick: () => void abrirControlesConversa("configuracao") }, textoInterface("Agente e modelo"))));
}
async function abrirConversa(lote: LoteLocal): Promise<void> {
  if (!raiz) return;
  if (raiz.hidden) religar();
  guardarRascunhoConversa();
  if (estado.ditado && ui.conversa?.contains(estado.ditado.botao)) pararDitado();
  if (!estado.lotes.some(l => l.id === lote.id)) estado.lotes.push(lote);
  estado.conversa = { lote, mensagens: [], selecao: new Map(), carregando: true };
  if (!ui.conversa) {
    ui.conversa = h("div", { class: "an-conversa" });
    raiz.append(ui.conversa);
    window.addEventListener("resize", ajustarTamanhoConversa);
  }
  ui.conversa.hidden = false;
  renderizarConversa();
  // A retomada do rascunho/voz só prossegue quando a montagem inicial terminou.
  await Promise.all([recarregarConversa(), atualizarHistoricoConversa()]);
  void acompanharLotes();
}

function fecharConversa(): void {
  guardarRascunhoConversa();
  if (estado.ditado && ui.conversa?.contains(estado.ditado.botao)) pararDitado();
  estado.conversa = null;
  if (ui.conversa) ui.conversa.hidden = true;
}

async function recarregarConversa(): Promise<void> {
  const c = estado.conversa;
  if (!c) return;
  try {
    const base = "/lotes/" + encodeURIComponent(c.lote.id);
    const [conversa, status, execucao] = await Promise.all([pedirApi(base + "/conversa"), pedirApi(base + "/status"), lerExecucaoConversa(c.lote).catch(() => null)]);
    if (!conversa.ok || !Array.isArray(conversa.dados.mensagens) || !Array.isArray(conversa.dados.abertas)) throw new Error("leitura indisponível");
    if (estado.conversa !== c) return;
    const mensagens = conversa.dados.mensagens as Mensagem[];
    const s = status.ok ? status.dados as unknown as StatusLote & { execucao?: ExecucaoLoteUI; erro?: string } : null;
    const execucaoAtual = s?.execucao ?? execucao;
    const mudou = c.carregando || c.erroLeitura || c.erroExecucao !== (execucaoAtual?.erro ?? s?.erro) || JSON.stringify(c.execucao) !== JSON.stringify(execucaoAtual) || JSON.stringify(c.mensagens) !== JSON.stringify(mensagens) || (s && (s.estado !== c.lote.estado || s.nota !== c.lote.nota));
    c.mensagens = mensagens; c.carregando = false; c.erroLeitura = undefined; c.execucao = execucaoAtual; c.erroExecucao = execucaoAtual?.erro ?? s?.erro; c.lote.execucao = execucaoAtual;
    c.lote.perguntasAbertas = conversa.dados.abertas.length;
    if (s && ["recebido", "em_andamento", "processado", "desconhecido"].includes(s.estado)) { c.lote.estado = s.estado; c.lote.nota = s.nota; }
    if (mudou) {
      if (redimensionandoConversa) atualizacaoConversaPendente = true;
      else renderizarConversa();
    }
    atualizarBarra(); salvar();
  } catch {
    if (estado.conversa !== c || c.erroLeitura) return;
    c.carregando = false; c.erroLeitura = "Não foi possível atualizar este lote. Tente novamente.";
    renderizarConversa();
  }
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function perguntasPendentesConversa(c: ConversaAberta): Mensagem[] {
  const respondidas = new Set(c.mensagens.filter(m => m.responde).map(m => m.responde));
  return c.mensagens.filter(m => m.autor === "agente" && (m.tipo === "pergunta" || m.tipo === "escolha") && !respondidas.has(m.id));
}

function renderizarConversa(): void {
  const c = estado.conversa;
  const painel = ui.conversa;
  if (!c || !painel) return;
  guardarRascunhoConversa();
  const campoAnterior = painel.querySelector<HTMLTextAreaElement>(".entrada textarea");
  // Atualizações do histórico e do agente não encerram uma gravação ou a espera
  // pela permissão. Conserva os nós aos quais o reconhecimento está vinculado.
  const entradaMantida = painel.dataset.loteId === c.lote.id && estado.ditado && painel.contains(estado.ditado.botao)
    ? campoAnterior?.closest<HTMLElement>(".entrada") ?? null : null;
  const manterFoco = painel.dataset.loteId === c.lote.id && campoAnterior === (painel.getRootNode() as ShadowRoot).activeElement;
  const selecaoAnterior = [campoAnterior?.selectionStart ?? 0, campoAnterior?.selectionEnd ?? 0];
  const textoAnterior = rascunhosConversa.get(c.lote.id) ?? "";
  painel.dataset.loteId = c.lote.id;
  const nomeAgente = agenteConversa(c);
  const marcaConversa = nomeAgente === AGENTE ? MARCA_AGENTE : "";
  if (!entradaMantida && estado.ditado && painel.contains(estado.ditado.botao)) pararDitado();
  const abertas = perguntasPendentesConversa(c);
  const rotuloEstado = c.carregando ? "Consultando status" : c.lote.estado === "processado" ? "Concluído" : c.lote.estado === "em_andamento" ? "Em andamento" : c.lote.estado === "desconhecido" ? "Consultando status" : "Aguardando início";
  // Rolagem grudada embaixo: só acompanha se o usuário já estava no fim da conversa.
  const fluxoAnterior = painel.querySelector<HTMLDivElement>(".fluxo");
  const scrollAnterior = fluxoAnterior?.scrollTop ?? 0;
  const coladoNoFim = !fluxoAnterior || fluxoAnterior.scrollHeight - fluxoAnterior.scrollTop - fluxoAnterior.clientHeight < 40;

  if (entradaMantida) {
    for (const filho of [...painel.children]) if (filho !== entradaMantida) filho.remove();
  } else painel.textContent = "";
  const alca = h("span", { class: "an-alca", html: ICONES.alca, title: "Arrastar" });
  const cab = h(
    "div",
    { class: "cab" },
    alca,
    h("span", { class: "marca", html: marcaConversa || ICONES.sliders }),
    h("div", { class: "tit" }, textoInterface("Anotações do lote"), h("span", { class: "sub" }, nomeAgente + " · " + hora(c.lote.enviadoEm))),
    h("button", { type: "button", class: "an-ico an-conversa-ampliar", title: textoInterface("Ampliar ou reduzir conversa"), "aria-label": textoInterface("Ampliar ou reduzir conversa"), "aria-pressed": String(conversaAmpliada), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>', onclick: () => { conversaAmpliada = !conversaAmpliada; renderizarConversa(); } }),
    h("button", { class: "an-ico", title: "Fechar", html: ICONES.fechar, onclick: fecharConversa })
  );
  painel.append(cab);
  tornarArrastavel(painel, [alca, cab], "conversa");
  controlesConversa(painel, c, rotuloEstado);

  const fluxo = h("div", { class: "fluxo" });
  if (!c.mensagens.length) {
    fluxo.append(h("div", { class: "vazio" }, c.lote.estado === "processado" ? "Nenhuma mensagem neste lote." : traduzirInterface("As respostas e ações publicadas pelo agente aparecem aqui.")));
  }
  const usuarioRespondeu = new Map(c.mensagens.filter((m) => m.responde).map((m) => [m.responde ?? "", m] as const));
  for (const m of c.mensagens) {
    if (m.autor === "usuario" && m.responde) continue;
    // Passo não é fala: é o agente dizendo em que ponto está. Vai numa linha fina, com
    // horário, para a sequência ficar legível sem competir com o que ele escreveu.
    if (m.tipo === "passo") {
      fluxo.append(h("div", { class: "an-passo" }, h("span", { class: "ponto" }), h("span", { class: "texto" }, m.texto), h("span", { class: "quando" }, hora(m.em))));
      continue;
    }
    const corpo = h("div", { class: "corpo" });
    if (m.autor === "agente") corpo.append(h("div", { class: "quem" }, (m.agente || nomeAgente) + " · " + hora(m.em)));
    corpo.append(h("div", { class: "balao" }, m.texto));
    if (m.autor === "agente" && (m.tipo === "pergunta" || m.tipo === "escolha")) {
      const resposta = usuarioRespondeu.get(m.id);
      if (resposta) {
        const escolhidas = resposta.opcoes?.length ? resposta.opcoes.join(", ") : "";
        corpo.append(h("div", { class: "escolhida" }, "Você respondeu" + (escolhidas ? ": " + escolhidas : "") + (resposta.texto && resposta.texto !== escolhidas ? (escolhidas ? " — " : ": ") + resposta.texto : "")));
      } else if (m.tipo === "escolha" && m.opcoes?.length) {
        const marcadas = c.selecao.get(m.id) ?? new Set<string>();
        const grupo = h("div", { class: "an-perguntas" }, h("div", { class: "rot" }, m.multipla ? "Escolha uma ou mais" : "Escolha uma opção"));
        for (const opcao of m.opcoes) {
          grupo.append(
            h("button", {
              class: "an-opcao" + (marcadas.has(opcao) ? " marcada" : ""),
              onclick: () => {
                if (m.multipla) {
                  if (marcadas.has(opcao)) marcadas.delete(opcao);
                  else marcadas.add(opcao);
                  c.selecao.set(m.id, marcadas);
                  renderizarConversa();
                } else {
                  void responder(m, [opcao], "");
                }
              },
            }, h("span", { class: "mira" }), opcao)
          );
        }
        grupo.append(h("button", { class: "an-opcao livre", onclick: () => focarEntrada(m) }, h("span", { class: "mira" }), "Outro…"));
        corpo.append(grupo);
        if (m.multipla && marcadas.size) {
          corpo.append(h("button", { class: "an-btn", style: "align-self:flex-start;background:var(--an-marca)", onclick: () => void responder(m, Array.from(marcadas), "") }, `Enviar ${marcadas.size} selecionada(s)`));
        }
      }
    }
    if (m.autor === "usuario") corpo.append(h("div", { class: "quem" }, "Você · " + hora(m.em)));
    const bloco = h("div", { class: "an-msg " + m.autor });
    if (m.autor === "agente") bloco.append(h("span", { class: "av", html: marcaConversa || ICONES.sliders }));
    bloco.append(corpo);
    fluxo.append(bloco);
  }
  painel.append(fluxo);

  const pendente = abertas[abertas.length - 1];
  if (pendente) painel.append(h("div", { class: "dica-resp" }, pendente.tipo === "escolha" ? "Escolha uma opção acima ou escreva outra resposta." : `${nomeAgente} aguarda sua resposta.`));

  if (entradaMantida) {
    // Move apenas os blocos novos: o campo e eventual player de áudio não são
    // removidos/reinseridos, o que também conserva foco e reprodução da prévia.
    for (const filho of [...painel.children]) if (filho !== entradaMantida) painel.insertBefore(filho, entradaMantida);
    painel.append(controleTamanhoConversa());
    ajustarTamanhoConversa();
    fluxo.scrollTop = coladoNoFim ? fluxo.scrollHeight : scrollAnterior;
    return;
  }

  const campo = h("textarea", { rows: 1, placeholder: pendente ? `Responder a ${nomeAgente}…` : `Recado para ${nomeAgente} sobre este lote…` });
  const enviarBtn = h("button", { class: "an-ok", title: "Enviar (Enter)", html: ICONES.ok, disabled: true });
  const enviarTexto = () => {
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    campo.style.height = "auto";
    enviarBtn.disabled = true;
    // Uma pergunta pode chegar enquanto o compositor é preservado pelo ditado.
    // A resposta pertence à pergunta atualmente aberta, não ao render anterior.
    const abertasAgora = perguntasPendentesConversa(c);
    void responder(abertasAgora[abertasAgora.length - 1] ?? null, [], texto);
  };
  enviarBtn.addEventListener("click", enviarTexto);
  campo.addEventListener("keydown", (e) => {
    // Com o menu aberto, as setas e o Enter pertencem a ele.
    if (comandos.teclado(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarTexto();
    }
  });
  campo.addEventListener("input", () => {
    campo.style.height = "auto";
    campo.style.height = Math.min(160, campo.scrollHeight) + "px";
    enviarBtn.disabled = campo.value.trim() === "";
  });
  const btnMic = h("button", { class: "an-ico", title: "Ditar resposta", "aria-label": "Ditar resposta", "aria-pressed": "false", html: ICONES.mic });
  btnMic.addEventListener("click", () => alternarDitadoEm(campo, btnMic));
  const caixa = h(
    "div",
    { class: "entrada" },
    campo,
    h("div", { class: "acoes" }, criarIdiomaDitado(), btnMic, h("span", { class: "atalho" }, "/ para comandos · Enter envia"), h("span", { class: "esp" }), enviarBtn)
  );
  const comandos = ligarComandos(campo, caixa);
  // Clicar em qualquer lugar da caixa foca o campo, como no Prompt Input do Nexus UI.
  caixa.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("button")) campo.focus();
  });
  painel.append(caixa, controleTamanhoConversa());
  ajustarTamanhoConversa();
  campo.value = textoAnterior;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  fluxo.scrollTop = coladoNoFim ? fluxo.scrollHeight : scrollAnterior;
  if (manterFoco) { campo.focus({ preventScroll: true }); campo.setSelectionRange(selecaoAnterior[0]!, selecaoAnterior[1]!); }
  (painel as HTMLDivElement & { __campo?: HTMLTextAreaElement }).__campo = campo;
}

// ---------------------------------------------------------------------------
// COMANDOS DE BARRA NO CHAT
// ---------------------------------------------------------------------------
//
// A mesma lista que a linha de comando do agente ofereceria: digitou `/`, viu o que
// existe neste projeto e nesta máquina, escolheu. O servidor descobre lendo as pastas
// de skills e comandos do agente conectado; aqui só se apresenta o resultado.

interface ComandoNoChat {
  nome: string;
  descricao: string;
  origem: string;
  tipo: string;
}

let comandosDoAgente: ComandoNoChat[] | null = null;
let buscaDeComandos: Promise<void> | null = null;

function carregarComandos(): Promise<void> {
  buscaDeComandos ??= fetch(CFG.base + "/agente/comandos", { cache: "no-store" })
    .then((r) => r.json() as Promise<{ comandos?: ComandoNoChat[] }>)
    .then((j) => {
      comandosDoAgente = Array.isArray(j.comandos) ? j.comandos : [];
    })
    .catch(() => {
      comandosDoAgente = [];
    });
  return buscaDeComandos;
}

/**
 * Liga o menu ao campo. Devolve quem pergunta se o menu está aberto, porque enquanto
 * estiver, Enter escolhe em vez de enviar — que é o comportamento de qualquer chat de
 * agente, e o contrário disso manda "/" sozinho para o outro lado.
 */
function ligarComandos(campo: HTMLTextAreaElement, caixa: HTMLElement): { aberto: () => boolean; teclado: (e: KeyboardEvent) => boolean } {
  const lista = h("div", { class: "an-comandos-lista" });
  const menu = h("div", { class: "an-comandos" }, lista);
  menu.hidden = true;
  caixa.append(menu);
  let visiveis: ComandoNoChat[] = [];
  let foco = 0;

  // Só enquanto a linha inteira for uma palavra começada por barra: o primeiro espaço
  // é o começo dos argumentos, e aí o menu sai da frente.
  const termo = (): string | null => {
    const m = /^\/(\S*)$/.exec(campo.value);
    return m ? (m[1] ?? "") : null;
  };

  const escolher = (c: ComandoNoChat): void => {
    campo.value = "/" + c.nome + " ";
    menu.hidden = true;
    campo.focus();
    campo.dispatchEvent(new Event("input"));
  };

  const pintar = (): void => {
    lista.replaceChildren();
    if (!visiveis.length) {
      lista.append(
        h(
          "div",
          { class: "an-comandos-vazio" },
          comandosDoAgente === null ? "procurando comandos…" : `${AGENTE} não tem comandos de barra neste projeto`
        )
      );
      return;
    }
    visiveis.forEach((c, i) => {
      const item = h(
        "button",
        {
          type: "button",
          class: "an-comando" + (i === foco ? " foco" : ""),
          onmouseenter: () => {
            foco = i;
            pintar();
          },
          onclick: () => escolher(c),
        },
        h("span", { class: "nome" }, "/" + c.nome),
        h("span", { class: "desc" }, c.descricao),
        h("span", { class: "origem" }, c.origem)
      );
      lista.append(item);
    });
    lista.children[foco]?.scrollIntoView({ block: "nearest" });
  };

  const atualizar = (): void => {
    const t = termo();
    if (t === null) {
      menu.hidden = true;
      return;
    }
    menu.hidden = false;
    if (comandosDoAgente === null) {
      pintar();
      void carregarComandos().then(atualizar);
      return;
    }
    const alvo = t.toLowerCase();
    visiveis = comandosDoAgente.filter((c) => c.nome.toLowerCase().includes(alvo)).slice(0, 8);
    foco = 0;
    pintar();
  };

  campo.addEventListener("input", atualizar);
  campo.addEventListener("blur", () => setTimeout(() => (menu.hidden = true), 150));

  return {
    aberto: () => !menu.hidden,
    teclado: (e: KeyboardEvent) => {
      if (menu.hidden) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (visiveis.length) {
          foco = (foco + (e.key === "ArrowDown" ? 1 : visiveis.length - 1)) % visiveis.length;
          pintar();
        }
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        menu.hidden = true;
        return true;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        const c = visiveis[foco];
        if (!c) return false;
        e.preventDefault();
        escolher(c);
        return true;
      }
      return false;
    },
  };
}

function focarEntrada(pergunta: Mensagem): void {
  const campo = (ui.conversa as (HTMLDivElement & { __campo?: HTMLTextAreaElement }) | null)?.__campo;
  if (!campo) return;
  campo.placeholder = "Sua resposta para: " + resumir(pergunta.texto, 60);
  campo.focus();
}

async function responder(pergunta: Mensagem | null, opcoes: string[], texto: string): Promise<void> {
  const c = estado.conversa;
  if (!c) return;
  // Sem pergunta pendente, a mensagem é um recado livre sobre o lote.
  const corpo: Record<string, unknown> = { autor: "usuario", tipo: "resposta", texto: texto || opcoes.join(", ") };
  if (opcoes.length) corpo["opcoes"] = opcoes;
  if (pergunta) corpo["responde"] = pergunta.id;
  try {
    const resp = await fetch(CFG.base + "/lotes/" + encodeURIComponent(c.lote.id) + "/mensagens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) {
      const erro = (await resp.json().catch(() => ({}))) as { erro?: string };
      avisar("Não foi possível enviar: " + (erro.erro ?? "HTTP " + resp.status), 5000);
      return;
    }
    c.selecao.delete(pergunta?.id ?? "");
    await recarregarConversa();
    avisar(pergunta ? `Resposta enviada a ${AGENTE}.` : `Recado enviado a ${AGENTE}.`);
  } catch (erro) {
    avisar("Não foi possível enviar: " + (erro instanceof Error ? erro.message : String(erro)), 5000);
  }
}

function alternarDitadoEm(campo: HTMLTextAreaElement, botao: HTMLButtonElement): void {
  iniciarDitado(campo, botao);
}

// ---------- árvore de elementos e seleção por área ----------
const CHAVE_ARVORE = "anotador-ui:arvore";
const LIMITE_FILHOS = 40;
const LIMITE_LINHAS = 400;
/** linhas da árvore → elemento da página que representam */
const linhaPara = new Map<HTMLElement, Element>();
let ultimoFocoHorizontalArvore: Element | null = null;
let suprimirCliqueAte = 0;
let observadorArvore: MutationObserver | null = null;
let temporizadorFoco: ReturnType<typeof setTimeout> | null = null;
let renderArvoreAgendado: ReturnType<typeof setTimeout> | null = null;

function dentroDe(e: Event, el: Element | null): boolean {
  return !!el && e.composedPath().includes(el);
}

function lerArvoreAberta(): boolean {
  try {
    return localStorage.getItem(CHAVE_ARVORE) === "1";
  } catch {
    return false;
  }
}

function gravarArvoreAberta(aberta: boolean): void {
  try {
    if (aberta) localStorage.setItem(CHAVE_ARVORE, "1");
    else localStorage.removeItem(CHAVE_ARVORE);
  } catch {
    /* sem armazenamento */
  }
}

function alternarArvore(): void {
  if (estado.arvore.aberta) fecharArvore();
  else abrirArvore();
}

function montarArvore(raizUi: HTMLDivElement): void {
  const alca = h("span", { class: "an-alca", html: ICONES.alca, title: "Arrastar (duplo clique recoloca)" });
  ui.arvoreSub = h("span", { class: "sub" });
  ui.btnFixar = h("button", {
    class: "an-ico",
    title: "Fixar a árvore no elemento atual em vez de seguir o cursor",
    html: ICONES.fixar,
    onclick: () => {
      estado.arvore.fixado = !estado.arvore.fixado;
      renderizarArvore();
    },
  });
  ui.btnLimparArea = h("button", { class: "an-btn mini", title: "Sair da visão de área (Esc)", hidden: true, onclick: () => limparArea() }, "Limpar área");
  ui.arvoreCorpo = h("div", { class: "corpo", role: "tree" });
  ui.arvoreCorpo.addEventListener("mouseover", (e) => {
    const no = (e.target as HTMLElement).closest<HTMLElement>(".an-no");
    const el = no ? linhaPara.get(no) : null;
    if (el && el.isConnected) destacar(ui.caixaHover, el);
  });
  ui.arvoreCorpo.addEventListener("mouseleave", () => {
    if (!estado.hoverEl) ui.caixaHover.style.display = "none";
  });
  ui.arvoreCorpo.addEventListener("keydown", aoTeclarNaArvore);
  const cab = h(
    "div",
    { class: "cab" },
    alca,
    h("span", { class: "an-ico", style: "background:var(--an-superficie-alta)", html: ICONES.arvore }),
    h("div", { class: "tit" }, "Estrutura", ui.arvoreSub),
    ui.btnLimparArea,
    ui.btnFixar,
    h("button", { class: "an-ico", title: "Fechar (Esc)", html: ICONES.fechar, onclick: fecharArvore })
  );
  ui.arvore = h(
    "div",
    { class: "an-arvore", hidden: true },
    cab,
    ui.arvoreCorpo,
    // Cinco instruções emendadas por ponto médio é a mesma coisa que a régua acusa nas
    // páginas alheias; separadas em frases, lê-se sem decifrar.
    h(
      "div",
      { class: "dica-uso" },
      h("span", {}, "Clique seleciona, duplo clique abre as propriedades."),
      h("span", {}, "Arraste na página para listar uma área."),
      h("span", {}, "Setas navegam aqui; com Alt, na página: pai, filho, irmãos.")
    )
  );
  raizUi.append(ui.arvore);
  tornarArrastavel(ui.arvore, [alca, cab], "arvore");
}

function abrirArvore(gravar = true): void {
  if (!raiz || !ui.arvore) return;
  estado.arvore.aberta = true;
  if (gravar) gravarArvoreAberta(true);
  ui.arvore.hidden = false;
  ui.btnArvore.classList.add("ativo");
  restaurarPosicao(ui.arvore, "arvore");
  if (!observadorArvore) {
    // HMR e re-renders trocam nós: a árvore acompanha, com folga para não redesenhar a cada mutação.
    observadorArvore = new MutationObserver(() => agendarRenderArvore(250));
    observadorArvore.observe(document.body, { childList: true, subtree: true });
  }
  renderizarArvore();
}

function fecharArvore(): void {
  estado.arvore.aberta = false;
  gravarArvoreAberta(false);
  if (ui.arvore) ui.arvore.hidden = true;
  ui.btnArvore.classList.remove("ativo");
  observadorArvore?.disconnect();
  observadorArvore = null;
  limparArea(false);
}

function agendarFocoArvore(el: Element): void {
  const a = estado.arvore;
  if (!a.aberta || a.fixado || a.area || estado.atual || a.foco === el) return;
  if (temporizadorFoco) clearTimeout(temporizadorFoco);
  temporizadorFoco = setTimeout(() => {
    temporizadorFoco = null;
    if (!a.aberta || a.fixado || a.area || estado.atual) return;
    a.foco = el;
    a.linhaFocada = null;
    renderizarArvore();
  }, 120);
}

function agendarRenderArvore(ms = 0): void {
  if (!estado.arvore.aberta || renderArvoreAgendado) return;
  renderArvoreAgendado = setTimeout(() => {
    renderArvoreAgendado = null;
    renderizarArvore();
  }, ms);
}

function elementoSelecionado(): Element | null {
  const el = estado.atual ? estado.elementos.get(estado.atual.id) ?? null : null;
  return el && el.isConnected ? el : null;
}

// Na visão de área só a seleção manda; fora dela, seleção > foco (cursor/fixado).
function focoDaArvore(): Element | null {
  const a = estado.arvore;
  const selecionado = elementoSelecionado();
  if (selecionado) return selecionado;
  if (a.area) return null;
  return a.foco && a.foco.isConnected ? a.foco : null;
}

function areaNoViewport(area: AreaSelecionada): Rect {
  return { left: area.rect.left - scrollX, top: area.rect.top - scrollY, width: area.rect.width, height: area.rect.height };
}

function rotuloArea(area: AreaSelecionada): string {
  return `${area.contidos.size}${area.truncado ? "+" : ""} elemento(s)`;
}

function rotuloNo(el: Element, pin: AnotacaoLocal | undefined, r: DOMRect): Node[] {
  const partes: Node[] = [];
  const comp = componenteDono(el);
  if (comp) partes.push(h("span", { class: "comp", title: "Componente React que começa neste nó" }, comp));
  const id = el.id && !ehDinamico(el.id) ? "#" + el.id : "";
  const cls = classesEstaveis(el)
    .slice(0, 2)
    .map((c) => "." + c)
    .join("");
  partes.push(h("span", { class: "nome mono" }, h("span", { class: "tag" }, el.tagName.toLowerCase()), id ? h("span", { class: "id" }, id) : null, cls ? h("span", { class: "cls" }, cls) : null));
  const texto = textoDireto(el);
  if (texto) partes.push(h("span", { class: "txt" }, '"' + (texto.length > 22 ? texto.slice(0, 21) + "…" : texto) + '"'));
  if (pin) partes.push(h("span", { class: "pin" + (pin.enviadaEm ? " enviado" : ""), title: pin.comentario || "anotação " + pin.ordem }, String(pin.ordem)));
  partes.push(h("span", { class: "dim" }, r.width && r.height ? `${Math.round(r.width)}×${Math.round(r.height)}` : "oculto"));
  return partes;
}

function renderizarArvore(): void {
  const a = estado.arvore;
  const corpo = ui.arvoreCorpo;
  if (!a.aberta || !corpo || !ui.arvore || ui.arvore.hidden) return;
  if (a.area && !a.area.raiz.isConnected) limparArea(false);
  const area = a.area;
  const foco = focoDaArvore();
  if (ui.arvoreSub) {
    ui.arvoreSub.textContent = area
      ? `Na área: ${rotuloArea(area)} · ${Math.round(area.rect.width)}×${Math.round(area.rect.height)}${area.parciais ? ` · ${area.parciais} cortado(s) pela borda` : ""}`
      : estado.atual
        ? "Seleção atual · clique num nível para trocar"
        : a.fixado
          ? "Fixada · clique no alfinete para seguir o cursor"
          : foco
            ? "Seguindo o cursor"
            : "Passe o mouse na página ou arraste uma área";
  }
  ui.btnFixar?.classList.toggle("ativo", a.fixado);
  if (ui.btnFixar) ui.btnFixar.hidden = !!area;
  if (ui.btnLimparArea) ui.btnLimparArea.hidden = !area;

  // caminho: ancestrais do foco (e da raiz da área) — mostram só o ramo; ramo: contidos na área e seus ancestrais.
  const caminho = new Set<Element>();
  const ramo = new Set<Element>();
  if (area) {
    for (const el of area.contidos) {
      for (let n: Element | null = el; n && !ramo.has(n); n = paiEstrutural(n)) ramo.add(n);
    }
    for (let n: Element | null = paiEstrutural(area.raiz); n; n = paiEstrutural(n)) caminho.add(n);
  }
  if (foco) for (let n: Element | null = paiEstrutural(foco); n; n = paiEstrutural(n)) caminho.add(n);
  const pinos = new Map<Element, AnotacaoLocal>();
  for (const an of estado.enviadas.concat(estado.anotacoes)) {
    const el = estado.elementos.get(an.id);
    if (el) pinos.set(el, an);
  }

  const ativo = host?.shadowRoot?.activeElement ?? null;
  const tinhaFoco = !!ativo && corpo.contains(ativo);
  const posicaoRolagem = { left: corpo.scrollLeft, top: corpo.scrollTop };
  corpo.textContent = "";
  linhaPara.clear();
  const linhas: Array<{ no: HTMLElement; el: Element }> = [];
  const emitir = (el: Element, prof: number): void => {
    if (linhas.length >= LIMITE_LINHAS) return;
    const filhos = filhosEstruturais(el);
    const ehFoco = el === foco;
    const noCaminho = caminho.has(el);
    const noRamo = ramo.has(el);
    const abertoManual = a.abertos.has(el);
    const dentroDoOrcamento = linhas.length < 120;
    const expandido = filhos.length > 0 && !a.fechados.has(el) && (abertoManual || ehFoco || noCaminho || (area !== null && noRamo && dentroDoOrcamento));
    let mostrar = filhos;
    let ocultos = 0;
    let rotuloOcultos = "";
    if (expandido && !abertoManual) {
      if (area && noRamo) {
        mostrar = filhos.filter((f) => ramo.has(f));
        ocultos = filhos.length - mostrar.length;
        rotuloOcultos = "fora da área";
      } else if (noCaminho && !ehFoco) {
        mostrar = filhos.filter((f) => caminho.has(f) || f === foco);
        ocultos = filhos.length - mostrar.length;
        rotuloOcultos = ocultos === 1 ? "irmão" : "irmãos";
      }
      if (mostrar.length > LIMITE_FILHOS) {
        ocultos += mostrar.length - LIMITE_FILHOS;
        mostrar = mostrar.slice(0, LIMITE_FILHOS);
        rotuloOcultos = rotuloOcultos || "mais";
      }
    }
    const r = el.getBoundingClientRect();
    const classes = ["an-no"];
    if (ehFoco) classes.push("foco");
    if (area) classes.push(area.contidos.has(el) ? "contido" : "fora");
    if (!r.width || !r.height) classes.push("invisivel");
    const no = h("div", { class: classes.join(" "), role: "treeitem", tabindex: "-1", style: `padding-left:${6 + prof * 12}px`, title: descrever(el) + (filhos.length ? ` · ${filhos.length} filho(s)` : "") });
    const seta = h("button", {
      class: "seta" + (filhos.length ? (expandido ? " aberto" : "") : " vazia"),
      html: ICONES.seta,
      tabindex: "-1",
      title: expandido ? "Recolher" : `Expandir (${filhos.length})`,
      onclick: (e: Event) => {
        e.stopPropagation();
        a.linhaFocada = el;
        alternarNo(el, expandido);
      },
    });
    no.append(seta, ...rotuloNo(el, pinos.get(el), r));
    no.addEventListener("click", () => selecionarElemento(el));
    no.addEventListener("dblclick", () => {
      selecionarElemento(el);
      if (estado.atual) abrirPainel(estado.atual);
    });
    corpo.append(no);
    linhaPara.set(no, el);
    linhas.push({ no, el });
    if (!expandido) return;
    for (const f of mostrar) emitir(f, prof + 1);
    if (ocultos > 0) {
      corpo.append(
        h(
          "div",
          {
            class: "an-mais",
            style: `padding-left:${6 + (prof + 1) * 12 + 18}px`,
            title: "Mostrar todos os filhos deste nó",
            onclick: () => {
              a.fechados.delete(el);
              a.abertos.add(el);
              renderizarArvore();
            },
          },
          `+${ocultos} ${rotuloOcultos}`
        )
      );
    }
  };
  emitir(document.body, 0);
  corpo.scrollTop = posicaoRolagem.top;
  corpo.scrollLeft = posicaoRolagem.left;

  const alvoLinha = linhas.find((l) => l.el === a.linhaFocada) ?? linhas.find((l) => l.el === foco) ?? linhas[0];
  if (alvoLinha) {
    alvoLinha.no.tabIndex = 0;
    const topo = alvoLinha.no.offsetTop;
    if (topo < corpo.scrollTop || topo + alvoLinha.no.offsetHeight > corpo.scrollTop + corpo.clientHeight) corpo.scrollTop = Math.max(0, topo - corpo.clientHeight / 2);
    if (ultimoFocoHorizontalArvore !== alvoLinha.el) revelarLinhaArvore(alvoLinha.no);
    ultimoFocoHorizontalArvore = alvoLinha.el;
    if (tinhaFoco) alvoLinha.no.focus({ preventScroll: true });
  }
}

// Move somente a rolagem do painel; não desloca a página sendo anotada.
function revelarLinhaArvore(no: HTMLElement): void {
  const corpo = ui.arvoreCorpo;
  if (!corpo) return;
  const caixa = corpo.getBoundingClientRect();
  const inicio = (no.querySelector(".seta") ?? no).getBoundingClientRect();
  const fim = (no.querySelector(".nome") ?? no).getBoundingClientRect();
  const esquerda = inicio.left - caixa.left + corpo.scrollLeft;
  const direita = Math.min(fim.right - caixa.left + corpo.scrollLeft, esquerda + corpo.clientWidth - 24);
  if (esquerda < corpo.scrollLeft + 8) corpo.scrollLeft = Math.max(0, esquerda - 8);
  else if (direita > corpo.scrollLeft + corpo.clientWidth - 8) corpo.scrollLeft = Math.max(0, direita - corpo.clientWidth + 8);
  const topo = no.offsetTop;
  if (topo < corpo.scrollTop) corpo.scrollTop = topo;
  else if (topo + no.offsetHeight > corpo.scrollTop + corpo.clientHeight) corpo.scrollTop = topo + no.offsetHeight - corpo.clientHeight;
}

function alternarNo(el: Element, expandido: boolean): void {
  const a = estado.arvore;
  if (expandido) {
    a.abertos.delete(el);
    a.fechados.add(el);
  } else {
    a.fechados.delete(el);
    a.abertos.add(el);
  }
  renderizarArvore();
  const linha = Array.from(linhaPara).find(([, elemento]) => elemento === el)?.[0];
  const filho = linha?.nextElementSibling;
  if (linha) revelarLinhaArvore(!expandido && filho instanceof HTMLElement && filho.classList.contains("an-no") ? filho : linha);
}

function aoTeclarNaArvore(e: KeyboardEvent): void {
  const corpo = ui.arvoreCorpo;
  if (!corpo) return;
  const nos = Array.from(corpo.querySelectorAll<HTMLElement>(".an-no"));
  const noAtual = (e.target as HTMLElement).closest<HTMLElement>(".an-no") ?? nos.find((n) => n.tabIndex === 0) ?? nos[0];
  const el = noAtual ? linhaPara.get(noAtual) : null;
  if (!noAtual || !el) return;
  const i = nos.indexOf(noAtual);
  const focar = (n: HTMLElement | undefined): void => {
    if (!n) return;
    for (const x of nos) x.tabIndex = -1;
    n.tabIndex = 0;
    n.focus({ preventScroll: true });
    const alvo = linhaPara.get(n);
    estado.arvore.linhaFocada = alvo ?? null;
    if (alvo) destacar(ui.caixaHover, alvo);
    revelarLinhaArvore(n);
    ultimoFocoHorizontalArvore = alvo ?? null;
  };
  const aberto = !!noAtual.querySelector(".seta.aberto");
  switch (e.key) {
    case "ArrowDown":
      focar(nos[i + 1]);
      break;
    case "ArrowUp":
      focar(nos[i - 1]);
      break;
    case "ArrowRight":
      if (!aberto && filhosEstruturais(el).length) {
        estado.arvore.linhaFocada = el;
        alternarNo(el, false);
      } else focar(nos[i + 1]);
      break;
    case "ArrowLeft":
      if (aberto) {
        estado.arvore.linhaFocada = el;
        alternarNo(el, true);
      } else {
        const pai = paiEstrutural(el);
        focar(nos.find((n) => linhaPara.get(n) === pai));
      }
      break;
    case "Enter":
    case " ":
      selecionarElemento(el);
      break;
    case "Home":
      focar(nos[0]);
      break;
    case "End":
      focar(nos[nos.length - 1]);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}

interface OpcoesSelecao {
  /** Alt+↓: mantém o elemento exato clicado para continuar descendo por ele */
  manterExato?: boolean;
}

// Seleção vinda da árvore, da área ou dos atalhos: troca o alvo do rascunho sem perder o comentário digitado.
function selecionarElemento(el: Element, opcoes: OpcoesSelecao = {}): void {
  if (!el.isConnected) {
    avisar("Este elemento não está mais na página.");
    agendarRenderArvore();
    return;
  }
  if (!estilizavel(el) || el.tagName === "HTML") {
    avisar("Este nó não pode ser anotado; escolha um elemento dentro da página.");
    return;
  }
  const exato = opcoes.manterExato ? estado.exato : null;
  let comentario = "";
  let descartou = false;
  if (estado.atual) {
    if (estado.elementos.get(estado.atual.id) === el) {
      abrirBalao(estado.atual);
      return;
    }
    if (!estado.atual.confirmada) {
      comentario = estado.atual.comentario;
      descartou = estado.atual.alteracoes.length > 0 || !!estado.atual.texto;
    }
    cancelarEdicao();
  }
  const existente = estado.anotacoes.find((x) => estado.elementos.get(x.id) === el);
  if (existente) {
    abrirEdicao(existente);
    return;
  }
  const alvo: AlvoNoPonto = { el: exato && exato !== el && contem(el, exato) ? exato : el, doc: el.ownerDocument, framePath: caminhoFrames(el), crossOrigin: false };
  iniciarAnotacao(el, alvo);
  if (comentario && estado.atual && !estado.atual.comentario) {
    estado.atual.comentario = comentario;
    if (ui.entradaBalao) ui.entradaBalao.value = comentario;
    ui.comentarioPainel.value = comentario;
  }
  if (descartou) avisar("Seleção trocada; as alterações de estilo do rascunho anterior foram descartadas.", 4000);
  estado.arvore.linhaFocada = el;
  if (!estado.arvore.area) estado.arvore.foco = el;
  if (estado.arvore.aberta) renderizarArvore();
}

// Alt+↑↓←→ com uma seleção (ou o elemento sob o cursor): pai, filho, irmão anterior/seguinte.
function navegarHierarquia(tecla: string): void {
  const base = elementoSelecionado() ?? (estado.arvore.foco?.isConnected ? estado.arvore.foco : null) ?? estado.hoverEl;
  if (!base || !base.isConnected) {
    avisar("Selecione um elemento (ou aponte para um) antes de navegar com Alt+setas.");
    return;
  }
  let alvo: Element | null = null;
  let aviso = "";
  if (tecla === "ArrowUp") {
    alvo = paiEstrutural(base);
    if (!alvo || alvo.tagName === "HTML") {
      alvo = null;
      aviso = "Já está no topo da página.";
    }
  } else if (tecla === "ArrowDown") {
    const filhos = filhosEstruturais(base);
    const exato = estado.exato;
    alvo = (exato && exato !== base && contem(base, exato) ? filhos.find((f) => contem(f, exato)) : null) ?? filhos[0] ?? null;
    if (!alvo) aviso = "Este elemento não tem filhos.";
  } else {
    alvo = irmaoEstrutural(base, tecla === "ArrowLeft" ? -1 : 1);
    if (!alvo) aviso = tecla === "ArrowLeft" ? "É o primeiro irmão." : "É o último irmão.";
  }
  if (!alvo) {
    avisar(aviso);
    return;
  }
  selecionarElemento(alvo, { manterExato: tecla === "ArrowDown" });
  if (!estado.atual) return;
  avisar(descrever(alvo), 1800);
}

// ---------- seleção por área (arrastar na página) ----------
function iniciarGestoArea(e: PointerEvent): void {
  estado.gestoArea = { x0: e.clientX + scrollX, y0: e.clientY + scrollY, x: e.clientX, y: e.clientY, ativo: false, pointerId: e.pointerId };
  try { document.documentElement.setPointerCapture(e.pointerId); } catch { /* Eventos sintéticos não têm ponteiro capturável. */ }
}

function rectDoGesto(g: GestoArea): Rect {
  const x0 = g.x0 - scrollX, y0 = g.y0 - scrollY;
  return { left: Math.min(x0, g.x), top: Math.min(y0, g.y), width: Math.abs(g.x - x0), height: Math.abs(g.y - y0) };
}

function aoMoverPonteiro(e: PointerEvent): void {
  const g = estado.gestoArea;
  if (!g || e.pointerId !== g.pointerId) return;
  if (!raiz || raiz.hidden || !estado.armado) {
    estado.gestoArea = null;
    return;
  }
  g.x = e.clientX;
  g.y = e.clientY;
  if (!g.ativo) {
    if (Math.hypot(g.x + scrollX - g.x0, g.y + scrollY - g.y0) < 6) return;
    g.ativo = true;
    estado.hoverEl = null;
    ui.caixaHover.style.display = "none";
    ui.dica.style.display = "none";
    ui.caixaArea.classList.add("ativa");
  }
  e.preventDefault();
  desenharArea(rectDoGesto(g));
  agendarContagemArea();
}

function desenharArea(r: Rect, rotulo?: string): void {
  const c = ui.caixaArea;
  c.style.left = r.left + "px";
  c.style.top = r.top + "px";
  c.style.width = r.width + "px";
  c.style.height = r.height + "px";
  c.style.display = "block";
  const n = c.querySelector<HTMLSpanElement>(".n");
  if (n) {
    n.textContent = rotulo ?? "";
    n.hidden = !rotulo;
  }
}

let contagemAgendada = false;
function agendarContagemArea(): void {
  if (contagemAgendada) return;
  contagemAgendada = true;
  setTimeout(() => {
    contagemAgendada = false;
    const g = estado.gestoArea;
    if (!g || !g.ativo) return;
    const r = rectDoGesto(g);
    const res = elementosNaArea(r, ignorar, 6000);
    desenharArea(r, `${res.elementos.length}${res.truncado ? "+" : ""} elemento(s) · ${Math.round(r.width)}×${Math.round(r.height)}`);
  }, 90);
}

function redesenharAreaAtual(): void {
  if (estado.gestoArea?.ativo) { desenharArea(rectDoGesto(estado.gestoArea)); return; }
  const area = estado.arvore.area;
  if (area) desenharArea(areaNoViewport(area), rotuloArea(area));
  else ui.caixaArea.style.display = "none";
}

function concluirGestoArea(e: PointerEvent, cancelado = false): void {
  const g = estado.gestoArea;
  if (!g || e.pointerId !== g.pointerId) return;
  estado.gestoArea = null;
  try { document.documentElement.releasePointerCapture(e.pointerId); } catch { /* O navegador pode já ter soltado o ponteiro. */ }
  if (!g.ativo) return;
  ui.caixaArea.classList.remove("ativa");
  // O click que fecha o gesto viria como seleção do elemento sob o cursor.
  suprimirCliqueAte = Date.now() + 500;
  g.x = e.clientX;
  g.y = e.clientY;
  const r = rectDoGesto(g);
  if (cancelado || r.width < 1 || r.height < 1) {
    redesenharAreaAtual();
    return;
  }
  definirArea(r);
}

function definirArea(r: Rect): void {
  const res = elementosNaArea(r, ignorar);
  if (estado.atual) cancelarEdicao();
  const area: AreaSelecionada = {
    rect: rectPagina(r),
    contidos: new Set(res.contidos),
    raiz: ancestralComum(res.contidos.length ? res.contidos : res.elementos.map(({el}) => el)) ?? document.body,
    parciais: res.parciais,
    truncado: res.truncado,
  };
  estado.arvore.area = area;
  estado.arvore.linhaFocada = null;
  estado.arvore.abertos = new WeakSet();
  estado.arvore.fechados = new WeakSet();
  desenharArea(r, rotuloArea(area));
  if (estado.arvore.aberta) renderizarArvore();
  iniciarAnotacaoArea(r, res);
}

function rectAnotacao(a: AnotacaoLocal): Rect {
  if (a.area) {
    const r = a.area.rectPagina;
    return { left: r.left - scrollX, top: r.top - scrollY, width: r.width, height: r.height };
  }
  const el = estado.elementos.get(a.id);
  return el?.isConnected ? rectTopo(el) : a.elemento.rect;
}

function destacarAnotacao(a: AnotacaoLocal): void {
  if (!a.area) { destacar(ui.caixaSel, estado.elementos.get(a.id) ?? null); return; }
  const r = rectAnotacao(a);
  Object.assign(ui.caixaSel.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
}

function iniciarAnotacaoArea(r: Rect, res: ElementosNaArea): void {
  const area: AreaAnotada = {
    rectPagina: rectPagina(r),
    viewport: { largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio || 1, scrollX, scrollY },
    elementos: res.elementos.slice(0, 100).map(({el, rect, intersecao}) => {
      const meta = metadados(el);
      // A referência da área é compacta; não duplica subárvores HTML inteiras.
      delete meta.html; delete meta.htmlPai;
      return { seletores: construirSeletores(el, el.ownerDocument), meta, framePath: caminhoFrames(el), shadowPath: caminhoShadow(el), rect, intersecao };
    }),
    truncado: res.truncado || res.elementos.length > 100,
  };
  const a: AnotacaoLocal = {
    id: uuid(), ordem: proximaOrdem(), comentario: "", area,
    elemento: { seletores: [], meta: { tag: "area", attrs: {}, texto: "", cadeia: [], componentes: [] }, framePath: [], shadowPath: [], rect: r, rectPagina: area.rectPagina, computado: {} },
    alteracoes: [], texto: null, criadaEm: new Date().toISOString(), estilosOriginais: "", textoOriginal: null, confirmada: false,
  };
  abrirEdicao(a);
  salvar(true);
  avisar(`Área selecionada: ${Math.round(r.width)} × ${Math.round(r.height)} px · ${area.elementos.length}${area.truncado ? "+" : ""} elemento(s).`);
}

function abrirPainelArea(a: AnotacaoLocal): void {
  if (!a.area) return;
  const area = a.area, r = area.rectPagina;
  ui.comentarioPainel.value = a.comentario;
  ui.painelTag.textContent = "Área selecionada";
  ui.painelComp.textContent = `${area.elementos.length}${area.truncado ? "+" : ""} elemento(s)`;
  ui.painelComp.title = "Elementos que intersectavam o retângulo no momento da seleção";
  ui.btnExcluir.hidden = !a.confirmada;
  const print = h("button", { type: "button", class: "an-btn an-tirar-print", title: "Capturar o site com a área marcada e anexar à anotação" }, textoInterface("Tirar print da tela"));
  const anexos = h("div", { class: "an-anexos", "aria-live": "polite" });
  const atualizar = () => {
    renderizarAnexos(a, anexos, print);
    if (estado.atual === a && !anexos.isConnected) {
      const listaAtual = ui.painelCorpo.querySelector<HTMLElement>(".an-anexos");
      const botaoAtual = ui.painelCorpo.querySelector<HTMLButtonElement>(".an-tirar-print");
      if (listaAtual && botaoAtual) renderizarAnexos(a, listaAtual, botaoAtual);
    }
  };
  print.addEventListener("click", () => void tirarPrintDaTela(a, print, atualizar));
  atualizar();
  const lista = h("div", { class: "an-area-elementos" });
  for (const membro of area.elementos) lista.append(h("div", { class: "an-seletor", style: "padding:8px 0;border-bottom:1px solid var(--an-borda);overflow-wrap:anywhere" },
    h("strong", null, membro.meta.tag + (membro.meta.texto ? " · " + resumir(membro.meta.texto, 65) : "")),
    h("div", { class: "sub" }, `${membro.intersecao === "parcial" ? "Cortado pela borda" : "Inteiro na área"} · ${Math.round(membro.rect.width)}×${Math.round(membro.rect.height)} px`),
    h("code", null, membro.seletores[0]?.valor ?? "Sem seletor estável"),
    membro.framePath.length ? h("div", { class: "sub" }, "Iframe: " + membro.framePath.join(" › ")) : null,
    membro.shadowPath.length ? h("div", { class: "sub" }, "Shadow DOM: " + membro.shadowPath.join(" › ")) : null,
  ));
  if (!area.elementos.length) lista.append(h("p", null, "A região foi mantida exatamente como desenhada, sem elementos identificados dentro dela."));
  ui.painelCorpo.replaceChildren(
    secao(h("strong", null, `${Math.round(r.width)} × ${Math.round(r.height)} px`), h("p", null, `Posição na página: ${Math.round(r.left)}, ${Math.round(r.top)}. Comente sobre esta região ou sobre os elementos listados.`), print, anexos),
    secao(h("strong", null, textoInterface("Elementos da área")), lista, area.truncado ? h("p", null, "A lista atingiu o limite de leitura. O retângulo permanece completo.") : null),
  );
  ui.painel.hidden = false;
  restaurarPosicao(ui.painel, "painel");
  setTimeout(() => ui.comentarioPainel.focus(), 0);
}

function limparArea(renderizar = true): void {
  estado.arvore.area = null;
  estado.arvore.abertos = new WeakSet();
  estado.arvore.fechados = new WeakSet();
  ui.caixaArea.style.display = "none";
  ui.caixaArea.classList.remove("ativa");
  if (renderizar && estado.arvore.aberta) renderizarArvore();
}

function resumoArvore(): ResumoArvore {
  const a = estado.arvore;
  const foco = focoDaArvore();
  const linhas: string[] = [];
  for (const n of Array.from(ui.arvoreCorpo?.children ?? [])) {
    if (!n.classList.contains("an-no")) {
      linhas.push("+ " + (n.textContent ?? ""));
      continue;
    }
    const txt = n.querySelector(".txt")?.textContent ?? "";
    linhas.push((n.classList.contains("foco") ? "● " : "  ") + (n.querySelector(".nome")?.textContent ?? "") + (txt ? " " + txt : ""));
  }
  return {
    aberta: a.aberta,
    fixado: a.fixado,
    foco: foco ? descrever(foco) : null,
    area: a.area ? { contidos: a.area.contidos.size, raiz: descrever(a.area.raiz), parciais: a.area.parciais } : null,
    linhas,
  };
}

// ---------- inicialização ----------
function iniciar(): void {
  if (window.__anotadorCarregado) return;
  let desligado = false;
  try {
    desligado = sessionStorage.getItem(CHAVE_DESLIGADO) === "1";
  } catch {
    desligado = false;
  }
  montar();
  if (desligado) desligar();
}

// Monta depois do `load` para não competir com a hidratação do React.
if (document.readyState === "complete") setTimeout(iniciar, 60);
else window.addEventListener("load", () => setTimeout(iniciar, 60));
