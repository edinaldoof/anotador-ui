// O que a tela mostra em cada largura: a metade que nenhum arquivo declara.
//
// `lib/design.ts` lê o sistema no CSS — quais tokens existem e o que cada um vale.
// Aqui é o contrário: abre a página em três larguras e mede o que ela de fato faz.
// Rolagem horizontal, elemento vazando, texto miúdo, alvo de toque pequeno, borda
// que quase encosta numa coluna, linha comprida demais para ler, tamanhos de texto a
// meio pixel um do outro e texto colado na borda da tela são coisas que não estão
// escritas em lugar nenhum — só aparecem quando a página é renderizada e medida.

/** Larguras da medição: celular estreito, tablet e desktop comum. */
export const LARGURAS_PADRAO = [390, 768, 1280] as const;

export interface MedidaTela {
  largura: number;
  altura: number;
  /** Quanto o documento passa da viewport na horizontal. Acima de 1px a página rola de lado. */
  rolagemHorizontal: number;
  vazamentos: Array<{ alvo: string; excesso: number }>;
  textoMiudo: { total: number; menor: number; exemplos: string[] };
  /** Abaixo de 24×24 e sem exceção do WCAG 2.5.8; `isentos` conta os que a norma dispensa. */
  alvosPequenos: { total: number; exemplos: string[]; isentos?: number };
  /** Bordas esquerdas que três ou mais blocos compartilham: as colunas de fato da página. */
  colunas: number[];
  quaseAlinhados: Array<{ alvo: string; borda: string; valor: number; coluna: number }>;
  /** Texto corrido acima de 75ch por linha, o teto da faixa que o playbook lê bem (45–75ch); `maior` em ch. */
  linhasLongas?: { total: number; maior: number; exemplos: string[] };
  /** Tamanhos (px) e pesos do texto visível, em ordem; `onde` dá um elemento de cada tamanho. */
  tipografia?: { tamanhos: number[]; pesos: number[]; onde?: Record<string, string> };
  /** Menor distância entre um texto visível e a borda da tela; nulo quando não há texto que se meça. */
  margemLateral?: { minima: number; alvo: string } | null;
}

export interface AchadoTela {
  regra: string;
  gravidade: "alta" | "media" | "baixa";
  largura: number;
  alvo: string;
  evidencia: string;
}

// Os scripts abaixo rodam dentro da página. Sem template literal no JavaScript deles:
// o texto é embutido num template do TypeScript, e um `${` ali dentro seria interpolado
// antes de chegar ao navegador. A única interpolação é a de propósito, CAMINHO_JS.

/** Seletor curto e legível do elemento, relativo ao body. Compartilhado pelos scripts. */
export const CAMINHO_JS = `
  const caminho = (el) => {
    const partes = [];
    for (let n = el; n && n.nodeType === 1 && partes.length < 3; n = n.parentElement) {
      // Todo elemento da página desce de html > body: repetir isso em cada linha do
      // relatório gasta espaço e não distingue coisa nenhuma.
      if (n.tagName === "BODY" || n.tagName === "HTML") break;
      let p = n.tagName.toLowerCase();
      if (n.id) { partes.unshift(p + "#" + n.id); break; }
      const classes = (n.getAttribute("class") || "").trim().split(/\\s+/);
      const cls = classes.filter((c) => c && c.length < 24 && !/^(css-|sc-|jsx-)/.test(c))[0];
      if (cls) p += "." + cls;
      partes.unshift(p);
    }
    return partes.join(" > ").slice(0, 120);
  };`;

/**
 * WCAG 2.2, critério 2.5.8 (AA): alvo apontável de pelo menos 24×24 px, com as duas
 * exceções que dá para verificar olhando a página. Sem elas a regra acusa o que a norma
 * aceita — foi o que aconteceu com "Criar conta" e "Esqueci minha senha" no Pré-Projetos.
 *
 * - Em linha: o alvo está numa frase. Só conta alvo `display: inline` (link no meio do
 *   texto), e só conta o texto do bloco que não pertence a outro alvo — senão um botão ao
 *   lado de um título, ou numa barra de botões com rótulo, passaria por "frase".
 * - Espaçamento: um círculo de 24 px centrado no alvo não toca outro alvo nem o círculo
 *   de outro alvo pequeno.
 *
 * As demais exceções — equivalente na mesma página, controle do navegador, essencial —
 * dependem de intenção e não são verificadas: o achado continua sendo "a conferir".
 */
export const ALVOS_WCAG_JS = `
  const avaliarAlvos = (todos, seletor) => {
    const blocoDe = (el) => { let n = el.parentElement; while (n && n !== document.body && /^(inline|inline-block|contents)$/.test(getComputedStyle(n).display)) n = n.parentElement; return n; };
    const emFrase = (el) => {
      if (getComputedStyle(el).display !== "inline") return false;
      const bloco = blocoDe(el);
      if (!bloco) return false;
      let resto = "";
      const passeio = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT);
      for (let t = passeio.nextNode(); t; t = passeio.nextNode()) {
        const pai = t.parentElement;
        if (pai && pai.closest(seletor)) continue;
        resto += t.nodeValue;
        if (resto.replace(/\\s+/g, "").length >= 3) break;
      }
      return /[\\p{L}\\p{N}]{2,}/u.test(resto);
    };
    const pequeno = (r) => r.width < 24 || r.height < 24;
    const falhas = []; let isentos = 0;
    for (const p of todos) {
      if (!pequeno(p.r)) continue;
      if (emFrase(p.el)) { isentos++; continue; }
      const cx = p.r.left + p.r.width / 2, cy = p.r.top + p.r.height / 2;
      let vizinho = null;
      for (const o of todos) {
        if (o.el === p.el || o.el.contains(p.el) || p.el.contains(o.el)) continue;
        const q = o.r;
        const dx = Math.max(q.left - cx, 0, cx - q.right), dy = Math.max(q.top - cy, 0, cy - q.bottom);
        const ox = q.left + q.width / 2, oy = q.top + q.height / 2;
        if (Math.hypot(dx, dy) < 12 || (pequeno(q) && Math.hypot(ox - cx, oy - cy) < 24)) { vizinho = o.el; break; }
      }
      if (vizinho) falhas.push({ el: p.el, r: p.r, vizinho }); else isentos++;
    }
    return { falhas, isentos };
  };`;

/**
 * Medida da linha de um bloco de texto corrido, em ch e em caracteres. Só conta o texto
 * que corre no próprio bloco — o de um bloco filho é outro parágrafo. As caixas de texto
 * são agrupadas pela altura: um código em linha, mais alto que as letras, continua na
 * mesma linha; e a última linha, quase sempre curta, conta pela fração que ocupa, para a
 * média não esconder a linha cheia. Bloco com menos de 120 caracteres ou de duas linhas
 * não é texto corrido e volta nulo.
 *
 * A régua é em ch — a largura do "0" da fonte —, a unidade das faixas do playbook e a que
 * se escreve no CSS. Em caracteres ela erraria contra a própria correção: `max-width: 65ch`
 * dá uns 81 caracteres por linha, porque o "0" é mais largo que a letra média.
 */
export const LEITURA_JS = `
  const blocoDoTexto = (t) => { let n = t.parentElement; while (n && /^(inline|inline-block|inline-flex|contents)$/.test(getComputedStyle(n).display)) n = n.parentElement; return n; };
  const leitura = (el) => {
    const pedacos = []; let texto = "";
    const passeio = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = passeio.nextNode(); t; t = passeio.nextNode()) {
      if (blocoDoTexto(t) !== el) continue;
      texto += t.nodeValue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) if (q.width > 0.5 && q.height > 0.5) pedacos.push(q);
    }
    texto = texto.replace(/\\s+/g, " ").trim();
    if (texto.length < 120 || !pedacos.length) return null;
    pedacos.sort((a, b) => a.top - b.top || a.left - b.left);
    const linhas = [];
    for (const q of pedacos) {
      const u = linhas[linhas.length - 1];
      if (!u || (q.top + q.bottom) / 2 > u.fundo) linhas.push({ fundo: q.bottom, largura: q.width });
      else { u.fundo = Math.max(u.fundo, q.bottom); u.largura += q.width; }
    }
    if (linhas.length < 2) return null;
    const cheia = Math.max(...linhas.map((l) => l.largura));
    const efetivas = linhas.length - 1 + Math.min(1, linhas[linhas.length - 1].largura / cheia);
    const cs = getComputedStyle(el);
    reguaCh.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const zero = reguaCh.measureText("0").width || parseFloat(cs.fontSize) / 2;
    return { linhas: linhas.length, porLinha: Math.round(texto.length / efetivas), ch: Math.round(cheia / zero) };
  };
  const reguaCh = document.createElement("canvas").getContext("2d");
  // Texto de leitor de tela (1px, recortado) não é texto na tela: nem tamanho, nem margem.
  const textoNaTela = (el, cs, r) => r.width > 2 && r.height > 2 && cs.clip === "auto" && (cs.clipPath === "none" || !cs.clipPath);`;

export const SCRIPT_MEDIDA = `(() => {
  const vw = innerWidth;
${CAMINHO_JS}
${LEITURA_JS}
  const blocos = [], vazamentos = [], miudos = [], alvos = [], todosAlvos = [], longas = [];
  const tamanhos = new Set(), pesos = new Set(), ondeTamanho = {}, margem = { minima: Infinity, alvo: "" };
  // Faixa horizontal em que o elemento aparece: a interseção dos ancestrais que recortam.
  // Texto rolado para trás da borda de uma tabela não está a 5px da tela — está escondido.
  const faixas = new Map();
  const faixaDe = (n) => {
    if (!n || n === document.body || n === document.documentElement) return [-Infinity, Infinity];
    if (faixas.has(n)) return faixas.get(n);
    const [e, d] = faixaDe(n.parentElement);
    let f = [e, d];
    if (getComputedStyle(n).overflowX !== "visible") { const q = n.getBoundingClientRect(); f = [Math.max(e, q.left), Math.min(d, q.right)]; }
    faixas.set(n, f);
    return f;
  };
  // Tabela larga dentro de um contêiner com rolagem própria é o padrão responsivo certo,
  // não vazamento: o retângulo dela passa da tela, mas o contêiner corta e a página não
  // rola de lado. Só vaza quem nenhum ancestral dentro da tela recorta.
  const recortado = (el) => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).overflowX === "visible") continue;
      const q = n.getBoundingClientRect();
      if (q.right <= vw + 1 && q.left >= -1) return true;
    }
    return false;
  };
  const SELETOR_ALVO = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem]";
  let menorTexto = Infinity, vistos = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (vistos > 3000) break;
    if (el.closest("#__anotador_host")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    vistos++;
    // Vazamento: só quem começa a passar da borda. Se o pai já vaza, os filhos vão
    // arrastados junto e repetir cada um deles só encheria o relatório de eco.
    const excesso = Math.round(Math.max(r.right - vw, -r.left));
    if (excesso > 1 && cs.position !== "fixed" && !recortado(el)) {
      const pai = el.parentElement, rp = pai ? pai.getBoundingClientRect() : null;
      if (!rp || (rp.right - vw <= 1 && rp.left >= -1)) vazamentos.push({ alvo: caminho(el), excesso });
    }
    // Só quem tem texto próprio: herdar o tamanho do pai não é decisão de ninguém.
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
      const px = parseFloat(cs.fontSize);
      if (px > 0) {
        if (px < menorTexto) menorTexto = px;
        if (px < 12) miudos.push(caminho(el) + " (" + Math.round(px * 10) / 10 + "px)");
      }
      // Tamanho, peso e margem só de palavra: um "×" de fechar não é degrau da escala.
      const palavras = [...el.childNodes].filter((n) => n.nodeType === 3 && /[\\p{L}\\p{N}]{2,}/u.test(n.nodeValue));
      if (palavras.length && textoNaTela(el, cs, r)) {
        if (px > 0) { const tam = Math.round(px * 100) / 100; tamanhos.add(tam); if (!ondeTamanho[tam]) ondeTamanho[tam] = caminho(el); }
        pesos.add(Number(cs.fontWeight) || 400);
        // O próprio elemento recorta o texto dele: reticências cortam o que passa da caixa.
        const [e, d] = faixaDe(el);
        for (const t of palavras) {
          const rg = document.createRange(); rg.selectNodeContents(t);
          for (const q of rg.getClientRects()) {
            const esq = Math.max(q.left, e), dir = Math.min(q.right, d);
            if (dir - esq < 1 || esq < -0.5 || dir > vw + 0.5) continue;
            const dist = Math.min(esq, vw - dir);
            if (dist < margem.minima) { margem.minima = dist; margem.alvo = caminho(el); }
          }
        }
        // Linha comprida: só bloco de texto corrido. Código tem a linha que o autor quis.
        if (!/^(inline|contents)/.test(cs.display) && cs.whiteSpace !== "pre" && !el.closest("pre, code") && el.textContent.length >= 120) {
          const l = leitura(el);
          if (l && l.ch > 75) longas.push({ alvo: caminho(el), ch: l.ch, porLinha: l.porLinha });
        }
      }
    }
    if (el.matches(SELETOR_ALVO) && !el.disabled && el.getAttribute("aria-disabled") !== "true") todosAlvos.push({ el, r });
    // Grade é o que se vê: borda fora da tela — de quem vaza ou de quem rola num contêiner —
    // não forma coluna nem "quase alinha" com nada.
    if (r.width >= 64 && r.height >= 16 && r.left >= -1 && r.right <= vw + 1) blocos.push({ alvo: caminho(el), esquerda: Math.round(r.left), direita: Math.round(r.right) });
  }
${ALVOS_WCAG_JS}
  const alvosAvaliados = avaliarAlvos(todosAlvos, SELETOR_ALVO);
  for (const f of alvosAvaliados.falhas) alvos.push(caminho(f.el) + " (" + Math.round(f.r.width) + "x" + Math.round(f.r.height) + ", o círculo de 24px encosta em " + caminho(f.vizinho) + ")");
  const analisarBorda = (campo, nome) => {
    const conta = new Map();
    for (const b of blocos) conta.set(b[campo], (conta.get(b[campo]) || 0) + 1);
    const fortes = [...conta.entries()].filter((par) => par[1] >= 3).map((par) => par[0]).sort((a, b) => a - b);
    const quase = [];
    for (const b of blocos) {
      if ((conta.get(b[campo]) || 0) >= 3) continue;
      const perto = fortes.find((c) => Math.abs(c - b[campo]) >= 1 && Math.abs(c - b[campo]) <= 4);
      if (perto !== undefined) quase.push({ alvo: b.alvo, borda: nome, valor: b[campo], coluna: perto });
    }
    return { fortes, quase };
  };
  const esquerda = analisarBorda("esquerda", "esquerda"), direita = analisarBorda("direita", "direita");
  const vistosQuase = new Set();
  const quaseAlinhados = [...esquerda.quase, ...direita.quase].filter((q) => {
    if (vistosQuase.has(q.alvo)) return false;
    vistosQuase.add(q.alvo); return true;
  }).slice(0, 8);
  return {
    largura: vw,
    altura: innerHeight,
    rolagemHorizontal: Math.max(0, Math.round(document.documentElement.scrollWidth - vw)),
    vazamentos: vazamentos.sort((a, b) => b.excesso - a.excesso).slice(0, 5),
    textoMiudo: { total: miudos.length, menor: Number.isFinite(menorTexto) ? Math.round(menorTexto * 10) / 10 : 0, exemplos: miudos.slice(0, 3) },
    alvosPequenos: { total: alvos.length, exemplos: alvos.slice(0, 3), isentos: alvosAvaliados.isentos },
    colunas: esquerda.fortes.slice(0, 12),
    quaseAlinhados,
    linhasLongas: { total: longas.length, maior: longas.reduce((m, l) => Math.max(m, l.ch), 0), exemplos: longas.sort((a, b) => b.ch - a.ch).slice(0, 3).map((l) => l.alvo + " (~" + l.ch + "ch, " + l.porLinha + " caracteres por linha)") },
    tipografia: { tamanhos: [...tamanhos].sort((a, b) => a - b), pesos: [...pesos].sort((a, b) => a - b), onde: ondeTamanho },
    margemLateral: Number.isFinite(margem.minima) ? { minima: Math.round(margem.minima), alvo: margem.alvo } : null,
  };
})()`;

export interface ContrasteTema {
  tema: "claro" | "escuro";
  /** A página mudou de cara ao forçar o tema. Sem isso, não se afirma nada sobre ele. */
  detectado: boolean;
  total: number;
  /** Menor razão encontrada; nulo quando nenhum texto ficou abaixo do mínimo. */
  pior: number | null;
  exemplos: string[];
}

/** O que só se vê forçando preferência do sistema — medido uma vez, na maior largura. */
export interface AcessibilidadeTela {
  largura: number;
  temas: ContrasteTema[];
  semMain: boolean;
  movimento: { total: number; exemplos: string[] } | null;
}

// A mesma régua do overlay (overlay/auditoria.ts), para os dois lados darem o mesmo
// número: luminância do WCAG, fundo do primeiro ancestral opaco, 4,5:1 ou 3:1 para texto
// grande. Sem ancestral que pinte, o fundo é o da tela — branco, ou quase preto quando a
// página declara color-scheme escuro.
export const SCRIPT_CONTRASTE = `(() => {
${CAMINHO_JS}
  const rgba = (v) => { const m = /rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)(?:[,\\s/]+([\\d.]+))?/.exec(v); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = (c) => { const f = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const escuro = /dark/.test(getComputedStyle(document.documentElement).colorScheme || "");
  const fundo = (el) => { for (let n = el, g = 0; n && g < 20; n = n.parentElement, g++) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.95) return c; } return escuro ? [18, 18, 18] : [255, 255, 255]; };
  const exemplos = []; let total = 0, pior = 21, vistos = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (vistos > 3000) break;
    if (el.closest("#__anotador_host")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length >= 2)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    vistos++;
    const fg = rgba(cs.color);
    if (!fg || fg[3] < 0.5) continue;
    const a = lum(fg), b = lum(fundo(el));
    const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const tam = parseFloat(cs.fontSize), peso = Number(cs.fontWeight) || 400;
    const minimo = tam >= 24 || (tam >= 18.66 && peso >= 700) ? 3 : 4.5;
    if (razao >= minimo) continue;
    total++; pior = Math.min(pior, razao);
    if (exemplos.length < 4) exemplos.push(caminho(el) + " (" + razao.toFixed(1) + ":1, mínimo " + minimo + ")");
  }
  // Sem falha, não há "pior": devolver o 21 inicial fazia agente ler 21:1 como nota da página.
  return { fundo: getComputedStyle(document.body).backgroundColor + "|" + getComputedStyle(document.body).color, total, pior: total ? Math.round(pior * 10) / 10 : null, exemplos, semMain: !document.querySelector("main, [role=main]") };
})()`;

// Tema por atributo (data-theme) ou por classe (.dark do Tailwind) não obedece a
// prefers-color-scheme: força os três, porque é o que um projeto real mistura.
export const SCRIPT_TEMA_ESCURO = `(() => {
  const html = document.documentElement;
  if (html.hasAttribute("data-theme")) html.setAttribute("data-theme", "dark");
  if (html.classList.contains("light")) html.classList.replace("light", "dark"); else html.classList.add("dark");
  return true;
})()`;

// Com prefers-reduced-motion: reduce, o que segue em loop é o que o CSS não desligou.
export const SCRIPT_MOVIMENTO = `(() => {
${CAMINHO_JS}
  const exemplos = []; let total = 0;
  for (const a of document.getAnimations ? document.getAnimations() : []) {
    if (a.playState !== "running" || !a.effect || !a.effect.getTiming) continue;
    const t = a.effect.getTiming(), dur = typeof t.duration === "number" ? t.duration : 0;
    if (t.iterations !== Infinity && dur * (t.iterations || 1) < 1000) continue;
    const alvo = a.effect.target;
    if (alvo && alvo.closest && alvo.closest("#__anotador_host")) continue;
    total++;
    if (exemplos.length < 3) exemplos.push((alvo ? caminho(alvo) : "?") + (a.animationName ? " (" + a.animationName + ")" : ""));
  }
  return { total, exemplos };
})()`;

/** Tamanho mínimo de alvo apontável do WCAG 2.2 (2.5.8, nível AA). */
const ALVO_MINIMO = 24;
/** Abaixo disto o texto deixa de ser legível em tela pequena. */
const TEXTO_MINIMO = 12;
/** Teto da faixa que o playbook lê bem, em ch (45–75ch). O WCAG 1.4.8 (AAA) fala em 80 caracteres. */
const LINHA_MAXIMA = 75;
/** Margem lateral do playbook no celular; no tablet ele usa 32px e no desktop, 48. */
const MARGEM_CELULAR = 16;
/** A escada do playbook: 400 no texto, 500 na ênfase de interface, 600 nos títulos, 700 reservado. */
const PESOS_DA_ESCADA = 4;

/** Pares de tamanhos a menos de 1px um do outro: meio pixel não cria hierarquia. */
function quaseIguais(tamanhos: number[]): Array<[number, number]> {
  const pares: Array<[number, number]> = [];
  for (let i = 1; i < tamanhos.length; i++) {
    const a = tamanhos[i - 1] as number, b = tamanhos[i] as number;
    if (b - a > 0.01 && b - a < 1) pares.push([a, b]);
  }
  return pares;
}

export function achadosDaTela(medidas: MedidaTela[], acessibilidade: AcessibilidadeTela | null = null): AchadoTela[] {
  const achados: AchadoTela[] = [];
  const alvosJaVistos = new Set<string>(), longasJaVistas = new Set<string>(), paresJaVistos = new Set<string>();
  let pesosJaDitos = false;
  if (acessibilidade) {
    const a = acessibilidade;
    for (const t of a.temas) {
      if (!t.detectado || !t.total) continue;
      achados.push({ regra: "contraste abaixo do mínimo", gravidade: (t.pior ?? 21) < 3 ? "alta" : "media", largura: a.largura, alvo: t.exemplos[0] ?? "texto",
        evidencia: `${t.total} texto(s) abaixo do mínimo do WCAG no tema ${t.tema}, o pior com ${t.pior}:1${t.exemplos.length > 1 ? " — também " + t.exemplos.slice(1).join(", ") : ""}` });
    }
    if (a.semMain) achados.push({ regra: "sem região principal", gravidade: "media", largura: a.largura, alvo: "documento", evidencia: "nenhum <main> nem role=\"main\": quem usa leitor de tela perde o atalho para pular direto ao conteúdo" });
    if (a.movimento?.total) {
      achados.push({ regra: "animação ignora movimento reduzido", gravidade: "baixa", largura: a.largura, alvo: a.movimento.exemplos[0] ?? "animação",
        evidencia: `${a.movimento.total} animação(ões) seguem em loop com prefers-reduced-motion: reduce — decoração deveria parar; um indicador de carregamento pode ser essencial e continuar` });
    }
  }
  for (const m of [...medidas].sort((a, b) => a.largura - b.largura)) {
    if (m.rolagemHorizontal > 1) {
      achados.push({ regra: "rolagem horizontal", gravidade: "alta", largura: m.largura, alvo: "documento",
        evidencia: `a página passa ${m.rolagemHorizontal}px da viewport de ${m.largura}px e rola de lado` });
    }
    for (const v of m.vazamentos) {
      achados.push({ regra: "elemento vazando", gravidade: v.excesso > 24 ? "alta" : "media", largura: m.largura, alvo: v.alvo,
        evidencia: `passa ${v.excesso}px da borda em ${m.largura}px de largura` });
    }
    if (m.textoMiudo.total) {
      achados.push({ regra: "texto miúdo", gravidade: m.textoMiudo.menor < 10 ? "media" : "baixa", largura: m.largura,
        alvo: m.textoMiudo.exemplos[0] ?? "texto", evidencia: `${m.textoMiudo.total} trecho(s) abaixo de ${TEXTO_MINIMO}px, o menor com ${m.textoMiudo.menor}px${m.textoMiudo.exemplos.length > 1 ? " — também " + m.textoMiudo.exemplos.slice(1).join(", ") : ""}` });
    }
    // O 2.5.8 vale para qualquer ponteiro, mouse incluído — não só para o dedo. O mesmo
    // elemento reprovado em três larguras vira um achado, na primeira em que aparece.
    const novos = m.alvosPequenos.exemplos.filter((e) => !alvosJaVistos.has(e.split(" (")[0] ?? e));
    for (const e of novos) alvosJaVistos.add(e.split(" (")[0] ?? e);
    if (m.alvosPequenos.total && novos.length) {
      achados.push({ regra: "alvo de toque pequeno", gravidade: "media", largura: m.largura,
        alvo: novos[0] ?? "controle", evidencia: `${m.alvosPequenos.total} controle(s) abaixo de ${ALVO_MINIMO}x${ALVO_MINIMO}px sem a folga de espaçamento que o WCAG 2.2 (2.5.8) aceita${m.alvosPequenos.isentos ? `; ${m.alvosPequenos.isentos} isento(s) por estar(em) numa frase ou com espaço em volta` : ""}${novos.length > 1 ? " — também " + novos.slice(1).join(", ") : ""}` });
    }
    for (const q of m.quaseAlinhados) {
      const distancia = Math.abs(q.coluna - q.valor);
      achados.push({ regra: "quase alinhado", gravidade: "baixa", largura: m.largura, alvo: q.alvo,
        evidencia: `borda ${q.borda} em ${q.valor}px, a ${distancia}px da coluna de ${q.coluna}px que o resto da página usa — ou alinha, ou afasta o bastante para virar intenção` });
    }
    // O mesmo parágrafo comprido em duas larguras é um achado, na primeira em que aparece.
    const longas = (m.linhasLongas?.exemplos ?? []).filter((e) => !longasJaVistas.has(e.split(" (")[0] ?? e));
    for (const e of longas) longasJaVistas.add(e.split(" (")[0] ?? e);
    if (m.linhasLongas?.total && longas.length) {
      achados.push({ regra: "linha longa demais", gravidade: m.linhasLongas.maior > 100 ? "media" : "baixa", largura: m.largura, alvo: longas[0] ?? "texto",
        evidencia: `${m.linhasLongas.total} parágrafo(s) acima de ${LINHA_MAXIMA}ch por linha, o mais longo com ~${m.linhasLongas.maior}ch — o playbook lê bem entre 45 e 75ch, e o WCAG 1.4.8 fala em 80 caracteres; um max-width de 65ch resolve${longas.length > 1 ? " — também " + longas.slice(1).join(", ") : ""}` });
    }
    const t = m.tipografia;
    if (t) {
      const pares = quaseIguais(t.tamanhos).filter(([a, b]) => !paresJaVistos.has(a + "|" + b));
      for (const [a, b] of pares) paresJaVistos.add(a + "|" + b);
      if (pares.length) {
        // O tamanho mais raro do par é quase sempre o intruso; mostrar onde ele mora
        // poupa quem vai corrigir de caçar o elemento.
        const onde = (n: number) => t.onde?.[String(n)];
        achados.push({ regra: "tamanhos quase iguais", gravidade: "baixa", largura: m.largura, alvo: onde(pares[0]![1]) ?? "texto",
          evidencia: `${pares.slice(0, 4).map(([a, b]) => `${a} e ${b}px${onde(b) ? ` (${onde(b)})` : ""}`).join(", ")} na mesma tela, de ${t.tamanhos.length} tamanhos ao todo — menos de 1px não cria hierarquia: é o mesmo papel escrito de dois jeitos, e um degrau da escala resolve` });
      }
      const entreDegraus = t.pesos.filter((p) => p % 100 !== 0);
      if (!pesosJaDitos && (t.pesos.length > PESOS_DA_ESCADA || entreDegraus.length)) {
        pesosJaDitos = true;
        achados.push({ regra: "escada de pesos", gravidade: "baixa", largura: m.largura, alvo: "texto",
          evidencia: `${t.pesos.length} peso(s) na tela (${t.pesos.join(", ")})${entreDegraus.length ? `, ${entreDegraus.join(" e ")} entre dois degraus` : ""} — o playbook fecha a escada em ${PESOS_DA_ESCADA}: 400 no texto, 500 na ênfase de interface, 600 nos títulos e 700 reservado` });
      }
    }
    // Texto colado na borda: a margem que o playbook dá ao celular é 16px. Abaixo de 8,
    // em qualquer largura, o texto encosta na moldura do aparelho.
    const margem = m.margemLateral;
    if (margem && (margem.minima < 8 || (margem.minima < MARGEM_CELULAR && m.largura < 600))) {
      achados.push({ regra: "margem lateral estreita", gravidade: margem.minima < 8 ? "media" : "baixa", largura: m.largura, alvo: margem.alvo,
        evidencia: `texto a ${margem.minima}px da borda da tela em ${m.largura}px — o playbook usa ${MARGEM_CELULAR}px de margem no celular, 32 no tablet e 48 no desktop` });
    }
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || a.largura - b.largura || a.regra.localeCompare(b.regra));
  return achados;
}

/** Seção do dossiê. Sem medida nenhuma devolve string vazia: nada a dizer é melhor que um título vazio. */
export function resumoDaTela(medidas: MedidaTela[], achados: AchadoTela[], acessibilidade: AcessibilidadeTela | null = null): string {
  if (!medidas.length) return "";
  const linhas: string[] = [];
  linhas.push("Medido na própria página renderizada, em " + medidas.map((m) => m.largura + "px").join(", ") + ".", "");
  for (const m of medidas) {
    const colunas = m.colunas.length ? m.colunas.join(", ") + "px" : "nenhuma coluna repetida o bastante para ser regra";
    const margem = m.margemLateral === undefined ? "" : ` · margem lateral: ${m.margemLateral ? m.margemLateral.minima + "px" : "sem texto para medir"}`;
    linhas.push(`- **${m.largura}px** — rolagem horizontal: ${m.rolagemHorizontal > 1 ? m.rolagemHorizontal + "px" : "nenhuma"} · bordas esquerdas dominantes: ${colunas}${margem}`);
  }
  // A escala é uma só; mede-se na maior largura, onde a tela mostra mais dela.
  const maior = [...medidas].sort((a, b) => b.largura - a.largura)[0];
  if (maior?.tipografia?.tamanhos.length) {
    linhas.push(`- **tipografia** (${maior.largura}px) — ${maior.tipografia.tamanhos.length} tamanho(s) de texto: ${maior.tipografia.tamanhos.join(", ")}px · pesos ${maior.tipografia.pesos.join(", ")}`);
  }
  // Tema que não reagiu não é tema aprovado: dizer "sem achados no escuro" de uma página
  // que nem mudou de cor seria atestar o que ninguém viu.
  for (const t of acessibilidade?.temas ?? []) {
    linhas.push(`- **tema ${t.tema}** — ${t.detectado ? (t.total ? `${t.total} texto(s) abaixo do contraste mínimo` : "contraste dentro do mínimo") : "não detectado: a página não mudou ao forçar prefers-color-scheme, data-theme e .dark"}`);
  }
  if (acessibilidade?.movimento) linhas.push(`- **movimento reduzido** — ${acessibilidade.movimento.total ? acessibilidade.movimento.total + " animação(ões) seguem em loop" : "nenhuma animação em loop"}`);
  if (!achados.length) {
    linhas.push("", "Nenhum achado nessas medidas. Contraste, tema e movimento são o que a régua alcança: nome genérico, texto de link que não se sustenta sozinho e estado comunicado só por cor ficam para o seu julgamento.");
    return linhas.join("\n");
  }
  linhas.push("", "| gravidade | largura | regra | onde | evidência |", "| --- | --- | --- | --- | --- |");
  for (const a of achados.slice(0, 40)) {
    linhas.push(`| ${a.gravidade} | ${a.largura}px | ${a.regra} | \`${a.alvo.replace(/\|/g, "/")}\` | ${a.evidencia.replace(/\|/g, "/")} |`);
  }
  if (achados.length > 40) linhas.push("", `_(${achados.length - 40} achado(s) além dos 40 listados.)_`);
  return linhas.join("\n");
}
