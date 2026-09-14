import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, esperarAte, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
const print = noOverlay(".an-tirar-print");
const confirmar = noOverlay('.an-painel [title="Confirmar"]');
const comentario = noOverlay(".an-painel .cab textarea");

describe("prints anexados às anotações", { skip: chrome ? false : "Chromium não encontrado", timeout: 90_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;

  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => {
      const el = ${expressao}; el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect();
      return {left:r.left,top:r.top,width:r.width,height:r.height};
    })()`);
    assert.ok(r.width > 0 && r.height > 0, "controle visível: " + expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const abrirPainel = async () => {
    await clicar(noOverlay('.an-balao [title="Propriedades do elemento"]'));
    await pagina.esperarPor(`${noOverlay(".an-painel")}.checkVisibility()`);
  };
  const rascunho = async (seletor = "p.rotulo", texto = "") => {
    await clicar(`document.querySelector(${JSON.stringify(seletor)})`);
    await pagina.esperarPor(noOverlay(".an-balao"));
    await abrirPainel();
    if (texto) await pagina.avaliar(`(() => { const campo = ${comentario}; campo.value = ${JSON.stringify(texto)}; campo.dispatchEvent(new Event("input", {bubbles:true})); })()`);
    return pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()");
  };
  const anexos = () => pagina.avaliar<AnexoImagem[]>("window.__anotadorDebug.atual()?.anexos ?? []");
  const capturar = async () => {
    const quantidade = (await anexos()).length;
    await clicar(print);
    await pagina.esperarPor(`window.__anotadorDebug.atual()?.anexos?.length === ${quantidade + 1}`, 20_000);
    await pagina.esperarPor(`${noOverlay(".an-anexo:last-child img")}?.naturalWidth > 0`);
    return (await anexos())[quantidade]!;
  };
  const reabrir = async () => {
    await clicar(noOverlay(".an-pin"));
    await abrirPainel();
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    navegador = await Navegador.abrir({ caminho: chrome });
  });
  beforeEach(async () => {
    // Capturas manuais reais, sem a captura automática de lote nem ponte de IA.
    proxy = await criarProxy(alvo, { chrome, capturas: false });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1400, 900);
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  afterEach(async () => { await pagina?.fechar(); await proxy?.fechar(); });
  after(async () => { await navegador?.fechar(); await alvo?.fechar(); });

  test("captura real aparece na anotação, sobrevive ao reload e segue no PNG/JSON/Markdown após Enviar", async () => {
    const atual = await rascunho();
    const anexo = await capturar();
    assert.equal(anexo.anotacaoId, atual.id);
    assert.equal(anexo.paginaUrl, proxy.origem + "/");
    assert.equal(anexo.largura, 1400);
    assert.equal(anexo.altura, 900);
    assert.equal(await pagina.avaliar<string>(`${noOverlay('.an-anexo a[title="Abrir print 1"]')}.pathname`), `/__anotador/anexos/${anexo.id}/imagem`);
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-anexo a[download]")}.download`), /\.png$/);
    assert.deepEqual(await proxy.servidor.fila.listar(), [], "tirar print não envia um lote à IA");
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
    await writeFile("/tmp/anotador-print-anexado.png", await pagina.capturar());

    await pagina.avaliar("window.marcadorDoReload = true");
    await clicar(noOverlay(".an-recarregar"));
    await esperarAte(async () => {
      try { return await pagina.avaliar<boolean>("!!window.__anotadorCarregado && !window.marcadorDoReload && !!window.__anotadorDebug.atual()"); }
      catch { return false; }
    });
    assert.deepEqual(await anexos(), [anexo]);
    await pagina.esperarPor(`${noOverlay(".an-anexo img")}?.naturalWidth === 1400`);
    assert.equal(await pagina.avaliar<string>(`${comentario}.value`), "");
    await clicar(confirmar);
    await pagina.esperarPor("window.__anotadorDebug.pendentes().length === 1");
    assert.equal(await pagina.avaliar("window.__anotadorDebug.atual()"), null, "um print basta para confirmar a anotação");
    assert.deepEqual(await proxy.servidor.fila.listar(), [], "confirmar deixa a anotação apenas na fila local");
    await clicar(noOverlay(".an-enviar"));
    await esperarAte(async () => (await proxy.servidor.fila.listar()).length === 1);
    const registro = (await proxy.servidor.fila.listar())[0]!;
    const [json, md, imagem] = await Promise.all([
      fetch(`${proxy.origem}/__anotador/lotes/${registro.id}`),
      fetch(`${proxy.origem}/__anotador/lotes/${registro.id}/md`),
      fetch(`${proxy.origem}/__anotador/anexos/${anexo.id}/imagem`),
    ]);
    assert.equal(json.status, 200);
    assert.equal(md.status, 200);
    assert.equal(imagem.status, 200);
    const corpo = await json.json() as { lote: Lote };
    assert.deepEqual(corpo.lote.anotacoes[0]?.anexos, [anexo]);
    const markdown = await md.text();
    assert.match(markdown, /### Prints anexados manualmente/);
    assert.ok(markdown.includes(anexo.caminho));
    assert.match(markdown, /!\[Print manual 1 da anotação 1\]/);
    assert.equal(imagem.headers.get("content-type"), "image/png");
    const png = Buffer.from(await imagem.arrayBuffer());
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 1400);
    assert.equal(png.readUInt32BE(20), 900);
    assert.deepEqual(await readFile(anexo.caminho), png);
  });

  test("limite de três prints, remoção e Cancelar preservam os anexos confirmados", async () => {
    await rascunho("p.rotulo", "Preservar estes prints");
    const originais = [await capturar(), await capturar(), await capturar()];
    assert.equal(await pagina.avaliar<boolean>(`${print}.disabled`), true);
    await clicar(confirmar);
    await reabrir();
    await clicar(noOverlay('.an-anexo [title="Remover print 1 da anotação"]'));
    assert.deepEqual((await anexos()).map((a) => a.id), originais.slice(1).map((a) => a.id));
    assert.equal(await pagina.avaliar<boolean>(`${print}.disabled`), false);
    await pagina.pressionar("Escape");
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.pendentes()[0].anexos"), originais, "cancelar recupera o conjunto confirmado");
    await reabrir();
    await clicar(noOverlay('.an-anexo [title="Remover print 1 da anotação"]'));
    await clicar(confirmar);
    const pendente = await pagina.avaliar<Anotacao>("window.__anotadorDebug.pendentes()[0]");
    assert.deepEqual(pendente.anexos, originais.slice(1));
    assert.equal(pendente.comentario, "Preservar estes prints");
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  });

  test("erro e captura cancelada não geram anexo fantasma nem deixam confirmar/enviar antes da resposta", async () => {
    await rascunho("#salvar", "Anotação já na fila");
    await clicar(confirmar);
    const atual = await rascunho("p.rotulo", "Comentário que deve permanecer");
    await pagina.avaliar(`(() => {
      const original = window.fetch;
      window.enviosDurantePrint = 0;
      window.modoCapturaTeste = "erro";
      window.fetch = (...args) => {
        const caminho = new URL(String(args[0]), location.href).pathname;
        if (caminho.endsWith("/anexos/captura")) {
          if (window.modoCapturaTeste === "erro") return Promise.resolve(Response.json({erro:"Falha controlada na captura"}, {status:503}));
          window.sinalCapturaTeste = args[1].signal;
          const pedido = JSON.parse(args[1].body);
          // O transporte simulado ignora abort para reproduzir uma resposta tardia.
          return new Promise(resolve => { window.concluirCapturaTeste = () => resolve(Response.json({anexo:{
            id:"11111111-1111-4111-8111-111111111111",anotacaoId:pedido.anotacaoId,paginaUrl:pedido.pagina.url,
            capturadoEm:new Date().toISOString(),largura:1400,altura:900,viewport:pedido.pagina.viewport,caminho:"/teste/imagem.png"
          }}, {status:201})); });
        }
        if (caminho.endsWith("/lotes") && args[1]?.method === "POST") window.enviosDurantePrint++;
        return original(...args);
      };
    })()`);
    await clicar(print);
    await pagina.esperarPor(`${noOverlay(".an-toast")}.textContent.includes("Falha controlada na captura")`);
    assert.deepEqual(await anexos(), []);
    assert.equal(await pagina.avaliar<boolean>(`${print}.disabled`), false);
    assert.equal(await pagina.avaliar<string>(`${comentario}.value`), atual.comentario);
    await pagina.avaliar('window.modoCapturaTeste = "pendente"');
    await clicar(print);
    await pagina.esperarPor("window.concluirCapturaTeste");
    assert.equal(await pagina.avaliar<boolean>(`${print}.disabled`), true);
    await clicar(confirmar);
    assert.equal(await pagina.avaliar<string>("window.__anotadorDebug.atual().id"), atual.id);
    assert.equal(await pagina.avaliar<number>("window.__anotadorDebug.pendentes().length"), 1);
    await clicar(noOverlay(".an-enviar"));
    assert.equal(await pagina.avaliar<number>("window.enviosDurantePrint"), 0);
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>("window.sinalCapturaTeste.aborted"), true);
    await pagina.avaliar("window.concluirCapturaTeste()");
    await pagina.esperarPor(`${print}.textContent === "Tirar print da tela"`);
    assert.equal(await pagina.avaliar("window.__anotadorDebug.atual()"), null);
    const pendentes = await pagina.avaliar<Anotacao[]>("window.__anotadorDebug.pendentes()");
    assert.equal(pendentes.length, 1);
    assert.equal(pendentes[0]?.comentario, "Anotação já na fila");
    assert.deepEqual(pendentes[0]?.anexos ?? [], []);
    assert.equal(await pagina.avaliar<number>(`${noOverlay(".an-painel")}.querySelectorAll(".an-anexo").length`), 0);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  });

  test("reabrir o painel durante a captura atualiza a miniatura e o botão reconstruídos", async () => {
    const atual = await rascunho("p.rotulo", "Print em andamento");
    await pagina.avaliar(`(() => {
      const original = window.fetch;
      window.botaoPrintAnterior = ${print};
      window.fetch = (...args) => {
        const caminho = new URL(String(args[0]), location.href).pathname;
        if (!caminho.endsWith("/anexos/captura")) return original(...args);
        const pedido = JSON.parse(args[1].body);
        return new Promise(resolve => { window.finalizarPrintReaberto = () => resolve(Response.json({anexo:{
          id:"22222222-2222-4222-8222-222222222222",anotacaoId:pedido.anotacaoId,paginaUrl:pedido.pagina.url,
          capturadoEm:new Date().toISOString(),largura:1400,altura:900,viewport:pedido.pagina.viewport,caminho:"/teste/imagem.png"
        }}, {status:201})); });
      };
    })()`);
    await clicar(print);
    await pagina.esperarPor("window.finalizarPrintReaberto");
    await clicar(noOverlay('.an-painel [title="Fechar painel"]'));
    await abrirPainel();
    assert.equal(await pagina.avaliar<boolean>("window.botaoPrintAnterior.isConnected"), false, "reabrir reconstruiu os controles");
    assert.equal(await pagina.avaliar<boolean>(`${print}.disabled`), true, "a captura permanece em andamento");
    await pagina.avaliar("window.finalizarPrintReaberto()");
    await pagina.esperarPor(`${noOverlay(".an-anexo img")} && !${print}.disabled`);
    assert.equal(await pagina.avaliar<string>("window.__anotadorDebug.atual().id"), atual.id);
    assert.equal(await pagina.avaliar<string>(`${comentario}.value`), atual.comentario);
    assert.deepEqual((await anexos()).map((anexo) => anexo.id), ["22222222-2222-4222-8222-222222222222"]);
    assert.equal(await pagina.avaliar<string>(`${noOverlay(".an-anexo img")}.getAttribute("src")`), "/__anotador/anexos/22222222-2222-4222-8222-222222222222/imagem");
    assert.equal(await pagina.avaliar<string>(`${print}.textContent`), "Tirar print da tela");
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  });
});
