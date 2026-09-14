import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import ts from "typescript";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { montarOverlay } from "../server.ts";
import { criarAlvoFalso, criarProxy } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("resolver de elementos preserva o contexto após reconstruir o DOM", { skip: chrome ? false : "Chromium não encontrado", timeout: 45_000 }, () => {
  let navegador: Navegador;
  let pagina: Pagina;
  let engine: string;
  before(async () => {
    engine = ts.transpileModule(await readFile(new URL("../overlay/engine.ts", import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
  });
  beforeEach(async () => {
    await pagina.navegar("about:blank");
    await pagina.avaliar(`(() => { ${engine}\nwindow.resolverSalvo = localizarPorSeletores; window.caminhoShadowSalvo = caminhoShadow; window.seletoresSalvos = construirSeletores; })()`);
    await pagina.avaliar(`(async () => {
      document.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1><div id="host"></div><iframe id="quadro"></iframe>';
      document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<h1 id="repetido">Mesmo texto</h1><div id="interno"></div>';
      document.getElementById('host').shadowRoot.getElementById('interno').attachShadow({ mode: 'open' }).innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
      const frame = document.getElementById('quadro');
      const doc = frame.contentDocument;
      doc.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1><div id="host"></div><iframe id="interno"></iframe>';
      doc.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
      doc.getElementById('interno').contentDocument.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
      window.candidatosSalvos = [
        { tipo: 'id', valor: '#repetido', unico: true, pontos: 95 },
        { tipo: 'texto', valor: 'Mesmo texto', tag: 'h1', unico: true, pontos: 72 },
        { tipo: 'xpath', valor: '//*[@id="repetido"]', unico: true, pontos: 30 }
      ];
    })()`);
  });
  after(async () => { await navegador?.fechar(); });

  test("ID, texto e XPath resolvem dentro do iframe mesmo quando existem no pai", async () => {
    const resultado = await pagina.avaliar<boolean[]>(`candidatosSalvos.map((c) => resolverSalvo([c], ['#quadro']) === document.getElementById('quadro').contentDocument.getElementById('repetido'))`);
    assert.deepEqual(resultado, [true, true, true]);
    assert.equal(await pagina.avaliar(`resolverSalvo(candidatosSalvos, ['#quadro', '#interno']).ownerDocument === document.getElementById('quadro').contentDocument.getElementById('interno').contentDocument`), true);
  });

  test("ID e texto ficam no shadow correto; XPath não escapa ao documento", async () => {
    const resultado = await pagina.avaliar<boolean[]>(`candidatosSalvos.slice(0, 2).map((c) => resolverSalvo([c], [], ['#host']) === document.getElementById('host').shadowRoot.getElementById('repetido'))`);
    assert.deepEqual(resultado, [true, true]);
    assert.equal(await pagina.avaliar(`resolverSalvo([candidatosSalvos[2]], [], ['#host'])`), null);
    assert.equal(await pagina.avaliar(`resolverSalvo(candidatosSalvos, [], ['#host', '#interno']) === document.getElementById('host').shadowRoot.getElementById('interno').shadowRoot.getElementById('repetido')`), true);
    assert.equal(await pagina.avaliar(`resolverSalvo(candidatosSalvos, ['#quadro'], ['#host']) === document.getElementById('quadro').contentDocument.getElementById('host').shadowRoot.getElementById('repetido')`), true);
    assert.deepEqual(await pagina.avaliar(`caminhoShadowSalvo(document.getElementById('quadro').contentDocument.getElementById('host').shadowRoot.getElementById('repetido'))`), ["#host"]);
    assert.equal(await pagina.avaliar(`seletoresSalvos(document.getElementById('quadro').contentDocument.getElementById('host').shadowRoot.getElementById('repetido'), document.getElementById('quadro').contentDocument).some(c => c.tipo === 'xpath')`), false);
  });

  test("contexto ausente, errado ou ambíguo nunca cai no documento pai", async () => {
    const resultado = await pagina.avaliar(`(() => {
      const antes = [
        resolverSalvo(candidatosSalvos, ['#sumiu']),
        resolverSalvo(candidatosSalvos, ['#host']),
        resolverSalvo(candidatosSalvos, [], ['#sumiu']),
        resolverSalvo(candidatosSalvos, [], ['#repetido']),
        resolverSalvo(candidatosSalvos, ['[invalido']),
        resolverSalvo(candidatosSalvos, [], ['[invalido']),
        resolverSalvo(candidatosSalvos, null)
      ];
      document.body.append(document.createElement('iframe'));
      const host = document.createElement('div'); host.id = 'host'; document.body.append(host);
      antes.push(resolverSalvo(candidatosSalvos, ['iframe']));
      antes.push(resolverSalvo(candidatosSalvos, [], ['#host']));
      document.getElementById('quadro').remove();
      antes.push(resolverSalvo(candidatosSalvos, ['#quadro']));
      return antes;
    })()`);
    assert.deepEqual(resultado, Array(10).fill(null));
  });

  test("unicidade é verificada no DOM atual para CSS, texto e XPath", async () => {
    assert.deepEqual(await pagina.avaliar(`(() => {
      const clone = document.getElementById('repetido').cloneNode(true);
      document.body.append(clone);
      return candidatosSalvos.map(c => resolverSalvo([c]));
    })()`), [null, null, null]);
    assert.equal(await pagina.avaliar(`(() => {
      const primeiro = document.querySelector('h1'); primeiro.setAttribute('data-alvo', 'original');
      return resolverSalvo([...candidatosSalvos, {tipo:'css',valor:'[data-alvo="original"]',unico:false,pontos:20}]) === primeiro;
    })()`), true, "um candidato posterior comprovadamente único continua disponível");
  });

  test("frame opaco e mistura de shadow antes do iframe não são resolvidos fora de seu contexto", async () => {
    const resultado = await pagina.avaliar(`(async () => {
      const fechado = document.createElement('div'); fechado.id = 'fechado';
      document.body.append(fechado); fechado.attachShadow({ mode: 'closed' }).innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
      const dentro = document.createElement('iframe'); dentro.id = 'frame-no-shadow';
      document.getElementById('host').shadowRoot.append(dentro);
      dentro.contentDocument.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
      const opaco = document.createElement('iframe'); opaco.id = 'opaco'; opaco.setAttribute('sandbox', '');
      opaco.srcdoc = '<h1 id="repetido">Mesmo texto</h1>';
      await new Promise(resolve => { opaco.onload = resolve; document.body.append(opaco); });
      return [resolverSalvo(candidatosSalvos, [], ['#fechado']), resolverSalvo(candidatosSalvos, ['#frame-no-shadow']), resolverSalvo(candidatosSalvos, ['#opaco'])];
    })()`);
    assert.deepEqual(resultado, [null, null, null]);
  });

  test("overlay restaura estilos HTML/SVG no iframe e shadow e religa após HMR", async () => {
    const alvo = await criarAlvoFalso();
    const proxy = await criarProxy(alvo);
    try {
      // Esta rota é texto simples e não injeta o overlay: primeiro reconstruímos
      // o app e seu armazenamento, como estariam imediatamente antes do reload.
      await pagina.navegar(proxy.origem + "/contexto-restaurado");
      await pagina.avaliar(`(() => { ${engine}
        localStorage.clear(); sessionStorage.clear();
        document.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1><svg><circle id="forma"/></svg><iframe id="quadro"></iframe>';
        const doc = document.getElementById('quadro').contentDocument;
        doc.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1><svg><circle id="forma"/></svg><div id="host"></div>';
        doc.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
        const elementos = [doc.getElementById('repetido'), doc.getElementById('forma'), doc.getElementById('host').shadowRoot.getElementById('repetido')];
        const anotacoes = elementos.map((el, i) => ({
          id: 'anotacao-' + i, ordem: i + 1, comentario: 'Restaurar alvo ' + i,
          elemento: {seletores: construirSeletores(el, doc), meta: metadados(el), framePath: ['#quadro'], shadowPath: caminhoShadow(el), rect: rectTopo(el), computado: {}},
          alteracoes: [{propriedade: 'color', antes: '', depois: 'rgb(123, 45, 67)'}], texto: null,
          criadaEm: new Date().toISOString(), estilosOriginais: '', textoOriginal: null, confirmada: true
        }));
        localStorage.setItem('anotador-ui:' + location.pathname, JSON.stringify({anotacoes, enviadas:[], lotes:[], armado:true}));
      })()`);
      await pagina.avaliar(await montarOverlay({ base: "/__anotador", capturas: false, nome: "teste", agente: "Claude", marca: "", modelo: null, norma: null }));
      await pagina.esperarPor("window.__anotadorDebug");
      const cores = () => pagina.avaliar(`(() => {
        const doc = document.getElementById('quadro').contentDocument;
        return [document.getElementById('repetido'), document.getElementById('forma'), doc.getElementById('repetido'), doc.getElementById('forma'), doc.getElementById('host').shadowRoot.getElementById('repetido')].map(el => el.style.color);
      })()`);
      assert.deepEqual(await cores(), ["", "", "rgb(123, 45, 67)", "rgb(123, 45, 67)", "rgb(123, 45, 67)"]);
      await pagina.avaliar(`(() => {
        const doc = document.getElementById('quadro').contentDocument;
        const velho = doc.getElementById('repetido');
        const novo = velho.cloneNode(true); novo.removeAttribute('style'); velho.replaceWith(novo);
        window.dispatchEvent(new Event('resize'));
      })()`);
      await pagina.esperarPor(`document.getElementById('quadro').contentDocument.getElementById('repetido').style.color === 'rgb(123, 45, 67)'`);
      assert.deepEqual(await cores(), ["", "", "rgb(123, 45, 67)", "rgb(123, 45, 67)", "rgb(123, 45, 67)"]);
      await pagina.avaliar(`document.getElementById('quadro').remove(); window.dispatchEvent(new Event('resize'))`);
      await pagina.esperarPor(`document.getElementById('__anotador_host').shadowRoot.querySelectorAll('.an-pin.perdido').length === 3`);
      assert.equal(await pagina.avaliar(`document.getElementById('repetido').style.color`), "", "sumir o frame nunca aplica a alteração no pai");
      await pagina.avaliar(`(() => {
        const frame = document.createElement('iframe'); frame.id = 'quadro'; document.body.append(frame);
        const doc = frame.contentDocument;
        doc.body.innerHTML = '<h1 id="repetido">Mesmo texto</h1><svg><circle id="forma"/></svg><div id="host"></div>';
        doc.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<h1 id="repetido">Mesmo texto</h1>';
        window.dispatchEvent(new Event('resize'));
      })()`);
      await pagina.esperarPor(`document.getElementById('__anotador_host').shadowRoot.querySelectorAll('.an-pin.perdido').length === 0`);
      assert.deepEqual(await cores(), ["", "", "rgb(123, 45, 67)", "rgb(123, 45, 67)", "rgb(123, 45, 67)"], "o reaparecimento do contexto recupera os alvos salvos");
    } finally {
      await pagina.navegar("about:blank");
      await proxy.fechar();
      await alvo.fechar();
    }
  });
});
