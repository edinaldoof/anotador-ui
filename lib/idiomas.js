// Preferência da interface. Não acessa áudio, conteúdo do app ou serviços externos.
(() => {
  "use strict";
  if (window.__anotador_i18n) return;
  const chave = "anotador-ui:idioma-interface";
  const idiomas = ["pt-BR", "en", "es"];
  const validar = valor => idiomas.includes(valor) ? valor : "pt-BR";
  let atual = "pt-BR";
  try { atual = validar(localStorage.getItem(chave)); } catch { /* navegador sem armazenamento */ }
  const dicionarios = { en: Object.create(null), es: Object.create(null) };
  const ouvintes = new Set();
  const fontes = new WeakMap();
  function t(texto, parametros) {
    const fonte = String(texto);
    const traducao = atual === "pt-BR" ? fonte : dicionarios[atual][fonte] ?? fonte;
    return traducao.replace(/\{([a-zA-Z_]\w*)\}/g, (inteiro, nome) => {
      if (!parametros || !Object.prototype.hasOwnProperty.call(parametros, nome)) return inteiro;
      const valor = parametros[nome];
      return typeof valor === "string" || typeof valor === "number" ? String(valor) : inteiro;
    });
  }
  function registrar(catalogo) {
    if (!catalogo || typeof catalogo !== "object") return;
    for (const idioma of ["en", "es"]) {
      if (!catalogo[idioma] || typeof catalogo[idioma] !== "object") continue;
      for (const [fonte, traducao] of Object.entries(catalogo[idioma])) {
        if (typeof traducao === "string") dicionarios[idioma][fonte] = traducao;
      }
    }
  }
  function publicar(idioma) {
    if (idioma === atual) return;
    atual = idioma;
    for (const ouvinte of ouvintes) { try { ouvinte(atual); } catch (erro) { console.error("Anotador: falha ao atualizar idioma", erro); } }
    window.dispatchEvent(new CustomEvent("anotador:idioma", { detail: { idioma: atual } }));
  }
  function definir(idioma) {
    const escolhido = validar(idioma);
    try { localStorage.setItem(chave, escolhido); } catch { /* preferência disponível nesta página */ }
    publicar(escolhido);
  }
  function observar(ouvinte) { ouvintes.add(ouvinte); return () => ouvintes.delete(ouvinte); }
  // Somente elementos marcados pelo Anotador. Nunca percorre texto do site alvo.
  function traduzir(raiz) {
    if (!raiz?.querySelectorAll) return;
    const atributos = ["title", "placeholder", "aria-label", "aria-description", "alt"];
    const seletor = ["[data-i18n]", ...atributos.map(nome => "[data-i18n-" + nome + "]")].join(",");
    const elementos = [...(raiz.matches?.(seletor) ? [raiz] : []), ...raiz.querySelectorAll(seletor)];
    for (const elemento of elementos) {
      let parametros;
      const bruto = elemento.getAttribute("data-i18n-params");
      if (bruto && bruto.length <= 4000) { try { parametros = JSON.parse(bruto); } catch { /* parâmetros inválidos permanecem literais */ } }
      const originais = fontes.get(elemento) ?? Object.create(null);
      for (const atributo of ["", ...atributos]) {
        const marca = "data-i18n" + (atributo ? "-" + atributo : "");
        if (!elemento.hasAttribute(marca)) continue;
        const explicito = elemento.getAttribute(marca);
        const fonte = explicito || originais[marca] || (atributo ? elemento.getAttribute(atributo) : elemento.textContent) || "";
        originais[marca] = fonte;
        if (atributo) elemento.setAttribute(atributo, t(fonte, parametros));
        else elemento.textContent = t(fonte, parametros);
      }
      fontes.set(elemento, originais);
    }
  }
  window.addEventListener("storage", evento => {
    if (evento.key === chave) publicar(validar(evento.newValue));
    else if (evento.key === null) publicar("pt-BR");
  });
  window.__anotador_i18n = Object.freeze({ t, registrar, idioma: () => atual, definir, observar, traduzir });
})();
