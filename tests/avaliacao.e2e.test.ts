import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
describe("avaliação: medição, retorno e arrasto", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso, proxy: ProxySobTeste, navegador: Navegador, pagina: Pagina;
  const no = (seletor: string) => `document.getElementById('__anotador_host').shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const rect = (seletor: string) => pagina.avaliar<Rect>(`(()=>{const r=${no(seletor)}.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  const clicar = async (seletor: string) => { await pagina.avaliar(`${no(seletor)}.scrollIntoView({block:'nearest'})`); const r=await rect(seletor); await pagina.clicar(r.left+r.width/2,r.top+r.height/2); };
  const texto = () => pagina.avaliar<string>(`${no('.an-avaliacao')}.textContent`);
  const abrir = async () => { await clicar('.an-barra button[title^="Avaliar a página"]'); await pagina.esperarPor(`${no('.an-avaliacao')}?.checkVisibility() && !${no('.an-avaliacao .rodape button')}?.disabled`); };
  const pedir = async () => { await clicar('.an-avaliacao .rodape button'); await pagina.esperarPor('window.avPosts.length === 1'); };
  before(async () => { alvo=await criarAlvoFalso(); proxy=await criarProxy(alvo,{capturas:false}); navegador=await Navegador.abrir({caminho:chrome}); pagina=await navegador.novaPagina(); await pagina.definirViewport(1200,800); });
  beforeEach(async () => {
    await pagina.navegar(proxy.origem+'/'); await pagina.esperarPor('window.__anotadorCarregado');
    await pagina.avaliar(`(()=>{
      localStorage.clear();window.avPosts=[];window.avGets=0;window.avStatus=200;window.avResposta={ok:true,parecer:null,estado:{fase:'executando',agente:'Claude Code',atualizadoEm:'agora'}};
      window.avAgentes=[{id:'codex',nome:'Codex CLI',instalado:true,ponte:true,modelos:[{valor:'codex-teste',titulo:'Modelo Codex',esforcos:['low','high']}]},{id:'claude',nome:'Claude Code',instalado:true,ponte:true,modelos:[{valor:'claude-teste',titulo:'Modelo Claude',esforcos:['low','high']}]},{id:'gemini',nome:'Gemini CLI',instalado:false,ponte:true,modelos:[]}];
      const fetchOriginal=window.fetch;window.fetch=(url,opcoes={})=>{
        const caminho=new URL(String(url),location.href).pathname;
        if(caminho.endsWith('/agentes'))return Promise.resolve(Response.json({agentes:window.avAgentes,ponte:{agente:'claude'},ouvintes:[]}));
        if(caminho.endsWith('/agente/atual')&&window.avAgente)return Promise.resolve(Response.json({ok:true,agente:window.avAgente,marca:'<svg></svg>',modelo:null}));
        if(window.avChat && caminho.includes('/chat/')) {
          if(caminho.endsWith('/catalogo'))return Promise.resolve(Response.json({agentes:window.avAgentes.filter(a=>a.instalado),sessoesExternas:[]}));
          if(caminho.endsWith('/sessoes'))return Promise.resolve(Response.json({sessoes:[window.avChat]}));
          if(caminho.endsWith('/sessoes/'+window.avChat.id))return Promise.resolve(Response.json({conversa:window.avChat}));
          if(caminho.endsWith('/limites'))return Promise.resolve(Response.json({agente:'claude',disponivel:false,janelas:[],atualizadoEm:null}));
        }
        if(caminho.endsWith('/avaliacoes')&&opcoes.method==='POST'){window.avPosts.push(JSON.parse(opcoes.body));return Promise.resolve(window.avPostErro?Response.json({erro:window.avPostErro},{status:503}):window.avConflito?Response.json({erro:'O agente foi alterado em outra aba. Confira o nome atualizado antes de pedir o parecer.'},{status:409}):Response.json({ok:true,id:'avaliacao-ui-'+String(window.avPosts.length).padStart(4,'0'),conversa:window.avResposta.conversa},{status:201}));}
        if(caminho.includes('/avaliacoes/avaliacao-ui-')){window.avGets++;if(window.avAdiarPrimeira&&window.avGets===1)return new Promise(resolve=>window.avResolverPrimeira=resolve);return Promise.resolve(new Response(JSON.stringify(window.avResposta),{status:window.avStatus}));}
        return fetchOriginal(url,opcoes);
      };
      const timeoutOriginal=window.setTimeout;window.setTimeout=(fn,tempo,...args)=>timeoutOriginal(fn,tempo===3000?60:tempo,...args);
    })()`);
  });
  after(async () => { await navegador?.fechar(); await proxy?.fechar(); await alvo?.fechar(); });

  test("pedido abre o chat vinculado, mostra a sessão e pode ser reaberto sem nova avaliação", async () => {
    const id = 'aaaaaaaa-bbbb-5ccc-addd-eeeeeeeeeeee', nativa = '11111111-2222-4333-a444-555555555555';
    await pagina.avaliar(`window.avResposta.conversa={id:'${id}',agente:'claude',modelo:null,sessaoExterna:'${nativa}'};window.avChat={...window.avResposta.conversa,titulo:'Avaliação · /',atualizadaEm:new Date().toISOString(),ocupada:false,somenteLeitura:true,motivoSomenteLeitura:'Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.',avaliacao:{id:'avaliacao-ui-0001',url:location.href,acompanhando:true,emAndamento:true},mensagens:[{id:'m1',autor:'usuario',texto:'Avaliar a página',em:new Date().toISOString()},{id:'m2',autor:'agente',texto:'Conferindo a hierarquia visual.',em:new Date().toISOString()}]}`);
    await abrir(); await pedir();
    await pagina.esperarPor(`${no('.an-chat')}?.checkVisibility() && ${no('.an-chat-mensagens')}.textContent.includes('Conferindo a hierarquia visual.')`);
    assert.equal(await pagina.avaliar(`${no('.an-avaliacao')}.hidden`), true);
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-sessao-id')}.textContent`), /11111111/);
    assert.equal(await pagina.avaliar(`${no('.an-chat-sessao-id')}.title`), nativa);
    assert.equal(await pagina.avaliar('window.avPosts.length'), 1);
    for (const largura of [873, 390]) {
      await pagina.definirViewport(largura, 746);
      const caixa = await rect('.an-chat');
      assert.ok(caixa.left >= 0 && caixa.left + caixa.width <= largura + 1);
      const cabecalho = await rect('.an-chat-cab'), identidade = await rect('.an-chat-identidade');
      assert.ok(identidade.top >= cabecalho.top && identidade.top + identidade.height <= cabecalho.top + cabecalho.height,
        'cabeçalho mantém título e sessão inteiros em telas pequenas');
      assert.equal(await pagina.avaliar(`${no('.an-chat-enviar')}.disabled`), true);
    }
    await pagina.definirViewport(1200, 800);
    await clicar('.an-barra button[title^="Avaliar a página"]');
    await pagina.esperarPor(`${no('.an-avaliacao-chat')}?.checkVisibility()`);
    await clicar('.an-avaliacao-chat');
    await pagina.esperarPor(`${no('.an-avaliacao')}.hidden`);
    assert.equal(await pagina.avaliar('window.avPosts.length'), 1, 'abrir a mesma sessão não reenvia');
  });

  test("mede a página, envia evidências e mostra o parecer sem perder o foco digitado", async () => {
    const medicao=await pagina.avaliar<ResultadoAuditoria>('window.__anotadorDebug.auditar()');
    await abrir(); assert.match(await texto(),new RegExp(String(medicao.medidos)+' elementos'));
    await pagina.avaliar(`${no('.an-avaliacao .rodape input')}.value='Avaliar a hierarquia';${no('.an-avaliacao .rodape input')}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await pedir(); await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('está avaliando')`);
    const corpo=await pagina.avaliar<{foco:string;achados:AchadoAuditoria[];contexto:{medidos:number};pagina:{url:string};instantaneo:null}>('window.avPosts[0]');
    assert.equal(corpo.foco,'Avaliar a hierarquia'); assert.equal(corpo.contexto.medidos,medicao.medidos); assert.deepEqual(corpo.achados,medicao.achados); assert.equal(corpo.pagina.url,proxy.origem+'/'); assert.equal(corpo.instantaneo,null);
    await pagina.avaliar(`window.avResposta.parecer={agente:'Claude Code',resumo:'Hierarquia revisada na página atual.',itens:[{titulo:'Ação principal discreta',categoria:'hierarquia',gravidade:'media',problema:'O botão compete com o conteúdo.',sugestao:'Dar destaque à ação.',seletor:'#salvar'}],perguntas:[]}`);
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('Hierarquia revisada')`);
    assert.doesNotMatch(await texto(),/Aguardando|está avaliando/); assert.equal(await pagina.avaliar(`${no('.an-avaliacao .rodape input')}.value`),'Avaliar a hierarquia');
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(),[],"fixture não executa nem envia prompt real");
  });

  test("troca o agente numa nova conversa; cancelar ou falhar preserva o parecer anterior", async () => {
    await abrir(); await pedir();
    await pagina.avaliar(`window.avResposta.conversa={id:'aaaaaaaa-bbbb-5ccc-addd-eeeeeeeeeeee',agente:'codex',modelo:'codex-teste',sessaoExterna:'11111111-2222-4333-a444-555555555555'};window.avResposta.parecer={agente:'Codex CLI',resumo:'Parecer anterior preservado.',itens:[]}`);
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('Parecer anterior preservado.')`);
    const escolherClaude = async () => {
      await clicar('.an-avaliacao-nova');
      await pagina.esperarPor(`${no('.an-avaliacao-agente')}?.options.length === 2`);
      await clicar('.an-avaliacao-escolhas button[aria-label="Agente"]');
      await pagina.esperarPor(`${no('.an-seletor-popup')}?.checkVisibility()`);
      await clicar('.an-seletor-popup .an-seletor-opcao:nth-child(2)');
      assert.equal(await pagina.avaliar(`${no('.an-avaliacao-modelo')}.value`), '', 'modelo anterior não passa para outro agente');
      await clicar('.an-avaliacao-escolhas button[aria-label="Modelo"]');
      await clicar('.an-seletor-popup .an-seletor-opcao:nth-child(2)');
      await clicar('.an-avaliacao-escolhas button[aria-label="Raciocínio"]');
      await clicar('.an-seletor-popup .an-seletor-opcao:nth-child(3)');
      assert.match(await pagina.avaliar<string>(`${no('.an-avaliacao .rodape button')}.textContent`), /Iniciar com Claude Code/);
    };
    await escolherClaude();
    assert.equal(await pagina.avaliar('window.avPosts.length'), 1, 'selecionar não envia');
    for (const largura of [873, 390]) {
      await pagina.definirViewport(largura, 746);
      await pagina.esperar(50);
      const medidas = await pagina.avaliar<{left:number;right:number;bottom:number;overflow:boolean}>(`(()=>{const e=${no('.an-avaliacao')},r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:e.scrollWidth>e.clientWidth}})()`);
      assert.ok(medidas.left >= 0 && medidas.right <= largura + 1 && medidas.bottom <= 747 && !medidas.overflow, JSON.stringify(medidas));
    }
    await clicar('.an-avaliacao-escolhas-cab button');
    assert.match(await texto(), /Parecer anterior preservado/);
    assert.match(await pagina.avaliar<string>(`${no('.an-avaliacao-chat-info strong')}.textContent`), /Codex CLI/);
    await escolherClaude();
    await pagina.avaliar(`window.avPostErro='O agente está indisponível.';${no('.an-avaliacao .rodape input')}.value='Revisar contraste';${no('.an-avaliacao .rodape input')}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await clicar('.an-avaliacao .rodape button');
    await pagina.esperarPor(`${no('.an-avaliacao [role="alert"]')}?.textContent.includes('indisponível')`);
    assert.match(await pagina.avaliar<string>(`${no('.an-avaliacao-chat-info strong')}.textContent`), /Codex CLI/);
    assert.equal(await pagina.avaliar(`localStorage.getItem('anotador-ui:avaliacao:teste:/')`), 'avaliacao-ui-0001');
    await pagina.avaliar(`window.avPostErro=null;window.avResposta={ok:true,parecer:null,estado:{fase:'executando',agente:'claude'},conversa:{id:'bbbbbbbb-bbbb-5ccc-addd-eeeeeeeeeeee',agente:'claude',modelo:'claude-teste',sessaoExterna:null}};window.avChat={...window.avResposta.conversa,esforco:'high',titulo:'Nova avaliação Claude',atualizadaEm:new Date().toISOString(),ocupada:false,mensagens:[{id:'m1',autor:'agente',texto:'Avaliando com Claude.',em:new Date().toISOString()}]}`);
    await clicar('.an-avaliacao .rodape button');
    await pagina.esperarPor(`${no('.an-chat-mensagens')}?.textContent.includes('Avaliando com Claude.')`);
    assert.equal(await pagina.avaliar(`${no('.an-avaliacao')}.hidden`), true);
    const enviada = await pagina.avaliar<{destino:unknown;id?:string;agenteEsperado?:string;foco:string}>('window.avPosts[2]');
    assert.deepEqual(enviada.destino, { agente: 'claude', modelo: 'claude-teste', esforco: 'high' });
    assert.equal(enviada.id, undefined); assert.equal(enviada.agenteEsperado, undefined); assert.equal(enviada.foco, 'Revisar contraste');
    assert.equal(await pagina.avaliar(`localStorage.getItem('anotador-ui:avaliacao:teste:/')`), 'avaliacao-ui-0003');
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), [], 'nenhum prompt real é enviado');
    await pagina.definirViewport(1200, 800);
  });

  test("falha de autenticação encerra espera e consulta manual pode recuperar parecer posterior", async () => {
    await pagina.avaliar(`window.avResposta.estado={fase:'falhou',agente:'Claude Code',atualizadoEm:'agora',erro:'A autenticação do agente expirou.'}`);
    await abrir(); await pedir(); await pagina.esperarPor(`${no('.an-avaliacao-consultar')} !== null`);
    assert.match(await texto(),/autenticação do agente expirou/); assert.doesNotMatch(await texto(),/Aguardando|está avaliando/);
    const gets=await pagina.avaliar<number>('window.avGets'); await pagina.esperar(160); assert.equal(await pagina.avaliar<number>('window.avGets'),gets,'falha terminal não continua consultando');
    await pagina.avaliar(`window.avResposta.parecer={agente:'Claude Code',resumo:'Parecer recuperado.',itens:[],perguntas:[]}`);
    await clicar('.an-avaliacao-consultar'); await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('Parecer recuperado.')`);
    assert.doesNotMatch(await texto(),/não concluiu|autenticação.*expirou/);
  });

  test("confere agente ao abrir e rejeita troca entre abas sem reenviar silenciosamente", async () => {
    await pagina.avaliar("window.avAgente='Codex CLI'");
    await abrir();
    assert.match(await pagina.avaliar<string>(`${no('.an-avaliacao .rodape button')}.textContent`), /Pedir parecer a Codex CLI/);
    await pagina.avaliar("window.avAgente='Claude Code';window.avConflito=true");
    await pedir();
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('alterado em outra aba')`);
    assert.equal(await pagina.avaliar("window.avPosts[0].agenteEsperado"),'Codex CLI');
    assert.match(await pagina.avaliar<string>(`${no('.an-avaliacao .rodape button')}.textContent`), /Pedir parecer a Claude Code/);
    assert.equal(await pagina.avaliar('window.avPosts.length'),1);
    assert.equal(await pagina.avaliar('window.avGets'),0);
    assert.equal((await proxy.servidor.avaliacoes.listar()).length,0);
  });

  test("fim sem parecer e erro HTTP ficam visíveis com recuperação sem reenviar pedido", async () => {
    await pagina.avaliar(`window.avResposta.estado.fase='sem_parecer'`); await abrir(); await pedir();
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('sem devolver um parecer')`);
    await pagina.avaliar(`window.avStatus=403;window.avResposta={ok:false,erro:'Sessão de acesso expirada.'}`); await clicar('.an-avaliacao-consultar');
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('Sessão de acesso expirada.')`);
    assert.doesNotMatch(await texto(),/Aguardando/); assert.equal(await pagina.avaliar<number>('window.avPosts.length'),1);
  });

  test("fechar e reabrir retoma consulta e ignora resposta antiga que chegou atrasada", async () => {
    await pagina.avaliar('window.avAdiarPrimeira=true'); await abrir(); await pedir(); await pagina.esperarPor('!!window.avResolverPrimeira');
    await clicar('.an-avaliacao .cab button[title="Fechar"]');
    await pagina.avaliar(`window.avResposta.parecer={agente:'Claude Code',resumo:'Retorno atual.',itens:[],perguntas:[]}`); await abrir();
    await pagina.esperarPor(`${no('.an-avaliacao')}.textContent.includes('Retorno atual.')`);
    await pagina.avaliar(`window.avResolverPrimeira(new Response(JSON.stringify({parecer:{agente:'Outro',resumo:'Resposta antiga.',itens:[],perguntas:[]}})))`); await pagina.esperar(80);
    assert.match(await texto(),/Retorno atual/); assert.doesNotMatch(await texto(),/Resposta antiga/);
  });

  test("alça inicia uma única captura e mouse solto nunca arrasta o painel", async () => {
    await abrir();
    await pagina.avaliar(`(()=>{window.capturasArrasto=0;const original=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=function(...args){window.capturasArrasto++;return original.apply(this,args)}})()`);
    await clicar('.an-avaliacao .cab .an-alca');
    assert.equal(await pagina.avaliar<number>('window.capturasArrasto'),1,'alça e cabeçalho não disputam captura');
    let antes=await rect('.an-avaliacao'),alca=await rect('.an-avaliacao .cab .an-alca');
    await pagina.mover(alca.left+2,alca.top+2); await pagina.mover(alca.left+8,alca.top+8);
    assert.deepEqual(await rect('.an-avaliacao'),antes);
    await pagina.arrastar({x:alca.left+alca.width/2,y:alca.top+alca.height/2},{x:alca.left-170,y:alca.top+80});
    const depois=await rect('.an-avaliacao'); assert.ok(depois.left<antes.left-100);
    alca=await rect('.an-avaliacao .cab .an-alca'); await pagina.mover(alca.left+4,alca.top+4); await pagina.mover(alca.left+12,alca.top+12);
    assert.deepEqual(await rect('.an-avaliacao'),depois); assert.equal(await pagina.avaliar(`${no('.an-avaliacao')}.classList.contains('arrastando')`),false);
  });

  for(const modo of ['lostpointercapture','blur','buttons-zero'])test(`arrasto encerra em ${modo} e ignora eventos posteriores`,async()=>{
    await abrir();
    const dados=await pagina.avaliar<{antes:Rect;depois:Rect;ativo:boolean}>(`(()=>{
      const alca=${no('.an-avaliacao .cab .an-alca')},painel=${no('.an-avaliacao')},r=alca.getBoundingClientRect();
      alca.setPointerCapture=()=>{};alca.releasePointerCapture=()=>{};
      const evento=(tipo,buttons,x=r.left,y=r.top)=>new PointerEvent(tipo,{pointerId:42,isPrimary:true,pointerType:'mouse',button:0,buttons,clientX:x,clientY:y,bubbles:true});
      alca.dispatchEvent(evento('pointerdown',1)); alca.dispatchEvent(evento('pointermove',1,r.left-100,r.top+30));
      const antes=painel.getBoundingClientRect().toJSON();
      if(${JSON.stringify(modo)}==='blur')window.dispatchEvent(new Event('blur'));
      else if(${JSON.stringify(modo)}==='buttons-zero')alca.dispatchEvent(evento('pointermove',0,r.left-120,r.top+40));
      else alca.dispatchEvent(evento('lostpointercapture',0));
      alca.dispatchEvent(evento('pointermove',1,r.left-180,r.top+50));
      return {antes,depois:painel.getBoundingClientRect().toJSON(),ativo:painel.classList.contains('arrastando')};
    })()`);
    assert.deepEqual(dados.depois,dados.antes); assert.equal(dados.ativo,false);
  });
});
