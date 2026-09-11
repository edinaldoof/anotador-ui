// Engine de precisão de captura — portada do inspetor de packages/fluxos-extension
// (repositório delta). Sem dependência de chrome.*: só DOM.

type Ignorar = (n: Node) => boolean;

interface AlvoNoPonto {
  el: Element | null;
  doc: Document;
  framePath: string[];
  crossOrigin: boolean;
}

const DINAMICO_RE =
  /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{12,}|^(ember\d|react-|:r|radix-|cdk-|mat-input-\d|ui-id-\d|ng-)/i;

function cssEsc(s: string): string {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function ehDinamico(v: string | null | undefined): boolean {
  if (!v) return true;
  const s = String(v);
  if (s.length > 64) return true;
  if (DINAMICO_RE.test(s)) return true;
  const digitos = (s.match(/\d/g) || []).length;
  return digitos / s.length > 0.5;
}

function tokensClasse(el: Element): string[] {
  return typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
}

function classesEstaveis(el: Element): string[] {
  return tokensClasse(el).filter((c) => !ehDinamico(c) && c.length <= 30);
}

function textoProprio(el: Element): string {
  return (el.textContent || "").trim().replace(/\s+/g, " ");
}

function consultavel(raiz: Node): raiz is Document | ShadowRoot {
  return typeof (raiz as ParentNode).querySelectorAll === "function";
}

const INTERATIVO =
  'a,button,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],' +
  '[role="tab"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[onclick]';

// Clique num <span>/<svg> dentro de <a>/<button> captura o interativo — até 3 níveis.
function encaixarNoInterativo(el: Element): Element {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || tag === "iframe") return el;
  let interativo = false;
  try {
    interativo = el.matches(INTERATIVO);
  } catch {
    interativo = false;
  }
  if (interativo) return el;
  let alvo: Element | null = null;
  try {
    alvo = el.closest(INTERATIVO);
  } catch {
    alvo = null;
  }
  if (!alvo || alvo === el) return el;
  let profundidade = 0;
  let n: Element | null = el;
  while (n && n !== alvo && profundidade <= 3) {
    n = n.parentElement;
    profundidade++;
  }
  return n === alvo && profundidade <= 3 ? alvo : el;
}

function seletorCurto(el: Element, raiz: ParentNode): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && !ehDinamico(el.id)) return "#" + cssEsc(el.id);
  const name = el.getAttribute("name");
  if (name && !ehDinamico(name)) return tag + '[name="' + name.replace(/"/g, '\\"') + '"]';
  const src = el.getAttribute("src");
  if (tag === "iframe" && src) {
    const caminho = src.split("?")[0]?.split("/").pop();
    if (caminho && !ehDinamico(caminho)) return 'iframe[src*="' + caminho.replace(/"/g, '\\"') + '"]';
  }
  let sel =
    tag +
    classesEstaveis(el)
      .slice(0, 2)
      .map((c) => "." + cssEsc(c))
      .join("");
  const pai = el.parentElement;
  if (pai) {
    let quantos = 0;
    try {
      quantos = raiz.querySelectorAll(sel).length;
    } catch {
      quantos = 0;
    }
    if (quantos !== 1) {
      const mesmaTag = Array.from(pai.children).filter((c) => c.tagName === el.tagName);
      if (mesmaTag.length > 1) sel += ":nth-of-type(" + (mesmaTag.indexOf(el) + 1) + ")";
    }
  }
  return sel;
}

function perfurarShadow(el: Element | null, x: number, y: number): Element | null {
  let guarda = 0;
  while (el && el.shadowRoot && guarda++ < 8) {
    let interno: Element | null = null;
    try {
      interno = el.shadowRoot.elementFromPoint(x, y);
    } catch {
      interno = null;
    }
    if (!interno || interno === el) break;
    el = interno;
  }
  return el;
}

// Quando o cursor está sobre o overlay, a pilha inteira do ponto é consultada;
// o primeiro nó que não é nosso é o alvo real.
function elementoAtrasDoOverlay(x: number, y: number, ignorar: Ignorar): Element | null {
  let pilha: Element[] = [];
  try {
    pilha = document.elementsFromPoint(x, y);
  } catch {
    pilha = [];
  }
  for (const n of pilha) {
    if (!ignorar(n)) return n;
  }
  return null;
}

// elementFromPoint que desce em iframes same-origin e perfura shadow roots abertos.
function elementoProfundoNoPonto(x: number, y: number, ignorar?: Ignorar): AlvoNoPonto {
  let doc: Document = document;
  let el: Element | null = doc.elementFromPoint(x, y);
  if (ignorar && el && ignorar(el)) el = elementoAtrasDoOverlay(x, y, ignorar);
  el = perfurarShadow(el, x, y);
  const framePath: string[] = [];
  let crossOrigin = false;
  let guarda = 0;
  while (el && guarda++ < 8 && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
    let filho: Document | null = null;
    try {
      filho = (el as HTMLIFrameElement).contentDocument;
    } catch {
      filho = null;
    }
    if (!filho) {
      crossOrigin = true;
      break;
    }
    const fr = el.getBoundingClientRect();
    framePath.push(seletorCurto(el, doc));
    x -= fr.left;
    y -= fr.top;
    doc = filho;
    el = perfurarShadow(doc.elementFromPoint(x, y), x, y);
  }
  return { el, doc, framePath, crossOrigin };
}

function caminhoShadow(el: Element): string[] {
  const caminho: string[] = [];
  let no: Node = el;
  let guarda = 0;
  while (guarda++ < 8) {
    const raiz = no.getRootNode();
    if (!(raiz instanceof ShadowRoot)) break;
    const raizDoHost = raiz.host.getRootNode();
    caminho.unshift(seletorCurto(raiz.host, consultavel(raizDoHost) ? raizDoHost : document));
    no = raiz.host;
  }
  return caminho;
}

function contarCasamentos(sel: string, raiz: ParentNode): number {
  try {
    return raiz.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

// Candidatos ranqueados por robustez: data-* de teste > id estável > name/aria >
// placeholder/title > texto > href > classes estáveis > caminho CSS mínimo > xpath.
function construirSeletores(el: Element, doc: Document): Seletor[] {
  const raizBruta = el.getRootNode();
  const raiz: Document | ShadowRoot = consultavel(raizBruta) ? raizBruta : doc;
  const emShadow = raiz instanceof ShadowRoot;
  const cands: Seletor[] = [];
  const vistos = new Set<string>();
  const tag = el.tagName.toLowerCase();

  function addCss(tipo: TipoSeletor, valor: string, pontos: number): void {
    const chave = tipo + "|" + valor;
    if (vistos.has(chave)) return;
    let els: NodeListOf<Element>;
    try {
      els = raiz.querySelectorAll(valor);
    } catch {
      return;
    }
    const idx = Array.prototype.indexOf.call(els, el);
    if (idx === -1) return;
    const unico = els.length === 1;
    vistos.add(chave);
    cands.push({ tipo, valor, unico, pontos: unico ? pontos : Math.max(10, pontos - 25 - (idx > 0 ? 10 : 0)) });
  }
  const attr = (nome: string) => el.getAttribute(nome);
  const aspas = (v: string) => v.replace(/"/g, '\\"');

  for (const a of ["data-testid", "data-test-id", "data-test", "data-qa", "data-cy"]) {
    const v = attr(a);
    if (v && !ehDinamico(v)) addCss("data", "[" + a + '="' + aspas(v) + '"]', 100);
  }
  if (el.id && !ehDinamico(el.id)) addCss("id", "#" + cssEsc(el.id), 95);
  const name = attr("name");
  if (name && !ehDinamico(name)) addCss("css", tag + '[name="' + aspas(name) + '"]', 90);
  const aria = attr("aria-label");
  if (aria && !ehDinamico(aria)) addCss("aria", tag + '[aria-label="' + aspas(aria) + '"]', 85);
  const placeholder = attr("placeholder");
  if (placeholder && !ehDinamico(placeholder)) addCss("css", tag + '[placeholder="' + aspas(placeholder) + '"]', 78);
  const title = attr("title");
  if (title && !ehDinamico(title)) addCss("css", tag + '[title="' + aspas(title) + '"]', 74);

  const texto = textoProprio(el);
  if (texto && texto.length <= 80) {
    let quantos = 0;
    try {
      for (const c of raiz.querySelectorAll(tag)) {
        if (textoProprio(c) === texto) quantos++;
      }
    } catch {
      quantos = 1;
    }
    cands.push({ tipo: "texto", valor: texto, tag, unico: quantos === 1, pontos: quantos === 1 ? 72 : 42 });
  }

  if (tag === "a") {
    const href = attr("href");
    if (href && href !== "#" && !/^javascript:/i.test(href)) {
      const caminho = href.split("?")[0] ?? "";
      if (caminho && caminho.length <= 120 && !ehDinamico(caminho.split("/").pop() || caminho)) {
        addCss("css", 'a[href="' + aspas(href) + '"]', 68);
      }
    }
  }

  const cls = classesEstaveis(el).slice(0, 2);
  if (cls.length > 0) addCss("css", tag + cls.map((c) => "." + cssEsc(c)).join(""), 58);

  {
    const partes: string[] = [];
    let no: Element | null = el;
    let profundidade = 0;
    let selFinal: string | null = null;
    while (no && no.nodeType === 1 && profundidade < 7) {
      const t = no.tagName.toLowerCase();
      if (t === "html" || t === "body") break;
      partes.unshift(seletorCurto(no, raiz));
      const sel = partes.join(" > ");
      if ((partes[0] ?? "").startsWith("#") || contarCasamentos(sel, raiz) === 1) {
        selFinal = sel;
        break;
      }
      selFinal = sel;
      no = no.parentElement;
      profundidade++;
    }
    if (selFinal) addCss("css", selFinal, 50);
  }

  if (!emShadow) {
    const xp = xpath(el);
    if (xp) cands.push({ tipo: "xpath", valor: xp, unico: true, pontos: 30 });
  }

  cands.sort((a, b) => b.pontos - a.pontos || Number(b.unico) - Number(a.unico));
  return cands.slice(0, 10);
}

function xpath(el: Element): string | null {
  if (el.id && !ehDinamico(el.id)) return '//*[@id="' + el.id + '"]';
  const segs: string[] = [];
  let no: Element | null = el;
  while (no && no.nodeType === 1 && segs.length < 50) {
    let i = 1;
    let irmao = no.previousElementSibling;
    while (irmao) {
      if (irmao.tagName === no.tagName) i++;
      irmao = irmao.previousElementSibling;
    }
    segs.unshift(no.tagName.toLowerCase() + "[" + i + "]");
    no = no.parentElement;
  }
  if (no) return null;
  return "/" + segs.join("/");
}

const META_ATTRS = ["id", "name", "class", "type", "role", "aria-label", "placeholder", "title", "href", "for", "data-slot"];

function cadeiaAncestrais(el: Element): NivelAncestral[] {
  const niveis: NivelAncestral[] = [];
  let n = el.parentElement;
  let guarda = 0;
  while (n && n.tagName !== "HTML" && n.tagName !== "BODY" && guarda++ < 8) {
    const item: NivelAncestral = { tag: n.tagName.toLowerCase() };
    const id = n.getAttribute("id");
    if (id) item.id = id.slice(0, 40);
    const cls = n.classList[0];
    if (cls) item.classe = cls.slice(0, 40);
    const role = n.getAttribute("role");
    if (role) item.role = role.slice(0, 24);
    niveis.unshift(item);
    n = n.parentElement;
  }
  return niveis;
}

interface FiberReact {
  type?: unknown;
  return?: FiberReact | null;
}

// Invólucros do React/Next que aparecem em toda árvore e não apontam para arquivo do app.
const COMPONENTE_INTERNO_RE =
  /^(Fragment|Suspense|Consumer|Symbol|Segment\w*|\w*LayoutRouter\w*|\w*Boundary\w*|\w*Handler(Old|New)?|AppRouter|Router|HotReload|ReactDevOverlay|RenderFromTemplateContext|ServerRoot|Root|Head|\w*Provider\w*|\w*ScrollAndFocus\w*|DevRoot\w*|Activity|Profiler|StrictMode|__\w+|\w*Context)$/;

// Cadeia de componentes React (do mais próximo ao mais externo) lida da fiber.
// Em dev os nomes não são minificados: é o ponteiro mais direto para o arquivo-fonte.
// Conteúdo de Server Component não tem fiber própria no cliente — a lista sai vazia.
function componentesReact(el: Element): string[] {
  let no: Element | null = el;
  let fiber: FiberReact | null = null;
  let guarda = 0;
  while (no && !fiber && guarda++ < 6) {
    const chave = Object.keys(no).find((k) => k.startsWith("__reactFiber$"));
    if (chave) fiber = (no as unknown as Record<string, FiberReact>)[chave] ?? null;
    else no = no.parentElement;
  }
  const nomes: string[] = [];
  let f = fiber;
  let passos = 0;
  while (f && passos++ < 400 && nomes.length < 8) {
    const t = f.type;
    if (t && typeof t !== "string") {
      const fn = t as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
      const nome = fn.displayName || fn.name || fn.render?.displayName || fn.render?.name || "";
      if (nome && !COMPONENTE_INTERNO_RE.test(nome) && !nomes.includes(nome)) nomes.push(nome);
    }
    f = f.return ?? null;
  }
  return nomes;
}

function metadados(el: Element): MetaElemento {
  const attrs: Record<string, string> = {};
  for (const a of META_ATTRS) {
    const v = el.getAttribute(a);
    if (v) attrs[a] = v.slice(0, 400);
  }
  const meta: MetaElemento = {
    tag: el.tagName.toLowerCase(),
    attrs,
    texto: textoProprio(el).slice(0, 120),
    cadeia: cadeiaAncestrais(el),
    componentes: componentesReact(el),
    html: el.outerHTML.slice(0, 800),
  };
  const pai = el.parentElement;
  if (pai && pai.tagName !== "BODY" && pai.tagName !== "HTML") {
    const abertura = pai.outerHTML;
    meta.htmlPai = abertura.slice(0, Math.min(400, abertura.indexOf(">") + 1));
  }
  return meta;
}

function descrever(el: Element): string {
  let d = el.tagName.toLowerCase();
  if (el.id) d += "#" + el.id;
  const comp = componentesReact(el)[0];
  if (comp) d = comp + " › " + d;
  const t = textoProprio(el).slice(0, 40);
  if (t) d += ' "' + t + '"';
  return d;
}

// Rect em coordenadas do viewport TOP (soma offsets de iframes).
function rectTopo(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const rect: Rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  let win: Window | null = el.ownerDocument.defaultView;
  let guarda = 0;
  while (win && win !== window && guarda++ < 10) {
    let frameEl: Element | null = null;
    try {
      frameEl = win.frameElement;
    } catch {
      frameEl = null;
    }
    if (!frameEl) break;
    const fr = frameEl.getBoundingClientRect();
    rect.left += fr.left;
    rect.top += fr.top;
    win = win.parent;
  }
  return rect;
}

// Localiza de novo um elemento salvo (reload/HMR) testando os candidatos em ordem.
function localizarPorSeletores(seletores: Seletor[]): Element | null {
  for (const c of seletores) {
    try {
      if (c.tipo === "xpath") {
        const r = document.evaluate(c.valor, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (r.singleNodeValue instanceof Element) return r.singleNodeValue;
      } else if (c.tipo === "texto") {
        for (const cand of document.querySelectorAll(c.tag || "*")) {
          if (textoProprio(cand) === c.valor) return cand;
        }
      } else {
        const els = document.querySelectorAll(c.valor);
        if (els.length === 1) return els[0] ?? null;
      }
    } catch {
      /* candidato inválido neste documento */
    }
  }
  return null;
}

// ---------- estrutura: pai/filhos atravessando shadow roots e iframes same-origin ----------
const NAO_RENDERIZAVEL = new Set(["script", "style", "link", "meta", "noscript", "template", "title", "head", "base"]);

function noEstrutural(el: Element): boolean {
  if (NAO_RENDERIZAVEL.has(el.tagName.toLowerCase())) return false;
  return el.id !== "__anotador_host";
}

// Pai "visual": parentElement, o host do shadow root ou o <iframe> que contém o documento.
function paiEstrutural(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const raiz = el.getRootNode();
  if (raiz instanceof ShadowRoot) return raiz.host;
  if (el.tagName === "BODY" || el.tagName === "HTML") {
    let frame: Element | null = null;
    try {
      frame = el.ownerDocument.defaultView?.frameElement ?? null;
    } catch {
      frame = null;
    }
    return frame;
  }
  return null;
}

// Filhos "visuais": os do shadow root aberto primeiro, depois os filhos normais e o body de iframe same-origin.
function filhosEstruturais(el: Element): Element[] {
  const filhos: Element[] = [];
  if (el.shadowRoot) filhos.push(...Array.from(el.shadowRoot.children).filter(noEstrutural));
  filhos.push(...Array.from(el.children).filter(noEstrutural));
  if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
    try {
      const corpo = (el as HTMLIFrameElement).contentDocument?.body;
      if (corpo) filhos.push(corpo);
    } catch {
      /* cross-origin: sem acesso */
    }
  }
  return filhos;
}

function irmaoEstrutural(el: Element, direcao: -1 | 1): Element | null {
  const pai = paiEstrutural(el);
  if (!pai) return null;
  const irmaos = filhosEstruturais(pai);
  const i = irmaos.indexOf(el);
  return i === -1 ? null : irmaos[i + direcao] ?? null;
}

// Seletores dos <iframe> que envolvem o elemento, do mais externo ao mais interno.
function caminhoFrames(el: Element): string[] {
  const caminho: string[] = [];
  let win: Window | null = el.ownerDocument.defaultView;
  let guarda = 0;
  while (win && win !== window && guarda++ < 10) {
    let frameEl: Element | null = null;
    try {
      frameEl = win.frameElement;
    } catch {
      frameEl = null;
    }
    if (!frameEl) break;
    caminho.unshift(seletorCurto(frameEl, frameEl.ownerDocument));
    win = win.parent;
  }
  return caminho;
}

// Texto dos nós de texto diretos (sem descer nos filhos).
function textoDireto(el: Element): string {
  let t = "";
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent ?? "";
  return t.trim().replace(/\s+/g, " ");
}

// Componente React cujo primeiro nó DOM é este elemento — ou seja, o componente "começa" aqui.
// Sobe pela fiber enquanto o nó for o primeiro filho do pai; pára no primeiro componente nomeado.
function componenteDono(el: Element): string | null {
  const chave = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!chave) return null;
  interface FiberComFilho extends FiberReact {
    child?: FiberReact | null;
  }
  let f = (el as unknown as Record<string, FiberComFilho>)[chave] ?? null;
  let passos = 0;
  while (f && f.return && passos++ < 50) {
    const pai = f.return as FiberComFilho;
    if (pai.child !== f) return null;
    const t = pai.type;
    if (t && typeof t !== "string") {
      const fn = t as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
      const nome = fn.displayName || fn.name || fn.render?.displayName || fn.render?.name || "";
      if (nome && !COMPONENTE_INTERNO_RE.test(nome)) return nome;
    }
    f = pai;
  }
  return null;
}

interface ElementosNaArea {
  /** inteiramente dentro do retângulo, em ordem de documento */
  contidos: Element[];
  /** cruzam a borda do retângulo sem caber nele */
  parciais: number;
  /** varredura interrompida por tamanho da página */
  truncado: boolean;
}

// Elementos com caixa inteiramente dentro do retângulo (coordenadas do viewport), descendo em shadow roots abertos.
function elementosNaArea(area: Rect, ignorar: Ignorar, limite = 20000): ElementosNaArea {
  const direita = area.left + area.width;
  const baixo = area.top + area.height;
  const contidos: Element[] = [];
  let parciais = 0;
  let visitados = 0;
  let truncado = false;
  const visitar = (raiz: ParentNode): void => {
    for (const el of Array.from(raiz.children)) {
      if (truncado) return;
      if (++visitados > limite) {
        truncado = true;
        return;
      }
      if (!noEstrutural(el) || ignorar(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const dentro = r.left >= area.left - 1 && r.top >= area.top - 1 && r.right <= direita + 1 && r.bottom <= baixo + 1;
        const cruza = r.left < direita && r.right > area.left && r.top < baixo && r.bottom > area.top;
        if (dentro) contidos.push(el);
        else if (cruza) parciais++;
      }
      if (el.shadowRoot) visitar(el.shadowRoot);
      visitar(el);
    }
  };
  visitar(document.body);
  return { contidos, parciais, truncado };
}

// Ancestral comum mais próximo (pelo pai estrutural).
function ancestralComum(els: Element[]): Element | null {
  let comum: Element | null = els[0] ?? null;
  for (const el of els.slice(1)) {
    if (!comum) return null;
    const cadeia = new Set<Element>();
    for (let n: Element | null = comum; n; n = paiEstrutural(n)) cadeia.add(n);
    let n: Element | null = el;
    while (n && !cadeia.has(n)) n = paiEstrutural(n);
    comum = n;
  }
  return comum;
}

function contem(ancestral: Element, el: Element): boolean {
  for (let n: Element | null = el; n; n = paiEstrutural(n)) if (n === ancestral) return true;
  return false;
}
