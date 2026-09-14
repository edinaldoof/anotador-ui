// Explorador do sistema de design: cruza o que o projeto declara (tokens lidos do CSS,
// que o servidor entrega em /design) com o que a página realmente pinta (medido aqui).
// O que não casa é o achado: cor sem token, medida fora da escala, token que ninguém usa.

interface TokenDoProjeto {
  nome: string;
  categoria: string;
  valor: string;
  px?: number;
  rgb?: string;
  intencao?: string;
  arquivo: string;
  linha: number;
}

interface SistemaDoProjeto {
  tokens: TokenDoProjeto[];
  espaco: { base: number | null; dentro: number; total: number; fora: Array<{ nome: string; px: number }> };
  escalaDeTexto: number[];
  porCor: Record<string, string[]>;
  arquivos: string[];
}

interface ValorPintado {
  chave: string;
  rotulo: string;
  usos: number;
  elementos: ElementoEstilizavel[];
  /** propriedades em que o valor aparece, para explicar o uso */
  propriedades: Set<string>;
  tokens: string[];
  intencao?: string;
  foraDoSistema: boolean;
  motivo?: string;
}

type AbaDesign = "cor" | "texto" | "espaco" | "raio" | "fora";

interface EstadoDesign {
  aberto: boolean;
  aba: AbaDesign;
  sistema: SistemaDoProjeto | null;
  erro: string | null;
  grupos: Record<string, ValorPintado[]>;
  medidoEm: number;
}

const design: EstadoDesign = { aberto: false, aba: "cor", sistema: null, erro: null, grupos: {}, medidoEm: 0 };

function normalizarCor(valor: string): string | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(valor);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) < 0.05) return null;
  return `rgb(${Number(m[1])}, ${Number(m[2])}, ${Number(m[3])})`;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

// Percorre o que está pintado na tela e agrupa por valor, guardando quem usa cada um.
function medirPagina(): Record<string, ValorPintado[]> {
  const sistema = design.sistema;
  const grupos: Record<string, Map<string, ValorPintado>> = { cor: new Map(), texto: new Map(), espaco: new Map(), raio: new Map() };
  const guardar = (categoria: string, chave: string, rotulo: string, propriedade: string, el: ElementoEstilizavel) => {
    const mapa = grupos[categoria];
    if (!mapa) return;
    let item = mapa.get(chave);
    if (!item) {
      item = { chave, rotulo, usos: 0, elementos: [], propriedades: new Set(), tokens: [], foraDoSistema: false };
      mapa.set(chave, item);
    }
    item.usos++;
    item.propriedades.add(propriedade);
    if (item.elementos.length < 60) item.elementos.push(el);
  };

  let vistos = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (vistos > 4000) break;
    if (!estilizavel(el) || ignorar(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    vistos++;

    for (const p of ["color", "background-color", "border-top-color"]) {
      if (p === "border-top-color" && parseFloat(cs.borderTopWidth) < 0.5) continue;
      const cor = normalizarCor(cs.getPropertyValue(p));
      if (cor) guardar("cor", cor, cor, p.replace("-top", ""), el);
    }
    const tamanho = parseFloat(cs.fontSize);
    if (Number.isFinite(tamanho) && (el.textContent ?? "").trim()) guardar("texto", String(arredondar(tamanho)), arredondar(tamanho) + "px", "font-size", el);
    for (const p of ["padding-top", "padding-left", "margin-top", "margin-left", "gap"]) {
      const n = parseFloat(cs.getPropertyValue(p));
      if (!Number.isFinite(n) || n <= 0) continue;
      guardar("espaco", String(arredondar(n)), arredondar(n) + "px", p.replace(/-(top|left)$/, ""), el);
    }
    const raio = parseFloat(cs.borderTopLeftRadius);
    if (Number.isFinite(raio) && raio > 0) guardar("raio", String(arredondar(raio)), arredondar(raio) + "px", "border-radius", el);
  }

  const saida: Record<string, ValorPintado[]> = {};
  for (const [categoria, mapa] of Object.entries(grupos)) {
    const lista = Array.from(mapa.values());
    for (const item of lista) classificar(categoria, item, sistema);
    saida[categoria] = lista.sort((a, b) => b.usos - a.usos);
  }
  return saida;
}

// Diz se o valor pertence ao sistema declarado e, quando não, por quê.
function classificar(categoria: string, item: ValorPintado, sistema: SistemaDoProjeto | null): void {
  if (!sistema) return;
  if (categoria === "cor") {
    item.tokens = sistema.porCor[item.chave] ?? [];
    if (!item.tokens.length && item.chave !== "rgb(0, 0, 0)" && item.chave !== "rgb(255, 255, 255)") {
      item.foraDoSistema = true;
      item.motivo = "cor sem token no projeto";
    }
    return;
  }
  const px = Number(item.chave);
  const casa = sistema.tokens.filter((t) => t.px !== undefined && Math.abs((t.px as number) - px) < 0.01 && (categoria !== "raio" || t.categoria === "raio"));
  item.tokens = casa.map((t) => t.nome);
  const comIntencao = casa.find((t) => t.intencao);
  if (comIntencao?.intencao) item.intencao = comIntencao.intencao;
  // Valor que casa com um token declarado está no sistema, mesmo fora do passo: o projeto
  // decidiu que aquele meio-passo existe. Sem isto o painel acusa o próprio --spacing-hairline.
  if (item.tokens.length) return;
  if (categoria === "espaco" && sistema.espaco.base && Math.abs(px % sistema.espaco.base) > 0.01) {
    item.foraDoSistema = true;
    item.motivo = `não é múltiplo de ${sistema.espaco.base}px, o passo do projeto`;
  }
  if (categoria === "texto" && sistema.escalaDeTexto.length && !sistema.escalaDeTexto.includes(px)) {
    item.foraDoSistema = true;
    item.motivo = "tamanho fora da escala de texto declarada";
  }
}

async function carregarSistema(): Promise<void> {
  try {
    const resp = await fetch(CFG.base + "/design", { cache: "no-store" });
    const corpo = (await resp.json()) as { ok: boolean; sistema: SistemaDoProjeto | null; erro?: string };
    design.sistema = corpo.sistema;
    design.erro = corpo.sistema ? null : (corpo.erro ?? "o servidor não leu o código-fonte");
  } catch (erro) {
    design.sistema = null;
    design.erro = erro instanceof Error ? erro.message : String(erro);
  }
}

function realcar(elementos: ElementoEstilizavel[]): void {
  ui.camadaRealces.textContent = "";
  for (const el of elementos.slice(0, 60)) {
    if (!el.isConnected) continue;
    const r = rectTopo(el);
    if (r.width < 1 || r.height < 1) continue;
    ui.camadaRealces.append(h("div", { class: "an-realce", style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` }));
  }
}

function limparRealces(): void {
  ui.camadaRealces.textContent = "";
}

async function alternarExplorador(): Promise<void> {
  if (design.aberto) {
    fecharExplorador();
    return;
  }
  design.aberto = true;
  ui.btnDesign.classList.add("ativo");
  if (!ui.design) {
    ui.design = h("div", { class: "an-design" });
    raiz?.append(ui.design);
  }
  ui.design.hidden = false;
  renderizarExplorador();
  if (!design.sistema) await carregarSistema();
  design.grupos = medirPagina();
  design.medidoEm = Date.now();
  renderizarExplorador();
}

function fecharExplorador(): void {
  design.aberto = false;
  ui.btnDesign.classList.remove("ativo");
  if (ui.design) ui.design.hidden = true;
  limparRealces();
}

function contarFora(): number {
  return Object.values(design.grupos).reduce((s, lista) => s + lista.filter((i) => i.foraDoSistema).length, 0);
}

function linhaDeValor(categoria: string, item: ValorPintado): HTMLElement {
  const amostra =
    categoria === "cor"
      ? h("span", { class: "amostra cor", style: `background:${item.chave}` })
      : h("span", { class: "amostra medida" }, item.rotulo.replace("px", ""));
  const nomes = item.tokens.length ? item.tokens.slice(0, 2).join(", ") + (item.tokens.length > 2 ? ` +${item.tokens.length - 2}` : "") : item.foraDoSistema ? "sem token" : "—";
  const linha = h(
    "div",
    {
      class: "an-valor" + (item.foraDoSistema ? " fora" : ""),
      title: [item.rotulo, Array.from(item.propriedades).join(", "), item.intencao, item.motivo].filter(Boolean).join(" · "),
      onmouseenter: () => realcar(item.elementos),
      onmouseleave: limparRealces,
      onclick: () => {
        const alvo = item.elementos.find((el) => el.isConnected);
        if (!alvo) return;
        fecharExplorador();
        selecionarElemento(alvo);
      },
    },
    amostra,
    h(
      "span",
      { class: "col" },
      h("span", { class: "titulo mono" }, categoria === "cor" ? item.chave : item.rotulo),
      h("span", { class: "sub" }, nomes + (item.intencao ? " · " + item.intencao : ""))
    ),
    h("span", { class: "usos" }, String(item.usos))
  );
  return linha;
}

function renderizarExplorador(): void {
  const painel = ui.design;
  if (!painel) return;
  painel.textContent = "";
  const alca = h("span", { class: "an-alca", html: ICONES.alca, title: "Arrastar" });
  const sistema = design.sistema;
  const resumo = sistema
    ? `${sistema.tokens.length} tokens · passo de ${sistema.espaco.base ?? "?"}px · ${contarFora()} fora do sistema`
    : design.erro
      ? design.erro
      : "lendo o projeto…";
  const cab = h(
    "div",
    { class: "cab" },
    alca,
    h("span", { class: "an-ico", style: "background:var(--an-superficie-alta)", html: ICONES.paleta }),
    h("div", { class: "tit" }, textoInterface("Sistema de design"), h("span", { class: "sub" }, resumo)),
    h("button", {
      class: "an-ico",
      title: "Medir a página de novo",
      html: ICONES.recarregar,
      onclick: () => {
        design.grupos = medirPagina();
        renderizarExplorador();
      },
    }),
    h("button", { class: "an-ico", title: textoInterface("Fechar"), html: ICONES.fechar, onclick: fecharExplorador })
  );
  painel.append(cab);
  tornarArrastavel(painel, [alca, cab], "design");

  const abas: Array<[AbaDesign, string]> = [
    ["cor", "Cores"],
    ["texto", "Texto"],
    ["espaco", "Espaço"],
    ["raio", "Raio"],
    ["fora", "Fora do sistema"],
  ];
  const barraAbas = h("div", { class: "abas" });
  for (const [id, rotulo] of abas) {
    const quantos = id === "fora" ? contarFora() : (design.grupos[id]?.length ?? 0);
    barraAbas.append(
      h(
        "button",
        {
          class: "aba" + (design.aba === id ? " ativa" : "") + (id === "fora" && quantos ? " alerta" : ""),
          onclick: () => {
            design.aba = id;
            renderizarExplorador();
          },
        },
        rotulo,
        h("span", { class: "n" }, String(quantos))
      )
    );
  }
  painel.append(barraAbas);

  const corpo = h("div", { class: "corpo" });
  if (design.aba === "fora") {
    const todos: Array<[string, ValorPintado]> = [];
    for (const [categoria, lista] of Object.entries(design.grupos)) for (const i of lista) if (i.foraDoSistema) todos.push([categoria, i]);
    if (!todos.length) corpo.append(h("div", { class: "vazio" }, sistema ? "Nada pintado nesta página escapa do sistema declarado." : "Sem o código-fonte não dá para comparar."));
    for (const [categoria, item] of todos.sort((a, b) => b[1].usos - a[1].usos)) {
      const linha = linhaDeValor(categoria, item);
      linha.append(h("span", { class: "motivo" }, item.motivo ?? ""));
      corpo.append(linha);
    }
  } else {
    const lista = design.grupos[design.aba] ?? [];
    if (!lista.length) corpo.append(h("div", { class: "vazio" }, "Nada medido nesta página."));
    for (const item of lista) corpo.append(linhaDeValor(design.aba, item));
  }
  painel.append(corpo);
  painel.append(
    h(
      "div",
      { class: "rodape" },
      h("span", { class: "dica" }, "Passe o mouse para ver onde cada valor aparece · clique para selecionar"),
      sistema ? h("span", { class: "fonte mono" }, sistema.arquivos[0] ?? "") : null
    )
  );
}
