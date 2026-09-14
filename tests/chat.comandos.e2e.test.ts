import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome=encontrarChromium();
const no=(s:string)=>`document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(s)})`;
const campo=no(".an-chat-entrada textarea"), enviar=no(".an-chat-enviar"), menu=no(".an-chat-comandos");
const comando=(nome:string)=>`Array.from(${menu}.querySelectorAll(".an-chat-comando")).find(el=>el.querySelector("strong").textContent===${JSON.stringify("/"+nome)})`;
const simular=`(() => {
  const api=window.comandosTeste={consultas:[],envios:[],criacoes:[],configuracoes:[],falhar:false,segurar:false,sessoes:{},
    comandos:["model","effort","new","resume","help"].map(nome=>({nome,descricao:"Personalizado "+nome,origem:"projeto",tipo:"comando",suporte:"chat"}))};
  const original=window.fetch;
  window.fetch=async (...args)=>{
    const url=new URL(String(args[0]),location.href), path=url.pathname.replace("/__anotador/chat","");
    if(!url.pathname.startsWith("/__anotador/chat/"))return original(...args);
    const corpo=args[1]?.method==="POST"?JSON.parse(args[1].body):null;
    if(path==="/catalogo")return Response.json({agentes:[{id:"claude",nome:"Claude Code",instalado:true,ponte:true,modelos:[{valor:"sonnet",titulo:"Sonnet teste",esforcos:["high"],padrao:true}]}],sessoesExternas:[]});
    if(path==="/comandos"){
      api.consultas.push(url.searchParams.get("agente"));
      if(api.segurar)await new Promise(resolve=>{api.liberar=resolve});
      if(api.falhar)throw new TypeError("Catálogo indisponível");
      return Response.json({comandos:api.comandos});
    }
    if(path==="/sessoes"&&!corpo)return Response.json({sessoes:Object.values(api.sessoes)});
    if(path==="/sessoes"&&corpo){
      api.criacoes.push(corpo);const id="sessao-"+api.criacoes.length;
      const conversa={id,...corpo,titulo:"Sessão de teste",ocupada:false,mensagens:[],atualizadaEm:new Date().toISOString()};
      api.sessoes[id]=conversa;return Response.json({conversa});
    }
    const match=path.match(/^\\/sessoes\\/([^/]+)(\\/(mensagens|configuracao))?$/),conversa=match&&api.sessoes[match[1]];
    if(!conversa)return Response.json({erro:"Sessão ausente"},{status:404});
    if(match[3]==="mensagens"){
      api.envios.push(corpo.texto);conversa.mensagens.push({id:"m-"+api.envios.length,autor:"usuario",texto:corpo.texto,em:conversa.atualizadaEm});
    }
    if(match[3]==="configuracao"){api.configuracoes.push(corpo);Object.assign(conversa,corpo)}
    return Response.json({conversa});
  };
})()`;

describe("colisões entre comandos instalados e controles do chat",{skip:chrome?false:"Chromium não encontrado",timeout:60_000},()=>{
  let alvo:AlvoFalso,proxy:ProxySobTeste,navegador:Navegador,pagina:Pagina;
  const clicar=async(expressao:string)=>{
    const r=await pagina.avaliar<Rect>(`(()=>{const el=(${expressao});el.scrollIntoView({block:"nearest"});const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    assert.ok(r.width>0&&r.height>0);await pagina.clicar(r.left+r.width/2,r.top+r.height/2);
  };
  const escrever=async(texto:string)=>{await clicar(campo);await pagina.avaliar(`${campo}.select()`);await pagina.digitar(texto)};
  const submeter=async(texto:string)=>{await escrever(texto);await clicar(enviar)};
  before(async()=>{
    alvo=await criarAlvoFalso();proxy=await criarProxy(alvo);navegador=await Navegador.abrir({caminho:chrome});pagina=await navegador.novaPagina();
    await pagina.navegar(proxy.origem);await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async()=>{
    await pagina.definirViewport(1200,800);await pagina.avaliar("localStorage.clear();sessionStorage.clear()");
    await pagina.navegar(proxy.origem);await pagina.esperarPor("window.__anotadorCarregado");await pagina.avaliar(simular);
    await clicar(no('[aria-label="Abrir chat"]'));await pagina.esperarPor(`${campo}&&!${campo}.disabled`);
  });
  after(async()=>{await navegador?.fechar();await proxy?.fechar();await alvo?.fechar()});

  test("menu mantém os cinco nomes instalados e oferece os controles locais como /chat:*",async()=>{
    await clicar(no(".an-chat-comandos-abrir"));
    await pagina.esperarPor(`${comando("model")} && ${comando("chat:model")}`);
    for(const nome of ["model","effort","new","resume","help"]){
      assert.equal(await pagina.avaliar<string>(`${comando(nome)}.querySelector("small").textContent`),"projeto");
      assert.equal(await pagina.avaliar<string>(`${comando("chat:"+nome)}.querySelector("small").textContent`),"Chat");
    }
    assert.equal(await pagina.avaliar<number>(`${menu}.querySelectorAll(".an-chat-comando").length`),11);
    await clicar(comando("model"));
    assert.equal(await pagina.avaliar<string>(`${campo}.value`),"/model ");
    await pagina.digitar("parâmetro customizado");
    await clicar(enviar);
    await pagina.esperarPor("window.comandosTeste.envios.length===1");
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),["/model parâmetro customizado"]);
  });

  test("comando digitado diretamente consulta o catálogo antes de encaminhar e não intercepta custom",async()=>{
    for(const nome of ["model","effort","new","resume","help"]){
      const antes=await pagina.avaliar<number>("window.comandosTeste.envios.length");
      await submeter("/"+nome+" argumento");
      await pagina.esperarPor(`window.comandosTeste.envios.length===${antes+1}`);
      await pagina.esperarPor(`${campo}.value===""`);
    }
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),["/model argumento","/effort argumento","/new argumento","/resume argumento","/help argumento"]);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.consultas"),["claude"],"catálogo compartilhado e isolado pelo agente");
    assert.equal(await pagina.avaliar<number>("window.comandosTeste.criacoes.length"),1,"/new instalado não troca a sessão do chat");
    assert.equal(await pagina.avaliar<number>("window.comandosTeste.configuracoes.length"),0);
  });

  test("aliases explícitos continuam locais mesmo quando o nome original pertence ao projeto",async()=>{
    await submeter("/chat:model sonnet");
    await pagina.esperarPor(`${no('[aria-label="Modelo da conversa"]')}.textContent==="Sonnet teste"`);
    await submeter("/chat:effort high");
    await pagina.esperarPor(`${no('[aria-label="Raciocínio"]')}.textContent==="Alto"`);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.consultas"),[],"namespace explícito não precisa adivinhar o catálogo");
    await submeter("/chat:resume ");
    await pagina.esperarPor(`${no(".an-chat-historico")}.open`);
    await submeter("/chat:help ");
    await pagina.esperarPor(`${comando("chat:new")}?.checkVisibility()`);
    await clicar(comando("chat:new"));
    await clicar(enviar);
    await pagina.esperarPor(`${campo}.value===""`);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),[]);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.criacoes"),[]);
  });

  test("sem colisão mantém os atalhos curtos e aceita também o namespace explícito",async()=>{
    await pagina.avaliar('window.comandosTeste.comandos=[{nome:"model",descricao:"Menu do terminal",origem:"nativo",tipo:"nativo",suporte:"terminal"}]');
    await submeter("/model sonnet");
    await pagina.esperarPor(`${no('[aria-label="Modelo da conversa"]')}.textContent==="Sonnet teste"`);
    await submeter("/chat:effort high");
    await pagina.esperarPor(`${no('[aria-label="Raciocínio"]')}.textContent==="Alto"`);
    await clicar(no(".an-chat-comandos-abrir"));
    await pagina.esperarPor(`${comando("model")}?.checkVisibility()`);
    assert.equal(await pagina.avaliar<string>(`${comando("model")}.querySelector("small").textContent`),"Chat");
    assert.equal(await pagina.avaliar<boolean>(`${comando("chat:model")}===undefined`),true);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),[]);
  });

  test("falha do catálogo não apaga o comando nem o transforma em ação local por engano",async()=>{
    await pagina.avaliar("window.comandosTeste.falhar=true");
    await submeter("/model parâmetro");
    await pagina.esperarPor(`${no(".an-chat-status")}.textContent.includes("Não consegui verificar")`);
    assert.equal(await pagina.avaliar<string>(`${campo}.value`),"/model parâmetro");
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),[]);
    await submeter("/chat:model sonnet");
    await pagina.esperarPor(`${no('[aria-label="Modelo da conversa"]')}.textContent==="Sonnet teste"`);
    await pagina.avaliar("window.comandosTeste.falhar=false");
    await submeter("/model parâmetro");
    await pagina.esperarPor("window.comandosTeste.envios.length===1");
  });

  test("dois Enters enquanto verifica catálogo geram um único envio do comando customizado",async()=>{
    await pagina.avaliar("window.comandosTeste.segurar=true");
    await submeter("/new argumento");
    await pagina.esperarPor("window.comandosTeste.consultas.length===1");
    await clicar(campo);await pagina.pressionar("Enter");await pagina.pressionar("Enter");
    await pagina.avaliar("window.comandosTeste.liberar()");
    await pagina.esperarPor("window.comandosTeste.envios.length===1");
    await pagina.esperarPor(`${campo}.value===""`);
    assert.deepEqual(await pagina.avaliar("window.comandosTeste.envios"),["/new argumento"]);
    assert.equal(await pagina.avaliar<number>("window.comandosTeste.consultas.length"),1);
  });
});
