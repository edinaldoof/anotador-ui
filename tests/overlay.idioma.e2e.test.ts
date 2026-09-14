import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const sombra = 'document.getElementById("__anotador_host").shadowRoot';
const no = (css: string) => `${sombra}.querySelector(${JSON.stringify(css)})`;
const chave = "anotador-ui:idioma-interface";
const mockChat = `(() => {
  const original=window.fetch;
  const conversa={id:'idioma-teste',agente:'claude',titulo:'Cancelar',modelo:'sonnet',ocupada:false,atualizadaEm:'2026-09-14T12:00:00Z',mensagens:[{id:'m1',autor:'usuario',texto:'Enviar',em:'2026-09-14T12:00:00Z'},{id:'m2',autor:'agente',texto:'Texto em português: Cancelar e Selecionar.',em:'2026-09-14T12:00:01Z'}]};
  window.fetch=async(...args)=>{
    const u=new URL(String(args[0]),location.href), p=u.pathname;
    if(!p.startsWith('/__anotador/chat/'))return original(...args);
    if(p.endsWith('/catalogo'))return Response.json({agentes:[{id:'claude',nome:'Claude Code',instalado:true,ponte:true,modelos:[{valor:'sonnet',titulo:'Sonnet',esforcos:['low','high']}]}],sessoesExternas:[]});
    if(p.endsWith('/limites'))return Response.json({agente:'claude',disponivel:false,atualizadoEm:null,origem:'Teste',janelas:[]});
    if(p.endsWith('/comandos'))return Response.json({comandos:[]});
    if(p.endsWith('/sessoes'))return Response.json({sessoes:[conversa]});
    return Response.json({conversa});
  };
})()`;

describe("idioma dos controles sem alterar conteúdo do usuário", { skip: chrome ? false : "Chromium não encontrado", timeout: 90_000 }, () => {
  let alvo: AlvoFalso, proxy: ProxySobTeste, navegador: Navegador, pagina: Pagina, outra: Pagina;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<{ x: number; y: number }>(`(()=>{const e=${expressao};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await pagina.clicar(r.x, r.y);
  };
  before(async () => {
    alvo = await criarAlvoFalso(); proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome }); pagina = await navegador.novaPagina(); outra = await navegador.novaPagina();
  });
  beforeEach(async () => {
    await pagina.definirViewport(1280, 900, 1);
    await pagina.navegar(proxy.origem + "/"); await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar("localStorage.clear();sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/"); await pagina.esperarPor("window.__anotadorCarregado");
  });
  after(async () => { await navegador?.fechar(); await proxy?.fechar(); await alvo?.fechar(); });

  test("preferência em inglês persiste e traduz somente a toolbar", async () => {
    const original = await pagina.avaliar("({texto:document.querySelector('main').textContent,lang:document.documentElement.lang,url:location.href})");
    await pagina.avaliar("window.__anotador_i18n.definir('en')");
    assert.equal(await pagina.avaliar(`${no(".an-modo button")}.textContent`), "Select");
    assert.equal(await pagina.avaliar(`${no(".an-recarregar")}.title`), "Reload page and keep annotations");
    assert.equal(await pagina.avaliar(`${no(".an-raiz")}.lang`), "en");
    assert.deepEqual(await pagina.avaliar("({texto:document.querySelector('main').textContent,lang:document.documentElement.lang,url:location.href})"), original);
    await pagina.navegar(proxy.origem + "/"); await pagina.esperarPor("window.__anotadorCarregado");
    assert.equal(await pagina.avaliar(`${no(".an-modo button")}.textContent`), "Select");
    assert.equal(await pagina.avaliar(`localStorage.getItem(${JSON.stringify(chave)})`), "en");
  });

  test("troca idioma de propriedades preservando seleção, comentário, CSS e idioma do ditado", async () => {
    await pagina.avaliar("document.querySelector('p.rotulo').textContent='Cancelar';localStorage.setItem('anotador-ui:idioma-ditado','es')");
    await clicar("document.querySelector('p.rotulo')"); await pagina.esperarPor(no(".an-balao"));
    await pagina.avaliar(`${no(".an-balao input")}.value='Enviar';${no(".an-balao input")}.dispatchEvent(new Event('input'))`);
    await clicar(no(".an-balao .an-ico")); await pagina.esperarPor(`!${no(".an-painel")}.hidden`);
    const antes = await pagina.avaliar("window.__anotadorDebug.atual()");
    await pagina.avaliar("window.__anotador_i18n.definir('en')");
    assert.match(await pagina.avaliar<string>(`${no(".an-painel")}.textContent`), /Text color/);
    assert.equal(await pagina.avaliar(`${no(".an-tirar-print")}.textContent`), "Take screenshot");
    assert.equal(await pagina.avaliar(`${no(".an-painel textarea")}.placeholder`), "Describe these changes...");
    assert.equal(await pagina.avaliar("document.querySelector('p.rotulo').textContent"), "Cancelar");
    assert.equal(await pagina.avaliar(`${no(".an-painel textarea")}.value`), "Enviar");
    assert.deepEqual(await pagina.avaliar("window.__anotadorDebug.atual()"), antes);
    assert.equal(await pagina.avaliar("localStorage.getItem('anotador-ui:idioma-ditado')"), "es");
    await pagina.avaliar("window.__anotador_i18n.definir('es')");
    assert.match(await pagina.avaliar<string>(`${no(".an-painel")}.textContent`), /Color del texto/);
    assert.equal(await pagina.avaliar(`${no(".an-tirar-print")}.textContent`), "Tomar captura de pantalla");
  });

  test("chat traduz controles sem modificar mensagens, modelo ou rascunho", async () => {
    await pagina.avaliar(mockChat);
    await clicar(no(".an-chat-abrir")); await pagina.esperarPor(no(".an-chat-sessao"));
    await pagina.avaliar(`${no(".an-chat-historico")}.open=true`);
    await clicar(no(".an-chat-sessao")); await pagina.esperarPor(`${no(".an-chat-mensagens")}.textContent.includes('Enviar')`);
    await pagina.avaliar(`${no(".an-chat-entrada textarea")}.value='Selecionar';${no(".an-chat-entrada textarea")}.dispatchEvent(new Event('input'))`);
    const mensagens = await pagina.avaliar(`Array.from(${sombra}.querySelectorAll(".an-chat-texto")).map(n=>n.textContent)`);
    await pagina.avaliar("window.__anotador_i18n.definir('en')");
    assert.equal(await pagina.avaliar(`${no(".an-chat-identidade strong")}.textContent`), "Conversations");
    assert.equal(await pagina.avaliar(`${no(".an-chat-sub")}.textContent`), "Cancelar");
    assert.equal(await pagina.avaliar(`${no(".an-chat-enviar")}.getAttribute('aria-label')`), "Send message");
    assert.equal(await pagina.avaliar(`${no(".an-chat-entrada textarea")}.value`), "Selecionar");
    assert.deepEqual(await pagina.avaliar(`Array.from(${sombra}.querySelectorAll(".an-chat-texto")).map(n=>n.textContent)`), mensagens);
    assert.equal(await pagina.avaliar(`${no(".an-chat-resumo-modelo")}.textContent`), "Sonnet");
    await clicar(no(".an-chat-modelo-resumo"));
    assert.equal(await pagina.avaliar(`${no('.an-chat-configuracao [role="combobox"][aria-label="Conversation agent"]')}.textContent`), "Claude Code");
  });

  test("limites traduzem login, datas e valores; verificar novamente recupera cotas sem enviar mensagem", async () => {
    await pagina.definirViewport(873, 746);
    await pagina.avaliar(mockChat);
    await pagina.avaliar(`(() => {
      const original=window.fetch;
      window.consultasConta=0;window.mutacoesConta=0;
      window.limitesIdioma={agente:'claude',disponivel:false,atualizadoEm:null,origem:'Claude · limites da conta',janelas:[],motivo:'login_necessario',aviso:'O login do Claude não está disponível para consultar os limites desta conta.'};
      window.fetch=(url,opcoes={})=>{
        if(opcoes.method&&opcoes.method!=='GET')window.mutacoesConta++;
        if(new URL(String(url),location.href).pathname.endsWith('/chat/limites')){window.consultasConta++;return Promise.resolve(Response.json(window.limitesIdioma))}
        return original(url,opcoes);
      };
      window.__anotador_i18n.definir('en');
    })()`);
    await clicar(no('.an-chat-abrir'));
    await pagina.esperarPor(`${no('.an-chat-conta-login')} !== null`);
    await clicar(no('.an-chat-uso-rapido'));
    assert.equal(await pagina.avaliar(`${no('.an-chat-conta')}.getAttribute('aria-label')`), 'Claude Code account limits');
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /not signed in on this server/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta-fonte')}.textContent`), /Last attempt:.*Source: Claude · account limits/);
    assert.equal(await pagina.avaliar(`${no('.an-chat-contexto-valor')}.textContent`), 'Not reported');
    assert.doesNotMatch(await pagina.avaliar<string>(`${no('.an-chat-monitor')}.textContent`), /Não informado|Consultado em|Fonte:|limites da conta/);
    assert.equal(await pagina.avaliar(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length`), 0);
    await clicar(no('.an-chat-conta-login summary'));
    assert.equal(await pagina.avaliar(`${no('.an-chat-conta-login code')}.textContent`), 'claude auth login');
    await pagina.avaliar(`window.campoConta=${no('.an-chat-entrada textarea')};window.campoConta.value='Meu rascunho';window.campoConta.dispatchEvent(new Event('input'));window.campoConta.focus();window.__anotador_i18n.definir('es')`);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /no ha iniciado sesión en este servidor/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta-fonte')}.textContent`), /Último intento:.*Fuente:/);
    assert.equal(await pagina.avaliar(`${no('.an-chat-contexto-valor')}.textContent`), 'No informado');
    assert.equal(await pagina.avaliar(`${no('.an-chat-conta-login')}.open`), true);
    assert.equal(await pagina.avaliar(`${no('.an-chat-entrada textarea')}===window.campoConta && ${sombra}.activeElement===window.campoConta && window.campoConta.value==='Meu rascunho'`), true);
    for(const largura of [320,873]) {
      await pagina.definirViewport(largura,746);
      const r=await pagina.avaliar<{left:number;right:number;scroll:number;client:number}>(`(()=>{const e=${no('.an-chat-metricas-corpo')},r=e.getBoundingClientRect();return {left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}})()`);
      assert.ok(r.left>=0&&r.right<=largura&&r.scroll<=r.client,JSON.stringify(r));
    }
    await writeFile('/tmp/anotador-limites-login-873.png',await pagina.capturar({alemDoViewport:false}));
    await pagina.avaliar(`window.limitesIdioma={agente:'claude',disponivel:true,atualizadoEm:'2026-09-14T12:00:00Z',origem:'Claude · limites da conta',janelas:[{id:'five_hour',titulo:'5 horas',usadoPercentual:37.5,janelaMinutos:300,redefineEm:'2099-09-14T12:00:00Z',grupo:null},{id:'seven_day',titulo:'Semanal',usadoPercentual:72,janelaMinutos:10080,redefineEm:'2099-09-21T12:00:00Z',grupo:null}]};window.__anotador_i18n.definir('en')`);
    await clicar(no('.an-chat-conta-verificar'));
    await pagina.esperarPor(`${no('.an-chat-conta')}.querySelectorAll('[role="progressbar"]').length===2`);
    assert.equal(await pagina.avaliar('window.consultasConta'),2);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /5 hours37.5% used.*Weekly72% used/);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta-fonte')}.textContent`), /Data from.*Checked at.*Source:/);
    assert.equal(await pagina.avaliar(no('.an-chat-conta-login')),null);
    await pagina.avaliar("window.__anotador_i18n.definir('pt-BR')");
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-conta')}.textContent`), /5 horas37,5% usado.*Semanal72% usado/);
    assert.equal(await pagina.avaliar('window.consultasConta'),2,'trocar idioma não consulta a conta de novo');
    assert.equal(await pagina.avaliar('window.mutacoesConta'),0,'ajuda e nova consulta não fazem login nem enviam prompts');
    assert.equal(await pagina.avaliar(`${no('.an-chat-entrada textarea')}===window.campoConta && window.campoConta.value==='Meu rascunho'`),true);
  });

  test("avaliação traduz controles e estados preservando foco, erro do agente e parecer", async () => {
    await pagina.avaliar(`(() => {
      const original=window.fetch;
      window.avIdiomaResposta={parecer:null,estado:{fase:'falhou',agente:'Claude Code',erro:'Erro original: autorização expirada.'}};
      window.fetch=(url,opcoes={})=>{
        const caminho=new URL(String(url),location.href).pathname;
        if(caminho.endsWith('/avaliacoes')&&opcoes.method==='POST')return Promise.resolve(Response.json({id:'avaliacao-idioma'}));
        if(caminho.endsWith('/avaliacoes/avaliacao-idioma'))return Promise.resolve(Response.json(window.avIdiomaResposta));
        return original(url,opcoes);
      };
      window.__anotador_i18n.definir('en');
    })()`);
    await clicar(no('.an-barra button[title^="Evaluate the page"]'));
    await pagina.esperarPor(`${no(".an-avaliacao")}?.checkVisibility()`);
    assert.match(await pagina.avaliar<string>(`${no(".an-avaliacao .tit")}.textContent`), /^Page evaluation/);
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao .an-alca")}.title`), "Drag");
    await pagina.avaliar(`${no(".an-avaliacao .rodape input")}.value='Verificar hierarquia';${no(".an-avaliacao .rodape input")}.dispatchEvent(new Event('input'))`);
    await clicar(no(".an-avaliacao .rodape button"));
    await pagina.esperarPor(no(".an-avaliacao-consultar"));
    assert.match(await pagina.avaliar<string>(`${no(".an-avaliacao")}.textContent`), /The agent did not complete the evaluation/);
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao-consultar")}.textContent`), "Check again");
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao .erro p")}.textContent`), "Erro original: autorização expirada.");
    const resumoIngles = await pagina.avaliar<string>(`${no(".an-avaliacao .tit .sub")}.textContent`);
    assert.match(resumoIngles, /elements.*findings?/);
    assert.doesNotMatch(resumoIngles, /elementos|achados?|régua|norma/);
    await pagina.avaliar("window.__anotador_i18n.definir('es')");
    const resumoEspanhol = await pagina.avaliar<string>(`${no(".an-avaliacao .tit .sub")}.textContent`);
    assert.match(resumoEspanhol, /elementos.*hallazgos?/);
    assert.deepEqual(resumoEspanhol.match(/\d+/g), resumoIngles.match(/\d+/g), "a troca de idioma preserva as quantidades medidas");
    assert.match(await pagina.avaliar<string>(`${no(".an-avaliacao")}.textContent`), /El agente no completó la evaluación/);
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao-consultar")}.textContent`), "Volver a consultar");
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao .erro p")}.textContent`), "Erro original: autorização expirada.");
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao .rodape input")}.value`), "Verificar hierarquia");
    assert.equal(await pagina.avaliar(`${no(".an-avaliacao .rodape button")}.textContent`), "Solicitar de nuevo");
    await pagina.avaliar("window.avIdiomaResposta.estado={fase:'sem_parecer',agente:'Claude Code'}");
    await clicar(no(".an-avaliacao-consultar"));
    await pagina.esperarPor(`${no(".an-avaliacao")}.textContent.includes('sin devolver una revisión')`);
    await pagina.avaliar("window.avIdiomaResposta.parecer={agente:'Claude Code',resumo:'Parecer original em português.',itens:[],perguntas:[]}");
    await clicar(no(".an-avaliacao-consultar"));
    await pagina.esperarPor(`${no(".an-avaliacao .resumo")}?.textContent==='Parecer original em português.'`);
    assert.match(await pagina.avaliar<string>(`${no(".an-avaliacao")}.textContent`), /Revisión de Claude Code/);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), [], "somente o retorno simulado foi consultado");
  });

  test("alteração em outra aba atualiza overlay e extrator sem recarregar o alvo", async () => {
    await outra.navegar(proxy.origem + "/__anotador/extrair");
    const pedidos = alvo.pedidos.filter(p => p.url === "/").length;
    await outra.avaliar("window.__anotador_i18n.definir('es')");
    await pagina.esperarPor(`${no(".an-modo button")}.textContent==='Seleccionar'`);
    assert.equal(await outra.avaliar("document.getElementById('extract').textContent"), "Extraer diseño");
    assert.equal(await outra.avaliar("document.documentElement.lang"), "es");
    assert.equal(alvo.pedidos.filter(p => p.url === "/").length, pedidos);
    await pagina.avaliar("window.__anotador_i18n.definir('en')");
    await outra.esperarPor("document.getElementById('extract').textContent==='Extract design'");
  });

  test("extrator traduz botões e taxonomia, preservando DESIGN.md, tokens e URL", async () => {
    await pagina.avaliar("window.__anotador_i18n.definir('en')");
    await pagina.navegar(proxy.origem + "/__anotador/extrair?url=https%3A%2F%2Freferencia.example%2FTexto");
    const markdown = '# Cancelar\n\nTexto do usuário: Enviar.\n\n```css\n.Select { color: red; }\n```';
    const resultado = { nome: "Selecionar", url: "https://referencia.example/Texto", extraidoEm: "2026-09-14T12:00:00Z", markdown,
      tokens: { colors: { "Cor do texto": "#ffffff" }, typography: {}, spacing: {}, rounded: {}, components: {} },
      evidencias: { viewports: [{ nome: "desktop", largura: 1280, altura: 900, elementosAnalisados: 42 }], limitacoes: [] } };
    await pagina.avaliar(`window.fetch=async()=>Response.json({resultado:${JSON.stringify(resultado)}})`);
    await clicar("document.getElementById('extract')"); await pagina.esperarPor("!document.getElementById('result').hidden");
    assert.equal(await pagina.avaliar("document.getElementById('copy').textContent"), "Copy Markdown");
    assert.equal(await pagina.avaliar("document.querySelector('#visual h3').textContent"), "Colors");
    assert.equal(await pagina.avaliar("document.getElementById('measured').textContent"), "42 elements");
    assert.equal(await pagina.avaliar("document.getElementById('source').textContent"), markdown);
    assert.equal(await pagina.avaliar("document.querySelector('#visual .token-name').textContent"), "Cor do texto");
    await pagina.avaliar("window.__anotador_i18n.definir('es')");
    assert.equal(await pagina.avaliar("document.querySelector('#visual h3').textContent"), "Colores");
    assert.equal(await pagina.avaliar("document.getElementById('site-name').textContent"), "Selecionar");
    assert.equal(await pagina.avaliar("document.getElementById('source').textContent"), markdown);
    assert.equal(await pagina.avaliar("document.getElementById('url').value"), resultado.url);
  });
});
