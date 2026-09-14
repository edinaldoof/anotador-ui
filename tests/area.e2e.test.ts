import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, Pagina, encontrarChromium } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const no = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;

describe("anotação de área exata e vários elementos", {skip: chrome ? false : "Chromium não encontrado", timeout: 90_000}, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => {const e=(${expressao});e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    assert.ok(r.width > 0 && r.height > 0);
    await pagina.clicar(r.left+r.width/2,r.top+r.height/2);
  };
  const atual = () => pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()");
  const aguardarArea = () => pagina.esperarPor("window.__anotadorDebug.atual()?.area");
  const inspecionar = async () => { await clicar(no('.an-balao [title="Detalhes da área selecionada"]')); await pagina.esperarPor(`${no(".an-area-elementos")}?.checkVisibility()`); };
  const comentar = async (texto: string) => {
    await clicar(no(".an-balao input"));
    await pagina.digitar(texto);
  };
  before(async () => {
    alvo=await criarAlvoFalso(); proxy=await criarProxy(alvo);
    navegador=await Navegador.abrir({caminho:chrome}); pagina=await navegador.novaPagina();
    await pagina.navegar(proxy.origem); await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async () => {
    await pagina.definirViewport(1200,800);
    await pagina.avaliar("localStorage.clear();sessionStorage.clear()");
    await pagina.navegar(proxy.origem); await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(`(() => {
      document.body.style.minHeight="3000px";
      const caixa=document.createElement("section");caixa.id="grupo-area";
      caixa.innerHTML='<button id="primeiro-area">Primeiro</button><button id="segundo-area">Segundo</button><button id="fora-area">Fora</button>';
      document.body.append(caixa); caixa.style.cssText="position:absolute;left:80px;top:900px;width:700px;height:250px;background:#eee;";
      for(const [id,left] of [["primeiro-area",20],["segundo-area",200],["fora-area",530]]) {
        document.getElementById(id).style.cssText="position:absolute;left:"+left+"px;top:40px;width:120px;height:50px;";
      }
      window.scrollTo(0,800);
    })()`);
    await pagina.esperarPor("scrollY === 800");
  });
  after(async () => {await navegador?.fechar();await proxy?.fechar();await alvo?.fechar();});

  test("retângulo em DPR 2 inclui vários alvos, permanece preso à página e restaura após reload", async () => {
    await pagina.definirViewport(1200,800,2);
    await pagina.arrastar({x:90,y:125},{x:410,y:220}); await aguardarArea();
    const a=await atual();
    assert.deepEqual(a.area?.rectPagina,{left:90,top:925,width:320,height:95});
    assert.equal(a.area?.viewport.dpr,2);
    assert.equal(a.area?.viewport.scrollY,800);
    assert.deepEqual(a.area?.elementos.map(el=>el.meta.attrs["id"]),["primeiro-area","segundo-area"]);
    assert.ok(a.area?.elementos.every(el=>el.intersecao === "inteiro"));
    assert.deepEqual(a.elemento.seletores,[],"não confunde o grupo com o ancestral section");
    await comentar("Ajustar os dois botões juntos");
    await inspecionar();
    assert.equal(await pagina.avaliar<number>(`${no(".an-painel .corpo")}.querySelectorAll("input,select").length`),0,"não aplica CSS ao ancestral");
    await writeFile("/tmp/anotador-area-precisa.png",await pagina.capturar({alemDoViewport:false}));
    await pagina.avaliar('document.body.style.minHeight="3000px"; window.scrollTo(0,850)');
    await pagina.esperarPor(`Math.abs(${no(".an-caixa.selecao")}.getBoundingClientRect().top-75)<1`);
    assert.deepEqual((await atual()).area?.rectPagina,a.area?.rectPagina);
    await clicar(no('.an-painel [title="Confirmar"]'));
    assert.equal(await pagina.avaliar<number>("window.__anotadorDebug.pendentes().length"),1);
    await pagina.navegar(proxy.origem); await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar('document.body.style.minHeight="3000px"; window.scrollTo(0,850)');
    await pagina.esperarPor(`${no(".an-pin")} && Math.abs(${no(".an-pin")}.getBoundingClientRect().top-75)<20`);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-pin")}.classList.contains("perdido")`),false,"região não depende do DOM original continuar existindo");
    if (await pagina.avaliar<boolean>(`${no(".an-arvore")}?.checkVisibility()`)) await clicar(no('.an-arvore [title^="Fechar"]'));
    await clicar(no(".an-pin"));
    await aguardarArea();
    assert.deepEqual((await atual()).area,a.area);
    assert.equal((await atual()).comentario,"Ajustar os dois botões juntos");
  });

  test("aceita recorte parcial e área vazia sem expandir ao elemento mais próximo", async () => {
    await pagina.arrastar({x:120,y:150},{x:155,y:175}); await aguardarArea();
    const a=await atual();
    assert.deepEqual(a.area?.rectPagina,{left:120,top:950,width:35,height:25});
    assert.deepEqual(a.area?.elementos.map(el=>[el.meta.attrs["id"],el.intersecao]),[["primeiro-area","parcial"]]);
    await pagina.pressionar("Escape");
    await pagina.pressionar("Escape");
    if (await pagina.avaliar<boolean>(`${no(".an-arvore")}?.checkVisibility()`)) await clicar(no('.an-arvore [title^="Fechar"]'));
    await pagina.arrastar({x:850,y:400},{x:870,y:420}); await aguardarArea();
    assert.deepEqual((await atual()).area?.rectPagina,{left:850,top:1200,width:20,height:20});
    assert.deepEqual((await atual()).area?.elementos,[]);
  });

  test("rolar no meio do arrasto preserva a origem no documento", async () => {
    const canal=(pagina as unknown as {canal:ConstructorParameters<typeof Pagina>[0]}).canal;
    await pagina.mover(90,125);
    await canal.enviar("Input.dispatchMouseEvent",{type:"mousePressed",x:90,y:125,button:"left",buttons:1,clickCount:1},pagina.sessionId);
    await canal.enviar("Input.dispatchMouseEvent",{type:"mouseMoved",x:200,y:190,button:"left",buttons:1},pagina.sessionId);
    await pagina.avaliar("window.scrollTo(0,850)");
    await pagina.esperarPor("scrollY === 850");
    await canal.enviar("Input.dispatchMouseEvent",{type:"mouseMoved",x:410,y:220,button:"left",buttons:1},pagina.sessionId);
    await canal.enviar("Input.dispatchMouseEvent",{type:"mouseReleased",x:410,y:220,button:"left",buttons:0,clickCount:1},pagina.sessionId);
    await aguardarArea();
    assert.deepEqual((await atual()).area?.rectPagina,{left:90,top:925,width:320,height:145});
  });

  test("iframe com borda e escala usa coordenadas superiores e inclui shadow DOM", async () => {
    await pagina.avaliar(`(() => {
      const frame=document.createElement("iframe");frame.id="frame-area";
      frame.style.cssText="position:absolute;left:600px;top:1050px;width:240px;height:150px;border:8px solid black;transform:scale(1.25);transform-origin:top left;";
      document.body.append(frame);
      const doc=frame.contentDocument;doc.body.innerHTML='<button id="botao-frame">No frame</button><div id="host-sombra"></div>';
      doc.body.style.margin="0";doc.querySelector("button").style.cssText="position:absolute;left:20px;top:20px;width:90px;height:40px;";
      const host=doc.querySelector("#host-sombra");host.style.cssText="position:absolute;left:130px;top:20px;width:90px;height:40px";
      const shadow=host.attachShadow({mode:"open"});const botao=doc.createElement("button");botao.id="botao-sombra";botao.textContent="Sombra";botao.style.cssText="width:90px;height:40px";shadow.append(botao);
    })()`);
    // Inicia dentro do frame e cruza seus dois botões; o evento continua no documento superior.
    await pagina.arrastar({x:620,y:270},{x:895,y:350}); await aguardarArea();
    const area=(await atual()).area;
    assert.deepEqual(area?.rectPagina,{left:620,top:1070,width:275,height:80});
    assert.deepEqual(area?.elementos.map(el=>el.meta.attrs["id"]),["botao-frame","botao-sombra"]);
    const primeiro=area?.elementos[0],segundo=area?.elementos[1];
    assert.deepEqual(primeiro?.rect,{left:635,top:285,width:112.5,height:50});
    assert.deepEqual(primeiro?.framePath,["#frame-area"]);
    assert.deepEqual(segundo?.shadowPath,["#host-sombra"]);
  });

  test("print e envio levam o retângulo exato e a lista de alvos, sem alterar CSS", async () => {
    await pagina.avaliar(`(() => {
      const original=window.fetch;
      window.fetch=async (...args)=>{
        const url=new URL(String(args[0]),location.href);
        if(args[1]?.method==="POST" && url.pathname.endsWith("/anexos/captura")) {
          const p=window.capturaAreaTeste=JSON.parse(args[1].body);
          return Response.json({anexo:{id:"captura-area-teste",anotacaoId:p.anotacaoId,paginaUrl:location.href,capturadoEm:new Date().toISOString(),largura:1200,altura:800,viewport:p.pagina.viewport,caminho:"/tmp/area-teste.png"}});
        }
        if(args[1]?.method==="POST" && url.pathname.endsWith("/lotes")) {window.loteAreaTeste=JSON.parse(args[1].body);return Response.json({id:window.loteAreaTeste.id});}
        return original(...args);
      };
    })()`);
    const estilo=await pagina.avaliar<string>('document.querySelector("#grupo-area").getAttribute("style")');
    await pagina.arrastar({x:410,y:220},{x:90,y:125}); await aguardarArea();
    await comentar("Rever o espaço entre os botões");
    const area=(await atual()).area;
    await inspecionar();
    await clicar(no(".an-tirar-print"));
    await pagina.esperarPor("window.__anotadorDebug.atual().anexos?.length === 1");
    const marcador=await pagina.avaliar<string>(`(() => { const doc=new DOMParser().parseFromString(window.capturaAreaTeste.instantaneo,"text/html"); return doc.querySelector('div[style*="2147483000"]').getAttribute("style"); })()`);
    assert.match(marcador,/left:\s*90px;\s*top:\s*925px;\s*width:\s*320px;\s*height:\s*95px/);
    await clicar(no('.an-painel [title="Confirmar"]'));
    await clicar(no(".an-enviar"));
    await pagina.esperarPor("window.loteAreaTeste");
    const anotacao=await pagina.avaliar<Anotacao>("window.loteAreaTeste.anotacoes[0]");
    assert.deepEqual(anotacao.area,area);
    assert.deepEqual(anotacao.elemento.rectPagina,area?.rectPagina);
    assert.equal(anotacao.anexos?.[0]?.id,"captura-area-teste");
    assert.deepEqual(anotacao.alteracoes,[]);
    assert.equal(await pagina.avaliar<string>('document.querySelector("#grupo-area").getAttribute("style")'),estilo);
  });
});
