import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const sombra = 'document.getElementById("__anotador_host").shadowRoot';
const no = (seletor: string) => `${sombra}.querySelector(${JSON.stringify(seletor)})`;
const titulo = no(".an-barra .titulo"), tooltip = no(".an-tooltip-url");

describe("endereço completo da página na barra", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso, proxy: ProxySobTeste, navegador: Navegador, pagina: Pagina;
  let visita = 0;
  const rect = (expressao: string) => pagina.avaliar<{ x: number; y: number; width: number; height: number; right: number; bottom: number }>(`(() => {
    const r = ${expressao}.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
  })()`);
  const pairar = async () => { const r = await rect(titulo); assert.ok(r.width > 0 && r.height > 0); await pagina.mover(r.x + r.width / 2, r.y + r.height / 2); };
  before(async () => {
    alvo = await criarAlvoFalso(); proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome }); pagina = await navegador.novaPagina();
  });
  beforeEach(async () => {
    await pagina.definirViewport(1400, 900, 1);
    await pagina.avaliar("try { localStorage.clear(); sessionStorage.clear(); } catch {}");
    await pagina.navegar(proxy.origem + "/?visita=" + ++visita);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar("history.replaceState({}, '', '/?filtro=ativos#detalhes')");
    await pagina.mover(1390, 890);
  });
  after(async () => { await navegador?.fechar(); await proxy?.fechar(); await alvo?.fechar(); });

  test("hover mostra protocolo, caminho, query e hash sem aumentar a barra ou navegar", async () => {
    const antes = await rect(no(".an-barra"));
    const navegacoes = alvo.pedidos.filter((p) => p.url.startsWith("/?")).length;
    await pairar();
    assert.equal(await pagina.avaliar(`${tooltip}.hidden`), true, "não abre imediatamente quando o mouse passa");
    await pagina.esperarPor(`!${tooltip}.hidden`);
    assert.equal(await pagina.avaliar(`${no(".an-url-completa")}.textContent`), proxy.origem + "/?filtro=ativos#detalhes");
    assert.equal(await pagina.avaliar(`${tooltip}.getAttribute("role")`), "tooltip");
    assert.deepEqual(await rect(no(".an-barra")), antes);
    const r = await rect(tooltip);
    await pagina.mover(r.x + 30, r.y + 30);
    await pagina.esperar(300);
    assert.equal(await pagina.avaliar(`${tooltip}.hidden`), false, "permite mover o mouse até o texto para selecionar/copiar");
    assert.equal(await pagina.avaliar(`getComputedStyle(${no(".an-url-completa")}).userSelect`), "text");
    await pagina.mover(1390, 890);
    await pagina.esperarPor(`${tooltip}.hidden`);
    assert.equal(alvo.pedidos.filter((p) => p.url.startsWith("/?")).length, navegacoes);
  });

  test("foco de teclado revela o endereço e Escape fecha sem cancelar a anotação", async () => {
    const alvoTexto = await rect('document.querySelector("p.rotulo")');
    await pagina.clicar(alvoTexto.x + alvoTexto.width / 2, alvoTexto.y + alvoTexto.height / 2);
    await pagina.esperarPor("window.__anotadorDebug.atual()");
    const antes = await pagina.avaliar("window.__anotadorDebug.atual()");
    await pagina.avaliar(`${titulo}.focus()`);
    await pagina.esperarPor(`!${tooltip}.hidden`);
    assert.equal(await pagina.avaliar(`${sombra}.activeElement === ${titulo}`), true);
    assert.equal(await pagina.avaliar(`${titulo}.getAttribute("aria-describedby")`), "an-endereco-completo");
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar(`${tooltip}.hidden`), true);
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.atual()"), antes);
    await pagina.pressionar("Tab");
    assert.equal(await pagina.avaliar(`${sombra}.activeElement === ${titulo}`), false);
  });

  test("endereço acompanha navegação SPA enquanto o tooltip está aberto", async () => {
    await pairar(); await pagina.esperarPor(`!${tooltip}.hidden`);
    const nova = "/outra?pagina=2&busca=design%20tokens#resultado";
    await pagina.avaliar(`history.pushState({}, "", ${JSON.stringify(nova)})`);
    await pagina.esperarPor(`${no(".an-url-completa")}.textContent === ${JSON.stringify(proxy.origem + nova)}`);
    assert.equal(await pagina.avaliar(`${no(".an-barra .titulo .url")}.textContent`), "• " + new URL(proxy.origem).host + "/outra");
    await pagina.pressionar("Escape");
    await pagina.avaliar("history.replaceState({}, '', '/?retorno=1#fim')");
    await pagina.mover(1390, 890); await pairar();
    await pagina.esperarPor(`!${tooltip}.hidden`);
    assert.equal(await pagina.avaliar(`${no(".an-url-completa")}.textContent`), proxy.origem + "/?retorno=1#fim");
  });

  test("URLs longas quebram linhas e ficam dentro de viewports de 390 e 873 pixels", async () => {
    const longa = "/?referencia=" + "abcdefghij".repeat(180) + "#trecho-final";
    for (const largura of [390, 873]) {
      await pagina.definirViewport(largura, 746, 1);
      await pagina.avaliar(`history.replaceState({}, "", ${JSON.stringify(longa)}); ${titulo}.blur()`);
      await pagina.mover(largura - 5, 740);
      await pairar(); await pagina.esperarPor(`!${tooltip}.hidden`);
      const r = await rect(tooltip), b = await rect(no(".an-barra"));
      assert.ok(r.x >= 11 && r.right <= largura - 11, `tooltip horizontal cabe em ${largura}`);
      assert.ok(r.y >= 11 && r.bottom <= 735, `tooltip vertical cabe em ${largura}`);
      assert.ok(b.x >= 0 && b.right <= largura, `barra continua dentro de ${largura}`);
      assert.equal(await pagina.avaliar(`${no(".an-url-completa")}.textContent`), proxy.origem + longa);
      assert.equal(await pagina.avaliar(`${tooltip}.scrollWidth <= ${tooltip}.clientWidth`), true);
      assert.equal(await pagina.avaliar(`getComputedStyle(${no(".an-url-completa")}).overflowWrap`), "anywhere");
      await pagina.pressionar("Escape");
    }
  });

  test("arrastar pelo endereço esconde o tooltip e continua movendo a barra", async () => {
    await pairar(); await pagina.esperarPor(`!${tooltip}.hidden`);
    const antes = await rect(no(".an-barra")), t = await rect(titulo);
    await pagina.arrastar({ x: t.x + t.width / 2, y: t.y + t.height / 2 }, { x: t.x + t.width / 2 + 50, y: t.y + t.height / 2 + 100 });
    assert.equal(await pagina.avaliar(`${tooltip}.hidden`), true);
    const depois = await rect(no(".an-barra"));
    assert.ok(depois.y > antes.y + 80);
    assert.equal(await pagina.avaliar("window.__anotadorDebug.atual()"), null);
  });
});
