import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, Pagina, encontrarChromium } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const no = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
const campo = no(".an-balao input");
const mic = no('[title="Ditar comentário"]');
const ambiente = `(() => {
  window.pedidosGravacao = []; window.paradasMicrofone = 0; window.enviosDeMensagem = 0;
  window.pedirPermissao = 0;
  window.avancarTempoGravacao = 0; const agora = Date.now.bind(Date); Date.now = () => agora() + window.avancarTempoGravacao;
  const stream = {getTracks: () => [{stop: () => window.paradasMicrofone++}]};
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable:true, value: (opcoes) => {
    window.pedirPermissao++; window.opcoesMicrofone = opcoes;
    if(window.recusarPermissao) return Promise.reject(new DOMException('negado','NotAllowedError'));
    if(window.atrasarPermissao) return new Promise(resolve => window.permitirGravacao = () => resolve(stream));
    return Promise.resolve(stream);
  }});
  class Gravador extends EventTarget {
    static isTypeSupported(mime) { return mime.startsWith('audio/webm'); }
    constructor(stream,opcoes) { super(); this.mimeType=opcoes?.mimeType || 'audio/webm'; this.state='inactive'; window.gravadorTeste=this; }
    start() { this.state='recording'; }
    emitirParte(texto) { this.dispatchEvent(new BlobEvent('dataavailable',{data:new Blob([texto],{type:this.mimeType})})); }
    stop() { if(this.state==='inactive') return; this.state='inactive'; queueMicrotask(() => {
      this.dispatchEvent(new BlobEvent('dataavailable',{data:new Blob(['audio-sintetico-teste'],{type:this.mimeType})}));
      this.dispatchEvent(new Event('stop'));
    }); }
  }
  window.MediaRecorder = Gravador;
  const original = window.fetch;
  window.fetch = (...args) => {
    const path = new URL(String(args[0]),location.href).pathname;
    if(path.endsWith('/voz/capacidade')) return Promise.resolve(Response.json({disponivel:true}));
    if(path.endsWith('/voz/transcrever')) {
      const pedido = JSON.parse(args[1].body); window.pedidosGravacao.push(pedido);
      if(pedido.parcial) {
        if(window.erroParcial) return Promise.resolve(Response.json({erro:'Prévia indisponível'},{status:503}));
        if(window.atrasarParcial) return new Promise(resolve => window.responderParcial = () => resolve(Response.json({texto:window.textoParcial ?? 'trecho provisório'})));
        return Promise.resolve(Response.json({texto:window.textoParcial ?? 'trecho provisório'}));
      }
      if(window.atrasarTranscricao) return new Promise(resolve => window.responderGravacao = () => resolve(Response.json({texto:'texto atrasado'})));
      if(window.erroTranscricao) return Promise.resolve(Response.json({erro:'Falha de transcrição simulada'},{status:503}));
      return Promise.resolve(Response.json({texto:window.textoGravacao ?? 'aumente o tamanho da fonte'}));
    }
    if(args[1]?.method==='POST' && ['lotes','mensagens','conversa'].some(s => path.endsWith('/'+s))) window.enviosDeMensagem++;
    return original(...args);
  };
})()`;

describe("gravação e transcrição no Anotador", { skip: chrome ? false : "Chromium necessário", timeout: 90000 }, () => {
  let alvo: AlvoFalso, proxy: ProxySobTeste, navegador: Navegador, pagina: Pagina;
  let numero = 0;
  const clicar = async (expressao: string) => {
    // A prévia muda a altura do balão; o ResizeObserver reposiciona-o no frame
    // seguinte. Aguarda o layout antes de medir as coordenadas do clique real.
    await pagina.avaliar("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const r = await pagina.avaliar<Rect>(`(() => { const e=${expressao}; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    assert.ok(r.width && r.height, "controle visível");
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const texto = () => pagina.avaliar<string>(`${campo}.value`);
  const terminou = () => pagina.esperarPor(`!${no(".an-voz-controles")}`);
  const comecar = async () => {
    await clicar(mic);
    await pagina.esperarPor('window.gravadorTeste?.state === "recording"');
  };
  before(async () => {
    alvo = await criarAlvoFalso(); proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome }); pagina = await navegador.novaPagina();
    const canal = (pagina as unknown as { canal: ConstructorParameters<typeof Pagina>[0] }).canal;
    await canal.enviar("Page.addScriptToEvaluateOnNewDocument", { source: ambiente }, pagina.sessionId);
    await pagina.definirViewport(900, 746);
  });
  beforeEach(async () => {
    if (numero) await pagina.avaliar('localStorage.clear()');
    await pagina.navegar(proxy.origem + "/?gravacao=" + ++numero);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar('localStorage.clear()');
    await clicar('document.getElementById("salvar")');
    await pagina.esperarPor(campo);
    await pagina.avaliar(`${campo}.value="Rascunho anterior";${campo}.dispatchEvent(new Event("input",{bubbles:true}))`);
  });
  after(async () => { await navegador?.fechar(); await proxy?.fechar(); await alvo?.fechar(); });

  test("pede somente microfone; parar transcreve e preserva o rascunho sem enviar", async () => {
    await comecar();
    assert.deepEqual(await pagina.avaliar("window.opcoesMicrofone"), { audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    assert.equal(await pagina.avaliar("window.pedidosGravacao.length"), 0);
    await clicar(no('[title="Parar ditado e revisar"]')); await terminou();
    assert.equal(await texto(), "Rascunho anterior aumente o tamanho da fonte");
    const pedidos = await pagina.avaliar<Array<{ audio: string; mime: string; idioma: string }>>("window.pedidosGravacao");
    assert.equal(pedidos.length, 1);
    assert.equal(Buffer.from(pedidos[0]!.audio, "base64").toString(), "audio-sintetico-teste");
    assert.equal(pedidos[0]!.mime, "audio/webm;codecs=opus");
    assert.equal(pedidos[0]!.idioma, "pt");
    assert.equal(await pagina.avaliar("window.enviosDeMensagem"), 0);
    assert.ok(await pagina.avaliar<number>("window.paradasMicrofone") > 0);
  });

  test("idioma mostra código compacto, menu acessível e permanece entre páginas", async () => {
    const idioma = no('.an-balao [role="combobox"][aria-label="Idioma do ditado"]');
    assert.equal(await pagina.avaliar<string>(`${idioma}.textContent`), "PT");
    await clicar(idioma);
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-seletor-popup')}.querySelectorAll('[role="option"]'),e=>e.textContent)`), ["Português (Brasil)", "Inglês", "Espanhol", "Francês", "Alemão", "Italiano"]);
    await clicar(`${no('.an-seletor-popup')}.querySelectorAll('[role="option"]')[1]`);
    assert.equal(await pagina.avaliar<string>(`${idioma}.textContent`), "EN");
    assert.equal(await pagina.avaliar<string>(`${idioma}.title`), "Idioma do ditado: Inglês");
    assert.equal(await pagina.avaliar<string>('localStorage.getItem("anotador-ui:idioma-ditado")'), "en");
    await pagina.navegar(proxy.origem + "/outra"); await pagina.esperarPor("window.__anotadorCarregado");
    await clicar('document.getElementById("salvar")'); await pagina.esperarPor(campo);
    assert.equal(await pagina.avaliar<string>(`${idioma}.textContent`), "EN");
    await comecar();
    // Uma preferência recebida de outra aba só vale para a próxima gravação.
    await pagina.avaliar('window.dispatchEvent(new StorageEvent("storage",{key:"anotador-ui:idioma-ditado",newValue:"es"}))');
    await clicar(no('[title="Parar ditado e revisar"]')); await terminou();
    assert.equal(await pagina.avaliar<string>('window.pedidosGravacao[0].idioma'), "en");
    assert.equal(await pagina.avaliar<string>(`${idioma}.textContent`), "ES");
  });

  test("prévia é incremental, acumula o áudio desde o cabeçalho e não disputa a transcrição final", async () => {
    await pagina.avaliar('window.atrasarParcial=true;window.atrasarTranscricao=true');
    await comecar();
    await pagina.avaliar('window.avancarTempoGravacao=3500;window.gravadorTeste.emitirParte("cabecalho-primeira-")');
    await pagina.esperarPor('window.pedidosGravacao.length === 1');
    assert.equal(await texto(), "Rascunho anterior");
    await pagina.avaliar('window.avancarTempoGravacao=7000;window.gravadorTeste.emitirParte("segunda-")');
    await pagina.avaliar('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await pagina.avaliar<number>('window.pedidosGravacao.length'), 1, "uma única prévia em curso");
    await pagina.avaliar('window.responderParcial()');
    await pagina.esperarPor(`${no('.an-voz-previa-texto')}.textContent === "trecho provisório"`);
    assert.equal(await texto(), "Rascunho anterior", "prévia nunca é anexada ao rascunho");
    await pagina.avaliar('window.avancarTempoGravacao=10500;window.gravadorTeste.emitirParte("terceira-")');
    await pagina.esperarPor('window.pedidosGravacao.length === 2');
    assert.equal(await pagina.avaliar<string>('atob(window.pedidosGravacao[1].audio)'), "cabecalho-primeira-segunda-terceira-");
    assert.equal(await pagina.avaliar<string>('window.pedidosGravacao[1].idioma'), "pt");
    await clicar(no('[title="Parar ditado e revisar"]'));
    await pagina.esperarPor(`${no('.an-voz-status')}.textContent === "Finalizando prévia…"`);
    assert.equal(await pagina.avaliar<number>('window.pedidosGravacao.length'), 2, "final aguarda a prévia em curso");
    await pagina.avaliar('window.textoParcial="trecho provisório revisado";window.responderParcial()');
    await pagina.esperarPor('window.pedidosGravacao.length === 3');
    assert.equal(await pagina.avaliar('window.pedidosGravacao[2].parcial'), undefined);
    assert.equal(await pagina.avaliar<string>('atob(window.pedidosGravacao[2].audio)'), "cabecalho-primeira-segunda-terceira-audio-sintetico-teste");
    await pagina.avaliar('window.responderGravacao()'); await terminou();
    assert.equal(await texto(), "Rascunho anterior texto atrasado");
    assert.equal(await pagina.avaliar<number>('window.enviosDeMensagem'), 0);
  });

  test("falha da prévia suspende outras parciais e conserva a gravação completa para revisão", async () => {
    await pagina.avaliar('window.erroParcial=true'); await comecar();
    await pagina.avaliar('window.avancarTempoGravacao=3500;window.gravadorTeste.emitirParte("inicio-")');
    await pagina.esperarPor(`${no('.an-voz-status')}.textContent.includes("revisão ao parar")`);
    await pagina.avaliar('window.avancarTempoGravacao=7000;window.gravadorTeste.emitirParte("continua-")');
    assert.equal(await pagina.avaliar<number>('window.pedidosGravacao.length'), 1);
    await clicar(no('[title="Parar ditado e revisar"]')); await terminou();
    assert.equal(await pagina.avaliar<number>('window.pedidosGravacao.length'), 2);
    assert.equal(await texto(), "Rascunho anterior aumente o tamanho da fonte");
  });

  test("prévia tem rolagem e permanece dentro da tela; cancelar ignora retorno parcial atrasado", async () => {
    await pagina.definirViewport(390, 746);
    await pagina.esperar(100);
    await writeFile('/tmp/anotador-voz-antes-390.png', await pagina.capturar({alemDoViewport:false}));
    await pagina.avaliar('window.textoParcial="Uma prévia legível, sem perder o rascunho. ".repeat(35)');
    await comecar();
    await pagina.avaliar('window.avancarTempoGravacao=3500;window.gravadorTeste.emitirParte("inicio-")');
    await pagina.esperarPor(`${no('.an-voz-previa-texto')}.textContent.startsWith("Uma prévia")`);
    const medidas = await pagina.avaliar<{left:number;right:number;top:number;bottom:number;altura:number;rola:boolean}>(`(() => {const r=${no('.an-balao')}.getBoundingClientRect(),p=${no('.an-voz-previa')};return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,altura:p.clientHeight,rola:p.scrollHeight>p.clientHeight}})()`);
    assert.ok(medidas.left >= 0 && medidas.right <= 390 && medidas.top >= 0 && medidas.bottom <= 746, JSON.stringify(medidas));
    assert.ok(medidas.altura <= 120 && medidas.rola);
    await writeFile('/tmp/anotador-voz-previa-390.png', await pagina.capturar({alemDoViewport:false}));
    await pagina.avaliar('window.atrasarParcial=true;window.avancarTempoGravacao=7000;window.gravadorTeste.emitirParte("continua-")');
    await pagina.esperarPor('window.pedidosGravacao.length === 2');
    await clicar(no('[title="Cancelar ditado"]')); await terminou();
    await pagina.avaliar('window.responderParcial()');
    await pagina.avaliar('new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar<boolean>(`!!${no('.an-voz-previa')}`), false);
    assert.equal(await pagina.avaliar<number>('window.enviosDeMensagem'), 0);
    await pagina.definirViewport(900, 746);
  });

  test("cancelar ainda durante a permissão libera qualquer stream tardio", async () => {
    await pagina.avaliar("window.atrasarPermissao=true"); await clicar(mic);
    await pagina.esperarPor("window.pedirPermissao === 1");
    await clicar(no('[title="Cancelar ditado"]')); await terminou();
    await pagina.avaliar("window.permitirGravacao()");
    await pagina.esperarPor("window.paradasMicrofone > 0");
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar("window.pedidosGravacao.length"), 0);
    assert.equal(await pagina.avaliar("!!window.gravadorTeste"), false);
  });

  test("Escape cancela gravação e não envia áudio nem descarta a anotação", async () => {
    await comecar(); await pagina.pressionar("Escape"); await terminou();
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar("window.pedidosGravacao.length"), 0);
    assert.equal(await pagina.avaliar("window.gravadorTeste.state"), "inactive");
    assert.ok(await pagina.avaliar("window.__anotadorDebug.atual()"));
  });

  test("cancelar transcrição ignora resposta tardia e conserva alterações digitadas", async () => {
    await pagina.avaliar("window.atrasarTranscricao=true"); await comecar();
    await clicar(no('[title="Usar texto ditado"]'));
    await pagina.esperarPor("window.pedidosGravacao.length === 1");
    assert.equal(await pagina.avaliar(`${no('[title="Parar ditado e revisar"]')}.disabled`), true);
    await clicar(no('[title="Cancelar ditado"]')); await terminou();
    await pagina.avaliar(`${campo}.value='Texto revisado';window.responderGravacao()`);
    await pagina.avaliar("new Promise(resolve=>setTimeout(resolve,30))");
    assert.equal(await texto(), "Texto revisado");
    assert.equal(await pagina.avaliar("window.enviosDeMensagem"), 0);
  });

  test("falha do servidor mantém a gravação e permite tentar novamente sem pedir outro microfone", async () => {
    await pagina.avaliar("window.erroTranscricao=true"); await comecar();
    await clicar(no('[title="Parar ditado e revisar"]'));
    const repetir = no('[aria-label="Tentar transcrever novamente"]');
    await pagina.esperarPor(repetir);
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar<number>("window.pedirPermissao"), 1);
    assert.ok(await pagina.avaliar<number>("window.paradasMicrofone") > 0);
    assert.match(await pagina.avaliar<string>(`${no(".an-voz-status")}.textContent`), /^Transcrição falhou · 0:/);
    await pagina.avaliar(`window.erroTranscricao=false;${campo}.value="Rascunho revisado";${campo}.dispatchEvent(new Event("input",{bubbles:true}))`);
    await clicar(repetir); await terminou();
    assert.equal(await texto(), "Rascunho revisado aumente o tamanho da fonte");
    assert.equal(await pagina.avaliar<number>("window.pedirPermissao"), 1, "usa o áudio original");
    const pedidos = await pagina.avaliar<Array<{audio:string;mime:string}>>("window.pedidosGravacao");
    assert.equal(pedidos.length, 2); assert.deepEqual(pedidos[0], pedidos[1]);
    assert.equal(await pagina.avaliar<number>("window.enviosDeMensagem"), 0);
  });

  test("tempo real de transcrição avança sem bloquear cancelar ou alterar o rascunho", async () => {
    await pagina.avaliar("window.atrasarTranscricao=true"); await comecar();
    await clicar(no('[title="Parar ditado e revisar"]'));
    await pagina.esperarPor("window.pedidosGravacao.length === 1");
    assert.match(await pagina.avaliar<string>(`${no(".an-voz-status")}.textContent`), /^Transcrevendo · 0:0[01]$/);
    await pagina.esperarPor(`${no(".an-voz-status")}.textContent.startsWith("Transcrevendo · ") && !${no(".an-voz-status")}.textContent.endsWith("0:00")`, 5000);
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar<boolean>(`${no('[title="Cancelar ditado"]')}.disabled`), false);
    await clicar(no('[title="Cancelar ditado"]')); await terminou();
    await pagina.avaliar("window.responderGravacao()");
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar<number>("window.enviosDeMensagem"), 0);
  });

  test("cancelar uma nova tentativa descarta o áudio retido e ignora o resultado atrasado", async () => {
    await pagina.avaliar("window.erroTranscricao=true"); await comecar();
    await clicar(no('[title="Parar ditado e revisar"]'));
    const repetir = no('[aria-label="Tentar transcrever novamente"]');
    await pagina.esperarPor(repetir);
    await pagina.avaliar("window.erroTranscricao=false;window.atrasarTranscricao=true");
    await clicar(repetir);
    await pagina.esperarPor("window.pedidosGravacao.length === 2");
    await pagina.avaliar(`${repetir}.click()`);
    assert.equal(await pagina.avaliar<number>("window.pedidosGravacao.length"), 2, "nova tentativa não duplica a requisição");
    await clicar(no('[title="Cancelar ditado"]')); await terminou();
    await pagina.avaliar("window.responderGravacao()");
    await pagina.avaliar("new Promise(resolve=>setTimeout(resolve,30))");
    assert.equal(await texto(), "Rascunho anterior");
    assert.equal(await pagina.avaliar<number>("window.pedirPermissao"), 1);
    assert.equal(await pagina.avaliar<number>("window.enviosDeMensagem"), 0);
  });

  test("silêncio não inventa texto e permissão negada não inicia gravação", async () => {
    await pagina.avaliar("window.textoGravacao='' "); await comecar();
    await clicar(no('[title="Parar ditado e revisar"]')); await terminou();
    assert.equal(await texto(), "Rascunho anterior");
    await pagina.avaliar("window.recusarPermissao=true;window.gravadorTeste=null");
    await clicar(mic); await terminou();
    assert.equal(await pagina.avaliar("window.gravadorTeste"), null);
    assert.equal(await texto(), "Rascunho anterior");
  });
});
