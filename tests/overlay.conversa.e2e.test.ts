import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const sombra = 'document.getElementById("__anotador_host").shadowRoot';
const no = (s: string) => `${sombra}.querySelector(${JSON.stringify(s)})`;
const painel = no(".an-conversa"), campo = no(".an-conversa .entrada textarea");
const fixture = `(() => {
 const em = new Date().toISOString();
 const lotes = [{id:'lote-a',enviadoEm:em,estado:'recebido',resumo:'Primeiro lote'}, {id:'lote-b',enviadoEm:em,estado:'recebido',resumo:'Segundo lote'}];
 const t = window.conversaTeste = {lotes, mensagens:{'lote-a':[], 'lote-b':[]}, status:{}, pedidos:[], post:[], erro:false};
 const original = window.fetch;
 window.fetch = async (...args) => {
  const u = new URL(String(args[0]),location.href), p=u.pathname, metodo=args[1]?.method||'GET';
  if(!p.startsWith('/__anotador/'))return original(...args);
  t.pedidos.push(p); if(metodo==='POST')t.post.push(p);
  if(p==='/__anotador/lotes')return Response.json({ok:true,lotes:lotes.map(l=>({...l,titulo:l.resumo}))});
  const lote = p.match(/^\\/__anotador\\/lotes\\/([^/]+)\\/(conversa|status)$/);
  if(lote) {
   if(t.erro)return Response.json({erro:'leitura indisponível'},{status:503});
   return Response.json(lote[2]==='conversa'?{mensagens:t.mensagens[lote[1]]||[],abertas:[]}:{id:lote[1],estado:'recebido',...t.status[lote[1]]});
  }
  if(p==='/__anotador/agentes')return Response.json({ok:true,agentes:[],execucoes:[]});
  if(p==='/__anotador/chat/catalogo')return Response.json({agentes:[{id:'claude',nome:'Claude Code',instalado:true,ponte:true,modelos:[]},{id:'codex',nome:'Codex CLI',instalado:true,ponte:true,modelos:[]}],sessoesExternas:[]});
  if(p==='/__anotador/chat/sessoes')return Response.json({sessoes:[{id:u.searchParams.get('agente')+'-sessao',agente:u.searchParams.get('agente'),titulo:'Sessão '+u.searchParams.get('agente'),modelo:null,atualizadaEm:em,ocupada:false,mensagens:[]}]});
  if(p==='/__anotador/chat/limites')return Response.json({limites:{agente:u.searchParams.get('agente'),disponivel:false,atualizadoEm:em,origem:'teste',janelas:[],aviso:'Sem medição no teste'}});
  if(p.endsWith('/comandos'))return Response.json({comandos:[]});
  return original(...args);
 };
})()`;

describe("conversa de lotes integrada", { skip: chrome ? false : "Chromium indisponível", timeout: 90000 }, () => {
 let alvo:AlvoFalso, proxy:ProxySobTeste, navegador:Navegador, pagina:Pagina;
 const clicar = async (expressao:string) => {
  const r = await pagina.avaliar<Rect>(`(()=>{const e=${expressao};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  await pagina.clicar(r.left+r.width/2,r.top+r.height/2);
 };
 const botao = (texto:string) => `Array.from(${painel}.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(texto)})`;
 const abrir = async (id='lote-a') => { await pagina.avaliar(`window.__anotadorDebug.abrirConversa(${JSON.stringify(id)})`); await pagina.esperarPor(`${painel}?.checkVisibility() && ${painel}.dataset.loteId===${JSON.stringify(id)} && ${no('.an-conversa-historico select')}.options.length===2 && !${no('.an-conversa-atalhos button')}.disabled`); };
 before(async()=>{alvo=await criarAlvoFalso();proxy=await criarProxy(alvo);navegador=await Navegador.abrir({caminho:chrome,mostrarBarrasRolagem:true});pagina=await navegador.novaPagina();await pagina.navegar(proxy.origem+'/');await pagina.esperarPor('window.__anotadorCarregado');});
 beforeEach(async()=>{
  await pagina.definirViewport(1200,800,1);
  await pagina.avaliar(`localStorage.clear();sessionStorage.clear();localStorage.setItem('anotador-ui:/',JSON.stringify({anotacoes:[],enviadas:[],lotes:[{id:'lote-a',enviadoEm:new Date().toISOString(),estado:'recebido',resumo:'Primeiro lote'}]}))`);
  await pagina.navegar(proxy.origem+'/');await pagina.esperarPor('window.__anotadorCarregado');await pagina.avaliar(fixture);await abrir();
 });
 after(async()=>{await navegador?.fechar();await proxy?.fechar();await alvo?.fechar();});
 test("notas novas chegam com status inalterado e preservam o rascunho",async()=>{
  await clicar(campo);await pagina.digitar('Meu rascunho');
  await pagina.avaliar(`window.conversaTeste.mensagens['lote-a'].push({id:'nota1',lote:'lote-a',autor:'agente',agente:'Codex CLI',tipo:'nota',texto:'Ajustei os campos do formulário.',em:new Date().toISOString()})`);
  await pagina.esperarPor(`${no('.an-conversa .fluxo')}.textContent.includes('Ajustei os campos')`,10000);
  assert.equal(await pagina.avaliar(`${campo}.value`),'Meu rascunho');
  assert.match(await pagina.avaliar<string>(`${no('.an-conversa-atividade')}.textContent`),/Ajustei os campos/);
  assert.equal(await pagina.avaliar(`${sombra}.activeElement === ${campo}`),true);
 });
 test("histórico isola os textos e recupera o rascunho ao reabrir",async()=>{
  await clicar(campo);await pagina.digitar('Rascunho A');
  await pagina.avaliar(`${no('.an-conversa-historico select')}.value='lote-b';${no('.an-conversa-historico select')}.dispatchEvent(new Event('change'))`);
  await pagina.esperarPor(`${painel}.dataset.loteId==='lote-b'`);assert.equal(await pagina.avaliar(`${campo}.value`),'');
  await clicar(campo);await pagina.digitar('Rascunho B');await abrir();assert.equal(await pagina.avaliar(`${campo}.value`),'Rascunho A');
  await clicar(no('.an-conversa .cab button[title="Fechar"]'));await abrir('lote-b');assert.equal(await pagina.avaliar(`${campo}.value`),'Rascunho B');
 });
 test("falha persistida de autenticação aparece sem afirmar conclusão",async()=>{
  await pagina.avaliar(`window.conversaTeste.status['lote-a']={execucao:{id:'e1',agente:'claude',modelo:'sonnet',iniciadoEm:new Date().toISOString(),terminadoEm:new Date().toISOString(),codigo:1,erro:'A sessão do Claude expirou. Conecte o Claude novamente.'}}`);
  await pagina.esperarPor(`${no('.an-conversa-atividade')}.textContent.includes('sessão do Claude expirou')`,10000);
  assert.match(await pagina.avaliar<string>(`${no('.an-conversa-atividade')}.textContent`),/Falha na execução/);
  assert.equal(await pagina.avaliar(`${no('.an-estado')}.textContent`),'Falha no agente');
  await pagina.definirViewport(873,746,1);
  assert.ok(await pagina.avaliar(`${no('.an-barra')}.getBoundingClientRect().height < 60`));
  await writeFile('/tmp/anotador-conversa-falha-873.png',await pagina.capturar({alemDoViewport:false}));
  assert.deepEqual(await pagina.avaliar('window.conversaTeste.post'),[]);
 });
 test("saída zero sem confirmação não marca o lote como concluído",async()=>{
  await pagina.avaliar(`window.conversaTeste.status['lote-a']={execucao:{id:'e2',agente:'claude',modelo:null,iniciadoEm:new Date().toISOString(),terminadoEm:new Date().toISOString(),codigo:0}}`);
  await pagina.esperarPor(`${no('.an-conversa-atividade')}.textContent.includes('Execução encerrada')`,10000);
  assert.match(await pagina.avaliar<string>(`${no('.an-conversa-atividade')}.textContent`),/sem confirmar a conclusão/);
  assert.equal(await pagina.avaliar("window.__anotadorDebug.lotes()[0].estado"),'recebido');
 });
 test("erro de leitura é visível e nova tentativa recupera as mensagens",async()=>{
  await pagina.avaliar('window.conversaTeste.erro=true');
  await pagina.esperarPor(no('.an-conversa-erro'),10000);
  await pagina.avaliar(`window.conversaTeste.erro=false;window.conversaTeste.mensagens['lote-a']=[{id:'n1',autor:'agente',tipo:'nota',texto:'Conexão recuperada',em:new Date().toISOString()}]`);
  await clicar(botao('Tentar novamente'));
  await pagina.esperarPor(`${no('.an-conversa .fluxo')}.textContent.includes('Conexão recuperada')`);
 });
 test("atalhos abrem o agente autor, a aba Conta e a configuração sem enviar mensagens",async()=>{
  await pagina.avaliar(`window.conversaTeste.mensagens['lote-a']=[{id:'n1',autor:'agente',agente:'Codex CLI',tipo:'nota',texto:'Revisão Codex',em:new Date().toISOString()}]`);
  await abrir();await pagina.esperarPor(`${no('.an-conversa .cab .sub')}.textContent.includes('Codex')`);
  await clicar(botao('Uso da conta'));
  await pagina.esperarPor(`${no('.an-chat-metricas')}?.open && ${no('[data-metrica-aba="conta"]')}?.getAttribute('aria-selected')==='true'`);
  assert.match(await pagina.avaliar<string>(`${no('.an-chat-historico summary')}.textContent`),/Codex/);
  await clicar(no('.an-chat-cab [aria-label="Fechar chat"]'));await abrir();await clicar(botao('Agente e modelo'));
  await pagina.esperarPor(`${no('.an-chat-configuracao')}?.checkVisibility()`);
  assert.equal(await pagina.avaliar(`${no('.an-chat-escolha select')}.value`),'codex');
  await clicar(no('.an-chat-cab [aria-label="Fechar chat"]'));await abrir();await clicar(botao('Conversas do agente'));
  await pagina.esperarPor(`${no('.an-chat-historico')}?.open`);
  assert.match(await pagina.avaliar<string>(`${no('.an-chat-historico')}.textContent`),/Sessão codex/);
  assert.deepEqual(await pagina.avaliar('window.conversaTeste.post'),[]);
 });
 test("redimensionar, ampliar e reduzir mantêm o painel dentro do viewport",async()=>{
  const dimensoes=()=>pagina.avaliar<{width:number;height:number,left:number,top:number,right:number,bottom:number}>(`(()=>{const r=${painel}.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
  const antes=await dimensoes();await clicar(no('.an-conversa-redimensionar'));await pagina.pressionar('ArrowRight');
  assert.ok((await dimensoes()).width>antes.width);
  const tamanhoSalvo=(await dimensoes()).width;await clicar(no('.an-conversa .cab button[title="Fechar"]'));await abrir();assert.equal((await dimensoes()).width,tamanhoSalvo);
  await clicar(no('.an-conversa-ampliar'));assert.ok((await dimensoes()).width>=1180);
  await clicar(no('.an-conversa-ampliar'));assert.ok((await dimensoes()).width<600);
  for(const largura of [873,390,320]){
   await pagina.definirViewport(largura,746,1);const r=await dimensoes();assert.ok(r.left>=0&&r.top>=0&&r.right<=largura&&r.bottom<=746,JSON.stringify(r));
   assert.equal(await pagina.avaliar(`${painel}.scrollWidth<=${painel}.clientWidth`),true);
   if(largura!==320)await writeFile('/tmp/anotador-conversa-'+largura+'.png',await pagina.capturar({alemDoViewport:false}));
  }
 });
 test("status de envio não cria segunda linha na barra de 873px",async()=>{
  await pagina.definirViewport(873,746,1);
  const r=await pagina.avaliar<{barra:number;enviar:number;estado:number}>(`(()=>{const b=${no('.an-barra')}.getBoundingClientRect(),e=${no('.an-enviar')}.getBoundingClientRect(),s=${no('.an-estado')}.getBoundingClientRect();return {barra:b.height,enviar:e.top,estado:s.top}})()`);
  assert.ok(r.barra<60,JSON.stringify(r));assert.ok(Math.abs(r.enviar-r.estado)<=5,JSON.stringify(r));
  assert.match(await pagina.avaliar<string>(`${no('.an-estado')}.getAttribute('aria-label')`),/lote/);
 });
});
