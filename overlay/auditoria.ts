// Inspeção da página, no nível do que se faria à mão nas ferramentas do navegador.
// Só mede: contraste, alvo de toque, hierarquia, transbordo, alinhamento, escala, consistência.
// Nenhum julgamento subjetivo mora aqui — isso é trabalho do agente, e ele recebe estes fatos
// junto com a captura para não precisar adivinhar.

// ---------- utilidades de medida ----------
function luminancia(c: [number, number, number]): number {
  const f = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function corRgba(valor: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(valor);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

// O fundo efetivo é o do primeiro ancestral que pinta algo opaco.
function fundoEfetivo(el: Element): [number, number, number] {
  let n: Element | null = el;
  let guarda = 0;
  while (n && guarda++ < 20) {
    const c = corRgba(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0.95) return [c[0], c[1], c[2]];
    n = n.parentElement;
  }
  return [255, 255, 255];
}

function razaoDeContraste(frente: [number, number, number], fundo: [number, number, number]): number {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function descreverCurto(el: Element): string {
  let d = el.tagName.toLowerCase();
  if (el.id && !ehDinamico(el.id)) d += "#" + el.id;
  const cls = classesEstaveis(el).slice(0, 2);
  if (cls.length) d += "." + cls.join(".");
  const t = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  return d + (t ? ` "${t}"` : "");
}

/**
 * O ranqueamento geral premia texto visível, que é ótimo para achar no código e
 * inútil para `querySelector` — e é `querySelector` que o painel usa para realçar o
 * achado. Aqui vale o melhor candidato que o navegador saiba consultar; o texto só
 * entra quando não existe nenhum.
 */
function melhorSeletor(el: Element): string | null {
  try {
    const cands = construirSeletores(el, el.ownerDocument);
    const consultavel = cands.find((c) => c.tipo === "data" || c.tipo === "id" || c.tipo === "css" || c.tipo === "aria");
    return (consultavel ?? cands[0])?.valor ?? null;
  } catch {
    return null;
  }
}

// ---------- inspeção ----------
/**
 * O elemento de cada achado, guardado fora do objeto que vai serializado para o
 * dossiê. Cruzar duas réguas pelo seletor não funciona — nem todo achado tem um que
 * o navegador consulte —, e comparar o nó é exato.
 */
const elementoDoAchado = new WeakMap<AchadoAuditoria, Element>();

function auditarPagina(): ResultadoAuditoria {
  const achados: AchadoAuditoria[] = [];
  const add = (a: Omit<AchadoAuditoria, "seletor" | "rect">, el: Element | null) => {
    const achado: AchadoAuditoria = { ...a, seletor: el ? melhorSeletor(el) : null, rect: el ? rectTopo(el) : null };
    if (el) elementoDoAchado.set(achado, el);
    achados.push(achado);
  };
  const visiveis: Array<{ el: Element; r: DOMRect; cs: CSSStyleDeclaration }> = [];
  for (const el of document.querySelectorAll("body *")) {
    if (visiveis.length > 3000) break;
    if (ignorar(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    visiveis.push({ el, r, cs });
  }

  // 1. contraste do texto (WCAG AA)
  for (const { el, cs } of visiveis) {
    if (textoDireto(el).length < 2) continue;
    const fg = corRgba(cs.color);
    if (!fg || fg[3] < 0.5) continue;
    const razao = razaoDeContraste([fg[0], fg[1], fg[2]], fundoEfetivo(el));
    const tam = parseFloat(cs.fontSize);
    const peso = Number(cs.fontWeight) || 400;
    const minimo = tam >= 24 || (tam >= 18.66 && peso >= 700) ? 3 : 4.5;
    if (razao < minimo) {
      add(
        {
          regra: "contraste abaixo do mínimo",
          categoria: "acessibilidade",
          gravidade: razao < minimo - 1.5 ? "alta" : "media",
          alvo: descreverCurto(el),
          evidencia: `${razao.toFixed(2)}:1 onde a norma pede ${minimo}:1 (texto de ${Math.round(tam)}px)`,
        },
        el
      );
    }
  }

  // 2. alvo de toque (WCAG 2.2 §2.5.8); link no meio de um parágrafo é exceção da própria norma
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="link"]')) {
    if (ignorar(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || (r.width >= 24 && r.height >= 24)) continue;
    const pai = el.parentElement;
    const embutido = el.tagName === "A" && pai && (pai.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 3;
    if (embutido) continue;
    add(
      {
        regra: "alvo de toque pequeno",
        categoria: "acessibilidade",
        gravidade: "media",
        alvo: descreverCurto(el),
        evidencia: `${Math.round(r.width)}×${Math.round(r.height)}px, abaixo de 24×24`,
      },
      el
    );
  }

  // 3. rótulo acessível em campo e botão
  for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
    if (ignorar(el)) continue;
    const campo = el as HTMLInputElement;
    if (campo.labels?.length || campo.getAttribute("aria-label") || campo.getAttribute("aria-labelledby") || campo.getAttribute("title") || campo.getAttribute("placeholder")) continue;
    add({ regra: "campo sem rótulo", categoria: "acessibilidade", gravidade: "alta", alvo: descreverCurto(el), evidencia: "nada nomeia este campo para leitor de tela" }, el);
  }
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (ignorar(el) || (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.getAttribute("title")) continue;
    add({ regra: "botão sem nome", categoria: "acessibilidade", gravidade: "alta", alvo: descreverCurto(el), evidencia: "só ícone, sem texto nem aria-label" }, el);
  }

  // 4. hierarquia dos cabeçalhos
  const cabecalhos = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter((el) => !ignorar(el))
    .map((el) => ({ el, n: Number(el.tagName[1]), tam: parseFloat(getComputedStyle(el).fontSize) }));
  const h1 = cabecalhos.filter((c) => c.n === 1);
  if (h1.length === 0 && cabecalhos.length) add({ regra: "sem h1", categoria: "hierarquia", gravidade: "media", alvo: "documento", evidencia: "a página tem cabeçalhos, mas nenhum de primeiro nível" }, null);
  if (h1.length > 1) add({ regra: "vários h1", categoria: "hierarquia", gravidade: "media", alvo: "documento", evidencia: `${h1.length} cabeçalhos de primeiro nível competindo pelo topo` }, h1[1]?.el ?? null);
  for (let i = 1; i < cabecalhos.length; i++) {
    const a = cabecalhos[i - 1];
    const b = cabecalhos[i];
    if (!a || !b) continue;
    if (b.n - a.n > 1) add({ regra: "salto de nível", categoria: "hierarquia", gravidade: "media", alvo: descreverCurto(b.el), evidencia: `vai de h${a.n} para h${b.n} sem passar pelo nível do meio` }, b.el);
    if (b.n > a.n && b.tam > a.tam + 0.5) {
      add({ regra: "hierarquia invertida", categoria: "hierarquia", gravidade: "media", alvo: descreverCurto(b.el), evidencia: `h${b.n} aparece em ${b.tam}px, maior que o h${a.n} acima (${a.tam}px)` }, b.el);
    }
  }

  // 5. transbordo e texto cortado
  const largura = document.documentElement.clientWidth;
  // Passar da janela só é defeito se a página inteira rolar de lado. Dentro de um contêiner
  // que rola de propósito (tabela larga, carrossel), sair da borda é o comportamento esperado.
  const rolaDeLado = document.documentElement.scrollWidth > largura + 1;
  const dentroDeRolagem = (el: Element): boolean => {
    let n = el.parentElement;
    let guarda = 0;
    while (n && guarda++ < 20) {
      const o = getComputedStyle(n).overflowX;
      if (o === "auto" || o === "scroll") return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const { el, r, cs } of visiveis) {
    if (rolaDeLado && r.right > largura + 1 && !dentroDeRolagem(el)) {
      add({ regra: "transborda a janela", categoria: "layout", gravidade: "alta", alvo: descreverCurto(el), evidencia: `passa ${Math.round(r.right - largura)}px da largura de ${largura}px e faz a página rolar de lado` }, el);
    }
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(cs.overflowX)) {
      add({ regra: "texto cortado", categoria: "layout", gravidade: "media", alvo: descreverCurto(el), evidencia: `conteúdo de ${el.scrollWidth}px espremido em ${el.clientWidth}px` }, el);
    }
  }

  // 6. quase-alinhamento: borda a 1–3px de uma coluna que vários elementos respeitam
  const colunas = new Map<number, number>();
  for (const { r } of visiveis) {
    const x = Math.round(r.left);
    colunas.set(x, (colunas.get(x) ?? 0) + 1);
  }
  const fortes = Array.from(colunas.entries())
    .filter(([, n]) => n >= 4)
    .map(([x]) => x);
  const jaApontado = new Set<string>();
  for (const { el, r } of visiveis) {
    const x = Math.round(r.left);
    if ((colunas.get(x) ?? 0) >= 4) continue;
    const perto = fortes.find((f) => Math.abs(f - x) >= 1 && Math.abs(f - x) <= 3);
    if (perto === undefined) continue;
    const chave = descreverCurto(el);
    if (jaApontado.has(chave)) continue;
    jaApontado.add(chave);
    add(
      {
        regra: "quase alinhado",
        categoria: "layout",
        gravidade: "baixa",
        alvo: chave,
        evidencia: `começa em ${x}px, ${Math.abs(perto - x)}px fora da coluna de ${perto}px que ${colunas.get(perto)} elementos respeitam`,
      },
      el
    );
  }

  // 7. irmãos que deveriam combinar: raio e altura de controles lado a lado
  for (const { el } of visiveis) {
    const filhos = Array.from(el.children).filter((f) => !ignorar(f) && f.getBoundingClientRect().width > 0);
    if (filhos.length < 2 || filhos.length > 12) continue;
    const cs = getComputedStyle(el);
    if (!/flex|grid/.test(cs.display)) continue;

    const raios = new Map<string, number>();
    const alturas: number[] = [];
    let controles = 0;
    for (const f of filhos) {
      const fcs = getComputedStyle(f);
      const r = f.getBoundingClientRect();
      const ehControle = /^(button|a|input|select)$/.test(f.tagName.toLowerCase()) || f.getAttribute("role") === "button";
      if (ehControle) {
        controles++;
        alturas.push(Math.round(r.height));
        raios.set(fcs.borderTopLeftRadius, (raios.get(fcs.borderTopLeftRadius) ?? 0) + 1);
      }
    }
    if (controles >= 2) {
      if (raios.size > 1) {
        add(
          {
            regra: "raio inconsistente",
            categoria: "consistencia",
            gravidade: "media",
            alvo: descreverCurto(el),
            evidencia: `controles lado a lado com raios diferentes: ${Array.from(raios.keys()).join(", ")}`,
          },
          el
        );
      }
      const alturasDistintas = Array.from(new Set(alturas));
      if (alturasDistintas.length > 1 && Math.max(...alturasDistintas) - Math.min(...alturasDistintas) > 2) {
        add(
          {
            regra: "altura de controle desigual",
            categoria: "consistencia",
            gravidade: "media",
            alvo: descreverCurto(el),
            evidencia: `botões e campos vizinhos medem ${alturasDistintas.sort((a, b) => a - b).join("px, ")}px`,
          },
          el
        );
      }
    }

    // 8. grade: espaços desiguais entre itens de uma mesma linha
    const emLinha = filhos.map((f) => f.getBoundingClientRect()).filter((r) => r.width > 0);
    if (emLinha.length >= 3) {
      const mesmaLinha = emLinha.every((r) => Math.abs(r.top - (emLinha[0] as DOMRect).top) < 2);
      if (mesmaLinha) {
        const vaos: number[] = [];
        for (let i = 1; i < emLinha.length; i++) vaos.push(Math.round((emLinha[i] as DOMRect).left - (emLinha[i - 1] as DOMRect).right));
        const distintos = Array.from(new Set(vaos.filter((v) => v >= 0)));
        if (distintos.length > 1 && Math.max(...distintos) - Math.min(...distintos) > 2) {
          add(
            {
              regra: "vãos desiguais",
              categoria: "escala",
              gravidade: "baixa",
              alvo: descreverCurto(el),
              evidencia: `itens da mesma linha separados por ${distintos.sort((a, b) => a - b).join("px, ")}px`,
            },
            el
          );
        }
      }
    }
  }

  // 13-15. marcas de interface montada no piloto automático, da lista de tells que a
  // Anthropic publica na skill frontend-design. Nenhuma é erro; todas são sinal de que
  // a tela foi montada com o repertório padrão em vez de com o assunto dela. Cada uma
  // rende no máximo três linhas, porque um vício de estilo se repete na página inteira
  // e listar tudo afogaria o resto do painel.
  const limitar = (lista: Element[], regra: string, evidencia: (el: Element) => string, texto: string) => {
    for (const el of lista.slice(0, 3)) {
      add({ regra, categoria: "originalidade", gravidade: "baixa", alvo: descreverCurto(el), evidencia: evidencia(el) }, el);
    }
    if (lista.length > 3) {
      add({ regra, categoria: "originalidade", gravidade: "baixa", alvo: `e mais ${lista.length - 3} elemento(s)`, evidencia: texto }, null);
    }
  };

  const versaletes: Element[] = [];
  const setas: Element[] = [];
  const pontosMedios: Element[] = [];
  for (const { el, cs } of visiveis) {
    const t = textoDireto(el);
    if (!t) continue;
    const espacamento = parseFloat(cs.letterSpacing);
    const tamanho = parseFloat(cs.fontSize);
    if (cs.textTransform === "uppercase" && espacamento >= tamanho * 0.05 && tamanho <= 13 && t.length <= 40) versaletes.push(el);
    if (/[→⟶]\s*$/.test(t) && (el.tagName === "A" || el.tagName === "BUTTON" || el.getAttribute("role") === "button")) setas.push(el);
    if ((t.match(/\s·\s/g) ?? []).length >= 2) pontosMedios.push(el);
  }
  limitar(
    versaletes,
    "rótulo em versalete",
    (el) => `"${textoDireto(el).slice(0, 28)}" em caixa alta com espaçamento entre letras; peso e cor separam igual, sem o ar de modelo pronto`,
    "o mesmo rótulo em versalete se repete pela página"
  );
  limitar(
    setas,
    "seta presa ao rótulo",
    (el) => `"${textoDireto(el).slice(0, 28)}" termina em seta; o elemento já é clicável e a seta não acrescenta destino`,
    "vários rótulos terminam em seta"
  );
  limitar(
    pontosMedios,
    "metadados colados por ponto",
    (el) => `"${textoDireto(el).slice(0, 34)}" emenda três informações com ponto médio; vírgula ou linhas separadas leem melhor`,
    "a mesma emenda aparece em outros lugares"
  );

  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || a.regra.localeCompare(b.regra));
  for (const a of achados) a.origem = "regua";
  return { achados, medidos: visiveis.length, em: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// MOTOR DE NORMAS EMPRESTADO DO PROJETO ANOTADO
// ---------------------------------------------------------------------------
//
// A régua acima mede geometria — alinhamento, vãos, altura, transbordo — e nenhum
// motor de acessibilidade mede isso. O axe-core mede o contrário: ARIA, semântica,
// landmarks, tabelas. Quando o projeto anotado já tem o axe instalado, o servidor o
// empresta e as duas réguas somam. Onde não tiver, nada muda: a régua própria basta.
//
// Um achado do motor só entra se a régua não tiver falado do mesmo elemento sobre o
// mesmo assunto. A régua tem calibração que a norma não tem (link no meio de parágrafo
// é exceção do próprio critério 2.5.8), então ela ganha o empate.

const GRAVIDADE_NORMA: Record<string, AchadoAuditoria["gravidade"]> = {
  critical: "alta",
  serious: "alta",
  moderate: "media",
  minor: "baixa",
};

/** Assunto de cada regra, dos dois lados, para o empate ser detectável. */
const ASSUNTO_NORMA: Record<string, string> = {
  "color-contrast": "contraste",
  "target-size": "toque",
  label: "rotulo",
  "form-field-multiple-labels": "rotulo",
  "button-name": "nome",
  "link-name": "nome",
  "heading-order": "cabecalho",
  "empty-heading": "cabecalho",
};

const ASSUNTO_REGUA: Record<string, string> = {
  "contraste abaixo do mínimo": "contraste",
  "alvo de toque pequeno": "toque",
  "campo sem rótulo": "rotulo",
  "botão sem nome": "nome",
  "salto de nível": "cabecalho",
  "hierarquia invertida": "cabecalho",
};

/** Nome em português das regras que de fato aparecem em aplicação React; o resto cai no texto do motor. */
const ROTULO_NORMA: Record<string, string> = {
  "aria-allowed-attr": "atributo ARIA que a função não aceita",
  "aria-hidden-focus": "elemento escondido de leitor mas ainda focável",
  "aria-input-field-name": "campo ARIA sem nome",
  "aria-required-attr": "função ARIA sem atributo obrigatório",
  "aria-required-children": "função ARIA sem os filhos que ela exige",
  "aria-required-parent": "função ARIA fora do pai que ela exige",
  "aria-valid-attr-value": "valor inválido em atributo ARIA",
  "aria-roles": "função ARIA inexistente",
  "button-name": "botão sem nome",
  bypass: "sem caminho para pular a navegação",
  "color-contrast": "contraste abaixo do mínimo",
  "definition-list": "lista de definição malformada",
  "document-title": "página sem título",
  "duplicate-id-aria": "mesmo id usado por dois alvos de ARIA",
  "empty-heading": "cabeçalho vazio",
  "form-field-multiple-labels": "campo com mais de um rótulo",
  "frame-title": "quadro embutido sem título",
  "heading-order": "salto de nível de cabeçalho",
  "html-has-lang": "página sem idioma declarado",
  "html-lang-valid": "idioma declarado inválido",
  "image-alt": "imagem sem texto alternativo",
  "input-button-name": "botão de formulário sem nome",
  "input-image-alt": "botão de imagem sem alternativa",
  label: "campo sem rótulo",
  "label-content-name-mismatch": "nome acessível não contém o rótulo visível",
  "landmark-one-main": "página sem região principal",
  "link-in-text-block": "link que só se distingue pela cor",
  "link-name": "link sem nome",
  list: "lista com filho que não é item",
  listitem: "item de lista fora de lista",
  "meta-viewport": "viewport que impede ampliar",
  "nested-interactive": "controle dentro de outro controle",
  "p-as-heading": "parágrafo em negrito fazendo as vezes de título",
  region: "conteúdo fora de qualquer região",
  "scrollable-region-focusable": "área rolável que o teclado não alcança",
  "select-name": "seleção sem nome",
  "svg-img-alt": "ícone SVG anunciado sem alternativa",
  "table-fake-caption": "legenda de tabela feita com célula",
  "target-size": "alvo de toque pequeno",
  "td-has-header": "célula de dado sem cabeçalho",
  "td-headers-attr": "célula apontando para cabeçalho inexistente",
  "th-has-data-cells": "cabeçalho de tabela sem células",
  "valid-lang": "idioma inválido em trecho do texto",
};

let carregandoNorma: Promise<boolean> | null = null;

/**
 * Baixa o motor uma vez por página. O `<script>` leva o nonce da página: sem ele,
 * uma política de segurança estrita descarta a tag em silêncio, sem erro nenhum.
 */
function carregarNorma(): Promise<boolean> {
  if (!CFG.norma) return Promise.resolve(false);
  const janela = window as unknown as Record<string, unknown>;
  if (janela["axe"]) return Promise.resolve(true);
  carregandoNorma ??= new Promise<boolean>((resolver) => {
    const script = document.createElement("script");
    script.src = CFG.base + "/norma.js";
    const nonce = String(janela["__ANOTADOR_NONCE"] ?? "");
    if (nonce) script.nonce = nonce;
    script.onload = () => resolver(Boolean(janela["axe"]));
    script.onerror = () => resolver(false);
    (document.head ?? document.documentElement).append(script);
  });
  return carregandoNorma;
}

/** Elementos que a régua própria já acusou, por assunto. */
function jaFalamosDe(achados: AchadoAuditoria[]): Map<string, Set<Element>> {
  const mapa = new Map<string, Set<Element>>();
  for (const a of achados) {
    const assunto = ASSUNTO_REGUA[a.regra];
    if (!assunto) continue;
    let el = elementoDoAchado.get(a) ?? null;
    if (!el && a.seletor) {
      try {
        el = document.querySelector(a.seletor);
      } catch {
        el = null;
      }
    }
    if (!el) continue;
    if (!mapa.has(assunto)) mapa.set(assunto, new Set());
    mapa.get(assunto)?.add(el);
  }
  return mapa;
}

/**
 * Roda o motor e devolve só o que a régua não disse. As regras normativas que o motor
 * entrega desligadas são ligadas aqui pelo nome; sem isso, `target-size` e outras seis
 * ficariam mudas e o verde não significaria nada.
 */
async function auditarComNorma(daRegua: AchadoAuditoria[]): Promise<AchadoAuditoria[]> {
  if (!(await carregarNorma())) return [];
  const motor = (window as unknown as Record<string, { run?: unknown }>)["axe"];
  const rodar = motor?.run as
    | ((ctx: unknown, opc: unknown) => Promise<{ violations: Array<Record<string, unknown>> }>)
    | undefined;
  if (!rodar) return [];

  const regras: Record<string, { enabled: boolean }> = {};
  for (const id of CFG.norma?.ligar ?? []) regras[id] = { enabled: true };

  let resultado: { violations: Array<Record<string, unknown>> };
  try {
    resultado = await rodar(
      { exclude: [["#__anotador_host"]] },
      {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
        rules: regras,
        resultTypes: ["violations"],
      }
    );
  } catch {
    return [];
  }

  const conhecidos = jaFalamosDe(daRegua);
  const achados: AchadoAuditoria[] = [];
  for (const v of resultado.violations) {
    const id = String(v["id"] ?? "");
    const nos = (v["nodes"] ?? []) as Array<{ target?: string[] }>;
    const assunto = ASSUNTO_NORMA[id];
    const elementos: Array<{ el: Element | null; seletor: string }> = [];
    for (const no of nos) {
      const seletor = no.target?.[0] ?? "";
      let el: Element | null = null;
      try {
        el = seletor ? document.querySelector(seletor) : null;
      } catch {
        el = null;
      }
      if (assunto && el && conhecidos.get(assunto)?.has(el)) continue;
      elementos.push({ el, seletor });
    }
    if (!elementos.length) continue;

    const rotulo = ROTULO_NORMA[id] ?? String(v["help"] ?? id);
    const gravidade = GRAVIDADE_NORMA[String(v["impact"] ?? "minor")] ?? "baixa";
    // Três por regra bastam para agir; uma regra que acende em quarenta nós vira
    // parede de texto e o painel inteiro deixa de ser lido.
    for (const { el, seletor } of elementos.slice(0, 3)) {
      const achado: AchadoAuditoria = {
        regra: rotulo,
        categoria: "acessibilidade",
        gravidade,
        alvo: el ? descreverCurto(el) : seletor,
        evidencia: `${id} — ${String(v["description"] ?? "")}`.slice(0, 220),
        seletor: el ? melhorSeletor(el) : seletor || null,
        rect: el ? rectTopo(el) : null,
        origem: "norma",
        norma: id,
      };
      if (el) elementoDoAchado.set(achado, el);
      achados.push(achado);
    }
    if (elementos.length > 3) {
      achados.push({
        regra: rotulo,
        categoria: "acessibilidade",
        gravidade: "baixa",
        alvo: `e mais ${elementos.length - 3} elemento(s)`,
        evidencia: `${id} — a mesma regra acende em ${elementos.length} lugares desta página`,
        seletor: null,
        rect: null,
        origem: "norma",
        norma: id,
      });
    }
  }
  return achados;
}

/** Junta as duas réguas na mesma medição, mantendo a ordem por gravidade. */
async function completarComNorma(medicao: ResultadoAuditoria): Promise<boolean> {
  const extras = await auditarComNorma(medicao.achados);
  if (!extras.length) return false;
  medicao.achados.push(...extras);
  const ordem = { alta: 0, media: 1, baixa: 2 };
  medicao.achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || a.regra.localeCompare(b.regra));
  return true;
}

/** Contexto que ajuda o agente a julgar sem adivinhar: estrutura, componentes e escala. */
function contextoDaPagina(): Record<string, unknown> {
  const contar = (sel: string) => document.querySelectorAll(sel).length;
  const cabecalhos = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter((el) => !ignorar(el))
    .slice(0, 20)
    .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent ?? "").trim().slice(0, 60)}`);
  const componentes = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 1500)) {
    if (ignorar(el)) continue;
    const nome = componentesReact(el)[0];
    if (nome) componentes.set(nome, (componentes.get(nome) ?? 0) + 1);
  }
  return {
    url: location.href,
    titulo: document.title,
    viewport: { largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio || 1 },
    tema: document.documentElement.getAttribute("data-theme"),
    estrutura: {
      cabecalhos,
      marcos: ["header", "nav", "main", "aside", "footer", "form"].filter((t) => contar(t) > 0),
      botoes: contar('button, [role="button"]'),
      links: contar("a[href]"),
      campos: contar("input:not([type=hidden]), select, textarea"),
      imagens: contar("img"),
    },
    componentes: Array.from(componentes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([nome, n]) => `${nome} ×${n}`),
  };
}

// ---------- painel: medição agora, parecer do agente quando ele responder ----------
interface EstadoAvaliacao {
  aberto: boolean;
  medicao: ResultadoAuditoria | null;
  id: string | null;
  enviando: boolean;
  parecer: { agente: string; resumo: string; itens: ItemParecerOverlay[]; perguntas?: PerguntaOverlay[] } | null;
  erro: string | null;
}

interface PerguntaOverlay {
  texto: string;
  opcoes: string[];
  resposta?: string | null;
}

interface ItemParecerOverlay {
  titulo: string;
  categoria: string;
  gravidade: "alta" | "media" | "baixa";
  seletor?: string | null;
  problema: string;
  sugestao: string;
  comoAplicar?: string;
}

const avaliacao: EstadoAvaliacao = { aberto: false, medicao: null, id: null, enviando: false, parecer: null, erro: null };
let sondaParecer: ReturnType<typeof setInterval> | null = null;

function elementoDoSeletor(seletor: string | null | undefined): ElementoEstilizavel | null {
  if (!seletor) return null;
  try {
    const el = document.querySelector(seletor);
    return estilizavel(el) ? el : null;
  } catch {
    return null;
  }
}

async function alternarAvaliacao(): Promise<void> {
  if (avaliacao.aberto) {
    fecharAvaliacao();
    return;
  }
  avaliacao.aberto = true;
  ui.btnAvaliar.classList.add("ativo");
  if (!ui.avaliacao) {
    ui.avaliacao = h("div", { class: "an-avaliacao" });
    raiz?.append(ui.avaliacao);
  }
  ui.avaliacao.hidden = false;
  avaliacao.medicao = auditarPagina();
  renderizarAvaliacao();
  medirComNormaEDepoisPintar();
}

/**
 * A régua própria pinta na hora; o motor emprestado chega depois porque precisa baixar
 * meio megabyte. Se o usuário mandou medir de novo nesse meio-tempo, o resultado velho
 * é descartado em vez de sobrescrever o novo.
 */
function medirComNormaEDepoisPintar(): void {
  const medicao = avaliacao.medicao;
  if (!medicao) return;
  void completarComNorma(medicao).then((mudou) => {
    if (mudou && avaliacao.medicao === medicao) renderizarAvaliacao();
  });
}

function fecharAvaliacao(): void {
  avaliacao.aberto = false;
  ui.btnAvaliar.classList.remove("ativo");
  if (ui.avaliacao) ui.avaliacao.hidden = true;
  limparRealces();
  if (sondaParecer) clearInterval(sondaParecer);
  sondaParecer = null;
}

async function pedirParecer(foco: string): Promise<void> {
  if (avaliacao.enviando || !avaliacao.medicao) return;
  avaliacao.enviando = true;
  avaliacao.erro = null;
  avaliacao.parecer = null;
  renderizarAvaliacao();
  try {
    const contexto = { ...contextoDaPagina(), medidos: avaliacao.medicao.medidos };
    const corpo = {
      pagina: {
        url: location.href,
        caminho: location.pathname,
        titulo: document.title,
        viewport: { largura: innerWidth, altura: innerHeight, dpr: devicePixelRatio || 1 },
        tema: document.documentElement.getAttribute("data-theme"),
      },
      contexto,
      achados: avaliacao.medicao.achados,
      foco: foco || null,
      instantaneo: CFG.capturas ? instantaneoHtml([]) : null,
    };
    const resp = await fetch(CFG.base + "/avaliacoes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    avaliacao.id = ((await resp.json()) as { id: string }).id;
    avisar(`Pedido de parecer enviado a ${AGENTE}.`);
    acompanharParecer();
  } catch (erro) {
    avaliacao.erro = erro instanceof Error ? erro.message : String(erro);
  } finally {
    avaliacao.enviando = false;
    renderizarAvaliacao();
  }
}

function acompanharParecer(): void {
  if (sondaParecer) clearInterval(sondaParecer);
  const inicio = Date.now();
  sondaParecer = setInterval(() => {
    if (!avaliacao.id || Date.now() - inicio > 20 * 60 * 1000) {
      if (sondaParecer) clearInterval(sondaParecer);
      sondaParecer = null;
      return;
    }
    void fetch(CFG.base + "/avaliacoes/" + encodeURIComponent(avaliacao.id), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((corpo: { parecer?: EstadoAvaliacao["parecer"] } | null) => {
        if (!corpo?.parecer) return;
        avaliacao.parecer = corpo.parecer;
        if (sondaParecer) clearInterval(sondaParecer);
        sondaParecer = null;
        avisar(`${corpo.parecer.agente} respondeu: ${corpo.parecer.itens.length} ponto(s).`, 6000);
        renderizarAvaliacao();
      })
      .catch(() => undefined);
  }, 3000);
}

/** "25 elementos medidos, 13 da régua e 5 da norma" — sem motor, só a primeira metade. */
function resumoDaMedicao(m: ResultadoAuditoria): string {
  const daNorma = m.achados.filter((a) => a.origem === "norma").length;
  const daRegua = m.achados.length - daNorma;
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (!daNorma) return `${m.medidos} elementos medidos, ${plural(m.achados.length, "achado", "achados")}`;
  // Cabe numa linha só: o cabeçalho tem 400px e quebrar empurra a lista para baixo.
  return `${m.medidos} elementos, ${plural(daRegua, "achado", "achados")} da régua e ${daNorma} da norma`;
}

function linhaDeAchado(a: AchadoAuditoria): HTMLElement {
  const el = elementoDoSeletor(a.seletor);
  return h(
    "div",
    {
      class: "an-achado " + a.gravidade,
      title: a.seletor ?? "",
      onmouseenter: () => (el ? realcar([el]) : undefined),
      onmouseleave: limparRealces,
      onclick: () => {
        if (!el) return;
        fecharAvaliacao();
        selecionarElemento(el);
      },
    },
    h("span", { class: "sinal" }),
    h(
      "span",
      { class: "col" },
      h(
        "span",
        { class: "titulo" },
        a.regra,
        // Selo só no que veio de fora: o padrão do painel é a régua da casa.
        ...(a.origem === "norma" ? [h("span", { class: "an-selo", title: a.norma ?? "regra normativa" }, "norma")] : [])
      ),
      h("span", { class: "sub" }, a.alvo),
      h("span", { class: "evid" }, a.evidencia)
    )
  );
}

function linhaDeParecer(i: ItemParecerOverlay): HTMLElement {
  const el = elementoDoSeletor(i.seletor);
  const bloco = h(
    "div",
    {
      class: "an-achado parecer " + i.gravidade,
      onmouseenter: () => (el ? realcar([el]) : undefined),
      onmouseleave: limparRealces,
    },
    h("span", { class: "sinal" }),
    h(
      "span",
      { class: "col" },
      h("span", { class: "titulo" }, i.titulo, h("span", { class: "cat" }, i.categoria)),
      h("span", { class: "evid" }, i.problema),
      h("span", { class: "sugestao" }, "→ " + i.sugestao),
      i.comoAplicar ? h("span", { class: "aplicar mono" }, i.comoAplicar) : null
    )
  );
  if (el) {
    bloco.append(
      h("button", {
        class: "an-btn mini",
        title: "Selecionar este elemento para anotar",
        onclick: (e: Event) => {
          e.stopPropagation();
          fecharAvaliacao();
          selecionarElemento(el);
          if (estado.atual && !estado.atual.comentario) {
            estado.atual.comentario = i.sugestao;
            if (ui.entradaBalao) ui.entradaBalao.value = i.sugestao;
            ui.comentarioPainel.value = i.sugestao;
          }
        },
      }, "Anotar")
    );
  }
  return bloco;
}

function renderizarAvaliacao(): void {
  const painel = ui.avaliacao;
  if (!painel) return;
  const m = avaliacao.medicao;
  painel.textContent = "";
  const alca = h("span", { class: "an-alca", html: ICONES.alca, title: "Arrastar" });
  const cab = h(
    "div",
    { class: "cab" },
    alca,
    h("span", { class: "an-ico", style: "background:var(--an-superficie-alta)", html: ICONES.lupa }),
    h(
      "div",
      { class: "tit" },
      "Avaliação da página",
      h("span", { class: "sub" }, m ? resumoDaMedicao(m) : "medindo…")
    ),
    h("button", {
      class: "an-ico",
      title: "Medir de novo",
      html: ICONES.recarregar,
      onclick: () => {
        avaliacao.medicao = auditarPagina();
        renderizarAvaliacao();
        medirComNormaEDepoisPintar();
      },
    }),
    h("button", { class: "an-ico", title: "Fechar", html: ICONES.fechar, onclick: fecharAvaliacao })
  );
  painel.append(cab);
  tornarArrastavel(painel, [alca, cab], "avaliacao");

  const corpo = h("div", { class: "corpo" });
  if (m) {
    // Os dois conjuntos ficam numa lista só, ordenada por gravidade, porque quem abre
    // o painel quer decidir o que consertar primeiro — e não ler duas listas. O título
    // então precisa cobrir as duas origens; o selo de cada linha diz de quem é o achado.
    const daNorma = m.achados.filter((a) => a.origem === "norma").length;
    corpo.append(h("div", { class: "secao" }, daNorma ? "Medido na página" : "Medido pela régua"));
    if (!m.achados.length) corpo.append(h("div", { class: "vazio" }, "Nada fora do lugar nas regras objetivas."));
    for (const a of m.achados) corpo.append(linhaDeAchado(a));
  }

  if (avaliacao.parecer) {
    const p = avaliacao.parecer;
    corpo.append(h("div", { class: "secao" }, `Parecer de ${p.agente}`));
    if (p.resumo) corpo.append(h("div", { class: "resumo" }, p.resumo));
    // O agente pergunta quando o julgamento depende da intenção do produto, que nenhuma medida revela.
    (p.perguntas ?? []).forEach((q, i) => {
      const bloco = h("div", { class: "an-pergunta" }, h("div", { class: "txt" }, q.texto));
      if (q.resposta) {
        bloco.append(h("div", { class: "respondida" }, "Você respondeu: " + q.resposta));
      } else {
        const grupo = h("div", { class: "opcoes" });
        for (const o of q.opcoes) grupo.append(h("button", { class: "an-opcao", onclick: () => void responderPergunta(i, o) }, h("span", { class: "mira" }), o));
        const campo = h("input", { type: "text", placeholder: "ou escreva a resposta…" });
        campo.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && campo.value.trim()) void responderPergunta(i, campo.value.trim());
        });
        bloco.append(grupo, campo);
      }
      corpo.append(bloco);
    });
    if (!p.itens.length) corpo.append(h("div", { class: "vazio" }, "Sem apontamentos além do que já foi medido."));
    for (const i of p.itens) corpo.append(linhaDeParecer(i));
  } else if (avaliacao.id) {
    corpo.append(h("div", { class: "aguardando" }, `Aguardando ${AGENTE} olhar a página…`));
  }
  painel.append(corpo);

  const campo = h("input", { type: "text", placeholder: `O que ${AGENTE} deve olhar com atenção? (opcional)` });
  const botao = h(
    "button",
    {
      class: "an-btn primario",
      disabled: avaliacao.enviando || !m,
      onclick: () => void pedirParecer(campo.value.trim()),
    },
    avaliacao.enviando ? "Enviando…" : avaliacao.parecer ? "Pedir de novo" : `Pedir parecer a ${AGENTE}`
  );
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void pedirParecer(campo.value.trim());
  });
  painel.append(h("div", { class: "rodape" }, campo, botao));
  if (avaliacao.erro) painel.append(h("div", { class: "erro" }, avaliacao.erro));
}

async function responderPergunta(indice: number, resposta: string): Promise<void> {
  if (!avaliacao.id) return;
  try {
    const r = await fetch(CFG.base + "/avaliacoes/" + encodeURIComponent(avaliacao.id) + "/resposta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ indice, resposta }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    avaliacao.parecer = ((await r.json()) as { parecer: EstadoAvaliacao["parecer"] }).parecer;
    avisar(`Resposta enviada a ${AGENTE}.`);
    renderizarAvaliacao();
  } catch (erro) {
    avisar("Não foi possível responder: " + (erro instanceof Error ? erro.message : String(erro)), 5000);
  }
}
