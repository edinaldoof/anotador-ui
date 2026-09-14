import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { Navegador, Pagina, encontrarChromium } from "../lib/cdp.ts";
import { temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, esperarAte, pedir, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const ip = Object.values(networkInterfaces()).flat().find((end) => end?.family === "IPv4" && !end.internal)?.address;
const disponivel = chrome && ip && await temOpenssl();
const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
const micComentario = noOverlay('.an-balao [title="Ditar comentário"]');
const campoComentario = noOverlay(".an-balao input");
const pararComentario = noOverlay('.an-balao [title="Parar ditado e revisar"]');
const micConversa = noOverlay('.an-conversa [title="Ditar resposta"]');
const campoConversa = noOverlay(".an-conversa .entrada textarea");
const micChat = noOverlay('.an-chat-microfone');
const campoChat = noOverlay('.an-chat-entrada textarea');

// Instalado pelo CDP antes de QUALQUER documento, incluindo a retomada HTTPS.
// Não pede microfone real; start() e seu evento são separados para testar permissão.
const ambienteSimulado = `(() => {
  const avisar = (tipo) => window.__eventoVozTeste(tipo);
  window.reconhecimentosTeste = [];
  window.mensagensConversaVozTeste = [];
  class ReconhecimentoTeste extends EventTarget {
    constructor() { super(); this.inicios = 0; this.paradas = 0; this.abortos = 0; window.reconhecimentosTeste.push(this); window.recVozTeste = this; }
    start() { this.inicios++; avisar("start"); if (window.falharInicioVozTeste) throw new DOMException("Permissão negada", "NotAllowedError"); }
    stop() { this.paradas++; this.emitir("end"); }
    abort() { this.abortos++; this.emitir("end"); }
    emitir(tipo, dados = {}) {
      const evento = Object.assign(new Event(tipo), dados);
      this.dispatchEvent(evento); this["on" + tipo]?.(evento);
    }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = ReconhecimentoTeste;
  window.open = () => { avisar("popup"); return null; };
  const original = window.fetch;
  window.fetch = (...args) => {
    const caminho = new URL(String(args[0]), location.href).pathname;
    if (caminho.endsWith("/voz/capacidade")) return Promise.resolve(Response.json({disponivel:false}));
    if (caminho.startsWith("/__anotador/chat/")) {
      const conversa = {id:"chat-voz-teste",agente:"claude",modelo:"sonnet",esforco:"high",titulo:"Conversa preservada",ocupada:false,mensagens:[{id:"mensagem-antiga",autor:"agente",texto:"Histórico preservado",em:"2026-09-14T12:00:00Z"}]};
      if (args[1]?.method === "POST") { avisar("envio"); return Promise.resolve(Response.json({ok:true})); }
      if (caminho.endsWith("/catalogo")) return Promise.resolve(Response.json({agentes:[{id:"claude",nome:"Claude Code",instalado:true,ponte:true,modelos:[{valor:"sonnet",titulo:"Sonnet teste",esforcos:["low","high"]}]}],sessoesExternas:[]}));
      if (caminho.endsWith("/comandos")) return Promise.resolve(Response.json({comandos:[]}));
      if (caminho.endsWith("/sessoes")) return Promise.resolve(Response.json({sessoes:[conversa]}));
      return Promise.resolve(Response.json({conversa}));
    }
    if (args[1]?.method === "POST" && /\\/(lotes|conversa)$/.test(caminho)) {
      avisar("envio"); return Promise.resolve(Response.json({ok:true}));
    }
    if (caminho.endsWith("/lote-voz-teste/conversa")) return Promise.resolve(Response.json({mensagens:window.mensagensConversaVozTeste,abertas:[]}));
    if (caminho.endsWith("/lote-voz-teste/status")) return Promise.resolve(Response.json({estado:"processado",perguntasAbertas:0}));
    return original(...args);
  };
})()`;

describe("ditado na mesma aba, com retomada segura de HTTP para HTTPS", {
  skip: disponivel ? false : "Chromium, OpenSSL e endereço IPv4 de rede necessários", timeout: 120_000,
}, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  let origem: string;
  let segura: string;
  let eventos: string[];
  let removerOuvinte: (() => void) | undefined;

  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => { const el = (${expressao}); el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    assert.ok(r.width > 0 && r.height > 0, "controle visível: " + expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const rascunho = async (texto = "Rascunho anterior") => {
    await clicar('document.querySelector("#salvar")');
    await pagina.esperarPor(campoComentario);
    await pagina.avaliar(`(() => { const campo = ${campoComentario}; campo.value = ${JSON.stringify(texto)}; campo.dispatchEvent(new Event("input", {bubbles:true})); })()`);
    return pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()");
  };
  const resultado = (texto: string) => pagina.avaliar(`window.recVozTeste.emitir("result", {results: [[{transcript: ${JSON.stringify(texto)}}]]})`);
  const ouvir = async (botao = micComentario) => {
    await pagina.esperarPor(`${noOverlay(".an-voz-status")}?.textContent === "Aguardando permissão…" && !!window.recVozTeste`);
    assert.equal(await pagina.avaliar<boolean>(`${botao}.classList.contains("grav")`), false, "solicitar permissão ainda não significa ouvir");
    if (botao === micComentario) assert.match(await pagina.avaliar<string>(`${noOverlay(".an-voz-status")}.textContent`), /Aguardando permissão/);
    await pagina.avaliar('window.recVozTeste.emitir("start")');
    await pagina.esperarPor(`${botao}.classList.contains("grav")`);
  };
  const migrar = async (botao = micComentario) => {
    await clicar(botao);
    await esperarAte(async () => {
      try { return await pagina.avaliar<boolean>(`location.origin === ${JSON.stringify(segura)} && location.pathname === "/" && !!window.__anotadorCarregado && !!window.recVozTeste`); }
      catch { return false; }
    }, 20_000, 100, "mesma aba retoma o app por HTTPS e continua o ditado");
    assert.equal(await pagina.avaliar<boolean>("isSecureContext"), true);
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.inicios"), 1);
    assert.equal(eventos.filter((e) => e === "popup").length, 0, "nenhuma janela é solicitada");
  };
  const abrirSeguro = async () => {
    await pagina.navegar(segura);
    await pagina.esperarPor("window.__anotadorCarregado");
    assert.equal(await pagina.avaliar<boolean>("isSecureContext"), true);
    assert.equal(await pagina.avaliar<number>("window.reconhecimentosTeste.length"), 0);
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { host: "0.0.0.0", https: true });
    origem = `http://${ip}:${proxy.porta}`;
    segura = origem.replace("http:", "https:");
  });
  beforeEach(async () => {
    eventos = [];
    navegador = await Navegador.abrir({ caminho: chrome });
    // Exceção TLS restrita ao Chromium descartável do teste, sem configurações globais.
    await navegador.ignorarErrosCertificado();
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1200, 800);
    const canal = (pagina as unknown as { canal: ConstructorParameters<typeof Pagina>[0] }).canal;
    await canal.enviar("Runtime.addBinding", { name: "__eventoVozTeste" }, pagina.sessionId);
    removerOuvinte = canal.em("Runtime.bindingCalled", (dados, sid) => {
      if (sid === pagina.sessionId && dados["name"] === "__eventoVozTeste") eventos.push(String(dados["payload"]));
    });
    await canal.enviar("Page.addScriptToEvaluateOnNewDocument", { source: ambienteSimulado }, pagina.sessionId);
    // O navegador na rede se conecta por convite, sem chave exposta no JS.
    const convite = JSON.parse((await pedir(proxy.origem + "/__anotador/acesso/link", { metodo: "POST", corpo: JSON.stringify({ voltar: "/" }) })).corpo) as { caminho: string };
    await pagina.navegar(origem + convite.caminho);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(`localStorage.setItem("anotador-ui:/", JSON.stringify({lotes:[{id:"lote-voz-teste",enviadoEm:"2000-01-01T00:00:00.000Z",estado:"processado",resumo:"Conversa de teste"}]}))`);
    await pagina.navegar(origem);
    await pagina.esperarPor("window.__anotadorCarregado");
    assert.equal(await pagina.avaliar<boolean>("isSecureContext"), false);
    assert.equal(eventos.filter((e) => e === "start").length, 0, "abrir o app não inicia microfone");
  });
  afterEach(async () => {
    try {
      assert.equal(eventos.filter((e) => e === "popup").length, 0, "ditado não abre janelas");
      assert.equal(eventos.filter((e) => e === "envio").length, 0, "ditado não envia anotações ou respostas");
    } finally { removerOuvinte?.(); await navegador?.fechar(); }
  });
  after(async () => { await proxy?.fechar(); await alvo?.fechar(); });

  test("clique no microfone migra na mesma aba preservando rascunho, edição e print anexado", async () => {
    const anterior = await rascunho();
    await pagina.avaliar(`localStorage.setItem("anotador-ui:chat:" + encodeURIComponent(window.__ANOTADOR_CFG.nome) + ":/", JSON.stringify({versao:1,rascunhos:[["nova:claude::","Rascunho do chat preservado"]],agente:"claude",modelo:"",esforco:"",sessao:null}))`);
    await clicar(noOverlay('.an-balao [title="Propriedades do elemento"]'));
    await pagina.avaliar(`(() => {
      const linha = Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((n) => n.querySelector("label")?.textContent.startsWith("Tamanho da fonte"));
      const campo = linha.querySelector("input"); campo.value = "22"; campo.dispatchEvent(new Event("change", {bubbles:true}));
    })()`);
    await clicar(noOverlay(".an-tirar-print"));
    await pagina.esperarPor("window.__anotadorDebug.atual()?.anexos?.length === 1", 20_000);
    const anexos = await pagina.avaliar("window.__anotadorDebug.atual().anexos");
    const alteracoes = await pagina.avaliar("window.__anotadorDebug.atual().alteracoes");
    await migrar();
    const atual = await pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()");
    assert.equal(atual.id, anterior.id);
    assert.equal(atual.comentario, anterior.comentario);
    assert.deepEqual(atual.anexos, anexos);
    assert.deepEqual(atual.alteracoes, alteracoes);
    assert.equal(await pagina.avaliar<string>('getComputedStyle(document.querySelector("#salvar")).fontSize'), "22px");
    await ouvir();
    await resultado("e texto ditado");
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value.trim()`), "Rascunho anterior e texto ditado");
    await writeFile("/tmp/anotador-ditado-mesma-aba.png", await pagina.capturar());
    await clicar(pararComentario);
    assert.equal(await pagina.avaliar<string>('JSON.parse(localStorage.getItem("anotador-ui:/")).rascunho.comentario.trim()'), "Rascunho anterior e texto ditado");
    assert.equal(await pagina.avaliar<string>('JSON.parse(localStorage.getItem("anotador-ui:chat:" + encodeURIComponent(window.__ANOTADOR_CFG.nome) + ":/")).rascunhos[0][1]'), "Rascunho do chat preservado");
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.atual().anexos"), anexos);
    assert.equal(eventos.filter((e) => e === "envio").length, 0);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    // A intenção é consumida; um reload comum não reabre o microfone.
    await pagina.navegar(segura);
    await pagina.esperarPor("window.__anotadorCarregado");
    assert.equal(await pagina.avaliar<number>("window.reconhecimentosTeste.length"), 0);
  });

  test("após migração Cancelar restaura o texto anterior e não cancela a anotação", async () => {
    const anterior = await rascunho("Texto  original");
    await migrar();
    await ouvir();
    await resultado("trecho descartado");
    await clicar(noOverlay('[aria-label="Cancelar ditado"]'));
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), anterior.comentario);
    assert.equal(await pagina.avaliar<string>(`${noOverlay(".an-painel textarea")}.value`), anterior.comentario);
    assert.equal(await pagina.avaliar<string>('window.__anotadorDebug.atual().id'), anterior.id);
    assert.equal(await pagina.avaliar<string>('JSON.parse(localStorage.getItem("anotador-ui:/")).rascunho.comentario'), anterior.comentario);
    await pagina.avaliar('window.recVozTeste.emitir("result", {results: [[{transcript:"evento atrasado"}]]})');
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), anterior.comentario);
  });

  test("idioma escolhido segue pela conexão HTTPS e chega ao reconhecimento do navegador", async () => {
    await rascunho("Idioma preservado");
    const idioma = noOverlay('.an-balao [aria-label="Idioma do ditado"]');
    await clicar(idioma);
    await clicar(`${noOverlay('.an-seletor-popup')}.querySelectorAll('[role="option"]')[1]`);
    await migrar();
    assert.equal(await pagina.avaliar<string>('localStorage.getItem("anotador-ui:idioma-ditado")'), "en");
    assert.equal(await pagina.avaliar<string>('window.recVozTeste.lang'), "en-US");
    await ouvir(); await clicar(pararComentario);
    assert.equal(await pagina.avaliar<string>(`${idioma}.textContent`), "EN");
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), "Idioma preservado");
  });

  test("resposta de conversa atravessa HTTPS e o ditado não envia a resposta", async () => {
    assert.equal(await pagina.avaliar<boolean>('window.__anotadorDebug.abrirConversa("lote-voz-teste")'), true);
    await pagina.esperarPor(campoConversa);
    await pagina.avaliar(`(() => { const campo = ${campoConversa}; campo.value = "Resposta iniciada"; campo.dispatchEvent(new Event("input", {bubbles:true})); })()`);
    await migrar(micConversa);
    assert.equal(await pagina.avaliar<string>(`${campoConversa}.value`), "Resposta iniciada");
    await ouvir(micConversa);
    await resultado("e continuada por voz");
    assert.equal(await pagina.avaliar<string>(`${campoConversa}.value.trim()`), "Resposta iniciada e continuada por voz");
    const enviar = noOverlay('.an-conversa [title="Enviar (Enter)"]');
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), false);
    await clicar(noOverlay('.an-conversa [title="Parar ditado e revisar"]'));
    assert.equal(eventos.filter((e) => e === "envio").length, 0);
    assert.equal(await pagina.avaliar<string>('window.__anotadorDebug.conversa().lote'), "lote-voz-teste");
  });

  test("microfone do chat retoma HTTPS na mesma sessão com modelo, histórico e rascunho", async () => {
    await pagina.avaliar(`localStorage.setItem("anotador-ui:chat:"+encodeURIComponent(window.__ANOTADOR_CFG.nome)+":/",JSON.stringify({versao:1,agente:"claude",modelo:"sonnet",esforco:"high",sessao:"chat-voz-teste",rascunhos:[["chat-voz-teste","Rascunho do chat"]]}))`);
    await pagina.navegar(origem); await pagina.esperarPor("window.__anotadorCarregado");
    await clicar(noOverlay('[aria-label="Abrir chat"]'));
    await pagina.esperarPor(`${campoChat}?.value === "Rascunho do chat" && !${micChat}.disabled`);
    await migrar(micChat);
    await pagina.esperarPor(`${campoChat}?.value === "Rascunho do chat"`);
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-chat-mensagens")}.textContent`), /Histórico preservado/);
    await ouvir(micChat); await resultado("com uma alteração falada");
    await clicar(noOverlay('.an-chat [title="Parar ditado e revisar"]'));
    assert.equal((await pagina.avaliar<string>(`${campoChat}.value`)).trim(), "Rascunho do chat com uma alteração falada");
    const salvo = await pagina.avaliar<{agente:string;modelo:string;esforco:string;sessao:string}>('JSON.parse(localStorage.getItem("anotador-ui:chat:"+encodeURIComponent(window.__ANOTADOR_CFG.nome)+":/"))');
    assert.deepEqual({agente:salvo.agente,modelo:salvo.modelo,esforco:salvo.esforco,sessao:salvo.sessao}, {agente:"claude",modelo:"sonnet",esforco:"high",sessao:"chat-voz-teste"});
    assert.equal(eventos.filter(e => e === "envio").length, 0);
  });

  test("contexto seguro só começa após clique e falhas de permissão permitem tentar novamente", async () => {
    await abrirSeguro();
    await rascunho("Comentário local");
    await pagina.avaliar("window.falharInicioVozTeste = true");
    await clicar(micComentario);
    await pagina.esperarPor("window.recVozTeste?.abortos === 1");
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), "Comentário local");
    assert.equal(await pagina.avaliar<boolean>(`${micComentario}.classList.contains("grav")`), false);
    await pagina.avaliar("window.falharInicioVozTeste = false");
    await clicar(micComentario);
    await ouvir();
    await resultado("trecho preservado");
    await pagina.avaliar('window.recVozTeste.emitir("error", {error:"not-allowed"})');
    assert.equal(await pagina.avaliar<boolean>(`${micComentario}.classList.contains("grav")`), false);
    await clicar(micComentario);
    await ouvir();
    await resultado("nova tentativa");
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value.trim()`), "Comentário local trecho preservado nova tentativa");
    await clicar(pararComentario);
    assert.equal(eventos.filter((e) => e === "popup").length, 0);
  });

  test("Escape cancela apenas o ditado, preservando rascunho, estilo e print", async () => {
    await abrirSeguro();
    const anterior = await rascunho("Texto  original");
    await clicar(noOverlay('.an-balao [title="Propriedades do elemento"]'));
    await clicar(noOverlay(".an-tirar-print"));
    await pagina.esperarPor("window.__anotadorDebug.atual()?.anexos?.length === 1", 20_000);
    const anexos = await pagina.avaliar("window.__anotadorDebug.atual().anexos");
    await clicar(micComentario);
    await ouvir();
    await resultado("trecho que será cancelado");
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), anterior.comentario);
    assert.equal(await pagina.avaliar<string>('window.__anotadorDebug.atual().id'), anterior.id);
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.atual().anexos"), anexos);
    assert.equal(await pagina.avaliar(`document.getElementById("__anotador_host").shadowRoot.activeElement === ${campoComentario}`), true);
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.pendentes()"), []);
  });

  test("quadrado e seta preservam o texto para revisão, sem confirmar nem enviar", async () => {
    await abrirSeguro();
    await pagina.definirViewport(873, 746);
    await rascunho("Revisar");
    for (const rotulo of ["Parar ditado e revisar", "Usar texto ditado"]) {
      await clicar(micComentario);
      assert.equal(await pagina.avaliar<boolean>(`${noOverlay(".an-voz-controles")}.classList.contains("ouvindo")`), false);
      await ouvir();
      await resultado("o texto ditado");
      if (rotulo === "Usar texto ditado") await writeFile("/tmp/anotador-ditado-barra.png", await pagina.capturar());
      const texto = await pagina.avaliar<string>(`${campoComentario}.value`);
      await clicar(noOverlay(`[aria-label="${rotulo}"]`));
      assert.equal(await pagina.avaliar<string>(`${campoComentario}.value`), texto);
      assert.equal(await pagina.avaliar(`document.getElementById("__anotador_host").shadowRoot.activeElement === ${campoComentario}`), true);
      assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.pendentes()"), []);
    }
    assert.equal(eventos.filter((e) => e === "envio").length, 0);
  });

  test("intenções vencidas, futuras ou de outra rota não iniciam reconhecimento no reload", async () => {
    await abrirSeguro();
    await rascunho("Rascunho guardado");
    await clicar(micComentario);
    await ouvir();
    await resultado("com contexto");
    await clicar(pararComentario);
    for (const invalida of ["vencida", "futura", "outra-rota"]) {
      await pagina.avaliar(`sessionStorage.setItem("anotador-ui:ditado-pendente", JSON.stringify({campo:"anotacao", voltar:${JSON.stringify(invalida === "outra-rota" ? "/outra" : "/")}, criadaEm:Date.now() + ${invalida === "vencida" ? -360000 : invalida === "futura" ? 60000 : 0}}))`);
      await pagina.navegar(segura);
      await pagina.esperarPor("window.__anotadorCarregado && !!window.__anotadorDebug.atual()");
      await pagina.esperar(150);
      assert.equal(await pagina.avaliar<number>("window.reconhecimentosTeste.length"), 0, invalida);
      assert.equal(await pagina.avaliar('sessionStorage.getItem("anotador-ui:ditado-pendente")'), null);
    }
  });

  test("mensagens novas preservam a permissão e a gravação da conversa no mesmo campo", async () => {
    assert.equal(await pagina.avaliar<boolean>('window.__anotadorDebug.abrirConversa("lote-voz-teste")'), true);
    await pagina.esperarPor(campoConversa);
    await migrar(micConversa);
    await pagina.avaliar(`window.campoConversaOriginal = ${campoConversa}; window.mensagensConversaVozTeste.push({id:"nota-permissao",lote:"lote-voz-teste",autor:"agente",agente:"Claude",tipo:"nota",texto:"Atualização durante a permissão",em:new Date().toISOString()})`);
    await pagina.esperarPor(`${noOverlay(".an-conversa .fluxo")}.textContent.includes("Atualização durante a permissão")`, 10000);
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.abortos"), 0);
    assert.equal(await pagina.avaliar<boolean>(`${campoConversa} === window.campoConversaOriginal`), true);
    await ouvir(micConversa);
    await resultado("Resposta continua ativa");
    await pagina.avaliar(`window.mensagensConversaVozTeste.push({id:"nota-gravacao",lote:"lote-voz-teste",autor:"agente",agente:"Claude",tipo:"nota",texto:"Atualização durante a gravação",em:new Date().toISOString()})`);
    await pagina.esperarPor(`${noOverlay(".an-conversa .fluxo")}.textContent.includes("Atualização durante a gravação")`, 10000);
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.abortos"), 0);
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.inicios"), 1);
    assert.equal(await pagina.avaliar<boolean>(`${campoConversa} === window.campoConversaOriginal`), true);
    assert.match(await pagina.avaliar<string>(`${campoConversa}.value`), /Resposta continua ativa/);
    await clicar(noOverlay('.an-conversa [title="Parar ditado e revisar"]'));
    assert.equal(eventos.filter(e => e === "envio").length, 0);
  });

  test("fechar a conversa após migrar encerra o reconhecimento e preserva o lote", async () => {
    assert.equal(await pagina.avaliar<boolean>('window.__anotadorDebug.abrirConversa("lote-voz-teste")'), true);
    await pagina.esperarPor(campoConversa);
    await migrar(micConversa);
    await ouvir(micConversa);
    await clicar(noOverlay('.an-conversa [title="Fechar"]'));
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.abortos"), 1);
    assert.equal(await pagina.avaliar("window.__anotadorDebug.conversa()"), null);
    assert.equal(await pagina.avaliar('window.__anotadorDebug.lotes()[0].id'), "lote-voz-teste");
  });

  test("ocultar o anotador após migrar encerra o reconhecimento sem enviar comentário", async () => {
    await rascunho("Rascunho ao ocultar");
    await migrar();
    await ouvir();
    await clicar(noOverlay('[title="Ocultar anotador (Alt+Shift+A)"]'));
    assert.equal(await pagina.avaliar<number>("window.recVozTeste.abortos"), 1);
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.pendentes()"), []);
    assert.equal(eventos.filter((e) => e === "envio").length, 0);
  });
});
