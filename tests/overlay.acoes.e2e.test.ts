import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, esperarAte, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("recarregar e tirar print no overlay", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect | null>(`(() => {
      const el = ${expressao};
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    assert.ok(r && r.width && r.height, "elemento visível: " + expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const estado = () => pagina.avaliar<{ atual: Anotacao | null; pendentes: Anotacao[]; enviadas: Anotacao[]; lotes: unknown[] }>(`({
    atual: window.__anotadorDebug.atual(), pendentes: window.__anotadorDebug.pendentes(),
    enviadas: window.__anotadorDebug.enviadas(), lotes: window.__anotadorDebug.lotes()
  })`);
  const abrirRascunho = async () => {
    await clicar('document.querySelector("p.rotulo")');
    await pagina.esperarPor(noOverlay(".an-balao"));
    await clicar(noOverlay('.an-balao button[title="Propriedades do elemento"]'));
    await pagina.esperarPor(`${noOverlay(".an-painel")}.checkVisibility()`);
    await pagina.avaliar(`(() => {
      const comentario = ${noOverlay(".an-painel .cab textarea")};
      comentario.value = "Comentário ainda em edição";
      comentario.dispatchEvent(new Event("input", { bubbles: true }));
      const linha = Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha"))
        .find((el) => el.querySelector("label")?.textContent.startsWith("Tamanho da fonte"));
      const entrada = linha.querySelector("input");
      entrada.value = "23";
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    assert.equal(await pagina.avaliar('document.querySelector("p.rotulo").style.fontSize'), "23px");
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { chrome });
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1400, 900, 1);
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async () => {
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("recarregar preserva fila, rascunho, comentário e edição visual", async () => {
    await clicar('document.querySelector("#salvar span")');
    await pagina.esperarPor(`${noOverlay(".an-balao input")} === document.getElementById("__anotador_host").shadowRoot.activeElement`);
    await pagina.digitar("Anotação já confirmada");
    await pagina.pressionar("Enter");
    await pagina.esperarPor("window.__anotadorDebug.pendentes().length === 1");
    await abrirRascunho();
    const antes = await estado();
    await pagina.avaliar("window.marcadorAntesDeRecarregar = true");
    await clicar(noOverlay(".an-recarregar"));
    await esperarAte(async () => {
      try {
        return await pagina.avaliar<boolean>("!!window.__anotadorCarregado && !window.marcadorAntesDeRecarregar && !!window.__anotadorDebug.atual()");
      } catch {
        return false;
      }
    }, 10_000, 100, "a página recarrega e restaura a edição");
    assert.deepEqual(await estado(), antes);
    assert.equal(await pagina.avaliar(`${noOverlay(".an-painel .cab textarea")}.value`), "Comentário ainda em edição");
    assert.equal(await pagina.avaliar('document.querySelector("p.rotulo").style.fontSize'), "23px");
    assert.equal(await pagina.avaliar(`${noOverlay(".an-painel")}.checkVisibility()`), true);
    assert.deepEqual(await proxy.servidor.fila.listar(), [], "recarregar não envia as anotações");
  });

  test("print anexa o HTML atual sem overlay/scripts e mantém a edição sem criar lote", async () => {
    await abrirRascunho();
    const antes = await estado();
    await pagina.avaliar(`(() => {
      const originalFetch = window.fetch;
      window.enviosIndesejadosNoPrint = 0;
      window.fetch = (...args) => {
        const caminho = new URL(String(args[0]), location.href).pathname;
        if (caminho.endsWith("/anexos/captura")) {
          window.pedidoDoPrint = { metodo: args[1]?.method, corpo: JSON.parse(args[1]?.body ?? "null") };
        }
        if (args[1]?.method === "POST" && /\\/(lotes|avaliacoes)$/.test(caminho)) window.enviosIndesejadosNoPrint++;
        return originalFetch(...args);
      };
    })()`);
    await clicar(noOverlay(".an-tirar-print"));
    await pagina.esperarPor(`${noOverlay(".an-anexo img")}?.naturalWidth > 0`);
    const resultado = await pagina.avaliar<{
      metodo: string; pagina: { url: string; viewport: { largura: number; altura: number } };
      anotacaoId: string; semScriptsEOverlay: boolean; fonte: string; download: string; envios: number;
    }>(`(() => {
      const pedido = window.pedidoDoPrint;
      const html = new DOMParser().parseFromString(pedido.corpo.instantaneo, "text/html");
      return {
        metodo: pedido.metodo, pagina: pedido.corpo.pagina, anotacaoId: pedido.corpo.anotacaoId,
        semScriptsEOverlay: html.querySelectorAll("script, #__anotador_host").length === 0,
        fonte: html.querySelector("p.rotulo").getAttribute("style") ?? "",
        download: ${noOverlay(".an-anexo a[download]")}.download, envios: window.enviosIndesejadosNoPrint
      };
    })()`);
    assert.equal(resultado.metodo, "POST");
    assert.equal(resultado.pagina.url, proxy.origem + "/");
    assert.equal(resultado.pagina.viewport.largura, 1400);
    assert.equal(resultado.pagina.viewport.altura, 900);
    assert.equal(resultado.semScriptsEOverlay, true);
    assert.match(resultado.fonte, /font-size:\s*23px/, "o instantâneo preserva a prévia visual");
    assert.equal(resultado.anotacaoId, antes.atual?.id);
    assert.match(resultado.download, /^anotacao-\d+-print-1\.png$/);
    assert.equal(resultado.envios, 0);
    const depois = await estado();
    assert.ok(depois.atual);
    const { anexos, ...atualSemAnexos } = depois.atual;
    assert.equal(anexos?.length, 1);
    assert.deepEqual({ ...depois, atual: atualSemAnexos }, antes, "anexar o print preserva o restante da edição");
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
    assert.equal(await pagina.avaliar(`${noOverlay(".an-tirar-print")}.disabled`), false);
  });
});
