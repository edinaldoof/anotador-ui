import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const sombra = 'document.getElementById("__anotador_host").shadowRoot';
const no = (seletor: string) => `${sombra}.querySelector(${JSON.stringify(seletor)})`;
const campo = no(".an-chat-entrada textarea");
const enviar = no(".an-chat-enviar");
const painel = no(".an-chat");
const mensagens = no(".an-chat-mensagens");
const combo = (rotulo: string) => no(`[role="combobox"][aria-label="${rotulo}"]`);

// O servidor de teste não executa CLIs: todas as rotas de chat são simuladas.
const simularApi = `(() => {
  const em = "2026-09-14T12:00:00.000Z";
  const sessao = (id, agente, titulo, texto, modelo = null) => ({id,agente,titulo,modelo,ocupada:false,atualizadaEm:em,mensagens:[{id:id+"-m1",autor:"agente",texto,em}]});
  const api = window.chatTeste = {
    criacoes:[], importacoes:[], envios:[], consultas:[], consultasAgente:[], listasAgente:[], configuracoes:[], comandosConsultados:[], consultasLimites:[], falharEnvio:false, segurarEnvio:false,
    limites:{
      claude:{agente:"claude",disponivel:false,atualizadoEm:null,origem:"CLI local",janelas:[],aviso:"O Claude não disponibilizou limites nesta instalação."},
      codex:{agente:"codex",disponivel:true,atualizadoEm:em,origem:"Codex App Server",plano:"Plus",janelas:[
        {id:"codex-week",titulo:"Semanal",usadoPercentual:86,janelaMinutos:10080,redefineEm:new Date(Date.now()+2*86400000).toISOString(),grupo:"Codex"},
        {id:"spark-5h",titulo:"5 horas",usadoPercentual:11,janelaMinutos:300,redefineEm:new Date(Date.now()+7200000).toISOString(),grupo:"Codex Spark"},
        {id:"spark-week",titulo:"Semanal",usadoPercentual:5,janelaMinutos:10080,redefineEm:new Date(Date.now()+86400000).toISOString(),grupo:"Codex Spark"}
      ]},
      antigravity:{agente:"antigravity",disponivel:false,atualizadoEm:null,origem:"CLI local",janelas:[]}
    },
    sessoes:{
      "salva-a":sessao("salva-a","claude","Revisão do formulário","Histórico A: rever formulário"),
      "salva-b":sessao("salva-b","claude","Correção da tabela","Histórico B: ajustar tabela"),
      "codex-a":sessao("codex-a","codex","Acessibilidade do menu","Histórico Codex", "gpt-teste")
    },
    agentes:[
      {id:"claude",nome:"Claude Code",instalado:true,ponte:true,modelos:[{valor:"sonnet",titulo:"Sonnet teste",esforcos:["low","high"]}]},
      {id:"codex",nome:"Codex CLI",instalado:true,ponte:true,modelos:[{valor:"gpt-teste",titulo:"GPT de teste",esforcos:["medium","high"]}]},
      {id:"antigravity",nome:"Antigravity",instalado:true,ponte:true,modelos:[]},
      {id:"gemini",nome:"Gemini CLI",instalado:false,ponte:true,modelos:[]}
    ],
    externas:[{id:"externa-a",agente:"claude",nome:"Conversa no terminal",titulo:null,em,ativa:false}, {id:"externa-agy",agente:"antigravity",nome:"Revisão no Antigravity",titulo:null,em,ativa:false,historicoDisponivel:false,descobertaParcial:true}]
  };
  const timeoutOriginal = window.setTimeout, limparTimeoutOriginal = window.clearTimeout;
  api.timersLimites = new Map(); api.timersMensagens = new Map();
  window.setTimeout = (acao, atraso, ...args) => {
    const executar = () => {api.timersLimites.delete(id);api.timersMensagens.delete(id);acao(...args)};
    const id = timeoutOriginal(executar, atraso);
    if(atraso >= 59000 && atraso <= 60000) api.timersLimites.set(id, () => {limparTimeoutOriginal(id);executar()});
    if(atraso === 5000) api.timersMensagens.set(id, () => {limparTimeoutOriginal(id);executar()});
    return id;
  };
  window.clearTimeout = id => {api.timersLimites.delete(id);api.timersMensagens.delete(id);limparTimeoutOriginal(id)};
  api.atualizarLimites = () => {const proximo=api.timersLimites.values().next().value;if(proximo)proximo()};
  api.atualizarMensagens = () => {const proximo=api.timersMensagens.values().next().value;if(proximo)proximo()};
  const original = window.fetch;
  window.fetch = async (...args) => {
    const url = new URL(String(args[0]), location.href);
    if (url.pathname === "/__anotador/voz/capacidade") return Response.json({disponivel:false});
    if (!url.pathname.startsWith("/__anotador/chat/")) return original(...args);
    const caminho = url.pathname.slice("/__anotador/chat".length);
    const post = args[1]?.method === "POST";
    const corpo = post ? JSON.parse(args[1].body) : null;
    if (caminho === "/limites") {
      const agente = url.searchParams.get("agente"); api.consultasLimites.push(agente);
      const dados = structuredClone(api.limites[api.limitesOutroAgente ? "codex" : agente]);
      if(api.segurarLimites === agente) await new Promise(resolve => api.liberarLimites = resolve);
      if(api.falharLimites === agente) throw new Error("Serviço de limites temporariamente indisponível.");
      return Response.json({ok:true,...dados});
    }
    if (caminho === "/comandos") {
      api.comandosConsultados.push(url.searchParams.get("agente"));
      return Response.json({comandos:Array.from({length:35},(_,i)=>({nome: "skill-"+i,descricao:"Comando instalado número "+i,origem:"projeto",tipo:"skill",suporte:"chat"}))});
    }
    if (caminho === "/catalogo") return Response.json({agentes:api.agentes,sessoesExternas:api.externas});
    if (caminho === "/sessoes" && !post) { api.listasAgente.push(url.searchParams.get("agente")); return Response.json({sessoes:Object.values(api.sessoes)}); }
    if (caminho === "/sessoes" && post) {
      if (corpo.sessaoExterna) {
        api.importacoes.push(corpo);
        if (api.segurarImportacao) await new Promise(resolve => { api.liberarImportacao = resolve; });
        if (api.falharImportacao) return Response.json({erro:"Histórico externo não encontrado neste projeto."},{status:404});
      }
      api.criacoes.push(corpo);
      const id = "nova-" + api.criacoes.length;
      const conversa = {id,...corpo,titulo:corpo.sessaoExterna ? "Conversa no terminal" : "Nova conversa",ocupada:false,atualizadaEm:em,mensagens:corpo.sessaoExterna ? [{id:id+"-m1",autor:"agente",texto:"Histórico importado do terminal",em}] : []};
      if (corpo.agente === "antigravity" && corpo.sessaoExterna) {
        conversa.titulo = "Revisão no Antigravity"; conversa.mensagens = [];
        conversa.avisoHistorico = "O histórico anterior permanece no Antigravity. As novas mensagens aparecem aqui.";
      }
      api.sessoes[id] = conversa;
      return Response.json({conversa});
    }
    const rota = caminho.match(/^\\/sessoes\\/([^/]+)(\\/(?:mensagens|configuracao))?$/);
    const conversa = rota && api.sessoes[decodeURIComponent(rota[1])];
    if (!conversa) return Response.json({erro:"Conversa não encontrada"},{status:404});
    if (post && rota[2] === "/configuracao") {
      api.configuracoes.push({id:conversa.id,...corpo});Object.assign(conversa,corpo);return Response.json({conversa});
    }
    if (post && rota[2]) {
      api.envios.push({id:conversa.id,...corpo});
      if (api.falharEnvio) { api.falharEnvio = false; throw new TypeError("Falha de rede simulada"); }
      if (api.segurarEnvio) await new Promise((resolve) => { api.liberarEnvio = resolve; });
      conversa.mensagens.push({id:conversa.id+"-u"+api.envios.length,autor:"usuario",texto:corpo.texto,em});
      conversa.ocupada = true;
      return Response.json({conversa});
    }
    api.consultas.push(conversa.id); api.consultasAgente.push(url.searchParams.get("agente"));
    if (api.falharConsulta === conversa.id) return Response.json({erro:"Conversa não encontrada neste projeto."},{status:404});
    if (api.segurarConsulta === conversa.id) await new Promise(resolve => { api.liberarConsulta = resolve; });
    return Response.json({conversa: api.respostaDeOutroAgente ? api.sessoes["codex-a"] : conversa});
  };
})()`;

describe("chat com agentes e modelos", { skip: chrome ? false : "Chromium não encontrado", timeout: 90_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const clicar = async (expressao: string) => {
    const configuracaoOculta = await pagina.avaliar<boolean>(`!!(${expressao})?.closest(".an-chat-configuracao")?.hidden`);
    if (configuracaoOculta) await clicar(no(".an-chat-modelo-resumo"));
    const r = await pagina.avaliar<Rect>(`(() => { const el = (${expressao}); el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    assert.ok(r.width > 0 && r.height > 0, "controle visível: " + expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const abrir = async () => {
    await clicar(no('[aria-label="Abrir chat"]'));
    await pagina.esperarPor(`${campo} && !${campo}.disabled`);
  };
  const escrever = async (texto: string) => {
    await clicar(campo);
    await pagina.avaliar(`${campo}.select()`);
    await pagina.digitar(texto);
  };
  const escolher = async (rotulo: string, titulo: string) => {
    await pagina.esperarPor(`${combo(rotulo)} && !${combo(rotulo)}.disabled`);
    await clicar(combo(rotulo));
    await pagina.esperarPor(no(".an-seletor-popup"));
    await clicar(`Array.from(${no(".an-seletor-popup")}.querySelectorAll('[role="option"]')).find(el => el.textContent === ${JSON.stringify(titulo)})`);
    await pagina.esperarPor(`${combo(rotulo)}.textContent === ${JSON.stringify(titulo)}`);
    await pagina.esperarPor(`${campo} && !${campo}.disabled`);
  };
  const abrirSessao = async (titulo: string, textoEsperado: string) => {
    if (!await pagina.avaliar<boolean>(`${no(".an-chat-historico")}.open`)) await clicar(no(".an-chat-historico summary"));
    await clicar(`Array.from(${no(".an-chat-sessoes")}.querySelectorAll("button")).find(el => el.querySelector("strong").textContent === ${JSON.stringify(titulo)})`);
    await pagina.esperarPor(`${mensagens}.textContent.includes(${JSON.stringify(textoEsperado)})`);
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.navegar(proxy.origem);
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async () => {
    await pagina.definirViewport(1200, 800);
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(simularApi);
  });
  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("cria conversa ao enviar, com agente/modelo/raciocínio escolhidos em menus estilizados", async () => {
    await abrir();
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), true);
    await clicar(combo("Agente da conversa"));
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${no(".an-seletor-popup")}).borderRadius`), "12px");
    assert.deepEqual(await pagina.avaliar<string[]>(`Array.from(${no(".an-seletor-popup")}.querySelectorAll('[role="option"]')).map(el=>el.textContent)`), ["Claude Code", "Codex CLI", "Antigravity"]);
    await pagina.pressionar("ArrowDown");
    await pagina.pressionar("Enter");
    await escolher("Modelo da conversa", "GPT de teste");
    await escolher("Raciocínio", "Alto");
    await escrever("Explique o formulário");
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), false, "não exige uma sessão prévia");
    await pagina.pressionar("Enter");
    await pagina.esperarPor(`${mensagens}.textContent.includes("Explique o formulário")`);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), [{ agente: "codex", modelo: "gpt-teste", esforco: "high" }]);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), [{ id: "nova-1", agente: "codex", texto: "Explique o formulário" }]);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    assert.equal(await pagina.avaliar<boolean>(`${combo("Agente da conversa")}.disabled`), false, "é possível consultar outro agente enquanto este responde");
  });

  test("configuração fica junto à mensagem e abre sem reduzir a conversa ou perder o rascunho", async () => {
    await abrir();
    await escrever("Rascunho antes de abrir os controles");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-filtros")}.parentElement === ${no(".an-chat-configuracao")}`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-modelo-resumo")}.closest(".an-chat-entrada") !== null`), true);
    const antes = await pagina.avaliar<number>(`${mensagens}.clientHeight`);
    await clicar(no(".an-chat-modelo-resumo"));
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), false);
    assert.equal(await pagina.avaliar<number>(`${mensagens}.clientHeight`), antes, "configuração sobrepõe sem encolher mensagens");
    await escolher("Modelo da conversa", "Sonnet teste");
    await escolher("Raciocínio", "Alto");
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-modelo-resumo")}.textContent.includes("Sonnet teste")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-modelo-resumo")}.textContent.includes("Alto")`));
    await clicar(no('[aria-label="Fechar configuração"]'));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho antes de abrir os controles");
    const alturaCurta = await pagina.avaliar<number>(`${campo}.getBoundingClientRect().height`);
    await escrever(Array.from({length:12},(_,i)=>"Linha de teste "+i).join("\n"));
    const alturaLonga = await pagina.avaliar<number>(`${campo}.getBoundingClientRect().height`);
    assert.ok(alturaCurta <= 42 && alturaLonga > alturaCurta && alturaLonga <= 108, JSON.stringify({alturaCurta,alturaLonga}));
    await escrever("Curta");
    assert.equal(await pagina.avaliar<number>(`${campo}.getBoundingClientRect().height`), alturaCurta);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("microfone do composer respeita sessão somente leitura e agente respondendo", async () => {
    await abrir();
    const microfone = no('[aria-label="Ditar mensagem"]');
    assert.equal(await pagina.avaliar<boolean>(`${microfone}.disabled`), false);
    await pagina.avaliar('window.chatTeste.sessoes["salva-a"].somenteLeitura=true');
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.equal(await pagina.avaliar<boolean>(`${microfone}.disabled`), true);
    await pagina.avaliar('window.chatTeste.sessoes["salva-a"].somenteLeitura=false;window.chatTeste.sessoes["salva-a"].ocupada=true');
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.equal(await pagina.avaliar<boolean>(`${microfone}.disabled`), true);
    await clicar(no(".an-chat-nova"));
    assert.equal(await pagina.avaliar<boolean>(`${microfone}.disabled`), false);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("ditado no composer conserva o rascunho, cancela ou revisa sem enviar e ignora eventos após trocar sessão", async () => {
    await pagina.avaliar(`(() => {
      window.vozChatTeste={reconhecimentos:[],popups:0};
      class Reconhecimento extends EventTarget {
        constructor(){super();this.paradas=0;window.vozChatTeste.reconhecimentos.push(this);window.recChatTeste=this;}
        start(){this.emitir('start');}
        stop(){this.paradas++;this.emitir('end');}
        abort(){this.paradas++;this.emitir('end');}
        emitir(tipo,dados={}){const evento=Object.assign(new Event(tipo),dados);this.dispatchEvent(evento);this['on'+tipo]?.(evento);}
      }
      window.SpeechRecognition=window.webkitSpeechRecognition=Reconhecimento;
      window.open=()=>{window.vozChatTeste.popups++;return null};
    })()`);
    await abrir(); await escrever("Rascunho anterior");
    await clicar(no('.an-chat-rodape [aria-label="Idioma do ditado"]'));
    await clicar(`${no('.an-seletor-popup')}.querySelectorAll('[role="option"]')[1]`);
    const mic=no('[aria-label="Ditar mensagem"]');
    const ditar = async (texto: string) => {
      const antes=await pagina.avaliar<number>('window.vozChatTeste.reconhecimentos.length');
      await clicar(mic);
      await pagina.esperarPor(`window.vozChatTeste.reconhecimentos.length===${antes+1}`);
      await pagina.avaliar(`window.recChatTeste.emitir("result",{results:[[{transcript:${JSON.stringify(texto)}}]]})`);
    };
    await ditar("trecho descartado");
    assert.equal(await pagina.avaliar<string>('window.recChatTeste.lang'), "en-US");
    assert.equal(await pagina.avaliar<string>(`${no('.an-chat-entrada .an-voz-previa-texto')}.textContent`), "trecho descartado");
    assert.equal(await pagina.avaliar<string>(`${campo}.value.trim()`), "Rascunho anterior trecho descartado");
    assert.equal(await pagina.avaliar<boolean>(`${campo}.checkVisibility()`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-rodape")}.checkVisibility()`), false);
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), true);
    await clicar(campo); await pagina.pressionar("Enter");
    await clicar(no('.an-chat-entrada [aria-label="Cancelar ditado"]'));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho anterior");
    await pagina.avaliar('window.recChatTeste.emitir("result",{results:[[{transcript:"tardio cancelado"}]]})');
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho anterior");
    await ditar("texto para revisar");
    await clicar(no('.an-chat-entrada [aria-label="Parar ditado e revisar"]'));
    assert.equal(await pagina.avaliar<string>(`${campo}.value.trim()`), "Rascunho anterior texto para revisar");
    await pagina.esperarPor(`${enviar}.disabled===false`);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await ditar("e texto antes de fechar");
    await clicar(no('[aria-label="Fechar chat"]'));
    assert.ok(await pagina.avaliar<number>('window.recChatTeste.paradas') > 0);
    await pagina.avaliar('window.recChatTeste.emitir("result",{results:[[{transcript:"tardio ao fechar"}]]})');
    await abrir();
    assert.equal(await pagina.avaliar<boolean>(`${campo}.value.includes("tardio")`), false);
    await ditar("e texto da sessão antiga");
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.ok(await pagina.avaliar<number>('window.recChatTeste.paradas') > 0);
    await pagina.avaliar('window.recChatTeste.emitir("result",{results:[[{transcript:"tardio em outra sessão"}]]})');
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    assert.equal(await pagina.avaliar<number>('window.vozChatTeste.popups'), 0);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("Escape fecha cada camada e /model ou /effort revelam o controle correspondente", async () => {
    await abrir();
    await escrever("/chat:model");
    await pagina.pressionar("Escape"); await pagina.pressionar("Enter");
    await pagina.esperarPor(no(".an-seletor-popup"));
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), false);
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-seletor-popup")} === null`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), false);
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), true);
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), false);
    await escolher("Modelo da conversa", "Sonnet teste");
    await escrever("/chat:effort"); await pagina.pressionar("Escape"); await pagina.pressionar("Enter");
    await pagina.esperarPor(no(".an-seletor-popup"));
    assert.equal(await pagina.avaliar<string>(`${no(".an-seletor-popup")}.getAttribute("aria-label")`), "Raciocínio");
    await pagina.pressionar("Escape"); await pagina.pressionar("Escape"); await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), true);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("históricos e rascunhos ficam isolados por sessão e por agente", async () => {
    await abrir();
    await escrever("Rascunho da nova conversa");
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    await escrever("Rascunho apenas A");
    await abrirSessao("Correção da tabela", "Histórico B");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`), false);
    await escrever("Rascunho apenas B");
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho apenas A");
    await clicar(no(".an-chat-nova"));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho da nova conversa");
    await escolher("Agente da conversa", "Codex CLI");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    await clicar(no(".an-chat-historico summary"));
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-sessoes")}.textContent.includes("Revisão do formulário")`), false);
    await abrirSessao("Acessibilidade do menu", "Histórico Codex");
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`), false);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), []);
  });

  test("trocar agente mantém a dona da sessão e restaura o rascunho ao voltar", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho exclusivo do Claude");
    assert.equal(await pagina.avaliar<boolean>(`${combo("Agente da conversa")}.disabled`), false);
    await escolher("Agente da conversa", "Codex CLI");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`), false);
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-historico summary")}.textContent.includes("Codex CLI")`));
    await abrirSessao("Acessibilidade do menu", "Histórico Codex");
    assert.deepEqual(await pagina.avaliar<string[]>(`Array.from(${no(".an-chat-sessoes")}.querySelectorAll(".an-chat-dono")).map(e=>e.textContent)`), ["Codex CLI"]);
    await escrever("Rascunho exclusivo do Codex");
    await escolher("Agente da conversa", "Claude Code");
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho exclusivo do Claude");
    await escolher("Agente da conversa", "Codex CLI");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho exclusivo do Codex");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.configuracoes"), []);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.listasAgente"), ["claude", "codex", "claude", "codex"]);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.consultasAgente"), ["claude", "codex", "claude", "codex"]);
  });

  test("recusa resposta de sessão de outro agente e ignora consulta antiga ao navegar", async () => {
    await abrir();
    await pagina.avaliar("window.chatTeste.respostaDeOutroAgente=true");
    await clicar(no(".an-chat-historico summary"));
    await clicar(`${no(".an-chat-sessoes")}.querySelector("button")`);
    await pagina.esperarPor(`${no(".an-chat-status")}.textContent.includes("pertence a outro agente")`);
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico Codex")`), false);
    assert.equal(await pagina.avaliar<string>(`${combo("Agente da conversa")}.textContent`), "Claude Code");
    await pagina.avaliar('window.chatTeste.respostaDeOutroAgente=false; window.chatTeste.segurarConsulta="salva-a"');
    await clicar(no(".an-chat-abertura-repetir"));
    await pagina.esperarPor("!!window.chatTeste.liberarConsulta");
    await escolher("Agente da conversa", "Codex CLI");
    await pagina.avaliar("window.chatTeste.liberarConsulta()");
    await abrirSessao("Acessibilidade do menu", "Histórico Codex");
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`), false);
    assert.equal(await pagina.avaliar<string>(`${combo("Agente da conversa")}.textContent`), "Codex CLI");
  });

  test("monitor distingue consumo acumulado de contexto, informa ausências e orienta /compact sem enviar", async () => {
    await abrir();
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-monitor")}.textContent.includes("Não informado")`));
    assert.equal(await pagina.avaliar<number>(`${no(".an-chat-monitor")}.querySelectorAll('[role="progressbar"]').length`), 0);
    await pagina.avaliar(`window.chatTeste.sessoes["salva-a"].metricas = {
      versao:1, cobertura:"parcial", atualizadoEm:"2026-09-14T12:00:00Z",
      acumulado:{entrada:2800000,saida:200000,total:3000000,cacheLeitura:1000000,cacheEscrita:null,raciocinio:null,custoUSD:1.2345},
      ultimoTurno:null, contexto:{usados:168000,limite:200000,percentual:84,base:"ultima_entrada",modelo:null,atualizadoEm:"2026-09-14T12:00:00Z"}
    }`);
    await abrirSessao("Revisão do formulário", "Histórico A");
    assert.equal(await pagina.avaliar<string>(`${no(".an-chat-contexto-valor")}.textContent`), "84%");
    assert.equal(await pagina.avaliar<string>(`${no('[role="progressbar"][aria-label="Ocupação do contexto informada pelo agente"]')}.getAttribute("aria-valuenow")`), "84");
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-consumo-resumo")}.textContent.includes("3.000.000")`));
    await clicar(no(".an-chat-metricas summary"));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-compact-orientacao")}.textContent.includes("ficando cheio")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-metricas-corpo")}.textContent.includes("Cobertura parcial")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-metricas-corpo")}.textContent.includes("Medição do contexto:")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-metricas-corpo")}.textContent.includes("não são somados novamente ao total")`));
    for (const largura of [390, 873]) {
      await pagina.definirViewport(largura, 746);
      const medidas = await pagina.avaliar<{left:number;right:number;top:number;bottom:number;mensagens:number}>(`(() => {const r=${no(".an-chat-metricas-corpo")}.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,mensagens:${mensagens}.clientHeight}})()`);
      assert.ok(medidas.left >= 0 && medidas.right <= largura && medidas.top >= 0 && medidas.bottom <= 746 && medidas.mensagens >= 80, JSON.stringify(medidas));
      await writeFile(`/tmp/anotador-chat-monitor-${largura}.png`, await pagina.capturar());
    }
    await clicar(no(".an-chat-compact"));
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-compact-ajuda")}.hidden`), false);
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-compact-ajuda")}.textContent.includes("Claude Code")`));
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    await escrever("/chat:compact"); await pagina.pressionar("Escape"); await pagina.pressionar("Enter");
    await pagina.esperarPor(`${no(".an-chat-metricas")}.open`);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    await escolher("Agente da conversa", "Codex CLI");
    assert.equal(await pagina.avaliar<string>(`${no(".an-chat-contexto-valor")}.textContent`), "Não informado");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-consumo-resumo")}.textContent.includes("3.000.000")`), false);
  });

  test("Conta mostra janelas reais mesmo sem sessão e mantém o contexto separado", async () => {
    await abrir(); await escolher("Agente da conversa", "Codex CLI");
    await pagina.esperarPor('window.chatTeste.consultasLimites.includes("codex") && !' + no('.an-chat-conta-indisponivel'));
    await escrever("Rascunho que continua aqui");
    const altura = await pagina.avaliar<number>(`${mensagens}.clientHeight`);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-uso-rapido')}.textContent`), /Uso86%Semanal/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-metricas summary')}.textContent`), /Uso e contexto.*Ver detalhes/);
    await clicar(no('.an-chat-uso-rapido'));
    assert.equal(await pagina.avaliar<string>(`${no('[data-metrica-aba="conta"]')}.getAttribute("aria-selected")`), "true", "atalho abre a conta diretamente");
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    // O caminho anterior continua disponível no mesmo lugar.
    await clicar(no('.an-chat-metricas summary')); await clicar(no('[data-metrica-aba="conta"]'));
    assert.equal(await pagina.avaliar<string>(`${no('.an-chat-contexto-valor')}.textContent`), "Não informado");
    assert.equal(await pagina.avaliar<string>(`${no('[data-metrica-aba="conta"]')}.getAttribute("aria-selected")`), "true");
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-metricas-sessao')}.hidden`), true);
    assert.equal(await pagina.avaliar<number>(`${mensagens}.clientHeight`), altura, "popup não reduz mensagens");
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]'),e=>e.getAttribute('aria-valuenow'))`), ["86", "11", "5"]);
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-chat-conta')}.querySelectorAll('.an-chat-conta-grupo'),e=>e.textContent)`), ["Codex", "Codex Spark"]);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /86% usado/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /Renova em 2d/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta-fonte')}.textContent`), /Consultado em.*Fonte: Codex App Server/);
    assert.equal(await pagina.avaliar<string>(`${no('.an-chat-conta-plano')}.textContent`), "Plus");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho que continua aqui");
    assert.deepEqual(await pagina.avaliar('window.chatTeste.criacoes'), []);
    assert.deepEqual(await pagina.avaliar('window.chatTeste.envios'), []);
    for (const largura of [320, 390, 873]) {
      await pagina.definirViewport(largura, 746); await pagina.esperar(60);
      const dimensoes = await pagina.avaliar<{left:number;right:number;top:number;bottom:number;scroll:number;client:number}>(`(() => {const p=${no('.an-chat-metricas-corpo')},r=p.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:p.scrollWidth,client:p.clientWidth}})()`);
      assert.ok(dimensoes.left >= 0 && dimensoes.right <= largura && dimensoes.top >= 0 && dimensoes.bottom <= 746 && dimensoes.scroll <= dimensoes.client, JSON.stringify(dimensoes));
      const cabecalho = await pagina.avaliar<{left:number;right:number;altura:number;scroll:number;client:number}>(`(() => {const b=${no('.an-chat-uso-rapido')},c=${no('.an-chat-cab')},r=b.getBoundingClientRect();return {left:r.left,right:r.right,altura:c.clientHeight,scroll:c.scrollWidth,client:c.clientWidth}})()`);
      assert.ok(cabecalho.left >= 0 && cabecalho.right <= largura && cabecalho.altura < 70 && cabecalho.scroll <= cabecalho.client, JSON.stringify(cabecalho));
      await writeFile('/tmp/anotador-chat-conta-' + largura + '.png', await pagina.capturar({alemDoViewport:false}));
    }
    await clicar(no('[data-metrica-aba="conta"]')); await pagina.pressionar("ArrowLeft");
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-conta')}.hidden`), true);
    assert.equal(await pagina.avaliar<string>(`${no('[data-metrica-aba="sessao"]')}.getAttribute("aria-selected")`), "true");
    await pagina.avaliar(`${no('.an-chat-uso-rapido')}.focus()`); await pagina.pressionar("Enter");
    assert.equal(await pagina.avaliar<string>(`${no('[data-metrica-aba="conta"]')}.getAttribute("aria-selected")`), "true", "Enter acessa a prévia a partir da aba Sessão");
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    await pagina.avaliar(`${no('.an-chat-uso-rapido')}.focus()`); await pagina.pressionar(" ");
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-metricas')}.open`), true, "Espaço também ativa o botão");
  });

  test("Antigravity mostra quatro limites reais e o atalho acompanha o grupo do modelo escolhido", async () => {
    await pagina.avaliar(`(() => {
      const a=window.chatTeste.agentes.find(a=>a.id==='antigravity');
      a.modelos=[{valor:'gemini-teste',titulo:'Gemini teste',esforcos:[]},{valor:'claude-teste',titulo:'Claude no Antigravity',esforcos:[]}];
      window.chatTeste.limites.antigravity={agente:'antigravity',disponivel:true,atualizadoEm:'2026-09-14T12:00:00Z',origem:'Antigravity · /usage',janelas:[
        {id:'ag-gem-week',grupo:'Gemini Models',titulo:'Semanal',janelaMinutos:10080,usadoPercentual:12,redefineEm:'2099-09-21T12:00:00Z'},
        {id:'ag-gem-5h',grupo:'Gemini Models',titulo:'5 horas',janelaMinutos:300,usadoPercentual:31,redefineEm:'2099-09-14T17:00:00Z'},
        {id:'ag-claude-week',grupo:'Claude and GPT models',titulo:'Semanal',janelaMinutos:10080,usadoPercentual:68,redefineEm:'2099-09-21T12:00:00Z'},
        {id:'ag-claude-5h',grupo:'Claude and GPT models',titulo:'5 horas',janelaMinutos:300,usadoPercentual:74,redefineEm:'2099-09-14T17:00:00Z'}
      ]};
    })()`);
    await abrir();await escolher('Agente da conversa','Antigravity');
    await pagina.esperarPor(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length===4`);
    assert.equal(await pagina.avaliar<boolean>(`!!${no('.an-chat-uso-trilho')}`),false,'modelo padrão não presume qual grupo de cota usa');
    await escolher('Modelo da conversa','Gemini teste');
    await pagina.esperarPor(`${no('.an-chat-uso-rapido')}.textContent.includes('31%')`);
    await escolher('Modelo da conversa','Claude no Antigravity');
    await pagina.esperarPor(`${no('.an-chat-uso-rapido')}.textContent.includes('74%')`);
    await clicar(no('.an-chat-uso-rapido'));
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-chat-conta')}.querySelectorAll('.an-chat-conta-grupo'),e=>e.textContent)`),['Modelos Gemini','Modelos Claude e GPT']);
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]'),e=>e.getAttribute('aria-valuenow'))`),['12','31','68','74']);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta-fonte')}.textContent`),/Antigravity · \/usage/);
    assert.deepEqual(await pagina.avaliar('window.chatTeste.envios'),[]);
    assert.deepEqual(await pagina.avaliar('window.chatTeste.criacoes'),[]);
  });

  test("limites indisponíveis ou de outro agente não viram uso zero nem herdam a conta anterior", async () => {
    await abrir();
    await pagina.esperarPor(`${no('.an-chat-conta-indisponivel')}.textContent.includes("Claude")`);
    assert.equal(await pagina.avaliar<boolean>(`!!${no('.an-chat-uso-trilho')}`), false, "atalho não inventa barra quando a conta não informou limites");
    await clicar(no('.an-chat-metricas summary')); await clicar(no('[data-metrica-aba="conta"]'));
    assert.equal(await pagina.avaliar<number>(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length`), 0);
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    await pagina.avaliar('window.chatTeste.segurarLimites="codex"');
    await escolher("Agente da conversa", "Codex CLI");
    await pagina.esperarPor('!!window.chatTeste.liberarLimites');
    await escolher("Agente da conversa", "Claude Code");
    await pagina.avaliar('window.chatTeste.liberarLimites()');
    await pagina.esperar(30);
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-conta')}.textContent.includes("86%")`), false);
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-uso-rapido')}.textContent.includes("86%")`), false);
    await pagina.avaliar('window.chatTeste.limitesOutroAgente=true;window.chatTeste.atualizarLimites()');
    await pagina.esperarPor(`${no('.an-chat-conta-indisponivel')}.textContent.includes("confirmar os limites")`);
    assert.equal(await pagina.avaliar<number>(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length`), 0);
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-conta')}.textContent.includes("Codex Spark")`), false);
  });

  test("conta atualiza a cada 60 segundos no chat aberto e preserva sessão, rascunho e última leitura", async () => {
    await abrir(); await escolher("Agente da conversa", "Codex CLI");
    await pagina.esperarPor(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length === 3`);
    await abrirSessao("Acessibilidade do menu", "Histórico Codex"); await escrever("Rascunho antes da atualização");
    await clicar(no('.an-chat-metricas summary')); await clicar(no('[data-metrica-aba="conta"]'));
    const antes = await pagina.avaliar<number>('window.chatTeste.consultasLimites.length');
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersLimites.size'), 1);
    await pagina.avaliar('window.chatTeste.limites.codex.janelas[0].usadoPercentual=91;window.chatTeste.atualizarLimites()');
    await pagina.esperarPor(`${no('.an-chat-conta')}.textContent.includes("91% usado")`);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.consultasLimites.length'), antes + 1);
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-metricas')}.open`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-chat-conta')}.hidden`), false);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho antes da atualização");
    assert.match(await pagina.avaliar<string>(`${mensagens}.textContent`), /Histórico Codex/);
    await pagina.avaliar('window.chatTeste.falharLimites="codex";window.chatTeste.atualizarLimites()');
    await pagina.esperarPor(`${no('.an-chat-conta-aviso')}.textContent.includes("Última leitura disponível")`);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /91% usado/);
    await clicar(no('[aria-label="Fechar chat"]'));
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersLimites.size'), 0);
    const fechada = await pagina.avaliar<number>('window.chatTeste.consultasLimites.length');
    await pagina.avaliar('window.chatTeste.atualizarLimites()'); await pagina.esperar(30);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.consultasLimites.length'), fechada);
    await abrir();
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho antes da atualização");
    assert.equal(await pagina.avaliar<number>('window.chatTeste.consultasLimites.length'), fechada, "reabertura usa cache recente");
    assert.deepEqual(await pagina.avaliar('window.chatTeste.envios'), []);
  });

  test("limites inválidos são omitidos e percentuais ficam dentro de zero a cem", async () => {
    await pagina.avaliar('window.chatTeste.limites.codex.janelas[0].usadoPercentual=150;window.chatTeste.limites.codex.janelas[1].usadoPercentual=-20;window.chatTeste.limites.codex.janelas[2].usadoPercentual="inválido"');
    await abrir(); await escolher("Agente da conversa", "Codex CLI");
    await pagina.esperarPor(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length === 2`);
    assert.deepEqual(await pagina.avaliar(`Array.from(${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]'),e=>e.getAttribute('aria-valuenow'))`), ["100", "0"]);
  });

  test("recolher e reabrir o anotador pausa e retoma limites e mensagens sem perder a sessão", async () => {
    await abrir(); await escolher("Agente da conversa", "Codex CLI");
    await pagina.esperarPor(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length === 3`);
    await abrirSessao("Acessibilidade do menu", "Histórico Codex"); await escrever("Rascunho preservado ao recolher");
    await pagina.avaliar('window.chatTeste.segurarConsulta="codex-a";window.chatTeste.atualizarMensagens()');
    await pagina.esperarPor('!!window.chatTeste.liberarConsulta');
    await clicar(no('[title="Ocultar anotador (Alt+Shift+A)"]'));
    assert.equal(await pagina.avaliar<boolean>(`${no('.an-raiz')}.hidden`), true);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersLimites.size'), 0);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersMensagens.size'), 0);
    const consultas = await pagina.avaliar<{conta:number;mensagens:number}>('({conta:window.chatTeste.consultasLimites.length,mensagens:window.chatTeste.consultas.length})');
    await pagina.avaliar('window.chatTeste.segurarConsulta=null;window.chatTeste.liberarConsulta();window.chatTeste.atualizarMensagens();window.chatTeste.atualizarLimites()');
    await pagina.esperar(30);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersMensagens.size'), 0, "resposta anterior não reinicia o polling recolhido");
    assert.deepEqual(await pagina.avaliar('({conta:window.chatTeste.consultasLimites.length,mensagens:window.chatTeste.consultas.length})'), consultas);
    await pagina.avaliar('(() => {const agora=Date.now;Date.now=()=>agora()+61000;window.chatTeste.limites.codex.janelas[0].usadoPercentual=42;window.chatTeste.sessoes["codex-a"].mensagens.push({id:"atualizada",autor:"agente",texto:"Atualizada durante recolhimento",em:new Date().toISOString()})})()');
    await clicar(no('.an-religar'));
    await pagina.esperarPor(`${no('.an-chat-conta')}.textContent.includes("42% usado")`);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersLimites.size'), 1);
    assert.equal(await pagina.avaliar<number>('window.chatTeste.timersMensagens.size'), 1);
    await pagina.avaliar('window.chatTeste.atualizarMensagens()');
    await pagina.esperarPor(`${mensagens}.textContent.includes("Atualizada durante recolhimento")`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho preservado ao recolher");
    assert.equal(await pagina.avaliar<string>('window.chatTeste.consultas.at(-1)'), "codex-a");
    assert.deepEqual(await pagina.avaliar('window.chatTeste.envios'), []);
  });

  test("abre sessão externa uma única vez e mostra o histórico importado", async () => {
    await abrir();
    await abrirSessao("Conversa no terminal", "Histórico importado");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), [{ agente: "claude", modelo: null, esforco: null, sessaoExterna: "externa-a" }]);
    await clicar(no(".an-chat-acoes button"));
    await abrirSessao("Conversa no terminal", "Histórico importado");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.criacoes.length"), 1);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), [], "abrir histórico não envia mensagem");
  });

  test("Antigravity distingue histórico remoto e orienta compactação sem presumir suporte", async () => {
    await abrir();
    await escolher("Agente da conversa", "Antigravity");
    await clicar(no(".an-chat-historico summary"));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-sessoes")}.textContent.includes("Histórico no agente")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-sessoes")}.textContent.includes("Lista parcial")`));
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-sessoes")}.textContent.includes("Conversa no terminal")`), false);
    await abrirSessao("Revisão no Antigravity", "O histórico anterior permanece no Antigravity");
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll(".an-chat-vazio").length`), 0);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), [{agente:"antigravity",modelo:null,esforco:null,sessaoExterna:"externa-agy"}]);
    await clicar(no(".an-chat-metricas summary"));
    await clicar(no(".an-chat-compact"));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-compact-ajuda")}.textContent.includes("suporte a /compact no Antigravity não foi verificado")`));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-compact-ajuda")}.textContent.includes("externa-agy")`));
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await clicar(no('[aria-label="Fechar detalhes do consumo"]'));
    await escrever("Continue a revisão desta sessão"); await pagina.pressionar("Enter");
    await pagina.esperarPor(`${mensagens}.textContent.includes("Continue a revisão desta sessão")`);
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll(".an-chat-aviso-historico").length`), 1);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), [{id:"nova-1",agente:"antigravity",texto:"Continue a revisão desta sessão"}]);
  });

  test("impede envio duplicado enquanto espera, consulta resposta e preserva o próximo rascunho", async () => {
    await abrir();
    await pagina.avaliar("window.chatTeste.segurarEnvio = true");
    await escrever("Primeiro pedido");
    await clicar(enviar);
    await pagina.esperarPor("window.chatTeste.envios.length === 1");
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), true);
    await escrever("Próximo pedido ainda em rascunho");
    await pagina.pressionar("Enter");
    await clicar(enviar);
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"), 1);
    await pagina.avaliar("window.chatTeste.liberarEnvio()");
    await pagina.esperarPor(`${no(".an-chat-status")}.textContent === "Respondendo…"`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Próximo pedido ainda em rascunho");
    await pagina.avaliar(`(() => { const c=window.chatTeste.sessoes["nova-1"]; c.ocupada=false; c.mensagens.push({id:"resposta-1",autor:"agente",texto:"Resposta pronta <script>não executar</script>",em:c.atualizadaEm}); })()`);
    await pagina.esperarPor(`${mensagens}.textContent.includes("Resposta pronta")`, 5_000);
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), false);
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.querySelector("script") === null`), true, "resposta é texto, sem executar HTML");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"), 1);
  });

  test("falha de rede mantém mensagem e repete na mesma sessão sem duplicar a criação", async () => {
    await abrir();
    await pagina.avaliar("window.chatTeste.falharEnvio = true");
    await escrever("Não perder este pedido");
    await clicar(enviar);
    await pagina.esperarPor(`${no(".an-chat-status")}.textContent.includes("Falha de rede simulada")`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Não perder este pedido");
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), false);
    await clicar(enviar);
    await pagina.esperarPor(`${mensagens}.textContent.includes("Não perder este pedido")`);
    assert.equal(await pagina.avaliar<number>("window.chatTeste.criacoes.length"), 1);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios.map(e=>e.id)"), ["nova-1", "nova-1"]);
  });

  test("Escape fecha primeiro o menu e depois o chat sem cancelar a anotação selecionada", async () => {
    await clicar('document.querySelector("#salvar")');
    await pagina.esperarPor("window.__anotadorDebug.atual()");
    const id = await pagina.avaliar<string>("window.__anotadorDebug.atual().id");
    await abrir();
    await escrever("Rascunho do chat");
    await clicar(combo("Modelo da conversa"));
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), false);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-seletor-popup")} === null`), true);
    await clicar(campo);
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), true);
    assert.equal(await pagina.avaliar<string>("window.__anotadorDebug.atual().id"), id);
    assert.equal(await pagina.avaliar<boolean>(`${sombra}.activeElement === ${no('[aria-label="Abrir chat"]')}`), true);
    await abrir();
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho do chat");
  });

  test("troca modelo e raciocínio na mesma sessão, preservando mensagens e rascunho", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho preservado ao trocar");
    await escolher("Modelo da conversa", "Sonnet teste");
    await escolher("Raciocínio", "Alto");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.configuracoes"), [
      {id:"salva-a",agente:"claude",modelo:"sonnet",esforco:null}, {id:"salva-a",agente:"claude",modelo:"sonnet",esforco:"high"},
    ]);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`),"Rascunho preservado ao trocar");
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`));
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), []);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("recarregar preserva rascunho de 16 mil caracteres e seleção sem enviar ou criar conversa", async () => {
    await abrir();
    await escolher("Agente da conversa", "Codex CLI");
    await escolher("Modelo da conversa", "GPT de teste");
    await escolher("Raciocínio", "Alto");
    const texto = "Rascunho preservado " + "á".repeat(16000 - "Rascunho preservado ".length);
    await pagina.avaliar(`(() => { const c=${campo};c.value=${JSON.stringify(texto)};c.dispatchEvent(new Event("input",{bubbles:true})); })()`);
    await pagina.navegar(proxy.origem);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(simularApi);
    await abrir();
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), texto);
    assert.equal(await pagina.avaliar<string>(`${combo("Agente da conversa")}.textContent`), "Codex CLI");
    assert.equal(await pagina.avaliar<string>(`${combo("Modelo da conversa")}.textContent`), "GPT de teste");
    assert.equal(await pagina.avaliar<string>(`${combo("Raciocínio")}.textContent`), "Alto");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), []);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await pagina.avaliar(`(() => { const c=${campo};c.value="x".repeat(16001);c.dispatchEvent(new Event("input",{bubbles:true})); })()`);
    assert.equal(await pagina.avaliar<number>(`${campo}.value.length`), 16000);
  });

  test("recarregar retoma o rascunho da sessão escolhida e mantém isolamento por página", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho particular da sessão A");
    await pagina.navegar(proxy.origem + "/outra");
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(simularApi);
    await abrir();
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    await pagina.navegar(proxy.origem);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(simularApi);
    await abrir();
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho particular da sessão A");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("fechar durante o envio limpa apenas o texto aceito antes de reabrir", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await pagina.avaliar("window.chatTeste.segurarEnvio=true");
    await escrever("Pedido aceito uma única vez");
    await clicar(enviar);
    await pagina.esperarPor("window.chatTeste.envios.length===1");
    await clicar(no('[aria-label="Fechar chat"]'));
    await pagina.avaliar("window.chatTeste.liberarEnvio()");
    await pagina.esperarPor('window.chatTeste.sessoes["salva-a"].ocupada');
    await abrir();
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Pedido aceito uma única vez")`));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "");
    await pagina.pressionar("Enter");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"), 1);
  });

  test("reabrir enquanto envia preserva a edição do novo textarea e atualiza a sessão de origem", async () => {
    await abrir();
    await pagina.avaliar("window.chatTeste.segurarEnvio=true");
    await escrever("Primeira mensagem da sessão nova");
    await clicar(enviar);
    await pagina.esperarPor("window.chatTeste.envios.length===1");
    await clicar(no('[aria-label="Fechar chat"]'));
    await abrir();
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), true);
    await escrever("Próximo pedido escrito depois de reabrir");
    await pagina.pressionar("Enter");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"), 1);
    await pagina.avaliar("window.chatTeste.liberarEnvio()");
    await pagina.esperarPor(`${mensagens}.textContent.includes("Primeira mensagem da sessão nova")`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Próximo pedido escrito depois de reabrir");
    assert.equal(await pagina.avaliar<boolean>(`${enviar}.disabled`), true, "sessão aceita está respondendo");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.criacoes.length"), 1);
    await clicar(no('[aria-label="Fechar chat"]'));
    await abrir();
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Próximo pedido escrito depois de reabrir");
  });

  test("lista todos os comandos do agente, navega por teclado e mantém ações locais fora do prompt", async () => {
    await abrir();
    await clicar(no(".an-chat-comandos-abrir"));
    await pagina.esperarPor(`${no(".an-chat-comandos-cab")}.textContent.includes("41 comandos")`);
    assert.equal(await pagina.avaliar<number>(`${no(".an-chat-comandos-lista")}.querySelectorAll("button").length`),41);
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-comandos-lista")}.scrollHeight > ${no(".an-chat-comandos-lista")}.clientHeight`));
    await escrever("/skill-34");
    await pagina.pressionar("Enter");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`),"/skill-34 ");
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"),0);
    await pagina.pressionar("Enter");
    await pagina.esperarPor("window.chatTeste.envios.length === 1");
    assert.equal(await pagina.avaliar<string>("window.chatTeste.envios[0].texto"),"/skill-34");
    await pagina.avaliar('window.chatTeste.sessoes["nova-1"].ocupada=false');
    await pagina.esperarPor(`${combo("Modelo da conversa")}.disabled === false`);
    await escrever("/model sonnet");
    await pagina.pressionar("Enter");
    await pagina.esperarPor(`${combo("Modelo da conversa")}.textContent === "Sonnet teste"`);
    assert.equal(await pagina.avaliar<number>("window.chatTeste.envios.length"),1);
    await escrever("/");
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`),false);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-comandos")}.hidden`),true);
  });

  test("respostas formatadas têm código copiável e expansão sem executar HTML", async () => {
    await abrir();
    const resposta = "## Explicação\n\nUma mensagem **legível** com `código`.\n\n- Primeiro\n- Segundo\n\n" + "```ts\nconst mensagem = '<img src=x onerror=alert(1)>';\n```" + "\n\n| Campo | Valor |\n| --- | --- |\n| modelo | sonnet |\n<script>alert(1)</script>";
    await pagina.avaliar(`window.chatTeste.sessoes["salva-a"].mensagens[0].texto = ${JSON.stringify(resposta)}`);
    await abrirSessao("Revisão do formulário", "Explicação");
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll("h3").length`),1);
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll("li").length`),2);
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll("table").length`),1);
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.querySelector("pre code").textContent.includes("<img")`));
    assert.equal(await pagina.avaliar<number>(`${mensagens}.querySelectorAll("script,img").length`),0);
    assert.ok(await pagina.avaliar<boolean>(`!!${mensagens}.querySelector(".an-chat-copiar")`));
    const antes=await pagina.avaliar<number>(`${painel}.getBoundingClientRect().width`);
    await clicar(no(".an-chat-ampliar"));
    assert.ok(await pagina.avaliar<number>(`${painel}.getBoundingClientRect().width`) > antes);
    await writeFile("/tmp/anotador-chat-legivel.png",await pagina.capturar());
  });

  test("resposta que cresce refaz só a última mensagem, sem remontar a conversa", async () => {
    await abrir();
    // Três mensagens, a última ainda sendo escrita pelo agente — o estado em que a
    // leitura volta a cada segundo e a resposta muda a cada volta.
    await pagina.avaliar(`window.chatTeste.sessoes["salva-a"].mensagens = [
      {id:"m1",autor:"usuario",texto:"Primeira pergunta",em:"2026-09-14T12:00:00.000Z"},
      {id:"m2",autor:"agente",texto:${JSON.stringify("Resposta anterior, ".repeat(40))},em:"2026-09-14T12:00:00.000Z"},
      {id:"m3",autor:"agente",texto:"Começando a responder",em:"2026-09-14T12:00:00.000Z"}
    ]`);
    await abrirSessao("Revisão do formulário", "Primeira pergunta");
    await pagina.esperarPor(`${mensagens}.querySelectorAll(".an-chat-mensagem").length === 3`);
    // Marca o que está na tela: nó remontado perde a marca.
    await pagina.avaliar(`${mensagens}.querySelectorAll(".an-chat-mensagem").forEach((n,i) => n.dataset.marca = "antes-" + i)`);
    await pagina.avaliar(`window.chatTeste.sessoes["salva-a"].ocupada = true; window.chatTeste.sessoes["salva-a"].mensagens[2].texto += " e continuando"`);
    await pagina.esperarPor(`${mensagens}.textContent.includes("e continuando")`);
    assert.deepEqual(
      await pagina.avaliar<Array<string|null>>(`[...${mensagens}.querySelectorAll(".an-chat-mensagem")].map(n => n.dataset.marca ?? null)`),
      ["antes-0", "antes-1", null],
      "só a mensagem que mudou é refeita; remontar a conversa inteira a cada leitura é o que trava o chat",
    );
    assert.equal(await pagina.avaliar<string|undefined>(`${mensagens}.dataset.assinatura`), undefined, "a conversa não fica copiada em texto dentro do DOM");
  });

  test("abrir um painel grande recolhe o outro, em vez de empilhar sobre a página", async () => {
    await abrir();
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), false);
    // A estrutura ocupa a mesma faixa da tela que o chat. Com os dois abertos, eles
    // se cobrem e disputam o clique sobre a página que está sendo anotada.
    await clicar(no('[title^="Estrutura de elementos"]'));
    await pagina.esperarPor(`${painel}.hidden === true`);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-arvore")}.hidden`), false);
    await clicar(no(".an-chat-abrir"));
    await pagina.esperarPor(`${no(".an-arvore")}.hidden === true`);
    assert.equal(await pagina.avaliar<boolean>(`${painel}.hidden`), false, "o chat volta sozinho na tela");
  });

  test("avaliação em curso dá sinal de vida e diz por que o envio está fechado", async () => {
    await abrir();
    // Uma avaliação real passa minutos entre uma mensagem e outra. Antes, o painel
    // ficava idêntico do primeiro ao oitavo minuto e o Enter não fazia nada: quem
    // escrevia não sabia se a mensagem tinha ido, se o agente tinha morrido, nada.
    await pagina.avaliar(`(() => {
      const s = window.chatTeste.sessoes["salva-a"];
      s.somenteLeitura = true;
      s.motivoSomenteLeitura = "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.";
      s.avaliacao = {id:"av-1",url:location.href,acompanhando:true,emAndamento:true,desde:new Date(Date.now()-135000).toISOString(),atividade:{ferramenta:"Read",alvo:"project-table.tsx",passos:14}};
    })()`);
    await abrirSessao("Revisão do formulário", "Histórico A");
    await pagina.esperarPor(no(".an-chat-trabalhando"));
    assert.match(await pagina.avaliar<string>(`${no(".an-chat-trabalhando")}.textContent`), /Claude Code está avaliando a página · 2:\d\d/);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-trabalhando")} === ${mensagens}.lastElementChild`), true, "o sinal fica no fim, depois da última mensagem");
    assert.equal(await pagina.avaliar<string>(`${no(".an-chat-trabalhando-passo")}.textContent`), "lendo project-table.tsx · 14 passos", "o passo atual vem das ferramentas que o agente já chamou");
    await escrever("Dá para conversar enquanto avalia?");
    await pagina.pressionar("Enter");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    assert.equal(await pagina.avaliar<string>(`${no(".an-toast")}.hidden ? "" : ${no(".an-toast")}.textContent`), "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Dá para conversar enquanto avalia?", "o rascunho espera a avaliação terminar");
    assert.equal(await pagina.avaliar<string>(`${enviar}.title`), "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.");
    await pagina.avaliar(`(() => {
      const s = window.chatTeste.sessoes["salva-a"];
      delete s.somenteLeitura; delete s.motivoSomenteLeitura; s.avaliacao.emAndamento = false;
    })()`);
    await pagina.esperarPor(`!${no(".an-chat-trabalhando")} && !${enviar}.disabled`);
    await pagina.pressionar("Enter");
    await pagina.esperarPor("window.chatTeste.envios.length === 1");
    assert.equal(await pagina.avaliar<string>("window.chatTeste.envios[0].texto"), "Dá para conversar enquanto avalia?");
  });

  test("falha ao abrir sessão identifica dona, bloqueia envio e recupera conversa e rascunho anteriores", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho preservado da sessão A");
    await pagina.avaliar("window.chatTeste.falharImportacao=true");
    await clicar(no(".an-chat-historico summary"));
    await clicar(`Array.from(${no(".an-chat-sessoes")}.querySelectorAll("button")).find(el => el.textContent.includes("Conversa no terminal"))`);
    await pagina.esperarPor(no(".an-chat-abertura-repetir"));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-abertura-identidade")}.textContent.includes("Conversa no terminal · Claude Code")`));
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico A")`), false);
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("O projeto também pode")`), false);
    assert.equal(await pagina.avaliar<boolean>(`${campo}.disabled && ${enviar}.disabled && ${combo("Modelo da conversa")}.disabled`), true);
    assert.equal(await pagina.avaliar<string>(`${no(".an-chat-monitor-pendente")}.textContent`), "Abra a sessão para consultar consumo e contexto.");
    assert.equal(await pagina.avaliar<number>(`${no(".an-chat-monitor")}.querySelectorAll(".an-chat-metricas-grade").length`), 0);
    await pagina.avaliar(`${campo}.value="Nunca enviar à sessão anterior"; ${campo}.dispatchEvent(new Event("input")); ${enviar}.dispatchEvent(new MouseEvent("click"));`);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    await clicar(no(".an-chat-abertura-voltar"));
    await pagina.esperarPor(`${mensagens}.textContent.includes("Histórico A")`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho preservado da sessão A");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-historico")}.open`), true);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.criacoes"), []);
  });

  test("tentar novamente mantém ID, agente, modelo e esforço da importação original", async () => {
    await abrir();
    await escolher("Modelo da conversa", "Sonnet teste");
    await escolher("Raciocínio", "Alto");
    await escrever("Rascunho anterior à importação");
    await pagina.avaliar("window.chatTeste.falharImportacao=true");
    await clicar(no(".an-chat-historico summary"));
    await clicar(`Array.from(${no(".an-chat-sessoes")}.querySelectorAll("button")).find(el => el.textContent.includes("Conversa no terminal"))`);
    await pagina.esperarPor(no(".an-chat-abertura-repetir"));
    await pagina.avaliar("window.chatTeste.falharImportacao=false");
    await clicar(no(".an-chat-abertura-repetir"));
    await pagina.esperarPor(`${mensagens}.textContent.includes("Histórico importado do terminal")`);
    const pedido = { agente: "claude", modelo: "sonnet", esforco: "high", sessaoExterna: "externa-a" };
    assert.deepEqual(await pagina.avaliar("window.chatTeste.importacoes"), [pedido, pedido]);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    assert.equal(await pagina.avaliar<boolean>(`!!${no(".an-chat-abertura-repetir")}`), false);
    assert.equal(await pagina.avaliar<boolean>(`${campo}.disabled`), false);
    await clicar(no(".an-chat-nova"));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho anterior à importação");
  });

  test("trocar agente durante importação cancela visualização antiga sem contaminar nova sessão", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho do Claude");
    await pagina.avaliar("window.chatTeste.segurarImportacao=true");
    await clicar(no(".an-chat-historico summary"));
    await clicar(`Array.from(${no(".an-chat-sessoes")}.querySelectorAll("button")).find(el => el.textContent.includes("Conversa no terminal"))`);
    await pagina.esperarPor("!!window.chatTeste.liberarImportacao");
    assert.equal(await pagina.avaliar<boolean>(`${campo}.disabled && ${enviar}.disabled`), true);
    await escolher("Agente da conversa", "Codex CLI");
    await abrirSessao("Acessibilidade do menu", "Histórico Codex");
    await pagina.avaliar("window.chatTeste.liberarImportacao()");
    await pagina.esperarPor("window.chatTeste.criacoes.length===1");
    assert.ok(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico Codex")`));
    assert.equal(await pagina.avaliar<boolean>(`${mensagens}.textContent.includes("Histórico importado")`), false);
    await escolher("Agente da conversa", "Claude Code");
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho do Claude");
    assert.equal(await pagina.avaliar<boolean>(`!!${no(".an-chat-abertura-repetir")}`), false);
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
  });

  test("sessão restaurada removida mostra falha e recupera rascunho sem autorizar ID não aberto", async () => {
    await abrir();
    await abrirSessao("Revisão do formulário", "Histórico A");
    await escrever("Rascunho salvo antes da remoção");
    await pagina.navegar(proxy.origem);
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(simularApi);
    await pagina.avaliar('window.chatTeste.falharConsulta="salva-a"');
    await clicar(no('[aria-label="Abrir chat"]'));
    await pagina.esperarPor(no(".an-chat-abertura-repetir"));
    assert.ok(await pagina.avaliar<boolean>(`${no(".an-chat-abertura-identidade")}.textContent.includes("Revisão do formulário · Claude Code")`));
    assert.equal(await pagina.avaliar<boolean>(`${campo}.disabled && ${enviar}.disabled`), true);
    await clicar(no('[aria-label="Fechar chat"]'));
    await clicar(no('[aria-label="Abrir chat"]'));
    await pagina.esperarPor(no(".an-chat-abertura-voltar"));
    await clicar(no(".an-chat-abertura-voltar"));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`), "Rascunho salvo antes da remoção");
    assert.deepEqual(await pagina.avaliar("window.chatTeste.envios"), []);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-cab")}.textContent.includes("Nova conversa")`), true);
  });

  for (const largura of [390, 873]) test(`chat e menus cabem em ${largura}px com histórico e textos longos`, async () => {
    await pagina.definirViewport(largura, 746);
    await abrir();
    await escolher("Agente da conversa", "Codex CLI");
    await escolher("Modelo da conversa", "GPT de teste");
    await clicar(no(".an-chat-historico summary"));
    await escrever("Mensagem sem espaços: " + "a".repeat(500));
    const medidas = await pagina.avaliar<{left:number;right:number;bottom:number;scroll:number;client:number;enviarBottom:number;enviarRight:number}>(`(() => { const p=${painel},r=p.getBoundingClientRect(),e=${enviar}.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,scroll:p.scrollWidth,client:p.clientWidth,enviarBottom:e.bottom,enviarRight:e.right}; })()`);
    assert.ok(medidas.left >= 0 && medidas.right <= largura, JSON.stringify(medidas));
    assert.ok(await pagina.avaliar<boolean>(`${painel}.getBoundingClientRect().top >= ${no(".an-barra")}.getBoundingClientRect().bottom + 7`), "chat começa abaixo de todas as linhas da barra");
    assert.ok(medidas.bottom <= 746 && medidas.enviarBottom <= medidas.bottom, JSON.stringify(medidas));
    assert.ok(medidas.enviarRight <= medidas.right && medidas.scroll <= medidas.client, JSON.stringify(medidas));
    await clicar(combo("Raciocínio"));
    const popup = await pagina.avaliar<{left:number;right:number;bottom:number;top:number}>(`(() => {const r=${no(".an-seletor-popup")}.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top}})()`);
    assert.ok(popup.left >= 0 && popup.right <= largura && popup.top >= 0 && popup.bottom <= 746, JSON.stringify(popup));
    const configuracao = await pagina.avaliar<{left:number;right:number;top:number;bottom:number}>(`(() => {const r=${no(".an-chat-configuracao")}.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
    assert.ok(configuracao.left >= 0 && configuracao.right <= largura && configuracao.top >= 0 && configuracao.bottom <= 746, JSON.stringify(configuracao));
    await writeFile(`/tmp/anotador-chat-${largura}.png`, await pagina.capturar({alemDoViewport:false}));
    await pagina.pressionar("Escape"); await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-chat-configuracao")}.hidden`), true);
    await writeFile(`/tmp/anotador-chat-compacto-${largura}.png`, await pagina.capturar({alemDoViewport:false}));
  });
});
