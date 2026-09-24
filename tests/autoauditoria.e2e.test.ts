// A régua do Anotador aplicada ao próprio Anotador.
//
// Um sistema que aponta texto miúdo, alvo pequeno e painel vazando nos outros não pode
// ter nada disso na própria interface. Este teste abre cada página e cada painel do
// Anotador em 390, 768 e 1280 px e mede com as mesmas regras que ele aplica às páginas
// que avalia: nada vaza da tela, texto a partir de 12 px, contraste do WCAG (4,5:1, ou
// 3:1 para texto grande), alvo apontável pelo WCAG 2.5.8 — com as exceções da norma —,
// todo controle com nome, nenhum painel por cima da barra, linha de até 75ch, nenhum
// par de tamanhos a menos de 1px, a escada de quatro pesos e texto a pelo menos 16px da
// borda no celular. Qualquer painel novo que quebre isso quebra a suíte.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { ALVOS_WCAG_JS, CAMINHO_JS, LEITURA_JS } from "../lib/tela.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const LARGURAS = [390, 768, 1280];
const SOMBRA = 'document.getElementById("__anotador_host").shadowRoot';
const no = (seletor: string) => `${SOMBRA}.querySelector(${JSON.stringify(seletor)})`;

// Mede tudo o que está visível dentro de `raiz` — o documento de uma página, ou a
// sombra onde o overlay vive. Sem template literal no JavaScript: vai dentro de outro.
const auditar = (raiz: string) => `(() => {
  const RAIZ = ${raiz};
  const vw = innerWidth, vh = innerHeight;
${CAMINHO_JS}
${ALVOS_WCAG_JS}
${LEITURA_JS}
  const SELETOR = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem]";
  const rgba = (v) => { const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?/.exec(v); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const lum = (c) => { const f = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  // Sobe pelo DOM e atravessa a fronteira da sombra: o painel pinta o próprio fundo, e o
  // que não pinta nada cai no fundo da página por trás.
  const acima = (n) => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const fundo = (el) => { for (let n = el, g = 0; n && n.nodeType === 1 && g < 40; n = acima(n), g++) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.95) return c; } return [255, 255, 255, 1]; };
  const misturar = (c, f) => [c[0] * c[3] + f[0] * (1 - c[3]), c[1] * c[3] + f[1] * (1 - c[3]), c[2] * c[3] + f[2] * (1 - c[3])];
  // Quem rola por dentro recorta o que passa dele, mas só no próprio eixo: um bloco de
  // código mais alto que a tela ainda contém a linha comprida na horizontal.
  const recortado = (el, eixo) => { for (let n = el.parentElement; n; n = n.parentElement) { const cs = getComputedStyle(n), q = n.getBoundingClientRect(); if (eixo === "x" ? cs.overflowX !== "visible" && q.left >= -1 && q.right <= vw + 1 : cs.overflowY !== "visible" && q.top >= -1 && q.bottom <= vh + 1) return true; } return false; };
  // Faixa horizontal visível: a interseção do elemento e dos ancestrais que recortam,
  // atravessando a sombra — reticências cortam o texto na caixa do próprio elemento.
  const faixaDe = (el) => { let e = -Infinity, d = Infinity; for (let n = el; n && n.nodeType === 1; n = acima(n)) { if (getComputedStyle(n).overflowX !== "visible") { const q = n.getBoundingClientRect(); e = Math.max(e, q.left); d = Math.min(d, q.right); } } return [e, d]; };
  const vazamentos = [], miudos = [], contraste = [], semNome = [], todos = [], linhasLongas = [];
  const tamanhos = new Set(), pesos = new Set(), margem = { minima: Infinity, alvo: "" };
  for (const el of RAIZ.querySelectorAll("*")) {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    // Painel fixo que passa da tela fica inalcançável; na página, só a horizontal pesa.
    const fora = Math.max(r.right - vw, -r.left), foraV = cs.position === "fixed" ? Math.max(r.bottom - vh, -r.top) : 0;
    const visivel = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
    const foraX = fora > 1 && !recortado(el, "x"), foraY = foraV > 1 && !recortado(el, "y");
    if (visivel && (foraX || foraY)) {
      const pai = el.parentElement, rp = pai && pai.getBoundingClientRect();
      if (!rp || (rp.right - vw <= 1 && rp.left >= -1 && (cs.position !== "fixed" || (rp.bottom - vh <= 1 && rp.top >= -1)))) vazamentos.push(caminho(el) + " passa " + Math.round(foraX ? fora : foraV) + "px " + (foraX ? "na horizontal" : "na vertical"));
    }
    const texto = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim().length >= 2).map((n) => n.nodeValue.trim()).join(" ");
    if (texto) {
      const px = parseFloat(cs.fontSize);
      if (px < 12) miudos.push(caminho(el) + " (" + px + "px: " + texto.slice(0, 24) + ")");
      const fg = rgba(cs.color);
      if (fg && fg[3] > 0.05) {
        const f = fundo(el), a = lum(misturar(fg, f)), b = lum(f);
        const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const minimo = px >= 24 || (px >= 18.66 && (Number(cs.fontWeight) || 400) >= 700) ? 3 : 4.5;
        if (razao < minimo) contraste.push(caminho(el) + " (" + razao.toFixed(2) + ":1, mínimo " + minimo + ": " + texto.slice(0, 24) + ")");
      }
      if (/[\\p{L}\\p{N}]{2,}/u.test(texto) && textoNaTela(el, cs, r)) {
        tamanhos.add(Math.round(px * 100) / 100);
        pesos.add(Number(cs.fontWeight) || 400);
        const [e, d] = faixaDe(el);
        for (const t of el.childNodes) {
          if (t.nodeType !== 3 || !t.nodeValue.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(t);
          for (const q of rg.getClientRects()) { const esq = Math.max(q.left, e), dir = Math.min(q.right, d); if (dir - esq < 1 || esq < -0.5 || dir > vw + 0.5) continue; const dist = Math.min(esq, vw - dir); if (dist < margem.minima) { margem.minima = dist; margem.alvo = caminho(el); } }
        }
        if (!/^(inline|contents)/.test(cs.display) && cs.whiteSpace !== "pre" && !el.closest("pre, code") && el.textContent.length >= 120) {
          const l = leitura(el);
          if (l && l.ch > 75) linhasLongas.push(caminho(el) + " (~" + l.ch + "ch)");
        }
      }
    }
    if (el.matches(SELETOR) && !el.disabled && el.getAttribute("aria-disabled") !== "true") {
      todos.push({ el, r });
      const nome = el.getAttribute("aria-label") || el.getAttribute("title") || (el.getAttribute("aria-labelledby") && "rotulado") || el.textContent.trim() || (el.labels && el.labels.length && "rotulado") || el.getAttribute("placeholder") || el.value;
      if (!nome) semNome.push(caminho(el));
    }
  }
  const alvos = avaliarAlvos(todos, SELETOR).falhas.map((f) => caminho(f.el) + " (" + Math.round(f.r.width) + "x" + Math.round(f.r.height) + ", encosta em " + caminho(f.vizinho) + ")");
  // Painel que abre por cima da barra esconde os controles dela — no celular, a barra
  // quebra em linhas e um topo fixo que servia no desktop passa a cobri-la.
  const sobreposicoes = [];
  const barra = RAIZ.querySelector && RAIZ.querySelector(".an-barra");
  if (barra && barra.checkVisibility()) {
    const b = barra.getBoundingClientRect();
    for (const painel of RAIZ.querySelectorAll(".an-raiz > *")) {
      if (painel === barra || painel.contains(barra) || !painel.checkVisibility()) continue;
      // Só painel de verdade: fixo, com fundo e recebendo clique. A camada transparente
      // dos marcadores cobre a tela inteira de propósito e não esconde nada.
      const cp = getComputedStyle(painel), fundoPainel = rgba(cp.backgroundColor);
      if (cp.position !== "fixed" || cp.pointerEvents === "none" || !fundoPainel || fundoPainel[3] < 0.5) continue;
      const q = painel.getBoundingClientRect();
      const x = Math.min(q.right, b.right) - Math.max(q.left, b.left), y = Math.min(q.bottom, b.bottom) - Math.max(q.top, b.top);
      if (x > 4 && y > 4) sobreposicoes.push(caminho(painel) + " cobre " + Math.round(x) + "x" + Math.round(y) + "px da barra");
    }
  }
  const tipografia = [], ts = [...tamanhos].sort((a, b) => a - b), ps = [...pesos].sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 0.01 && ts[i] - ts[i - 1] < 1) tipografia.push("tamanhos quase iguais: " + ts[i - 1] + " e " + ts[i] + "px");
  if (ps.length > 4 || ps.some((p) => p % 100)) tipografia.push("pesos fora da escada: " + ps.join(", "));
  const margens = margem.minima < 8 || (margem.minima < 16 && vw < 600) ? [margem.alvo + " a " + Math.round(margem.minima) + "px da borda"] : [];
  return { vazamentos, miudos, contraste, alvos, semNome, sobreposicoes, linhasLongas, tipografia, margens };
})()`;

// Um resultado de extração plausível, para medir a tela do extrator preenchida — vazia,
// ela esconde justamente a parte densa: amostras, escala, código e tabela.
const RESULTADO_EXTRACAO = {
  nome: "Portal de exemplo", url: "https://exemplo.org/", extraidoEm: "2026-09-24T12:00:00.000Z",
  markdown: ["# Referência de design", "", "## Tipografia", "- **Corpo:** `16px`, entrelinha `24px`.", "", "| Token | Valor |", "| :--- | ---: |", "| `accent` | **#0A6B62** |", "| `ink` | #1F2523 |", "", "```css", ".cartao {", "  padding: 16px;", "  border-radius: 12px;", "}", "```"].join("\n"),
  tokens: {
    colors: { accent: "#0A6B62", background: "#F4F6F5", ink: "#1F2523", muted: "#5C6763" },
    typography: {
      heading: { fontFamily: "Georgia, serif", fontSize: "32px", fontWeight: "600", lineHeight: "38px", letterSpacing: "-0.6px" },
      body: { fontFamily: "system-ui, sans-serif", fontSize: "16px", fontWeight: "400", lineHeight: "24px", letterSpacing: "normal" },
    },
    spacing: { sm: "8px", md: "16px", lg: "32px", xl: "64px" },
    rounded: { sm: "6px", md: "12px", pill: "999px" },
    shadows: { card: "0 5px 15px rgba(0,0,0,.25)" },
    components: { button: { color: "#FFFFFF", backgroundColor: "#0A6B62", borderRadius: "10px" } },
  },
  evidencias: {
    viewports: [
      { nome: "desktop", largura: 1440, altura: 900, url: "https://exemplo.org/", elementosAnalisados: 48, domLimitado: false },
      { nome: "mobile", largura: 390, altura: 844, url: "https://exemplo.org/", elementosAnalisados: 46, domLimitado: false },
    ],
    tokens: [], componentes: [], cssVariables: [], layout: [], responsivo: [], assets: [],
    limitacoes: ["Estados de hover não foram observados."],
  },
};

interface Medida { vazamentos: string[]; miudos: string[]; contraste: string[]; alvos: string[]; semNome: string[]; sobreposicoes: string[]; linhasLongas: string[]; tipografia: string[]; margens: string[] }

describe("o Anotador passa na própria régua", { skip: chrome ? false : "Chromium não encontrado (defina ANOTADOR_CHROME)", timeout: 240_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const falhas: string[] = [];

  const registrar = (onde: string, m: Medida) => {
    for (const [regra, lista] of Object.entries(m) as Array<[keyof Medida, string[]]>) for (const item of lista) falhas.push(`${onde} · ${regra}: ${item}`);
  };
  const abrirOverlay = async () => {
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    await pagina.esperar(300);
  };
  const clicarNaSombra = async (seletor: string, espera: string) => {
    await pagina.avaliar(`${no(seletor)}.click()`);
    await pagina.esperarPor(`${no(espera)}?.checkVisibility()`, 8_000);
    await pagina.esperar(250);
  };

  // Como quem usa: passa o mouse, clica no elemento, e o balão aparece junto dele.
  const selecionar = async () => {
    const r = await pagina.avaliar<{ x: number; y: number }>(`(() => { const r = document.getElementById("salvar").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await pagina.mover(r.x, r.y);
    await pagina.clicar(r.x, r.y);
    await pagina.esperarPor(`${no(".an-balao")}?.checkVisibility()`, 8_000);
    await pagina.esperar(250);
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
  });
  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  for (const largura of LARGURAS) {
    test(`páginas e painéis em ${largura}px`, async () => {
      await pagina.definirViewport(largura, largura < 500 ? 844 : 900, 1);
      // As páginas próprias seguem o tema do sistema: medidas nos dois.
      for (const tema of ["light", "dark"] as const) {
        await pagina.emularPreferencias({ tema });
        for (const [nome, caminho] of [["conexão", "/__anotador/"], ["extrator", "/__anotador/extrair"], ["microfone", "/__anotador/microfone"], ["extrator com resultado", "/__anotador/extrair"]] as const) {
          await pagina.navegar(proxy.origem + caminho);
          await pagina.esperar(600);
          if (nome === "extrator com resultado") {
            // A resposta do servidor é trocada na própria página: medir a interface não
            // precisa extrair um site de verdade.
            await pagina.avaliar(`(() => { const original = window.fetch; window.fetch = (url, opcoes) => String(url).endsWith("/__anotador/extrair") && opcoes && opcoes.method === "POST" ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify({ resultado: RESULTADO_EXTRACAO }))}, { status: 200, headers: { "content-type": "application/json" } })) : original(url, opcoes); document.getElementById("url").value = "https://exemplo.org/"; document.getElementById("form").requestSubmit(); })()`);
            await pagina.esperarPor('document.getElementById("result").hidden === false', 8_000);
            await pagina.esperar(300);
          }
          registrar(`${largura}px ${nome} (${tema === "dark" ? "escuro" : "claro"})`, await pagina.avaliar<Medida>(auditar("document.body")));
        }
      }
      await pagina.emularPreferencias({ tema: "light" });
      const estados: Array<[string, () => Promise<void>]> = [
        ["barra", async () => {}],
        ["balão de anotação", () => selecionar()],
        ["painel de anotação", async () => { await selecionar(); await clicarNaSombra(".an-balao .an-ico", ".an-painel"); }],
        ["chat", () => clicarNaSombra('[aria-label="Abrir chat"]', ".an-chat")],
        ["estrutura", async () => { await pagina.avaliar("window.__anotadorDebug.abrirArvore()"); await pagina.esperarPor(`${no(".an-arvore")}?.checkVisibility()`, 8_000); await pagina.esperar(250); }],
        ["sistema de design", () => clicarNaSombra('.an-barra button[title^="Sistema de design"]', ".an-design")],
        ["avaliação", () => clicarNaSombra('.an-barra button[title^="Avaliar a página"]', ".an-avaliacao")],
        ["fila", () => clicarNaSombra('.an-barra button[title="Ver fila e lotes"]', ".an-fila")],
      ];
      for (const [nome, abrir] of estados) {
        await abrirOverlay();
        await abrir();
        registrar(`${largura}px ${nome}`, await pagina.avaliar<Medida>(auditar(SOMBRA)));
      }
    });
  }

  test("nenhuma falha em nenhuma largura", () => {
    assert.deepEqual(falhas, [], `${falhas.length} falha(s) na própria interface:\n${falhas.join("\n")}`);
  });
});
