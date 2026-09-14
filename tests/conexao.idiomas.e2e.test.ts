import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { paginaConexao } from "../lib/conexao.ts";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";

const chrome=encontrarChromium();
describe("idioma da página de conexão",{skip:chrome?false:"Chromium necessário",timeout:60000},()=>{
  let navegador:Navegador,pagina:Pagina,origem:string;
  const mutacoes:string[]=[];
  const servidor=createServer(async(req,res)=>{
    const url=new URL(req.url??"/","http://local"),caminho=url.pathname;
    if(caminho==="/__anotador/"){
      let html=await paginaConexao();
      if(url.searchParams.has("storage-bloqueado"))html=html.replace("<head>","<head><script>Storage.prototype.getItem=function(){throw new DOMException('Bloqueado','SecurityError')};Storage.prototype.setItem=function(){throw new DOMException('Bloqueado','SecurityError')};</script>");
      res.setHeader("content-type","text/html; charset=utf-8");res.end(html);return;
    }
    res.setHeader("content-type","application/json");
    if(req.method==="POST"&&!caminho.endsWith("/acesso/sessao"))mutacoes.push(caminho);
    const saude={ok:true,nome:"Ponte automática",versao:"0.2",conectado:true,alvo:"http://localhost:3000/rota",fonte:"/tmp/Fonte do usuário",saida:"/tmp/fila",quemOuve:[],ponte:{agente:"claude",modelo:"modelo-teste",esforco:"high"},conexoes:[],app:{alcancavel:true,titulo:"Iniciar conversa",framework:"Vite",status:200}};
    if(caminho.endsWith("/saude"))res.end(JSON.stringify(saude));
    else if(caminho.endsWith("/deteccao"))res.end(JSON.stringify({ok:true,servidores:[]}));
    else if(caminho.endsWith("/agentes"))res.end(JSON.stringify({ok:true,agentes:[{id:"claude",nome:"Claude Code",instalado:true,caminho:"/usr/bin/claude",ponte:true,sessoes:true,como:"A ponte chama `gemini -p` a cada lote.",modelos:[{valor:"modelo-teste",titulo:"Modelo padrão",descricao:"Descrição externa",padrao:true,esforcos:["high"],esforcoPadrao:"high"}]}],sessoes:[{id:"sessao-teste",agente:"claude",nome:"Iniciar conversa",titulo:"Ponte automática",ativa:false,em:"2026-09-14T12:00:00Z",origem:"/tmp/projeto"}],execucoes:[]}));
    else if(caminho.endsWith("/sondar"))res.end(JSON.stringify({ok:true,sondagem:{alcancavel:true,status:200,html:true,titulo:"Iniciar conversa"}}));
    else res.end(JSON.stringify({ok:true}));
  });
  const clicar=async(expressao:string)=>{const r=await pagina.avaliar<Rect>(`(()=>{const e=${expressao};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);await pagina.clicar(r.left+r.width/2,r.top+r.height/2)};
  const escolher=async(idioma:string)=>{await clicar('document.getElementById("idioma-gatilho")');await clicar(`document.querySelector('[data-idioma="${idioma}"]')`);await pagina.esperarPor(`document.documentElement.lang===${JSON.stringify(idioma)}`)};
  const abrir=async()=>{await pagina.navegar(origem+"/__anotador/");await pagina.esperarPor('document.querySelector(".sessao .nome") && !document.getElementById("btn-copiar-acesso").hidden')};
  before(async()=>{await new Promise<void>(resolve=>servidor.listen(0,"127.0.0.1",resolve));const endereco=servidor.address();assert.ok(endereco&&typeof endereco==="object");origem="http://127.0.0.1:"+endereco.port;navegador=await Navegador.abrir({caminho:chrome});pagina=await navegador.novaPagina();await abrir()});
  beforeEach(async()=>{await pagina.avaliar('localStorage.clear()');await pagina.definirViewport(873,746);await abrir();mutacoes.length=0});
  after(async()=>{await navegador?.fechar();servidor.closeAllConnections();await new Promise<void>(resolve=>servidor.close(()=>resolve()))});

  test("português é padrão; inglês traduz a interface e estados sem alterar dados ou ditado",async()=>{
    assert.equal(await pagina.avaliar<string>('document.documentElement.lang'),"pt-BR");
    const protocolo=await pagina.avaliar<string>('document.getElementById("protocolo").textContent');
    await pagina.avaliar('localStorage.setItem("anotador-ui:idioma-ditado","de");document.getElementById("fonte").value="Meu rascunho de pasta"');
    await escolher("en");
    assert.equal(await pagina.avaliar<string>('document.title'),"Anotador · connection");
    assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"Development app");
    assert.equal(await pagina.avaliar<string>('document.getElementById("pilula-app").textContent'),"App: responding · Vite");
    assert.match(await pagina.avaliar<string>('document.getElementById("acesso-descricao").textContent'),/^This browser is connected/);
    assert.match(await pagina.avaliar<string>('document.getElementById("pilula-agente").textContent'),/^Agent: Claude Code bridge/);
    assert.equal(await pagina.avaliar<string>('document.querySelector(".sessao .nome").textContent'),"Iniciar conversa");
    assert.equal(await pagina.avaliar<string>('document.getElementById("sub-marca").textContent'),"Ponte automática · v0.2");
    assert.match(await pagina.avaliar<string>('document.getElementById("ponte").textContent'),/Modelo padrão/);
    assert.equal(await pagina.avaliar<string>('document.getElementById("fonte").value'),"Meu rascunho de pasta");
    assert.equal(await pagina.avaliar<string>('localStorage.getItem("anotador-ui:idioma-ditado")'),"de");
    assert.equal(await pagina.avaliar<string>('document.getElementById("protocolo").textContent'),protocolo);
    assert.deepEqual(mutacoes,[]);
    await abrir();assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"Development app");
  });

  test("espanhol e retorno a português funcionam por teclado sem recarregar nem executar agentes",async()=>{
    await clicar('document.getElementById("idioma-gatilho")');await pagina.pressionar("End");await pagina.pressionar("Enter");
    await pagina.esperarPor('document.documentElement.lang==="es"');
    assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"Aplicación en desarrollo");
    assert.equal(await pagina.avaliar<string>('document.getElementById("btn-conectar").textContent'),"Cambiar y abrir");
    await escolher("pt-BR");assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"App em desenvolvimento");
    assert.deepEqual(mutacoes,[]);
  });

  test("troca de idioma chega a outra aba e traduções marcadas não interpretam HTML",async()=>{
    const outra=await navegador.novaPagina();await outra.navegar(origem+"/__anotador/");await outra.esperarPor('!!window.__anotador_i18n');
    await escolher("es");await outra.esperarPor('document.documentElement.lang==="es"');
    assert.equal(await outra.avaliar<string>('document.querySelector("h2").textContent'),"Aplicación en desarrollo");
    await pagina.avaliar(`(()=>{const i=window.__anotador_i18n;i.registrar({es:{'Teste {valor}':'Prueba {valor}'}});const e=document.createElement('div');e.id='teste-seguro';e.setAttribute('data-i18n','Teste {valor}');e.setAttribute('data-i18n-params',JSON.stringify({valor:'<img src=x onerror="window.injecao=true">'}));document.body.append(e);i.traduzir(e)})()`);
    assert.equal(await pagina.avaliar<boolean>('!!document.querySelector("#teste-seguro img") || !!window.injecao'),false);
    assert.match(await pagina.avaliar<string>('document.getElementById("teste-seguro").textContent'),/^Prueba <img/);
    await outra.fechar();
  });

  for(const largura of [320,873])test(`seletor e menu cabem em ${largura}px`,async()=>{
    await pagina.definirViewport(largura,746);await escolher("en");await clicar('document.getElementById("idioma-gatilho")');
    const r=await pagina.avaliar<{left:number;right:number;top:number;bottom:number}>('(()=>{const r=document.getElementById("idioma-menu").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()');
    assert.ok(r.left>=0&&r.right<=largura&&r.top>=0&&r.bottom<=746,JSON.stringify(r));
    await writeFile('/tmp/anotador-idioma-menu-'+largura+'.png',await pagina.capturar({alemDoViewport:false}));
  });

  test("sem armazenamento, agente e seletor PT/EN/ES continuam operacionais em memória",async()=>{
    const antes=pagina.erros.length;
    try {
      await pagina.navegar(origem+"/__anotador/?storage-bloqueado");
      await pagina.esperarPor('document.querySelector(".sessao .nome") && !document.getElementById("btn-copiar-acesso").hidden');
      assert.equal(await pagina.avaliar<string>('document.documentElement.lang'),"pt-BR");
      assert.equal(await pagina.avaliar<boolean>('(()=>{try{localStorage.getItem("teste");return false}catch{return true}})()'),true);
      await escolher("en");assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"Development app");
      await clicar('document.querySelector("#abas .agente")');
      assert.equal(await pagina.avaliar<string>('document.querySelector(".sessao .nome").textContent'),"Iniciar conversa");
      await escolher("es");assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"Aplicación en desarrollo");
      await escolher("pt-BR");assert.equal(await pagina.avaliar<string>('document.querySelector("h2").textContent'),"App em desenvolvimento");
      assert.deepEqual(pagina.erros.slice(antes),[]);assert.deepEqual(mutacoes,[]);
    } finally { await abrir(); }
  });
});
