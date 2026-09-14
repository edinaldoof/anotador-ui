// Select acessível com popup no Shadow DOM, sem depender do menu nativo do sistema.
let fecharSeletorAberto: (() => void) | null = null;
const atualizacoesSeletores = new WeakMap<HTMLSelectElement, () => void>();

function atualizarSeletorPersonalizado(sel: HTMLSelectElement): void {
  atualizacoesSeletores.get(sel)?.();
}

function criarSeletorPersonalizado(sel: HTMLSelectElement, rotulo: string, textoFechado?: (opcao: HTMLOptionElement) => string): HTMLButtonElement {
  const id = "an-seletor-" + uuid();
  const valor = h("span", { class: "an-seletor-valor" });
  const botao = h("button", {
    type: "button", class: "an-seletor-botao", role: "combobox", "aria-label": textoInterface(rotulo),
    "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": id,
  }, valor, h("span", { class: "an-seletor-seta", "aria-hidden": "true", html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4"/></svg>' }));
  sel.hidden = true;
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");
  const sincronizar = () => {
    const opcao = sel.selectedOptions[0];
    valor.textContent = opcao && textoFechado ? textoFechado(opcao) : opcao?.textContent ?? sel.value;
    botao.disabled = sel.disabled;
  };
  sincronizar();
  sel.addEventListener("change", sincronizar);
  atualizacoesSeletores.set(sel, () => {
    if (botao.getAttribute("aria-expanded") === "true") fecharSeletorAberto?.();
    sincronizar();
  });

  function abrir(inicial?: "primeiro" | "ultimo"): void {
    if (botao.disabled || !raiz) return;
    if (botao.getAttribute("aria-expanded") === "true") {
      fecharSeletorAberto?.();
      return;
    }
    fecharSeletorAberto?.();
    const opcoes = Array.from(sel.options).filter((opcao) => !opcao.disabled && !opcao.hidden);
    if (!opcoes.length) return;
    let ativo = inicial === "primeiro" ? 0 : inicial === "ultimo" ? opcoes.length - 1 : Math.max(0, opcoes.findIndex((opcao) => opcao.selected));
    const popup = h("div", { id, class: "an-seletor-popup", role: "listbox", "aria-label": textoInterface(rotulo) });
    const cancelar = new AbortController();
    const sombra = botao.getRootNode() as ShadowRoot;
    let observador: MutationObserver | null = null;
    let fechado = false;

    function fechar(focar = false): void {
      if (fechado) return;
      fechado = true;
      cancelar.abort();
      observador?.disconnect();
      popup.remove();
      botao.setAttribute("aria-expanded", "false");
      botao.removeAttribute("aria-activedescendant");
      fecharSeletorAberto = null;
      if (focar && botao.isConnected && botao.checkVisibility()) botao.focus({ preventScroll: true });
    }

    function escolher(): void {
      const escolha = opcoes[ativo];
      if (escolha && escolha.value !== sel.value) {
        sel.value = escolha.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      fechar(true);
    }

    const linhas = opcoes.map((opcao, i) => {
      const item = h("div", {
        id: id + "-" + i, class: "an-seletor-opcao", role: "option", "aria-selected": String(opcao.selected),
      }, h("span", { class: "an-seletor-opcao-texto" }, opcao.textContent ?? opcao.value),
      h("span", { class: "an-seletor-check", "aria-hidden": "true", html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 8 3 3 7-7"/></svg>' }));
      item.addEventListener("pointermove", () => marcar(i));
      item.addEventListener("pointerdown", (e) => e.preventDefault());
      item.addEventListener("click", () => { ativo = i; escolher(); });
      return item;
    });

    function marcar(indice: number, revelar = false): void {
      ativo = Math.max(0, Math.min(indice, linhas.length - 1));
      linhas.forEach((item, i) => item.classList.toggle("ativa", i === ativo));
      const item = linhas[ativo];
      if (!item) return;
      botao.setAttribute("aria-activedescendant", item.id);
      if (revelar) {
        if (item.offsetTop < popup.scrollTop) popup.scrollTop = item.offsetTop;
        else if (item.offsetTop + item.offsetHeight > popup.scrollTop + popup.clientHeight) popup.scrollTop = item.offsetTop + item.offsetHeight - popup.clientHeight;
      }
    }

    function posicionar(): void {
      if (fechado) return;
      if (!botao.isConnected || !botao.checkVisibility()) { fechar(); return; }
      const r = botao.getBoundingClientRect();
      const viewport = window.visualViewport;
      const esquerda = (viewport?.offsetLeft ?? 0) + 8;
      const topo = (viewport?.offsetTop ?? 0) + 8;
      const direita = esquerda + (viewport?.width ?? innerWidth) - 16;
      const baixo = topo + (viewport?.height ?? innerHeight) - 16;
      const corpo = botao.closest(".an-painel .corpo");
      const limite = corpo?.getBoundingClientRect();
      if (r.bottom <= topo || r.top >= baixo || (limite && (r.bottom <= limite.top || r.top >= limite.bottom))) { fechar(); return; }
      const espacoAbaixo = Math.max(0, baixo - r.bottom - 6);
      const espacoAcima = Math.max(0, r.top - topo - 6);
      const abaixo = espacoAbaixo >= Math.min(240, popup.scrollHeight) || espacoAbaixo >= espacoAcima;
      popup.style.width = Math.max(0, Math.min(Math.max(r.width, 168), direita - esquerda)) + "px";
      popup.style.maxHeight = Math.min(280, abaixo ? espacoAbaixo : espacoAcima) + "px";
      popup.style.left = Math.max(esquerda, Math.min(r.left, direita - popup.offsetWidth)) + "px";
      popup.style.top = Math.max(topo, abaixo ? r.bottom + 6 : r.top - popup.offsetHeight - 6) + "px";
      popup.dataset["lado"] = abaixo ? "baixo" : "cima";
    }

    popup.append(...linhas);
    raiz.append(popup);
    botao.setAttribute("aria-expanded", "true");
    fecharSeletorAberto = () => fechar();
    posicionar();
    if (fechado) return;
    marcar(ativo, true);
    botao.focus({ preventScroll: true });

    let busca = "";
    let ultimaBusca = 0;
    // Captura na janela vem antes dos atalhos do painel no document: Esc fecha
    // apenas este popup; o próximo Esc pode cancelar a edição normalmente.
    window.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { escolher(); return; }
      if (e.ctrlKey || e.metaKey) return;
      let tratado = true;
      if (e.key === "ArrowDown") marcar(ativo + 1, true);
      else if (e.key === "ArrowUp") marcar(ativo - 1, true);
      else if (e.key === "Home") marcar(0, true);
      else if (e.key === "End") marcar(linhas.length - 1, true);
      else if (e.key === "Enter" || e.key === " ") escolher();
      else if (e.key === "Escape") fechar(true);
      else if (e.key.length === 1 && !e.altKey) {
        const agora = Date.now();
        const letra = e.key.toLocaleLowerCase();
        busca = agora - ultimaBusca > 700 || busca === letra ? letra : busca + letra;
        ultimaBusca = agora;
        for (let passo = 1; passo <= opcoes.length; passo++) {
          const i = (ativo + passo) % opcoes.length;
          if ((opcoes[i]?.textContent ?? "").toLocaleLowerCase().startsWith(busca)) { marcar(i, true); break; }
        }
      } else tratado = false;
      if (tratado) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, { capture: true, signal: cancelar.signal });
    window.addEventListener("pointerdown", (e) => {
      const caminho = e.composedPath();
      if (!caminho.includes(botao) && !caminho.includes(popup)) fechar();
    }, { capture: true, signal: cancelar.signal });
    sombra.addEventListener("focusin", (e) => {
      const caminho = e.composedPath();
      if (!caminho.includes(botao) && !caminho.includes(popup)) fechar();
    }, { signal: cancelar.signal });
    window.addEventListener("resize", posicionar, { signal: cancelar.signal });
    window.addEventListener("scroll", posicionar, { capture: true, passive: true, signal: cancelar.signal });
    sombra.addEventListener("scroll", posicionar, { capture: true, passive: true, signal: cancelar.signal });
    window.visualViewport?.addEventListener("resize", posicionar, { signal: cancelar.signal });
    window.visualViewport?.addEventListener("scroll", posicionar, { signal: cancelar.signal });
    observador = new MutationObserver(posicionar);
    observador.observe(raiz, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  }

  botao.addEventListener("click", () => abrir());
  botao.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      abrir(e.key === "Home" ? "primeiro" : e.key === "End" ? "ultimo" : undefined);
    }
  });
  return botao;
}

interface CorAnotador { r: number; g: number; b: number; a: number }

function lerCorAnotador(valor: string): CorAnotador | null {
  const texto = valor.trim();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(texto)?.[1];
  if (hex) {
    const longo = hex.length < 5 ? Array.from(hex, (v) => v + v).join("") : hex;
    return { r: parseInt(longo.slice(0, 2), 16), g: parseInt(longo.slice(2, 4), 16), b: parseInt(longo.slice(4, 6), 16), a: longo.length === 8 ? parseInt(longo.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(texto);
  if (rgb) return { r: Math.min(255, Number(rgb[1])), g: Math.min(255, Number(rgb[2])), b: Math.min(255, Number(rgb[3])), a: Math.min(1, Number(rgb[4] ?? 1)) };
  if (!CSS.supports("color", texto)) return null;
  // O canvas converte também cores CSS como oklch/display-p3 para o espaço sRGB
  // dos controles, sem inserir elementos ou estilos na página anotada.
  const tela = document.createElement("canvas");
  tela.width = tela.height = 1;
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = texto;
  ctx.fillRect(0, 0, 1, 1);
  const canais = ctx.getImageData(0, 0, 1, 1).data;
  return { r: canais[0] ?? 0, g: canais[1] ?? 0, b: canais[2] ?? 0, a: (canais[3] ?? 255) / 255 };
}

function criarSeletorCor(rotulo: string, ler: () => string, aplicar: (valor: string) => void): HTMLButtonElement {
  const id = "an-cor-" + uuid();
  const botao = h("button", { type: "button", class: "sw an-cor-abrir", "aria-label": textoInterface("Escolher " + rotulo.toLocaleLowerCase()), "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": id, title: textoInterface("Escolher " + rotulo.toLocaleLowerCase()) });
  botao.style.background = ler();
  botao.addEventListener("click", () => {
    if (!raiz) return;
    if (botao.getAttribute("aria-expanded") === "true") { fecharSeletorAberto?.(); return; }
    fecharSeletorAberto?.();
    let cor = lerCorAnotador(ler()) ?? { r: 0, g: 0, b: 0, a: 1 };
    let matiz = 0, saturacao = 0, brilho = 0;
    function atualizarHsv(): void {
      const r = cor.r / 255, g = cor.g / 255, b = cor.b / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      brilho = max; saturacao = max ? delta / max : 0;
      if (delta) matiz = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
    }
    atualizarHsv();
    function atualizarRgb(): void {
      const c = brilho * saturacao, x = c * (1 - Math.abs((matiz / 60) % 2 - 1)), m = brilho - c;
      const canais = matiz < 60 ? [c, x, 0] : matiz < 120 ? [x, c, 0] : matiz < 180 ? [0, c, x] : matiz < 240 ? [0, x, c] : matiz < 300 ? [x, 0, c] : [c, 0, x];
      [cor.r, cor.g, cor.b] = canais.map((v) => Math.round((v + m) * 255)) as [number, number, number];
    }
    const popup = h("div", { id, class: "an-cor-popup", role: "dialog", "aria-label": textoInterface(rotulo) });
    const fecharBotao = h("button", { type: "button", class: "an-ico", "aria-label": textoInterface("Fechar seletor de cor"), title: textoInterface("Fechar seletor de cor"), html: ICONES.fechar });
    const ponto = h("span", { class: "an-cor-ponto", "aria-hidden": "true" });
    const plano = h("div", { class: "an-cor-plano", role: "slider", tabindex: 0, "aria-label": textoInterface("Saturação e brilho"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-describedby": id + "-ajuda" }, ponto);
    const ajuda = h("span", { id: id + "-ajuda", class: "an-cor-ajuda" }, textoInterface("Setas esquerda e direita ajustam a saturação; acima e abaixo ajustam o brilho."));
    const matizInput = h("input", { type: "range", min: 0, max: 360, step: 1, class: "an-cor-matiz", "aria-label": textoInterface("Matiz") });
    const alpha = h("input", { type: "range", min: 0, max: 100, step: 1, class: "an-cor-alpha", "aria-label": textoInterface("Opacidade da cor") });
    const alphaValor = h("span", { class: "an-cor-percentual" });
    const hex = h("input", { type: "text", class: "an-cor-hex mono", "aria-label": textoInterface("Cor hexadecimal"), spellcheck: "false", autocomplete: "off", maxlength: 9 });
    const rgbInputs = (["r", "g", "b"] as const).map((canal, i) => h("input", { type: "number", min: 0, max: 255, step: 1, inputmode: "numeric", "aria-label": textoInterface(["Vermelho", "Verde", "Azul"][i] ?? ""), "data-canal": canal }));
    const cabecalho = h("div", { class: "an-cor-cab" }, h("strong", null, textoInterface(rotulo)), fecharBotao);
    popup.append(cabecalho, plano, ajuda,
      h("label", { class: "an-cor-faixa" }, h("span", null, textoInterface("Matiz")), matizInput),
      h("label", { class: "an-cor-faixa" }, h("span", null, textoInterface("Opacidade")), alpha, alphaValor),
      h("div", { class: "an-cor-valores" }, h("label", { class: "an-cor-hex-campo" }, h("span", null, "HEX"), hex),
        ...rgbInputs.map((entrada, i) => h("label", null, h("span", null, ["R", "G", "B"][i]), entrada))));
    const cancelar = new AbortController();
    const sombra = botao.getRootNode() as ShadowRoot;
    let fechado = false;
    let observador: MutationObserver | null = null;
    const fecharAtual = () => fechar();
    function fechar(focar = false): void {
      if (fechado) return;
      fechado = true; cancelar.abort(); observador?.disconnect(); popup.remove();
      botao.setAttribute("aria-expanded", "false");
      if (fecharSeletorAberto === fecharAtual) fecharSeletorAberto = null;
      if (focar && botao.isConnected && botao.checkVisibility()) botao.focus({ preventScroll: true });
    }
    function sincronizar(emitir = true, preservarHex = false): void {
      const valor = cor.a >= 1 ? `rgb(${cor.r}, ${cor.g}, ${cor.b})` : `rgba(${cor.r}, ${cor.g}, ${cor.b}, ${Math.round(cor.a * 1000) / 1000})`;
      plano.style.backgroundColor = `hsl(${matiz}, 100%, 50%)`;
      ponto.style.left = saturacao * 100 + "%"; ponto.style.top = (1 - brilho) * 100 + "%";
      plano.setAttribute("aria-valuenow", String(Math.round(saturacao * 100)));
      plano.setAttribute("aria-valuetext", `Saturação ${Math.round(saturacao * 100)}%, brilho ${Math.round(brilho * 100)}%`);
      matizInput.value = String(matiz); alpha.value = String(Math.round(cor.a * 100)); alphaValor.textContent = alpha.value + "%";
      alpha.style.setProperty("--an-cor-rgb", `${cor.r}, ${cor.g}, ${cor.b}`);
      if (!preservarHex) hex.value = "#" + [cor.r, cor.g, cor.b, ...(cor.a < 1 ? [Math.round(cor.a * 255)] : [])].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
      rgbInputs.forEach((entrada, i) => entrada.value = String([cor.r, cor.g, cor.b][i]));
      hex.removeAttribute("aria-invalid");
      if (emitir) { botao.style.background = valor; aplicar(valor); }
    }
    function posicionar(): void {
      if (fechado) return;
      if (!botao.isConnected || !botao.checkVisibility()) { fechar(); return; }
      const r = botao.getBoundingClientRect(), viewport = window.visualViewport;
      const esquerda = (viewport?.offsetLeft ?? 0) + 8, topo = (viewport?.offsetTop ?? 0) + 8;
      const direita = esquerda + (viewport?.width ?? innerWidth) - 16, baixo = topo + (viewport?.height ?? innerHeight) - 16;
      const corpo = botao.closest(".an-painel .corpo")?.getBoundingClientRect();
      if (r.bottom <= topo || r.top >= baixo || (corpo && (r.bottom <= corpo.top || r.top >= corpo.bottom))) { fechar(); return; }
      popup.style.width = Math.max(0, Math.min(292, direita - esquerda)) + "px";
      popup.style.maxHeight = Math.max(0, baixo - topo) + "px";
      const altura = popup.offsetHeight;
      const abaixo = baixo - r.bottom - 8 >= altura || baixo - r.bottom >= r.top - topo;
      popup.style.left = Math.max(esquerda, Math.min(r.left, direita - popup.offsetWidth)) + "px";
      popup.style.top = Math.max(topo, Math.min(abaixo ? r.bottom + 8 : r.top - altura - 8, baixo - altura)) + "px";
    }
    fecharBotao.addEventListener("click", () => fechar(true));
    let ponteiro: number | null = null;
    function escolherPonto(e: PointerEvent): void {
      const r = plano.getBoundingClientRect();
      saturacao = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      brilho = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      atualizarRgb(); sincronizar();
    }
    plano.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); ponteiro = e.pointerId; plano.setPointerCapture(e.pointerId); plano.focus({ preventScroll: true }); escolherPonto(e); });
    plano.addEventListener("pointermove", (e) => { if (ponteiro === e.pointerId) escolherPonto(e); });
    plano.addEventListener("pointerup", () => ponteiro = null);
    plano.addEventListener("pointercancel", () => ponteiro = null);
    plano.addEventListener("lostpointercapture", () => ponteiro = null);
    plano.addEventListener("keydown", (e) => {
      const passo = e.shiftKey ? .1 : .01;
      if (e.key === "ArrowLeft") saturacao = Math.max(0, saturacao - passo);
      else if (e.key === "ArrowRight") saturacao = Math.min(1, saturacao + passo);
      else if (e.key === "ArrowUp") brilho = Math.min(1, brilho + passo);
      else if (e.key === "ArrowDown") brilho = Math.max(0, brilho - passo);
      else return;
      e.preventDefault(); e.stopPropagation(); atualizarRgb(); sincronizar();
    });
    matizInput.addEventListener("input", () => { matiz = Number(matizInput.value); atualizarRgb(); sincronizar(); });
    alpha.addEventListener("input", () => { cor.a = Number(alpha.value) / 100; sincronizar(); });
    function aplicarHex(preservarTexto: boolean): void {
      const nova = /^#?([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex.value.trim()) ? lerCorAnotador("#" + hex.value.trim().replace(/^#/, "")) : null;
      if (!nova) { hex.setAttribute("aria-invalid", "true"); return; }
      cor = nova; atualizarHsv(); sincronizar(true, preservarTexto);
    }
    // Atualiza a prévia antes que um clique fora remova o campo; manter o texto
    // evita mudar o cursor ou expandir #RGB no meio da digitação de #RRGGBB.
    hex.addEventListener("input", () => aplicarHex(true));
    hex.addEventListener("change", () => aplicarHex(false));
    hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hex.dispatchEvent(new Event("change")); } });
    rgbInputs.forEach((entrada, i) => entrada.addEventListener("input", () => {
      if (entrada.value === "" || !entrada.validity.valid) return;
      cor[(["r", "g", "b"] as const)[i]!] = Math.round(Number(entrada.value)); atualizarHsv(); sincronizar();
    }));
    sincronizar(false); raiz.append(popup); botao.setAttribute("aria-expanded", "true"); fecharSeletorAberto = fecharAtual;
    posicionar(); if (fechado) return; plano.focus({ preventScroll: true });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fechar(true); } }, { capture: true, signal: cancelar.signal });
    window.addEventListener("pointerdown", (e) => { if (!e.composedPath().includes(botao) && !e.composedPath().includes(popup)) fechar(); }, { capture: true, signal: cancelar.signal });
    sombra.addEventListener("focusin", (e) => { if (!e.composedPath().includes(botao) && !e.composedPath().includes(popup)) fechar(); }, { signal: cancelar.signal });
    window.addEventListener("resize", posicionar, { signal: cancelar.signal });
    window.addEventListener("scroll", posicionar, { capture: true, passive: true, signal: cancelar.signal });
    sombra.addEventListener("scroll", posicionar, { capture: true, passive: true, signal: cancelar.signal });
    window.visualViewport?.addEventListener("resize", posicionar, { signal: cancelar.signal });
    window.visualViewport?.addEventListener("scroll", posicionar, { signal: cancelar.signal });
    observador = new MutationObserver(posicionar);
    observador.observe(raiz, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  });
  return botao;
}
