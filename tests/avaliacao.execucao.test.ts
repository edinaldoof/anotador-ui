import assert from "node:assert/strict";
import { test } from "node:test";
import { Ponte, type Execucao, type PedidoPonte } from "../lib/agentes.ts";
import { BASE } from "../server.ts";
import { criarAlvoFalso, criarProxy, esperarAte, pedir } from "./ajuda.ts";

test("avaliação acompanha execução, falha segura e parecer recebido depois sem chamar CLI real", async (t) => {
  const chamadas: Array<{ pedido: PedidoPonte; execucao: Execucao }> = [];
  t.mock.method(Ponte.prototype,"iniciar",async (pedido:PedidoPonte):Promise<Execucao>=>{
    const execucao:Execucao={id:'execucao-avaliacao-'+chamadas.length,agente:pedido.agente,sessao:pedido.sessao,modelo:pedido.modelo,comando:['simulado'],pid:null,iniciadoEm:new Date().toISOString(),terminadoEm:null,codigo:null,log:'',motivo:pedido.motivo};
    chamadas.push({pedido,execucao}); await pedido.aoAtualizar?.(execucao); return execucao;
  });
  const alvo=await criarAlvoFalso(),proxy=await criarProxy(alvo,{capturas:false,fonte:null,ponte:{agente:'claude',sessao:null,modelo:null,esforco:null}});
  const ler=async(id:string)=>JSON.parse((await pedir(proxy.origem+BASE+'/avaliacoes/'+id)).corpo);
  const enviar=async(id:string)=>{const r=await pedir(proxy.origem+BASE+'/avaliacoes',{metodo:'POST',headers:{'content-type':'application/json'},corpo:JSON.stringify({id,pagina:{url:alvo.origem,titulo:'Página avaliada',viewport:{largura:1200,altura:800,dpr:1}},contexto:{medidos:49},achados:[{regra:'p-as-heading',alvo:'p.titulo',evidencia:'Título visual em um parágrafo.',gravidade:'media',origem:'norma'}]})});assert.equal(r.status,201,r.corpo)};
  try {
    const id='avaliacao-execucao-0001'; await enviar(id);
    await esperarAte(async()=> (await ler(id)).estado?.fase==='executando',3000,20);
    const chamada=chamadas[0]; assert.ok(chamada); assert.match(chamada.pedido.mensagem,/dossiê/);
    assert.equal((await ler(id)).avaliacao.contexto.medidos,49); assert.equal((await ler(id)).avaliacao.achados[0].regra,'p-as-heading');
    const md=await proxy.servidor.avaliacoes.lerMarkdown(id); assert.match(md??'',/49 elementos visíveis/); assert.match(md??'',/p-as-heading/);
    await chamada.pedido.aoAtualizar?.({...chamada.execucao,terminadoEm:new Date().toISOString(),codigo:1,erro:'A autenticação do agente expirou. O pedido continua salvo.'});
    const falha=await ler(id); assert.equal(falha.estado.fase,'falhou'); assert.match(falha.estado.erro,/autenticação/); assert.equal(falha.parecer,null);
    const r=await pedir(proxy.origem+BASE+'/avaliacoes/'+id+'/parecer',{metodo:'POST',headers:{'content-type':'application/json'},corpo:JSON.stringify({agente:'Claude Code',resumo:'Parecer recuperado',itens:[],perguntas:[]})}); assert.equal(r.status,201);
    assert.equal((await ler(id)).parecer.resumo,'Parecer recuperado');
    const outro='avaliacao-execucao-0002'; await enviar(outro); await esperarAte(()=>chamadas.length===2,3000,20); const segunda=chamadas[1]; assert.ok(segunda);
    await segunda.pedido.aoAtualizar?.({...segunda.execucao,terminadoEm:new Date().toISOString(),codigo:0}); assert.equal((await ler(outro)).estado.fase,'sem_parecer');
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("avaliação não fica aguardando quando a ponte falha antes de iniciar", async(t)=>{
  t.mock.method(Ponte.prototype,'iniciar',async()=>{throw new Error('falha interna: chave-super-secreta')});
  const alvo=await criarAlvoFalso(),proxy=await criarProxy(alvo,{capturas:false,fonte:null,ponte:{agente:'claude',sessao:null}});
  try {
    const id='avaliacao-nao-iniciada';const r=await pedir(proxy.origem+BASE+'/avaliacoes',{metodo:'POST',headers:{'content-type':'application/json'},corpo:JSON.stringify({id,pagina:{url:alvo.origem}})});assert.equal(r.status,201);
    await esperarAte(async()=> (await proxy.servidor.avaliacoes.lerEstado(id))?.fase==='falhou',3000,20);
    const resposta=await pedir(proxy.origem+BASE+'/avaliacoes/'+id); assert.match(resposta.corpo,/Não foi possível iniciar/);assert.doesNotMatch(resposta.corpo,/super-secreta/);
  } finally {await proxy.fechar();await alvo.fechar()}
});

test("avaliação recusa o agente de uma aba antiga antes de gravar ou executar", async(t)=>{
  const chamadas: PedidoPonte[]=[];
  t.mock.method(Ponte.prototype,'iniciar',async(pedido:PedidoPonte)=>{chamadas.push(pedido);return {} as Execucao});
  const alvo=await criarAlvoFalso(),proxy=await criarProxy(alvo,{capturas:false,fonte:null,agente:'Codex CLI',ponte:{agente:'codex',sessao:null,modelo:'gpt-6-astra'}});
  const enviar=(agenteEsperado:string)=>pedir(proxy.origem+BASE+'/avaliacoes',{metodo:'POST',headers:{'content-type':'application/json'},corpo:JSON.stringify({id:'avaliacao-agente-fixo',agenteEsperado,pagina:{url:alvo.origem}})});
  try {
    const atual=JSON.parse((await pedir(proxy.origem+BASE+'/agente/atual')).corpo);
    assert.equal(atual.agente,'Codex CLI');assert.match(atual.modelo,/GPT-6/);
    const antiga=await enviar('Claude Code');assert.equal(antiga.status,409);assert.match(antiga.corpo,/alterado em outra aba/);
    assert.equal(chamadas.length,0);assert.deepEqual(await proxy.servidor.avaliacoes.listar(),[]);
    const aceita=await enviar('Codex CLI');assert.equal(aceita.status,201);assert.equal(JSON.parse(aceita.corpo).agente,'Codex CLI');
    await esperarAte(()=>chamadas.length===1,3000,20);assert.equal(chamadas[0]?.agente,'codex');assert.equal(chamadas[0]?.modelo,'gpt-6-astra');
  } finally {await proxy.fechar();await alvo.fechar()}
});
