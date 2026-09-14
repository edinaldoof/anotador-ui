import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { gerarMarkdown, validarLote } from "../lib/fila.ts";
import { criarAlvoFalso, criarProxy, esperarAte, loteDeExemplo, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

function contextoDeExemplo(): ContextoVisualAnotacao {
  return {
    url: "http://exemplo.local/na-selecao", capturadoEm: "2026-09-14T17:00:00.000Z",
    viewport: { largura: 873, altura: 746, dpr: 1, scrollX: 0, scrollY: 120 },
    nos: [{
      relacao: "alvo", tag: "button", seletor: { tipo: "id", valor: "#anotar", unico: true, pontos: 95 },
      framePath: [], shadowPath: ["#componente"], rect: { left: 12, top: 40, width: 300, height: 48 },
      clientWidth: 300, clientHeight: 48, scrollWidth: 460, scrollHeight: 48,
      estilos: { display: "flex", "flex-wrap": "nowrap", "min-width": "auto", "overflow-x": "hidden", "font-family": "Arial", "font-size": "16px", color: "rgb(12, 34, 56)", padding: "8px 12px" },
    }],
  };
}

test("contexto visual é opcional e limitado a três nós e propriedades conhecidas", () => {
  const legado = validarLote(loteDeExemplo());
  assert.equal(legado.anotacoes[0]!.elemento.contextoVisual, undefined);
  assert.doesNotMatch(gerarMarkdown(legado), /Contexto visual na seleção/);
  const bruto = loteDeExemplo();
  const contexto = contextoDeExemplo();
  const no = contexto.nos[0]!;
  contexto.nos = Array.from({ length: 30 }, () => ({ ...no, estilos: { ...no.estilos, "font-family": "x".repeat(1000), "segredo-alheio": "não coletar" } }));
  bruto.anotacoes[0]!.elemento.contextoVisual = contexto;
  const normalizado = validarLote(bruto).anotacoes[0]!.elemento.contextoVisual!;
  assert.equal(normalizado.nos.length, 3);
  assert.equal(normalizado.nos[0]!.estilos["font-family"]!.length, 400);
  assert.equal(normalizado.nos[0]!.estilos["segredo-alheio"], undefined);
  assert.equal(normalizado.nos[0]!.estilos["overflow-x"], "hidden");
});

test("markdown distingue as medidas da seleção do viewport de envio e mantém referências visuais", () => {
  const bruto = loteDeExemplo();
  bruto.anotacoes[0]!.elemento.contextoVisual = contextoDeExemplo();
  const md = gerarMarkdown(validarLote(bruto));
  assert.match(md, /### Contexto visual na seleção/);
  assert.match(md, /2026-09-14T17:00:00\.000Z, antes das edições/);
  assert.match(md, /URL: `http:\/\/exemplo\.local\/na-selecao`\. Viewport: 873×746/);
  assert.match(md, /Área cliente: 300×48; conteúdo rolável: 460×48/);
  assert.match(md, /Shadow DOM: `#componente`/);
  assert.match(md, /`flex-wrap: nowrap`/);
  assert.match(md, /`overflow-x: hidden`/);
  assert.match(md, /`color: rgb\(12, 34, 56\)`/);
  assert.match(md, /`font-size: 16px`/);
  assert.match(md, /não identificam sozinhas a causa/);
});

const chrome = encontrarChromium();
describe("contexto visual do clique no Chromium", { skip: chrome ? false : "Chromium não encontrado", timeout: 45_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => {
      const el = ${expressao}; el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height };
    })()`);
    await pagina.clicar(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
  };
  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1100, 800, 1);
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("alvo/pai/avô, cores e tipografia ficam visíveis e acompanham comentário sem extração global", async () => {
    await pagina.avaliar(`(() => {
      const externo = document.createElement("section"); externo.id = "contexto-externo";
      externo.style.cssText = "position:fixed;left:50px;top:180px;width:500px;padding:12px;background:white";
      const pai = document.createElement("div"); pai.id = "contexto-pai";
      pai.style.cssText = "display:flex;flex-wrap:nowrap;width:240px;overflow-x:hidden;gap:12px";
      const alvo = document.createElement("div"); alvo.id = "contexto-alvo"; alvo.textContent = "Elemento observado";
      alvo.style.cssText = "min-width:500px;flex-shrink:0;height:70px;color:rgb(12,34,56);font:17px/24px Arial;padding:8px;border:2px solid rgb(45,67,89);border-radius:6px;background:rgb(220,230,240)";
      pai.append(alvo); externo.append(pai); document.body.append(externo);
      window.extracoesAutomaticas = 0;
      const original = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes("/__anotador/extrair")) window.extracoesAutomaticas++;
        return original(...args);
      };
    })()`);
    await clicar('document.querySelector("#contexto-alvo")');
    await pagina.esperarPor("!!window.__anotadorDebug.atual()?.elemento.contextoVisual");
    const contexto = await pagina.avaliar<ContextoVisualAnotacao>("window.__anotadorDebug.atual().elemento.contextoVisual");
    assert.equal(contexto.viewport.largura, 1100);
    assert.deepEqual(contexto.nos.map((n) => n.relacao), ["alvo", "pai", "avo"]);
    assert.deepEqual(contexto.nos.map((n) => n.seletor?.valor), ["#contexto-alvo", "#contexto-pai", "#contexto-externo"]);
    assert.equal(contexto.nos[0]!.estilos["font-size"], "17px");
    assert.equal(contexto.nos[0]!.estilos.color, "rgb(12, 34, 56)");
    assert.equal(contexto.nos[0]!.estilos["border-radius"], "6px");
    assert.equal(contexto.nos[1]!.estilos["flex-wrap"], "nowrap");
    assert.equal(contexto.nos[1]!.clientWidth, 240);
    assert.ok(contexto.nos[1]!.scrollWidth > contexto.nos[1]!.clientWidth);
    await clicar(noOverlay('.an-balao button[title="Propriedades do elemento"]'));
    assert.equal(await pagina.avaliar(`${noOverlay(".an-contexto")}.open`), false);
    await clicar(noOverlay(".an-contexto summary"));
    assert.equal(await pagina.avaliar(`${noOverlay(".an-contexto")}.open`), true);
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-contexto")}.textContent`), /Conteúdo mais largo que a área interna/);
    await pagina.avaliar(`(() => {
      const painel = ${noOverlay(".an-painel")};
      const comentario = painel.querySelector(".cab textarea"); comentario.value = "Verificar tamanho e contexto do container";
      comentario.dispatchEvent(new Event("input", { bubbles:true }));
      const linha = Array.from(painel.querySelectorAll(".an-linha")).find((n) => n.querySelector("label")?.textContent.startsWith("Tamanho da fonte"));
      const entrada = linha.querySelector("input"); entrada.value = "24";
      entrada.dispatchEvent(new Event("change", { bubbles:true }));
    })()`);
    assert.equal(await pagina.avaliar('getComputedStyle(document.querySelector("#contexto-alvo")).fontSize'), "24px");
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.atual().elemento.contextoVisual"), contexto, "edição não sobrescreve a evidência anterior");
    await clicar(noOverlay(".an-painel .an-ok"));
    await pagina.esperarPor("window.__anotadorDebug.pendentes().length === 1");
    await pagina.definirViewport(1000, 760, 1);
    await clicar(noOverlay(".an-enviar"));
    await esperarAte(async () => (await proxy.servidor.fila.listar()).length === 1);
    const [registro] = await proxy.servidor.fila.listar();
    const salvo = await proxy.servidor.fila.ler(registro!.id);
    assert.deepEqual(salvo?.anotacoes[0]!.elemento.contextoVisual, contexto);
    assert.equal(salvo?.pagina.viewport.largura, 1000, "viewport de envio difere da referência da seleção");
    const md = await proxy.servidor.fila.lerMarkdown(registro!.id);
    assert.match(md!, /Contexto visual na seleção[\s\S]*Viewport: 1100×800/);
    assert.match(md!, /`font-size: 17px`/);
    assert.match(md!, /`#contexto-pai`/);
    assert.equal(await pagina.avaliar("window.extracoesAutomaticas"), 0);
  });
});
