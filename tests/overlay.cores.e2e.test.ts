import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();
const sombra = 'document.getElementById("__anotador_host").shadowRoot';
const no = (seletor: string) => `${sombra}.querySelector(${JSON.stringify(seletor)})`;
const paleta = no(".an-cor-popup");
const botaoCor = (rotulo = "cor do texto") => no(`.an-cor-abrir[aria-label="Escolher ${rotulo}"]`);

describe("paleta de cores integrada e rolagem do chat", { skip: chrome ? false : "Chromium não encontrado", timeout: 90_000 }, () => {
  let alvo: AlvoFalso, proxy: ProxySobTeste, navegador: Navegador, pagina: Pagina;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => { const el = (${expressao}); el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    assert.ok(r.width > 0 && r.height > 0);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const abrir = async (rotulo?: string) => { await clicar(botaoCor(rotulo)); await pagina.esperarPor(`${paleta}?.checkVisibility()`); };
  const corPagina = () => pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).color');
  const escreverHex = async (valor: string) => {
    const campo = no(".an-cor-hex");
    await clicar(campo); await pagina.avaliar(`${campo}.select()`); await pagina.digitar(valor); await pagina.pressionar("Enter");
  };
  before(async () => {
    alvo = await criarAlvoFalso(); proxy = await criarProxy(alvo); navegador = await Navegador.abrir({ caminho: chrome, mostrarBarrasRolagem: true }); pagina = await navegador.novaPagina();
    await pagina.navegar(proxy.origem + "/"); await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async () => {
    await pagina.definirViewport(1200, 800, 1);
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/"); await pagina.esperarPor("window.__anotadorCarregado");
    await clicar('document.querySelector("p.rotulo")');
    await pagina.esperarPor(no(".an-balao")); await clicar(no('.an-balao [title="Propriedades do elemento"]'));
    await pagina.esperarPor(`${sombra}.activeElement === ${no(".an-painel .cab textarea")}`);
  });
  after(async () => { await navegador?.fechar(); await proxy?.fechar(); await alvo?.fechar(); });

  test("HEX altera a prévia; Escape fecha só a paleta e Cancelar desfaz a mudança", async () => {
    const antes = await corPagina();
    await abrir();
    assert.equal(await pagina.avaliar<number>(`${sombra}.querySelectorAll('input[type="color"]').length`), 0);
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${paleta}).backgroundColor`), "rgb(26, 30, 29)");
    await escreverHex("#2468AC");
    assert.equal(await corPagina(), "rgb(36, 104, 172)");
    const anotacao = await pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()");
    assert.equal(anotacao.alteracoes.find((a) => a.propriedade === "color")?.depois, "rgb(36, 104, 172)");
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<boolean>(`${paleta} === null`), true);
    assert.equal(await pagina.avaliar<boolean>(`${no(".an-painel")}.checkVisibility()`), true);
    assert.equal(await pagina.avaliar<boolean>(`${sombra}.activeElement === ${botaoCor()}`), true);
    assert.equal(await corPagina(), "rgb(36, 104, 172)");
    await pagina.pressionar("Escape"); assert.equal(await corPagina(), antes);
  });

  test("transparência existente é preservada; RGB e opacidade funcionam pelo teclado", async () => {
    await abrir("fundo");
    assert.equal(await pagina.avaliar<string>(`${no('.an-cor-alpha')}.value`), "0");
    assert.equal(await pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).backgroundColor'), "rgba(0, 0, 0, 0)");
    await escreverHex("#20406080");
    const fundo = await pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).backgroundColor');
    assert.match(fundo, /^rgba\(32, 64, 96, 0\.5(?:0[12])?\)/);
    await clicar(no('.an-cor-valores [aria-label="Vermelho"]')); await pagina.pressionar("ArrowUp");
    assert.match(await pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).backgroundColor'), /^rgba\(33, 64, 96, 0\.5(?:0[12])?\)/);
    await pagina.avaliar(`${no('.an-cor-alpha')}.focus()`); await pagina.pressionar("ArrowRight");
    assert.equal(await pagina.avaliar<string>(`${no('.an-cor-alpha')}.value`), "51");
    await clicar(no(".an-painel .cab .an-ico"));
    assert.equal(await pagina.avaliar<boolean>(`${paleta} === null`), true);
    assert.match(await pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).backgroundColor'), /^rgba\(33, 64, 96, 0\.51\)/);
  });

  test("arrastar a área de cor é preciso e setas alteram apenas a dimensão indicada", async () => {
    await abrir(); await escreverHex("#FF0000");
    const plano = no(".an-cor-plano");
    const r = await pagina.avaliar<Rect>(`(() => { const r=${plano}.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height} })()`);
    await pagina.arrastar({x:r.left+r.width*.1,y:r.top+r.height*.1},{x:r.left+r.width*.75,y:r.top+r.height*.25});
    const valor = await corPagina();
    assert.match(valor, /^rgb\(19[01], 4[78], 4[78]\)$/);
    assert.match(await pagina.avaliar<string>(`${plano}.getAttribute("aria-valuetext")`), /Saturação 75%, brilho 75%/);
    await pagina.pressionar("ArrowLeft");
    assert.match(await pagina.avaliar<string>(`${plano}.getAttribute("aria-valuetext")`), /Saturação 74%, brilho 75%/);
    await pagina.pressionar("ArrowUp");
    assert.match(await pagina.avaliar<string>(`${plano}.getAttribute("aria-valuetext")`), /Saturação 74%, brilho 76%/);
  });

  test("HEX digitado é mantido ao clicar fora sem Enter", async () => {
    await abrir();
    const entrada = no(".an-cor-hex");
    await clicar(entrada); await pagina.avaliar(`${entrada}.select()`); await pagina.digitar("#369ABC");
    assert.equal(await pagina.avaliar<string>(`${entrada}.value`), "#369ABC");
    await clicar(no(".an-painel .cab .an-ico"));
    assert.equal(await pagina.avaliar<boolean>(`${paleta} === null`), true);
    assert.equal(await corPagina(), "rgb(54, 154, 188)");
  });

  test("HEX inválido não destrói a prévia e a paleta fecha quando seu painel desaparece", async () => {
    await abrir(); await escreverHex("#123456");
    await escreverHex("#NOPE");
    assert.equal(await corPagina(), "rgb(18, 52, 86)");
    assert.equal(await pagina.avaliar<string>(`${no('.an-cor-hex')}.getAttribute("aria-invalid")`), "true");
    await pagina.avaliar(`${no('.an-painel')}.hidden=true`);
    await pagina.esperarPor(`${paleta} === null`);
    assert.equal(await corPagina(), "rgb(18, 52, 86)");
  });

  for (const [largura, altura] of [[1200, 800], [390, 640], [320, 360]] as const) {
    test(`paleta cabe em ${largura}×${altura} e mantém controles acessíveis`, async () => {
      await pagina.definirViewport(largura, altura, 1); await abrir();
      const dentro = `(() => { const r=${paleta}.getBoundingClientRect(); return r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7 && ${paleta}.scrollWidth<=${paleta}.clientWidth; })()`;
      assert.equal(await pagina.avaliar<boolean>(dentro), true);
      await escreverHex("#ABCDEF"); assert.equal(await corPagina(), "rgb(171, 205, 239)");
      assert.equal(await pagina.avaliar<boolean>(dentro), true);
      if (largura !== 320) await writeFile(`/tmp/anotador-paleta-${largura}.png`, await pagina.capturar({alemDoViewport:false}));
    });
  }

  test("conversa longa e 35 comandos rolam com barra escura, sem perder o último item", async () => {
    await pagina.avaliar(`(() => {
      const original=window.fetch;
      const em="2026-09-14T12:00:00.000Z";
      const conversa={id:"visual",agente:"claude",modelo:null,esforco:null,titulo:"Conversa longa",atualizadaEm:em,ocupada:false,mensagens:Array.from({length:30},(_,i)=>({id:"m"+i,autor:i%2?"agente":"usuario",texto:"Mensagem "+i+": revisar o formulário e conferir o espaçamento dos campos da página.",em}))};
      window.fetch=async(...args)=>{ const url=new URL(String(args[0]),location.href);
        if(url.pathname==="/__anotador/chat/catalogo") return Response.json({agentes:[{id:"claude",nome:"Claude Code",instalado:true,ponte:true,modelos:[]}],sessoesExternas:[]});
        if(url.pathname==="/__anotador/chat/sessoes") return Response.json({sessoes:[conversa]});
        if(url.pathname==="/__anotador/chat/sessoes/visual") return Response.json({conversa});
        if(url.pathname==="/__anotador/chat/comandos") return Response.json({comandos:Array.from({length:35},(_,i)=>({nome:"comando-"+i,descricao:"Comando instalado para revisar elementos da página, incluindo nomes extensos sem truncar o texto.",origem:"Projeto",tipo:"skill",suporte:"chat"}))});
        return original(...args);
      };
    })()`);
    await pagina.avaliar(`${no('.an-painel')}.hidden=true`);
    await clicar(no('[aria-label="Abrir chat"]'));
    await pagina.esperarPor(`${no('.an-chat-sessoes')}.querySelector('button')`);
    await clicar(no('.an-chat-historico summary')); await clicar(no('.an-chat-sessao'));
    const mensagens = no('.an-chat-mensagens'), lista=no('.an-chat-comandos-lista');
    await pagina.esperarPor(`${mensagens}.textContent.includes("Mensagem 29")`);
    await pagina.avaliar(`${mensagens}.scrollTop=0`);
    await pagina.mover(0,0);
    const scroll = await pagina.avaliar<{ overflow:boolean; cor:string; largura:number; site:string }>(`({overflow:${mensagens}.scrollHeight>${mensagens}.clientHeight,cor:getComputedStyle(${mensagens},"::-webkit-scrollbar-thumb").backgroundColor,largura:${mensagens}.offsetWidth-${mensagens}.clientWidth,site:getComputedStyle(document.body).scrollbarColor})`);
    assert.equal(scroll.overflow,true); assert.ok(scroll.largura > 0 && scroll.largura <= 8); assert.equal(scroll.cor,"rgb(76, 84, 83)"); assert.equal(scroll.site,"auto");
    await writeFile('/tmp/anotador-scroll-conversa.png',await pagina.capturar({alemDoViewport:false}));
    await pagina.definirViewport(390,640,1);
    await clicar(no('.an-chat-comandos-abrir')); await pagina.esperarPor(`${lista}?.querySelectorAll('[role="option"]').length>=35`);
    assert.equal(await pagina.avaliar<boolean>(`${lista}.scrollHeight>${lista}.clientHeight && ${lista}.scrollWidth<=${lista}.clientWidth`),true);
    const dentro = await pagina.avaliar<boolean>(`(() => {const r=${no('.an-chat-comandos')}.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth})()`);
    assert.equal(dentro,true);
    await pagina.mover(0,0);
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${lista},"::-webkit-scrollbar-thumb").backgroundColor`),scroll.cor);
    await writeFile('/tmp/anotador-scroll-comandos.png',await pagina.capturar({alemDoViewport:false}));
    await pagina.definirViewport(320,640,1);
    await pagina.esperarPor(`(() => {const r=${no('.an-chat-comandos')}.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && ${lista}.scrollWidth<=${lista}.clientWidth})()`);
    await writeFile('/tmp/anotador-scroll-comandos-320.png',await pagina.capturar({alemDoViewport:false}));
    const count=await pagina.avaliar<number>(`${lista}.querySelectorAll('[role="option"]').length`);
    for(let i=1;i<count;i++) await pagina.pressionar('ArrowDown');
    assert.equal(await pagina.avaliar<boolean>(`(() => {const r=${lista}.getBoundingClientRect(),ultimo=${lista}.lastElementChild.getBoundingClientRect();return ultimo.bottom<=r.bottom+1 && ultimo.top>=r.top && ${lista}.scrollTop>0})()`),true);
    await pagina.pressionar('Enter');
    assert.match(await pagina.avaliar<string>(`${no('.an-chat-entrada textarea')}.value`),/^\//);
  });
});
