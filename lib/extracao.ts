// Extrai medidas observáveis de uma página. Não interpreta texto remoto como instrução
// nem atribui intenção de marca a cores, componentes ou decisões de layout.
import { Navegador, type Pagina } from "./cdp.ts";

export type ViewportExtracao = "desktop" | "mobile";
export interface TipografiaExtraida {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
}
export interface TokensExtraidos {
  colors: Record<string, string>;
  typography: Record<string, TipografiaExtraida>;
  spacing: Record<string, string>;
  rounded: Record<string, string>;
  shadows: Record<string, string>;
  components: Record<string, Record<string, string>>;
}
export interface AmostraExtracao { seletor: string; propriedade: string; viewport: ViewportExtracao }
export interface EvidenciaTokenExtracao {
  categoria: string;
  token: string;
  valor: string;
  frequencia: number;
  amostras: AmostraExtracao[];
}
export interface EvidenciasExtracao {
  viewports: Array<{ nome: ViewportExtracao; largura: number; altura: number; url: string; elementosAnalisados: number; domLimitado: boolean }>;
  tokens: EvidenciaTokenExtracao[];
  componentes: Array<{ token: string; tipo: string; seletor: string; texto: string; viewport: ViewportExtracao; frequencia: number }>;
  cssVariables: Array<{ nome: string; valor: string; seletor: string; viewport: ViewportExtracao }>;
  layout: Array<{ seletor: string; viewport: ViewportExtracao; estilos: Record<string, string> }>;
  responsivo: Array<{ seletor: string; propriedade: string; desktop: string; mobile: string }>;
  assets: Array<{ tipo: "imagem" | "fonte" | "icone" | "background"; url: string; origem: string }>;
  limitacoes: string[];
}
export interface ResultadoExtracao {
  nome: string;
  url: string;
  extraidoEm: string;
  markdown: string;
  tokens: TokensExtraidos;
  evidencias: EvidenciasExtracao;
  /** PNG em base64, sem prefixo data:. Apenas o enquadramento inicial, até 2 MiB por imagem. */
  capturas?: { desktop: string; mobile: string };
}

interface FrequenciaBruta { valor: string; frequencia: number; amostras: Array<{ seletor: string; propriedade: string }> }
interface ComponenteBruto { tipo: string; seletor: string; texto: string; estilos: Record<string, string>; tipografia: TipografiaExtraida; frequencia: number }
interface ColetaBruta {
  nome: string;
  url: string;
  elementosAnalisados: number;
  domLimitado: boolean;
  categorias: Record<"colors" | "typography" | "spacing" | "rounded" | "shadows", FrequenciaBruta[]>;
  componentes: ComponenteBruto[];
  cssVariables: Array<{ nome: string; valor: string; seletor: string }>;
  layout: Array<{ seletor: string; estilos: Record<string, string> }>;
  assets: EvidenciasExtracao["assets"];
  folhasInacessiveis: number;
  iframes: number;
  regrasLimitadas: boolean;
}

const VIEWPORTS = [{ nome: "desktop", largura: 1440, altura: 900 }, { nome: "mobile", largura: 390, altura: 844 }] as const;
const LIMITES = { colors: 32, typography: 24, spacing: 24, rounded: 16, shadows: 16 } as const;

// Código executado no contexto isolado do Chromium. A coleta é limitada antes de
// serializar: 6 mil nós visitados, 4 mil renderizados, 160 layouts, 80 componentes.
const COLETAR = String.raw`(() => {
  const categorias = { colors: new Map(), typography: new Map(), spacing: new Map(), rounded: new Map(), shadows: new Map() };
  const componentes = new Map(), cssVariables = new Map(), assets = new Map(), layout = [];
  let elementosAnalisados = 0, visitados = 0, domLimitado = false, folhasInacessiveis = 0, regras = 0, regrasLimitadas = false, iframes = 0;
  const pequeno = (valor, limite = 300) => String(valor ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, limite);
  const esc = (valor) => CSS.escape(valor);
  const seletorDe = (el) => {
    const partes = [];
    let atual = el;
    for (let nivel = 0; atual && nivel < 24; nivel++, atual = atual.parentElement) {
      if (atual.id && atual.getRootNode().querySelectorAll('#' + esc(atual.id)).length === 1) { partes.unshift('#' + esc(atual.id)); break; }
      const tag = atual.localName;
      let indice = 1, irmao = atual.previousElementSibling;
      while (irmao) { if (irmao.localName === tag) indice++; irmao = irmao.previousElementSibling; }
      partes.unshift(tag + (atual.parentElement ? ':nth-of-type(' + indice + ')' : ''));
    }
    const raiz = el.getRootNode();
    return pequeno((raiz instanceof ShadowRoot ? seletorDe(raiz.host) + ' >>> ' : '') + partes.join(' > '), 700);
  };
  const cor = (v) => {
    if (!v || v === 'none' || v === 'transparent') return '';
    const m = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(v);
    if (!m) return pequeno(v);
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha === 0) return '';
    return '#' + m.slice(1, 4).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase() + (alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase() : '');
  };
  const contar = (categoria, valor, seletor, propriedade) => {
    if (!valor) return;
    const mapa = categorias[categoria];
    if (!mapa.has(valor)) {
      if (mapa.size >= 512) return;
      mapa.set(valor, { valor, frequencia: 0, amostras: [] });
    }
    const item = mapa.get(valor); item.frequencia++;
    if (item.amostras.length < 4 && !item.amostras.some((a) => a.seletor === seletor && a.propriedade === propriedade)) item.amostras.push({ seletor, propriedade });
  };
  const asset = (tipo, valor, origem, base = document.baseURI) => {
    if (assets.size >= 100) return;
    try {
      const u = new URL(valor, base);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return;
      const chave = tipo + ':' + u.href;
      if (!assets.has(chave)) assets.set(chave, { tipo, url: pequeno(u.href, 2000), origem: pequeno(origem, 700) });
    } catch {}
  };
  const urlsCss = (valor, tipo, origem, base = document.baseURI) => {
    for (const m of valor.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)) asset(tipo, m[1], origem, base);
  };
  const variaveis = (el, estilo, seletor) => {
    if (cssVariables.size >= 240) return;
    for (let i = 0; i < estilo.length && cssVariables.size < 240; i++) {
      const nome = estilo[i]; if (!nome.startsWith('--')) continue;
      const valor = pequeno(estilo.getPropertyValue(nome).trim(), 500);
      const chave = nome + ':' + valor;
      if (valor && !cssVariables.has(chave)) cssVariables.set(chave, { nome: pequeno(nome, 150), valor, seletor });
    }
  };
  const fontes = (lista, origem) => {
    for (const regra of lista) {
      if (++regras > 4000) { regrasLimitadas = true; return; }
      if (regra.type === 5) urlsCss(regra.style.getPropertyValue('src'), 'fonte', origem, /^https?:/.test(origem) ? origem : document.baseURI);
      try { if (regra.cssRules) fontes(regra.cssRules, origem); } catch { folhasInacessiveis++; }
      if (regrasLimitadas) return;
    }
  };
  for (const folha of document.styleSheets) {
    try { fontes(folha.cssRules, folha.href || 'CSS da página'); } catch { folhasInacessiveis++; }
    if (regrasLimitadas) break;
  }
  for (const link of document.querySelectorAll('link[rel~="icon"],link[as="font"]')) asset(link.getAttribute('as') === 'font' ? 'fonte' : 'icone', link.href, seletorDe(link));
  const filas = [document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT)];
  while (filas.length) {
    const arvore = filas.shift(); let el = arvore.currentNode;
    do {
      if (++visitados > 6000 || elementosAnalisados >= 4000) { domLimitado = true; break; }
      if (!(el instanceof Element)) continue;
      if (el.id === '__anotador_host' || el.closest('#__anotador_host') || /^(script|style|meta|link|noscript|template)$/.test(el.localName)) continue;
      if (el.shadowRoot) filas.push(document.createTreeWalker(el.shadowRoot, NodeFilter.SHOW_ELEMENT));
      if (el.localName === 'iframe') iframes++;
      const estilo = getComputedStyle(el), seletor = seletorDe(el), tag = el.localName;
      const textoDireto = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const tipo = el.matches('button,[role="button"],input[type="button"],input[type="submit"]') ? 'button'
        : /^(input|select|textarea|nav|header|footer|blockquote)$/.test(tag) ? tag
        : tag === 'a' && el.hasAttribute('href') ? 'link'
        : /^(h[1-6])$/.test(tag) ? tag
        : /(?:^|[\s_-])card(?:$|[\s_-])/.test(el.getAttribute('class') || '') ? 'card'
        : tag === 'article' ? 'article' : '';
      if (layout.length < 160 && (/^(body|main|header|nav|footer|section|article|h[1-6]|button)$/.test(tag) || /grid|flex/.test(estilo.display))) {
        const propriedades = ['display', 'visibility', 'fontSize', 'gridTemplateColumns', 'flexDirection', 'flexWrap', 'gap', 'padding', 'maxWidth', 'width', 'height', 'position'];
        layout.push({ seletor, estilos: Object.fromEntries(propriedades.map((p) => [p, pequeno(estilo[p])])) });
      }
      if (el === document.documentElement || el === document.body || (tipo && componentes.size < 40)) variaveis(el, estilo, seletor);
      const rect = el.getBoundingClientRect();
      if (estilo.display === 'none' || /hidden|collapse/.test(estilo.visibility) || estilo.opacity === '0' || !rect.width || !rect.height || (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
      elementosAnalisados++;
      const tipografia = Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].map((p) => [p, pequeno(estilo[p]) ]));
      if (textoDireto || /^(input|textarea|select)$/.test(tag)) {
        contar('typography', JSON.stringify(tipografia), seletor, 'font');
        contar('colors', cor(estilo.color), seletor, 'color');
      }
      contar('colors', cor(estilo.backgroundColor), seletor, 'background-color');
      for (const lado of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(estilo['border' + lado + 'Width']) > 0 && estilo['border' + lado + 'Style'] !== 'none') contar('colors', cor(estilo['border' + lado + 'Color']), seletor, 'border-' + lado.toLowerCase() + '-color');
        for (const propriedade of ['margin', 'padding']) {
          const valor = estilo[propriedade + lado];
          if (parseFloat(valor) !== 0 && Number.isFinite(parseFloat(valor))) contar('spacing', pequeno(valor), seletor, propriedade + '-' + lado.toLowerCase());
        }
      }
      for (const propriedade of ['rowGap', 'columnGap']) if (parseFloat(estilo[propriedade]) > 0) contar('spacing', pequeno(estilo[propriedade]), seletor, propriedade);
      if (el instanceof SVGElement) for (const propriedade of ['fill', 'stroke']) contar('colors', cor(estilo[propriedade]), seletor, propriedade);
      if (estilo.borderRadius !== '0px') contar('rounded', pequeno(estilo.borderRadius), seletor, 'border-radius');
      if (estilo.boxShadow !== 'none') contar('shadows', pequeno(estilo.boxShadow, 1200), seletor, 'box-shadow');
      if (el instanceof HTMLImageElement) asset('imagem', el.currentSrc || el.src, seletor);
      urlsCss(estilo.backgroundImage, 'background', seletor);
      if (tipo) {
        const estilos = Object.fromEntries(['backgroundColor', 'color', 'borderRadius', 'padding', 'borderColor', 'borderWidth', 'boxShadow', 'width', 'height', 'position', 'display', 'gap'].map((p) => [p, pequeno(estilo[p], p === 'boxShadow' ? 1200 : 300)]));
        for (const p of ['backgroundColor', 'color', 'borderColor']) estilos[p] = cor(estilos[p]) || estilos[p];
        const chave = tipo + JSON.stringify(estilos) + JSON.stringify(tipografia);
        if (componentes.has(chave)) componentes.get(chave).frequencia++;
        else if (componentes.size < 80) componentes.set(chave, { tipo, seletor, texto: pequeno(el.getAttribute('aria-label') || el.textContent?.trim(), 90), estilos, tipografia, frequencia: 1 });
      }
    } while ((el = arvore.nextNode()));
    if (domLimitado) break;
  }
  return {
    nome: pequeno(document.title || location.hostname, 150), url: location.href,
    elementosAnalisados, domLimitado,
    categorias: Object.fromEntries(Object.entries(categorias).map(([k, v]) => [k, Array.from(v.values())])),
    componentes: Array.from(componentes.values()), cssVariables: Array.from(cssVariables.values()), layout,
    assets: Array.from(assets.values()), folhasInacessiveis, iframes, regrasLimitadas
  };
})()`;

function validarUrl(valor: string): URL {
  let url: URL;
  try { url = new URL(valor); } catch { throw new Error("Informe uma URL HTTP ou HTTPS válida."); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("A extração aceita somente URLs HTTP ou HTTPS.");
  if (url.username || url.password) throw new Error("A URL não pode conter usuário ou senha.");
  if (url.href.length > 4000) throw new Error("A URL é longa demais (limite de 4.000 caracteres).");
  return url;
}

function inline(valor: string): string { return valor.replace(/[\r\n]/g, " ").replace(/[\\`*_{}\[\]<>|]/g, "\\$&"); }
function codigo(valor: string): string { return "`" + valor.replace(/`/g, "ˋ").replace(/[\r\n]/g, " ") + "`"; }
function yaml(valor: unknown, nivel = 0): string {
  const pad = "  ".repeat(nivel);
  return Object.entries(valor as Record<string, unknown>).map(([k, v]) => {
    const chave = /^[a-zA-Z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
    return v && typeof v === "object" ? (Object.keys(v).length ? `${pad}${chave}:\n${yaml(v, nivel + 1)}` : `${pad}${chave}: {}`) : `${pad}${chave}: ${JSON.stringify(v)}`;
  }).join("\n");
}

function produzirResultado(url: string, coletas: Array<{ nome: ViewportExtracao; dados: ColetaBruta }>, capturas?: ResultadoExtracao["capturas"]): ResultadoExtracao {
  const tokens: TokensExtraidos = { colors: {}, typography: {}, spacing: {}, rounded: {}, shadows: {}, components: {} };
  const evidencias: EvidenciasExtracao = { viewports: [], tokens: [], componentes: [], cssVariables: [], layout: [], responsivo: [], assets: [], limitacoes: [] };
  const porValor: Record<string, Map<string, string>> = {};
  for (const categoria of Object.keys(LIMITES) as Array<keyof typeof LIMITES>) {
    const agrupados = new Map<string, EvidenciaTokenExtracao>();
    for (const coleta of coletas) for (const item of coleta.dados.categorias[categoria]) {
      const existente = agrupados.get(item.valor) ?? { categoria, token: "", valor: item.valor, frequencia: 0, amostras: [] };
      existente.frequencia += item.frequencia;
      existente.amostras.push(...item.amostras.slice(0, 3).map((a) => ({ ...a, viewport: coleta.nome })));
      agrupados.set(item.valor, existente);
    }
    porValor[categoria] = new Map();
    const ordenados = [...agrupados.values()].sort((a, b) => b.frequencia - a.frequencia || a.valor.localeCompare(b.valor));
    for (const [i, item] of ordenados.slice(0, LIMITES[categoria]).entries()) {
      const prefixo = ({ colors: "color", typography: "text", spacing: "space", rounded: "radius", shadows: "shadow" })[categoria];
      item.token = `${prefixo}-${String(i + 1).padStart(2, "0")}`;
      item.amostras = item.amostras.slice(0, 6);
      if (categoria === "typography") tokens.typography[item.token] = JSON.parse(item.valor) as TipografiaExtraida;
      else tokens[categoria][item.token] = item.valor;
      porValor[categoria]?.set(item.valor, item.token);
      evidencias.tokens.push(item);
    }
    if (ordenados.length > LIMITES[categoria]) evidencias.limitacoes.push(`${categoria}: mostrados os ${LIMITES[categoria]} valores mais frequentes dentre ${ordenados.length} observados.`);
  }
  const referencia = (categoria: string, valor: string) => {
    const token = porValor[categoria]?.get(valor);
    return token ? `{${categoria}.${token}}` : valor;
  };
  const variaveis = new Set<string>(), assets = new Set<string>(), tipos = new Map<string, number>();
  const variantes = new Map<string, string>();
  for (const coleta of coletas) {
    const v = VIEWPORTS.find((p) => p.nome === coleta.nome)!;
    evidencias.viewports.push({ nome: coleta.nome, largura: v.largura, altura: v.altura, url: coleta.dados.url, elementosAnalisados: coleta.dados.elementosAnalisados, domLimitado: coleta.dados.domLimitado });
    evidencias.layout.push(...coleta.dados.layout.slice(0, 80).map((l) => ({ ...l, viewport: coleta.nome })));
    for (const componente of coleta.dados.componentes) {
      const chave = componente.tipo + JSON.stringify(componente.estilos) + JSON.stringify(componente.tipografia);
      let token = variantes.get(chave);
      if (!token) {
        if (Object.keys(tokens.components).length >= 40) continue;
        const n = (tipos.get(componente.tipo) ?? 0) + 1;
        tipos.set(componente.tipo, n);
        token = `${componente.tipo}-${String(n).padStart(2, "0")}`;
        variantes.set(chave, token);
        const c = componente.estilos;
        tokens.components[token] = {
          backgroundColor: referencia("colors", c["backgroundColor"] ?? "transparent"),
          textColor: referencia("colors", c["color"] ?? ""),
          typography: referencia("typography", JSON.stringify(componente.tipografia)),
          rounded: referencia("rounded", c["borderRadius"] ?? "0px"),
          padding: c["padding"] ?? "0px",
          borderColor: referencia("colors", c["borderColor"] ?? ""),
          borderWidth: c["borderWidth"] ?? "0px",
          boxShadow: referencia("shadows", c["boxShadow"] ?? "none"),
          width: c["width"] ?? "auto", height: c["height"] ?? "auto", position: c["position"] ?? "static", display: c["display"] ?? "block", gap: c["gap"] ?? "normal",
        };
      }
      evidencias.componentes.push({ token, tipo: componente.tipo, seletor: componente.seletor, texto: componente.texto, viewport: coleta.nome, frequencia: componente.frequencia });
    }
    for (const item of coleta.dados.cssVariables) {
      const chave = item.nome + item.valor + coleta.nome;
      if (!variaveis.has(chave)) { variaveis.add(chave); evidencias.cssVariables.push({ ...item, viewport: coleta.nome }); }
    }
    for (const item of coleta.dados.assets) {
      const chave = item.tipo + item.url;
      if (!assets.has(chave)) { assets.add(chave); evidencias.assets.push(item); }
    }
    if (coleta.dados.domLimitado) evidencias.limitacoes.push(`${coleta.nome}: coleta limitada a 6.000 nós visitados e 4.000 elementos renderizados.`);
    if (coleta.dados.folhasInacessiveis) evidencias.limitacoes.push(`${coleta.nome}: ${coleta.dados.folhasInacessiveis} folha(s)/grupo(s) CSS não permitem leitura por origem; estilos computados dos elementos continuam medidos.`);
    if (coleta.dados.iframes) evidencias.limitacoes.push(`${coleta.nome}: conteúdo interno de ${coleta.dados.iframes} iframe(s) não foi inspecionado.`);
    if (coleta.dados.regrasLimitadas) evidencias.limitacoes.push(`${coleta.nome}: catálogo de fontes limitado às primeiras 4.000 regras CSS acessíveis.`);
  }
  const desktop = coletas.find((c) => c.nome === "desktop")!.dados;
  const mobile = coletas.find((c) => c.nome === "mobile")!.dados;
  const layoutMobile = new Map(mobile.layout.map((l) => [l.seletor, l.estilos]));
  for (const propriedade of ["display", "visibility", "fontSize", "gridTemplateColumns", "flexDirection", "flexWrap", "gap", "padding", "maxWidth", "width", "height", "position"]) {
    for (const el of desktop.layout) {
      const correspondente = layoutMobile.get(el.seletor);
      const a = el.estilos[propriedade], b = correspondente?.[propriedade];
      if (a !== undefined && b !== undefined && a !== b && evidencias.responsivo.length < 80) evidencias.responsivo.push({ seletor: el.seletor, propriedade, desktop: a, mobile: b });
    }
  }
  evidencias.limitacoes.push(
    "Os nomes color-*, text-*, space-* e variantes de componentes são identificadores gerados por frequência, não nomes oficiais ou intenções de marca.",
    "Frequência conta ocorrências de propriedade por elemento e viewport; a mesma instância pode ser contada em desktop e mobile. Não representa área ocupada ou percentual visual.",
    "Análise de uma URL em dois tamanhos, sem autenticação, cliques, hover ou abertura de menus. Temas, estados interativos e breakpoints intermediários não foram testados.",
    "Elementos renderizados fora do enquadramento inicial também podem contribuir; conteúdo carregado só após rolagem pode faltar. Pseudo-elementos, canvas e Shadow DOM fechado não foram inspecionados.",
    "CSS variables preservam nomes e valores observados, sem provar uso. O catálogo de assets registra URLs; fontes, imagens e logos não são baixados para redistribuição.",
    "A coleta considera até 512 valores por categoria/viewport, 240 CSS variables, 100 assets, 160 amostras de layout e 80 variantes de componente por viewport; a exportação mantém até 40 variantes."
  );
  const resultado: ResultadoExtracao = { nome: desktop.nome || new URL(url).hostname, url, extraidoEm: new Date().toISOString(), markdown: "", tokens, evidencias, ...(capturas ? { capturas } : {}) };
  resultado.markdown = gerarMarkdown(resultado);
  return resultado;
}

function gerarMarkdown(r: ResultadoExtracao): string {
  const linhas = ["---", yaml({ version: "alpha", name: r.nome, description: `Estilos computados observados em ${r.url}, nos viewports desktop 1440×900 e mobile 390×844. Identificadores gerados por frequência; evidências e limites documentados abaixo.`, ...r.tokens }), "---", "", `# ${inline(r.nome)}`, "", "## Overview", "", `URL solicitada: ${codigo(r.url)}. Extraído em ${codigo(r.extraidoEm)}.`, "", "Medição automatizada do DOM renderizado e dos estilos computados. Os tokens abaixo descrevem valores observados; nomes oficiais, intenção da marca e regras universais de uso não são inferidos.", ""];
  for (const v of r.evidencias.viewports) linhas.push(`- **${v.nome} ${v.largura}×${v.altura}:** ${v.elementosAnalisados} elementos renderizados analisados. URL final: ${codigo(v.url)}.`);
  const evidencia = (categoria: string, token: string) => r.evidencias.tokens.find((e) => e.categoria === categoria && e.token === token);
  const lista = (categoria: "colors" | "spacing" | "rounded" | "shadows") => {
    const entradas = Object.entries(r.tokens[categoria]);
    if (!entradas.length) return ["Nenhum valor não nulo observado nesta amostra."];
    return entradas.map(([token, valor]) => {
      const e = evidencia(categoria, token);
      const a = e?.amostras[0];
      return `- ${codigo(`{${categoria}.${token}}`)}: ${codigo(valor)} — ${e?.frequencia ?? 0} ocorrências${a ? `; ${codigo(a.seletor)} / ${codigo(a.propriedade)} (${a.viewport})` : ""}.`;
    });
  };
  linhas.push("", "## Colors", "", ...lista("colors"), "", "As frequências acima contam propriedades pintadas (texto, fundo, borda ou SVG), sem atribuir papéis como cor primária ou secundária.", "", "## Typography", "", "| Token | Família | Tamanho | Peso | Entrelinha | Tracking | Ocorrências | Amostra |", "|---|---|---|---|---|---|---|---|");
  for (const [token, t] of Object.entries(r.tokens.typography)) {
    const e = evidencia("typography", token), a = e?.amostras[0];
    linhas.push(`| ${codigo(token)} | ${inline(t.fontFamily)} | ${inline(t.fontSize)} | ${inline(t.fontWeight)} | ${inline(t.lineHeight)} | ${inline(t.letterSpacing)} | ${e?.frequencia ?? 0} | ${a ? codigo(a.seletor).replace(/\|/g, "\\|") + " (" + a.viewport + ")" : "—"} |`);
  }
  linhas.push("", "A família é a pilha CSS computada. Isso não confirma qual arquivo de fonte desenhou cada glifo; entrelinha e tracking são os valores computados do navegador.", "", "## Layout", "", "### Spacing", "", ...lista("spacing"), "", "Margens, padding e gaps são medidos em pixels computados. Não se deduz uma escala-base apenas pela repetição dos números.", "", "### Grid & Container", "", "Amostras de containers, landmarks e elementos flex/grid. Larguras são medidas computadas no viewport indicado, não limites universais do projeto.", "", "| Viewport | Elemento | Display | Largura | Máximo | Padding | Gap | Colunas |", "|---|---|---|---|---|---|---|---|");
  for (const l of r.evidencias.layout.filter((l) => !/^(none|inline)$/.test(l.estilos["display"] ?? "")).slice(0, 60)) {
    const s = l.estilos;
    linhas.push(`| ${l.viewport} | ${codigo(l.seletor).replace(/\|/g, "\\|")} | ${inline(s["display"] ?? "")} | ${inline(s["width"] ?? "")} | ${inline(s["maxWidth"] ?? "")} | ${inline(s["padding"] ?? "")} | ${inline(s["gap"] ?? "")} | ${inline(s["gridTemplateColumns"] ?? "")} |`);
  }
  linhas.push("", "## Elevation & Depth", "", ...lista("shadows"), "", "Sombras são preservadas integralmente, incluindo múltiplas camadas. A ausência de sombra na amostra não prova ausência em outros estados.", "", "## Shapes", "", ...lista("rounded"), "", "## Components", "");
  for (const [token, c] of Object.entries(r.tokens.components)) {
    const amostras = r.evidencias.componentes.filter((e) => e.token === token);
    linhas.push(`### ${inline(token)}`, "");
    for (const a of amostras) linhas.push(`- Evidência: ${codigo(a.seletor)} (${a.viewport}); tipo observado: ${codigo(a.tipo)}; ${a.frequencia} instância(s) com este conjunto de medidas${a.texto ? `; trecho: “${inline(a.texto)}”` : ""}.`);
    linhas.push("", "```yaml", yaml(c), "```", "");
  }
  linhas.push("## Do's and Don'ts", "", "### Do", "", "- Reutilize valores repetidos para reproduzir os componentes medidos e mantenha a referência ao seletor de origem.", "- Confira as duas capturas e as diferenças de viewport antes de implementar regras responsivas.", "- Valide fontes carregadas e estados interativos na página original quando eles forem necessários.", "", "### Don't", "", "- Não transforme a frequência de um valor em percentual visual, intenção de marca ou regra de acessibilidade.", "- Não assuma que um identificador gerado, como color-01 ou button-01, é um token oficial ou um botão primário.", "- Não extrapole breakpoints ou comportamento de hover a partir de duas observações estáticas.", "", "## Responsive Behavior", "", "Comparação dos estilos dos mesmos seletores em 1440×900 e 390×844. Limiares de media queries não foram medidos.", "");
  if (r.evidencias.responsivo.length) {
    linhas.push("| Elemento | Propriedade | Desktop | Mobile |", "|---|---|---|---|");
    for (const d of r.evidencias.responsivo) linhas.push(`| ${codigo(d.seletor).replace(/\|/g, "\\|")} | ${codigo(d.propriedade)} | ${inline(d.desktop)} | ${inline(d.mobile)} |`);
  } else linhas.push("Nenhuma diferença encontrada nas propriedades e seletores amostrados; isso não demonstra que a página não possua regras responsivas.");
  linhas.push("", "## CSS Variables", "");
  if (!r.evidencias.cssVariables.length) linhas.push("Nenhuma custom property acessível foi encontrada na amostra.");
  for (const v of r.evidencias.cssVariables) linhas.push(`- ${codigo(v.nome)} = ${codigo(v.valor)} — ${codigo(v.seletor)} (${v.viewport}).`);
  linhas.push("", "## Assets", "", "Referências observadas; arquivos não incluídos na exportação.", "");
  for (const a of r.evidencias.assets) linhas.push(`- ${inline(a.tipo)}: ${codigo(a.url)} — ${codigo(a.origem)}.`);
  if (!r.evidencias.assets.length) linhas.push("Nenhuma URL HTTP(S) de imagem, ícone ou fonte foi encontrada na amostra acessível.");
  linhas.push("", "## Evidence & Limitations", "", ...r.evidencias.limitacoes.map((l) => "- " + inline(l)), "");
  return linhas.join("\n");
}

/** Abre um Chromium temporário, mede duas larguras e devolve DESIGN.md sem gravar assets. */
export async function extrairDesign(url: string, opcoes: { chrome?: string | null; timeoutMs?: number } = {}): Promise<ResultadoExtracao> {
  const alvo = validarUrl(url);
  const timeoutMs = opcoes.timeoutMs ?? 45_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new Error("O timeout deve ficar entre 1 e 120.000 ms.");
  let navegador: Navegador | undefined;
  let expirou = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => { expirou = true; rejeitar(new Error(`A extração excedeu o limite de ${timeoutMs} ms.`)); }, timeoutMs);
  });
  const trabalho = async () => {
    const aberto = await Navegador.abrir({ caminho: opcoes.chrome ?? null, timeoutMs: Math.min(timeoutMs, 15_000) });
    navegador = aberto;
    if (expirou) { await aberto.fechar(); throw new Error("Extração cancelada por timeout."); }
    const pagina: Pagina = await aberto.novaPagina();
    const coletas: Array<{ nome: ViewportExtracao; dados: ColetaBruta }> = [];
    const capturas: Partial<Record<ViewportExtracao, string>> = {};
    for (const v of VIEWPORTS) {
      if (expirou) throw new Error("Extração cancelada por timeout.");
      await pagina.definirViewport(v.largura, v.altura, 1);
      await pagina.navegar(alvo.href, Math.min(timeoutMs, 20_000));
      validarUrl(await pagina.avaliar<string>("location.href"));
      await pagina.avaliar("Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(() => new Promise(r => setTimeout(r, 350)))");
      const dados = await pagina.avaliar<ColetaBruta>(COLETAR);
      validarUrl(dados.url);
      coletas.push({ nome: v.nome, dados });
      try {
        const png = await pagina.capturar({ alemDoViewport: false });
        if (png.length <= 2 * 1024 * 1024) capturas[v.nome] = png.toString("base64");
      } catch { /* A medição continua útil quando só a captura falha. */ }
    }
    const imagens = capturas.desktop && capturas.mobile ? { desktop: capturas.desktop, mobile: capturas.mobile } : undefined;
    const resultado = produzirResultado(alvo.href, coletas, imagens);
    if (!imagens) {
      resultado.evidencias.limitacoes.push("As capturas não foram incluídas: houve falha no navegador ou PNG maior que 2 MiB por viewport.");
      resultado.markdown = gerarMarkdown(resultado);
    }
    return resultado;
  };
  try { return await Promise.race([trabalho(), limite]); }
  finally {
    if (timer) clearTimeout(timer);
    await navegador?.fechar();
  }
}
