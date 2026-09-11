// Interface do anotador: barra, seleção, pins/balões, painel de propriedades, fila e envio.

type ElementoEstilizavel = HTMLElement | SVGElement;

interface SnapshotEdicao {
  alteracoes: AlteracaoEstilo[];
  texto: AlteracaoTexto | null;
  comentario: string;
  style: string;
}

interface AnotacaoLocal extends Anotacao {
  estilosOriginais: string;
  textoOriginal: string | null;
  confirmada: boolean;
  enviadaEm?: string | null;
  snapshotEdicao?: SnapshotEdicao;
}

interface LoteLocal {
  id: string;
  enviadoEm: string;
  estado: EstadoLote;
  nota?: string;
  perguntasAbertas?: number;
  /** resumo do que foi anotado, para o cabeçalho da conversa */
  resumo?: string;
}

interface ConversaAberta {
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
  ditado: { rec: SpeechRecognition; botao: HTMLButtonElement } | null;
  conversa: ConversaAberta | null;
  arvore: EstadoArvore;
  /** elemento exato sob o cursor no clique que criou o rascunho atual */
  exato: Element | null;
  gestoArea: GestoArea | null;
}

interface Posicao {
  left: number;
  top: number;
}

interface Ui {
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
}

interface OpcoesArrasto {
  aoMover?: () => void;
  /** o elemento inteiro arrasta; clique sem deslocar chama aoClique */
  arrastarTudo?: boolean;
  aoClique?: () => void;
}

const CFG: ConfigOverlay = window.__ANOTADOR_CFG ?? { base: "/__anotador", capturas: true, nome: "", agente: "Claude" };
const AGENTE = CFG.agente || "Claude";
const CHAVE_ARMAZENAMENTO = "anotador-ui:" + location.pathname;
const CHAVE_DESLIGADO = "anotador-ui:desligado";

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
};

let host: HTMLDivElement | null = null;
let raiz: HTMLDivElement | null = null;
const ui = { balao: null, entradaBalao: null, religar: null, conversa: null, arvore: null, arvoreCorpo: null, arvoreSub: null, btnFixar: null, btnLimparArea: null } as Ui;

// ---------- utilidades ----------
type Filho = Node | string | number | null | undefined | false | Filho[];
type Atributos = Record<string, string | number | boolean | null | undefined | EventListener>;

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
    if (k === "class") el.className = String(v);
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
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  };
  filhos.forEach(anexar);
  return el;
}

function estilizavel(el: Element | null): el is ElementoEstilizavel {
  return el instanceof HTMLElement || el instanceof SVGElement;
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
  return el.childNodes.length > 0 && Array.from(el.childNodes).every((n) => n.nodeType === 3);
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
function salvar(): void {
  const dados: DadosPersistidos = {
    anotacoes: estado.anotacoes.map(serializarAnotacao),
    enviadas: estado.enviadas.map(serializarAnotacao),
    lotes: estado.lotes,
    armado: estado.armado,
  };
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(dados));
  } catch {
    /* sem armazenamento: a fila vive só em memória */
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
  estado.anotacoes = dados.anotacoes ?? [];
  estado.enviadas = dados.enviadas ?? [];
  estado.lotes = dados.lotes ?? [];
  if (typeof dados.armado === "boolean") estado.armado = dados.armado;
  for (const a of estado.anotacoes) {
    const el = localizarPorSeletores(a.elemento.seletores);
    if (estilizavel(el)) {
      estado.elementos.set(a.id, el);
      quandoHidratado(el, () => reaplicar(a, el));
    }
  }
  for (const a of estado.enviadas) {
    const el = localizarPorSeletores(a.elemento.seletores);
    if (estilizavel(el)) estado.elementos.set(a.id, el);
  }
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
  raiz = h("div", { class: "an-raiz" });
  host.style.setProperty("--an-fonte-pagina", getComputedStyle(document.body).fontFamily || "system-ui, sans-serif");
  sombra.append(raiz);
  document.documentElement.appendChild(host);

  ui.caixaHover = h("div", { class: "an-caixa" });
  ui.caixaSel = h("div", { class: "an-caixa selecao" });
  ui.dica = h("div", { class: "an-dica" });
  ui.camadaPins = h("div");
  ui.toast = h("div", { class: "an-toast", hidden: true });
  ui.caixaArea = h("div", { class: "an-area" }, h("span", { class: "n", hidden: true }));
  raiz.append(ui.caixaHover, ui.caixaSel, ui.caixaArea, ui.dica, ui.camadaPins);
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
function montarBarra(raizUi: HTMLDivElement): void {
  ui.btnLimpar = h("button", { class: "an-ico", title: "Descartar todas as anotações pendentes", html: ICONES.lixeira, onclick: limparFila });
  ui.contador = h("span", { class: "n" }, "0");
  ui.btnEnviar = h("button", { class: "an-enviar", title: "Enviar anotações para " + AGENTE, onclick: () => void enviar() }, "Enviar", ui.contador);
  ui.estado = h("button", {
    class: "an-estado",
    title: "Ver lotes enviados",
    onclick: () => {
      const alvo = estado.lotes.filter((l) => (l.perguntasAbertas ?? 0) > 0).pop() ?? estado.lotes.filter((l) => l.estado !== "processado").pop() ?? estado.lotes[estado.lotes.length - 1];
      if (alvo) void abrirConversa(alvo);
      else alternarFila(true);
    },
  });
  ui.modoSel = h("button", { class: "ativo", title: "Clique seleciona elementos (Alt+A alterna)", onclick: () => definirModo(true) }, "Selecionar");
  ui.modoNav = h("button", { title: "Usar a página normalmente (Alt+A alterna)", onclick: () => definirModo(false) }, "Navegar");
  ui.alcaBarra = h("button", { class: "an-alca", title: "Arrastar a barra (duplo clique recoloca)", html: ICONES.alca });
  ui.btnArvore = h("button", { class: "an-ico", title: "Estrutura de elementos: árvore para escolher o nível certo (Alt+R)", html: ICONES.arvore, onclick: () => alternarArvore() });
  const titulo = h("div", { class: "titulo" }, "Anotando ", h("span", { class: "url" }, "• " + location.host + location.pathname));
  ui.barra = h(
    "div",
    { class: "an-barra" },
    ui.alcaBarra,
    h("button", { class: "an-ico", title: "Ocultar anotador (Alt+Shift+A)", html: ICONES.fechar, onclick: desligar }),
    ui.btnLimpar,
    h("span", { class: "an-sep" }),
    titulo,
    h("span", { class: "an-sep" }),
    h("button", { class: "an-ico", title: "Ver fila e lotes", html: ICONES.lista, onclick: () => alternarFila() }),
    ui.btnArvore,
    h("div", { class: "an-modo" }, ui.modoSel, ui.modoNav),
    ui.btnEnviar,
    ui.estado
  );
  raizUi.append(ui.barra);
  tornarArrastavel(ui.barra, [ui.alcaBarra, titulo], "barra", {
    aoMover: () => {
      if (!ui.fila.hidden) posicionarFila();
    },
  });
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
      if (e.button !== 0) return;
      const origem = e.target as Element;
      if (!opcoes.arrastarTudo && !alca.classList.contains("an-alca") && origem.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const inicioX = e.clientX;
      const inicioY = e.clientY;
      let moveu = false;
      estado.arrastando = true;
      raiz?.classList.add("arrastando");
      el.classList.add("arrastando");
      alca.setPointerCapture(e.pointerId);
      const mover = (ev: PointerEvent) => {
        if (!moveu && Math.hypot(ev.clientX - inicioX, ev.clientY - inicioY) < 4) return;
        moveu = true;
        aplicarPosicao(el, limitar(el, { left: ev.clientX - dx, top: ev.clientY - dy }));
        opcoes.aoMover?.();
      };
      const soltar = () => {
        alca.removeEventListener("pointermove", mover);
        alca.removeEventListener("pointerup", soltar);
        alca.removeEventListener("pointercancel", soltar);
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
        } else {
          opcoes.aoClique?.();
        }
      };
      alca.addEventListener("pointermove", mover);
      alca.addEventListener("pointerup", soltar);
      alca.addEventListener("pointercancel", soltar);
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
  ui.btnEnviar.disabled = n === 0;
  ui.btnLimpar.disabled = n === 0;
  ui.modoSel.classList.toggle("ativo", estado.armado);
  ui.modoNav.classList.toggle("ativo", !estado.armado);
  const comPergunta = estado.lotes.filter((l) => (l.perguntasAbertas ?? 0) > 0).pop();
  const emAndamento = estado.lotes.filter((l) => l.estado === "em_andamento").pop();
  const aguardando = estado.lotes.find((l) => l.estado === "recebido" || l.estado === "desconhecido");
  const ultimo = estado.lotes[estado.lotes.length - 1];
  if (comPergunta) {
    ui.estado.className = "an-estado pergunta";
    ui.estado.textContent = (comPergunta.perguntasAbertas ?? 1) > 1 ? `${AGENTE} perguntou (${comPergunta.perguntasAbertas})` : `${AGENTE} perguntou`;
    ui.estado.title = `${AGENTE} precisa de uma resposta sua · clique para responder`;
  } else if (emAndamento) {
    ui.estado.className = "an-estado andamento";
    ui.estado.textContent = `${AGENTE}: ` + resumir(emAndamento.nota || "trabalhando…", 48);
    ui.estado.title = (emAndamento.nota || `${AGENTE} está trabalhando no lote`) + " · clique para ver os lotes";
  } else if (aguardando) {
    ui.estado.className = "an-estado";
    ui.estado.textContent = `Enviado · aguardando ${AGENTE}`;
    ui.estado.title = `O lote chegou e espera ${AGENTE} começar · clique para ver os lotes`;
  } else if (ultimo) {
    ui.estado.className = "an-estado ok";
    ui.estado.textContent = `Aplicado por ${AGENTE}`;
    ui.estado.title = (ultimo.nota ?? "") + " · clique para ver os lotes";
  } else {
    ui.estado.textContent = "";
  }
  atualizarReligar();
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
  document.documentElement.style.cursor = estado.armado && raiz && !raiz.hidden ? "crosshair" : "";
  if (!estado.armado) {
    ui.caixaHover.style.display = "none";
    ui.dica.style.display = "none";
  }
}

function desligar(): void {
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
    h("span", { class: "rotulo" }, "Anotador"),
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
  const situacao = perguntas > 0 ? `${AGENTE} perguntou — abra para responder · ` : aberto ? (aberto.estado === "em_andamento" ? `${AGENTE}: ${aberto.nota || "trabalhando"} · ` : `Lote aguardando ${AGENTE} · `) : n ? `${n} anotação(ões) na fila · ` : "";
  ui.religar.title = situacao + "Reabrir anotador (Alt+Shift+A) · arraste para mover";
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
    if (estado.arvore.area) redesenharAreaAtual();
    if (estado.atual) {
      const el = estado.elementos.get(estado.atual.id);
      destacar(ui.caixaSel, el && el.isConnected ? el : null);
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
  estado.atual = a;
  const el = estado.elementos.get(a.id) ?? null;
  a.snapshotEdicao = {
    alteracoes: a.alteracoes.map((x) => ({ ...x })),
    texto: a.texto ? { ...a.texto } : null,
    comentario: a.comentario,
    style: el?.getAttribute("style") ?? "",
  };
  destacar(ui.caixaSel, el);
  renderizarPins();
  abrirBalao(a);
  // Ação direta do usuário: renderiza já, sem esperar o debounce do MutationObserver.
  if (estado.arvore.aberta) renderizarArvore();
}

function cancelarEdicao(): void {
  const a = estado.atual;
  if (!a) return;
  const el = estado.elementos.get(a.id) ?? null;
  if (!a.confirmada) {
    reverterElemento(a, el);
    estado.elementos.delete(a.id);
  } else if (a.snapshotEdicao && el) {
    el.style.cssText = a.snapshotEdicao.style;
    if (soTexto(el)) el.textContent = a.snapshotEdicao.texto ? a.snapshotEdicao.texto.depois : (a.textoOriginal ?? el.textContent);
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
  a.comentario = a.comentario.trim();
  if (!a.comentario && a.alteracoes.length === 0 && !a.texto) {
    avisar("Escreva um comentário ou altere alguma propriedade.");
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
  if (estado.anotacoes.length === 0) return;
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
    if (el && !el.isConnected) {
      const novo = localizarPorSeletores(a.elemento.seletores);
      el = estilizavel(novo) ? novo : null;
      if (el) {
        estado.elementos.set(a.id, el);
        if (!enviada) reaplicar(a, el);
      }
    }
    const r = el ? rectTopo(el) : a.elemento.rect;
    const pin = h(
      "button",
      {
        class: "an-pin" + (enviada ? " enviado" : "") + (!el ? " perdido" : ""),
        title: (a.comentario || "(sem comentário)") + (el ? "" : " — elemento não localizado nesta versão da página"),
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
    placeholder: "Adicionar um comentário...",
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
  const btnMic = h("button", { class: "an-ico", title: "Ditar comentário", html: ICONES.mic });
  btnMic.addEventListener("click", () => alternarDitado(entrada, btnMic, a));
  ui.balao = h(
    "div",
    { class: "an-balao" },
    h("button", { class: "an-ico", title: "Propriedades do elemento", html: ICONES.sliders, onclick: () => abrirPainel(a) }),
    entrada,
    btnMic,
    a.confirmada ? h("button", { class: "an-ico", title: "Excluir anotação", html: ICONES.lixeira, onclick: () => excluirAnotacao(a) }) : null,
    h("button", { class: "an-ico", title: "Confirmar (Enter)", html: ICONES.ok, style: "color:#7ee2b0", onclick: confirmarEdicao })
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
  const el = estado.elementos.get(a.id);
  const r = el && el.isConnected ? rectTopo(el) : a.elemento.rect;
  if (!ui.balao) return;
  const largura = Math.min(520, Math.max(300, innerWidth - 24));
  let left = r.left + 18;
  if (left + largura > innerWidth - 12) left = Math.max(12, innerWidth - 12 - largura);
  let top = r.top - 46;
  if (top < 56) top = r.top + r.height + 10;
  if (top > innerHeight - 60) top = innerHeight - 60;
  ui.balao.style.left = left + "px";
  ui.balao.style.top = top + "px";
}

// ---------- ditado ----------
function alternarDitado(campo: HTMLInputElement, botao: HTMLButtonElement, a: AnotacaoLocal): void {
  if (estado.ditado) {
    pararDitado();
    return;
  }
  const Reconhecimento = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Reconhecimento) {
    avisar("Este navegador não oferece reconhecimento de voz.", 4000);
    return;
  }
  if (!window.isSecureContext) {
    avisar("Microfone bloqueado em http. Marque esta origem em chrome://flags/#unsafely-treat-insecure-origin-as-secure", 7000);
    return;
  }
  const rec = new Reconhecimento();
  rec.lang = "pt-BR";
  rec.interimResults = true;
  rec.continuous = true;
  const base = campo.value ? campo.value.replace(/\s+$/, "") + " " : "";
  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let finais = "";
    let parcial = "";
    for (let i = 0; i < ev.results.length; i++) {
      const resultado = ev.results[i];
      const t = resultado?.[0]?.transcript ?? "";
      if (resultado?.isFinal) finais += t + " ";
      else parcial += t;
    }
    campo.value = (base + finais + parcial).replace(/\s+/g, " ");
    a.comentario = campo.value;
    ui.comentarioPainel.value = a.comentario;
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    avisar("Voz: " + (ev.error || "erro"), 4000);
    pararDitado();
  };
  rec.onend = () => {
    if (estado.ditado && estado.ditado.rec === rec) pararDitado();
  };
  rec.start();
  botao.classList.add("grav");
  estado.ditado = { rec, botao };
  avisar("Ouvindo… clique no microfone para parar.");
}

function pararDitado(): void {
  if (!estado.ditado) return;
  try {
    estado.ditado.rec.stop();
  } catch {
    /* já parado */
  }
  estado.ditado.botao.classList.remove("grav");
  estado.ditado = null;
}

// ---------- painel de propriedades ----------
function montarPainel(raizUi: HTMLDivElement): void {
  ui.comentarioPainel = h("textarea", {
    rows: 1,
    placeholder: "Descreva essas alterações...",
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
  ui.btnExcluir = h("button", { class: "an-btn perigo", onclick: () => estado.atual && excluirAnotacao(estado.atual) }, "Excluir");
  ui.alcaPainel = h("button", { class: "an-alca", title: "Arrastar o painel (duplo clique recoloca)", html: ICONES.alca });
  const sub = h(
    "div",
    { class: "sub" },
    h("span", null, ui.painelTag, ui.painelComp),
    h("span", { class: "acoes" }, ui.alcaPainel, h("button", { class: "an-ico", title: "Fechar painel", html: ICONES.fechar, onclick: () => (ui.painel.hidden = true) }))
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
      h("button", { class: "an-btn", onclick: cancelarEdicao }, "Cancelar"),
      h("button", { class: "an-ok", title: "Confirmar", html: ICONES.ok, onclick: confirmarEdicao })
    )
  );
  raizUi.append(ui.painel);
  tornarArrastavel(ui.painel, [ui.alcaPainel, sub], "painel");
}

function abrirPainel(a: AnotacaoLocal): void {
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
  return h("div", { class: "an-linha" + (larga ? " larga" : "") }, h("label", null, rotulo, sub ? h("span", { class: "sub" }, sub) : null), campo);
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
  const sw = h("span", { class: "sw", style: "background:" + atual });
  const cor = h("input", { type: "color", value: rgbParaHex(atual) });
  const txt = h("input", { type: "text", class: "mono", value: atual });
  const wrap = h("div", { class: "an-campo" + (a.alteracoes.some((x) => x.propriedade === propriedade) ? " alterado" : "") }, sw, txt);
  sw.append(cor);
  const aplicar = (valor: string) => {
    registrar(a, el, propriedade, valor);
    sw.style.background = valor;
    wrap.classList.toggle("alterado", valor !== "");
  };
  cor.addEventListener("input", () => {
    const v = hexParaRgb(cor.value);
    txt.value = v;
    aplicar(v);
  });
  txt.addEventListener("change", () => {
    aplicar(txt.value.trim());
    cor.value = rgbParaHex(getComputedStyle(el).getPropertyValue(propriedade));
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
  const wrap = h("div", { class: "an-campo" + (a.alteracoes.some((x) => x.propriedade === propriedade) ? " alterado" : "") }, sel);
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
  return linha(rotulo, h("div", { class: "an-quatro" }, ...campos), "cima · direita · baixo · esquerda", true);
}

function construirCampos(a: AnotacaoLocal, el: ElementoEstilizavel): HTMLElement[] {
  const melhor = a.elemento.seletores[0];
  const seletor = h(
    "div",
    { class: "an-seletor" },
    h(
      "div",
      { class: "melhor" },
      h("span", { class: "an-ico", style: "width:20px;height:20px", html: ICONES.mira }),
      h("code", { title: "melhor seletor encontrado" }, melhor ? melhor.valor : "(sem seletor)"),
      melhor ? h("span", { class: "pts", title: melhor.unico ? "único na página" : "não único" }, (melhor.unico ? "único · " : "") + melhor.pontos) : null
    )
  );
  const cls = a.elemento.meta.attrs["class"];
  if (cls) seletor.append(h("div", { class: "melhor", style: "margin-top:4px" }, h("code", { class: "classes" }, "." + cls.split(/\s+/).join(" ."))));

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
  const trava = h("button", { class: "an-ico", title: "Travar proporção largura/altura", html: ICONES.cadeado, style: estado.proporcaoTravada ? "color:#7ee2b0" : "" });
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
          title: "Excluir",
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

function instantaneoHtml(anotacoes: AnotacaoLocal[]): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const n of clone.querySelectorAll("#__anotador_host, script, nextjs-portal, [data-nextjs-toast], link[rel=preload], link[rel=modulepreload]")) n.remove();
  const head = clone.querySelector("head") ?? clone.insertBefore(document.createElement("head"), clone.firstChild);
  head.insertBefore(h("base", { href: location.origin + "/" }), head.firstChild);
  const body = clone.querySelector("body");
  if (body) {
    for (const a of anotacoes) {
      const el = estado.elementos.get(a.id);
      if (!el || !el.isConnected) continue;
      const r = rectPagina(rectTopo(el));
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
  if (estado.anotacoes.length === 0) return;
  if (estado.atual) cancelarEdicao();
  ui.btnEnviar.disabled = true;
  ui.estado.className = "an-estado";
  ui.estado.textContent = "Enviando…";
  const anotacoes = estado.anotacoes.slice();
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
        elemento: { ...a.elemento, rect: vivo ? rectTopo(el) : a.elemento.rect, rectPagina: vivo ? rectPagina(rectTopo(el)) : null, localizado: vivo },
        alteracoes: a.alteracoes,
        texto: a.texto,
        criadaEm: a.criadaEm,
      };
    }),
    instantaneo: CFG.capturas ? instantaneoHtml(anotacoes) : null,
  };
  try {
    const resp = await fetch(CFG.base + "/lotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lote) });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const corpo = (await resp.json()) as { id?: string };
    const agora = new Date().toISOString();
    for (const a of anotacoes) {
      a.enviadaEm = agora;
      estado.enviadas.push(a);
    }
    estado.anotacoes = [];
    estado.lotes.push({
      id: corpo.id ?? lote.id,
      enviadoEm: agora,
      estado: "recebido",
      resumo: anotacoes.map((a) => a.comentario || a.elemento.meta.tag).join(" · ").slice(0, 120),
    });
    renderizarPins();
    atualizarBarra();
    salvar();
    avisar(anotacoes.length + " anotação(ões) enviada(s) ao chat.");
    void acompanharLotes();
  } catch (erro) {
    ui.estado.className = "an-estado erro";
    ui.estado.textContent = "Falha ao enviar — fila preservada";
    ui.btnEnviar.disabled = false;
    avisar("Não foi possível enviar: " + (erro instanceof Error ? erro.message : String(erro)), 5000);
  }
}

let acompanhando = false;
async function acompanharLotes(): Promise<void> {
  if (acompanhando) return;
  acompanhando = true;
  const inicio = Date.now();
  // Lote processado ainda pode receber nota/pergunta do Claude por alguns minutos.
  const relevante = (l: LoteLocal) => l.estado !== "processado" || Date.now() - new Date(l.enviadoEm).getTime() < 15 * 60 * 1000 || estado.conversa?.lote.id === l.id;
  while (estado.lotes.some(relevante) && Date.now() - inicio < 45 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 2500));
    for (const l of estado.lotes) {
      if (!relevante(l)) continue;
      try {
        const resp = await fetch(CFG.base + "/lotes/" + encodeURIComponent(l.id) + "/status", { cache: "no-store" });
        if (!resp.ok) continue;
        const s = (await resp.json()) as StatusLote;
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
    atualizarBarra();
    salvar();
  }
  acompanhando = false;
}

// ---------- conversa com o Claude ----------
async function abrirConversa(lote: LoteLocal): Promise<void> {
  if (!raiz) return;
  if (raiz.hidden) religar();
  estado.conversa = { lote, mensagens: [], selecao: new Map() };
  if (!ui.conversa) {
    ui.conversa = h("div", { class: "an-conversa" });
    raiz.append(ui.conversa);
  }
  ui.conversa.hidden = false;
  renderizarConversa();
  await recarregarConversa();
  void acompanharLotes();
}

function fecharConversa(): void {
  estado.conversa = null;
  if (ui.conversa) ui.conversa.hidden = true;
}

async function recarregarConversa(): Promise<void> {
  const c = estado.conversa;
  if (!c) return;
  try {
    const resp = await fetch(CFG.base + "/lotes/" + encodeURIComponent(c.lote.id) + "/conversa", { cache: "no-store" });
    if (!resp.ok) return;
    const corpo = (await resp.json()) as { mensagens: Mensagem[]; abertas: string[] };
    if (estado.conversa !== c) return;
    c.mensagens = corpo.mensagens;
    c.lote.perguntasAbertas = corpo.abertas.length;
    renderizarConversa();
    atualizarBarra();
    salvar();
  } catch {
    /* servidor indisponível no momento */
  }
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderizarConversa(): void {
  const c = estado.conversa;
  const painel = ui.conversa;
  if (!c || !painel) return;
  const respondidas = new Set(c.mensagens.filter((m) => m.responde).map((m) => m.responde));
  const abertas = c.mensagens.filter((m) => m.autor === "agente" && m.tipo !== "nota" && !respondidas.has(m.id));
  const rotuloEstado = c.lote.estado === "processado" ? "aplicado" : c.lote.estado === "em_andamento" ? `${AGENTE} trabalhando` : `aguardando ${AGENTE}`;
  painel.textContent = "";
  const alca = h("span", { class: "an-alca", html: ICONES.alca, title: "Arrastar" });
  const cab = h(
    "div",
    { class: "cab" },
    alca,
    h("span", { class: "an-ico", style: "background:#2c302f", html: ICONES.sliders }),
    h("div", { class: "tit" }, `Conversa com ${AGENTE}`, h("span", { class: "sub" }, `Lote das ${hora(c.lote.enviadoEm)} · ${rotuloEstado}${c.lote.resumo ? " · " + c.lote.resumo : ""}`)),
    h("button", { class: "an-ico", title: "Fechar", html: ICONES.fechar, onclick: fecharConversa })
  );
  painel.append(cab);
  tornarArrastavel(painel, [alca, cab], "conversa");

  const fluxo = h("div", { class: "fluxo" });
  if (!c.mensagens.length) {
    fluxo.append(h("div", { class: "vazio" }, c.lote.estado === "processado" ? "Nenhuma mensagem neste lote." : `Quando ${AGENTE} explicar algo ou perguntar, aparece aqui. Você também pode mandar um recado.`));
  }
  const usuarioRespondeu = new Map(c.mensagens.filter((m) => m.responde).map((m) => [m.responde ?? "", m] as const));
  for (const m of c.mensagens) {
    if (m.autor === "usuario" && m.responde) continue;
    const bloco = h("div", { class: "an-msg " + m.autor });
    bloco.append(h("div", { class: "balao" }, m.texto));
    if (m.autor === "agente" && m.tipo !== "nota") {
      const resposta = usuarioRespondeu.get(m.id);
      if (resposta) {
        const escolhidas = resposta.opcoes?.length ? resposta.opcoes.join(", ") : "";
        bloco.append(h("div", { class: "escolhida" }, "Você respondeu" + (escolhidas ? ": " + escolhidas : "") + (resposta.texto && resposta.texto !== escolhidas ? (escolhidas ? " — " : ": ") + resposta.texto : "")));
      } else if (m.tipo === "escolha" && m.opcoes?.length) {
        const marcadas = c.selecao.get(m.id) ?? new Set<string>();
        const grupo = h("div", { class: "opcoes" });
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
            }, opcao)
          );
        }
        grupo.append(h("button", { class: "an-opcao", onclick: () => focarEntrada(m) }, "Outro…"));
        bloco.append(grupo);
        if (m.multipla && marcadas.size) {
          bloco.append(h("button", { class: "an-btn", style: "align-self:flex-start;background:#2563eb", onclick: () => void responder(m, Array.from(marcadas), "") }, `Enviar ${marcadas.size} selecionada(s)`));
        }
      }
    }
    bloco.append(h("div", { class: "meta" }, (m.autor === "agente" ? (m.agente || AGENTE) + " · " : "Você · ") + hora(m.em)));
    fluxo.append(bloco);
  }
  painel.append(fluxo);

  const pendente = abertas[abertas.length - 1];
  if (pendente) painel.append(h("div", { class: "dica-resp" }, pendente.tipo === "escolha" ? "Escolha uma opção acima ou escreva outra resposta." : `${AGENTE} aguarda sua resposta.`));
  const campo = h("textarea", { rows: 1, placeholder: pendente ? `Responder a ${AGENTE}…` : `Recado para ${AGENTE} sobre este lote…` });
  const enviarBtn = h("button", { class: "an-ok", title: "Enviar (Enter)", html: ICONES.ok });
  const enviarTexto = () => {
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    void responder(pendente ?? null, [], texto);
  };
  enviarBtn.addEventListener("click", enviarTexto);
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarTexto();
    }
  });
  campo.addEventListener("input", () => {
    campo.style.height = "auto";
    campo.style.height = Math.min(120, campo.scrollHeight) + "px";
  });
  const btnMic = h("button", { class: "an-ico", title: "Ditar resposta", html: ICONES.mic });
  btnMic.addEventListener("click", () => alternarDitadoEm(campo, btnMic));
  painel.append(h("div", { class: "entrada" }, campo, btnMic, enviarBtn));
  fluxo.scrollTop = fluxo.scrollHeight;
  (painel as HTMLDivElement & { __campo?: HTMLTextAreaElement }).__campo = campo;
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
  if (estado.ditado) {
    pararDitado();
    return;
  }
  const Reconhecimento = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Reconhecimento) {
    avisar("Este navegador não oferece reconhecimento de voz.", 4000);
    return;
  }
  if (!window.isSecureContext) {
    avisar("Microfone bloqueado em http. Marque esta origem em chrome://flags/#unsafely-treat-insecure-origin-as-secure", 7000);
    return;
  }
  const rec = new Reconhecimento();
  rec.lang = "pt-BR";
  rec.interimResults = true;
  rec.continuous = true;
  const base = campo.value ? campo.value.replace(/\s+$/, "") + " " : "";
  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let finais = "";
    let parcial = "";
    for (let i = 0; i < ev.results.length; i++) {
      const resultado = ev.results[i];
      const t = resultado?.[0]?.transcript ?? "";
      if (resultado?.isFinal) finais += t + " ";
      else parcial += t;
    }
    campo.value = (base + finais + parcial).replace(/\s+/g, " ");
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    avisar("Voz: " + (ev.error || "erro"), 4000);
    pararDitado();
  };
  rec.onend = () => {
    if (estado.ditado && estado.ditado.rec === rec) pararDitado();
  };
  rec.start();
  botao.classList.add("grav");
  estado.ditado = { rec, botao };
  avisar("Ouvindo… clique no microfone para parar.");
}

// ---------- árvore de elementos e seleção por área ----------
const CHAVE_ARVORE = "anotador-ui:arvore";
const LIMITE_FILHOS = 40;
const LIMITE_LINHAS = 400;
/** linhas da árvore → elemento da página que representam */
const linhaPara = new Map<HTMLElement, Element>();
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
    h("span", { class: "an-ico", style: "background:#2c302f", html: ICONES.arvore }),
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
    h("div", { class: "dica-uso" }, "Clique seleciona · duplo clique abre propriedades · arraste na página para listar uma área · setas navegam aqui · Alt+seta na página: pai, filho, irmãos")
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
  const id = el.id && !ehDinamico(el.id) ? "#" + el.id.slice(0, 24) : "";
  const cls = classesEstaveis(el)
    .slice(0, 2)
    .map((c) => "." + (c.length > 16 ? c.slice(0, 15) + "…" : c))
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

  const alvoLinha = linhas.find((l) => l.el === a.linhaFocada) ?? linhas.find((l) => l.el === foco) ?? linhas[0];
  if (alvoLinha) {
    alvoLinha.no.tabIndex = 0;
    const topo = alvoLinha.no.offsetTop;
    if (topo < corpo.scrollTop || topo + alvoLinha.no.offsetHeight > corpo.scrollTop + corpo.clientHeight) corpo.scrollTop = Math.max(0, topo - corpo.clientHeight / 2);
    if (tinhaFoco) alvoLinha.no.focus({ preventScroll: true });
  }
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
    const topo = n.offsetTop;
    if (topo < corpo.scrollTop || topo + n.offsetHeight > corpo.scrollTop + corpo.clientHeight) n.scrollIntoView({ block: "nearest" });
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
  estado.gestoArea = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, ativo: false, pointerId: e.pointerId };
}

function rectDoGesto(g: GestoArea): Rect {
  return { left: Math.min(g.x0, g.x), top: Math.min(g.y0, g.y), width: Math.abs(g.x - g.x0), height: Math.abs(g.y - g.y0) };
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
    if (Math.hypot(g.x - g.x0, g.y - g.y0) < 6) return;
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
    desenharArea(r, `${res.contidos.length}${res.truncado ? "+" : ""} elemento(s) · ${Math.round(r.width)}×${Math.round(r.height)}`);
  }, 90);
}

function redesenharAreaAtual(): void {
  const area = estado.arvore.area;
  if (area) desenharArea(areaNoViewport(area), rotuloArea(area));
  else ui.caixaArea.style.display = "none";
}

function concluirGestoArea(e: PointerEvent, cancelado = false): void {
  const g = estado.gestoArea;
  if (!g || e.pointerId !== g.pointerId) return;
  estado.gestoArea = null;
  if (!g.ativo) return;
  ui.caixaArea.classList.remove("ativa");
  // O click que fecha o gesto viria como seleção do elemento sob o cursor.
  suprimirCliqueAte = Date.now() + 500;
  g.x = e.clientX;
  g.y = e.clientY;
  const r = rectDoGesto(g);
  if (cancelado || r.width < 8 || r.height < 8) {
    redesenharAreaAtual();
    return;
  }
  definirArea(r);
}

function definirArea(r: Rect): void {
  const res = elementosNaArea(r, ignorar);
  if (res.contidos.length === 0) {
    redesenharAreaAtual();
    avisar(res.parciais ? `Nenhum elemento cabe inteiro na área (${res.parciais} cortado(s) pela borda); amplie um pouco.` : "Nenhum elemento dentro da área.", 4000);
    return;
  }
  const area: AreaSelecionada = {
    rect: rectPagina(r),
    contidos: new Set(res.contidos),
    raiz: ancestralComum(res.contidos) ?? document.body,
    parciais: res.parciais,
    truncado: res.truncado,
  };
  estado.arvore.area = area;
  estado.arvore.linhaFocada = null;
  estado.arvore.abertos = new WeakSet();
  estado.arvore.fechados = new WeakSet();
  desenharArea(r, rotuloArea(area));
  if (estado.arvore.aberta) renderizarArvore();
  else abrirArvore();
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
