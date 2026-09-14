import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { test } from "node:test";
import { Navegador, Pagina, encontrarChromium } from "../lib/cdp.ts";
import { temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

const ip = Object.values(networkInterfaces()).flat().find(item => item?.family === "IPv4" && !item.internal)?.address;
const disponivel = encontrarChromium() && ip && await temOpenssl();
const BASE = "/__anotador";
// Nem a retomada de campo chat nem o overlay podem pedir microfone real no teste.
const semMicrofone = `class RecTeste {start(){} stop(){} abort(){} addEventListener(){} removeEventListener(){}};window.SpeechRecognition=window.webkitSpeechRecognition=RecTeste;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>Promise.reject(new Error("Microfone desabilitado no teste"));`;

test("continuação LAN confirma autorização em HTTPS antes de voltar e preserva estado do chat", { skip: !disponivel, timeout: 30_000 }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0", https: true });
  const navegador = await Navegador.abrir();
  try {
    await navegador.ignorarErrosCertificado();
    const pagina = await navegador.novaPagina();
    const canal = (pagina as unknown as { canal: ConstructorParameters<typeof Pagina>[0] }).canal;
    await canal.enviar("Page.addScriptToEvaluateOnNewDocument", { source: semMicrofone }, pagina.sessionId);
    const origem = `http://${ip}:${proxy.porta}`, segura = origem.replace("http:", "https:");
    await pagina.navegar(origem + "/");
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 403, "consulta não autentica um navegador desconhecido");
    const convite = JSON.parse((await pedir(proxy.origem + BASE + "/acesso/link", { metodo: "POST", corpo: '{"voltar":"/"}' })).corpo) as { caminho: string };
    await pagina.navegar(origem + convite.caminho);
    await pagina.esperarPor("window.__anotadorCarregado");
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200);
    const nome = await pagina.avaliar<string>("window.__ANOTADOR_CFG.nome");
    const chat = { versao: 1, agente: "claude", modelo: "", esforco: "", sessao: null, rascunhos: [["nova:claude::", "Texto do chat antes do HTTPS"]] };
    const pedido = { voltar: "/outra", campo: "chat", armazenamento: JSON.stringify({ anotacoes: [], chat: { nome, estado: JSON.stringify(chat) } }) };
    const r = await pagina.avaliar<{ url: string }>(`fetch('${BASE}/voz/continuar',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(pedido))}}).then(r=>r.json())`);
    await pagina.navegar(r.url);
    await pagina.esperarPor(`location.origin===${JSON.stringify(segura)} && location.pathname==='/outra' && window.__anotadorCarregado`);
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200, "cookie da retomada autoriza o navegador da rede");
    assert.equal((await pedir(proxy.origem + BASE + "/acesso/sessao")).headers["set-cookie"], undefined, "GET não emite nem renova sessão");
    assert.equal(await pagina.avaliar(`fetch('${BASE}/chat/sessoes?agente=claude').then(r=>r.status)`), 200, "leitura protegida funciona no endereço seguro");
    const chaveChat = "anotador-ui:chat:" + encodeURIComponent(nome) + ":/outra";
    assert.equal(await pagina.avaliar(`JSON.parse(localStorage.getItem(${JSON.stringify(chaveChat)})).rascunhos[0][1]`), "Texto do chat antes do HTTPS");
    assert.equal(await pagina.avaliar("location.hash"), "");
    assert.equal(await pagina.avaliar("document.cookie.includes('anotador_sessao')"), false);
    const outra = await navegador.novaPagina(); await outra.navegar(segura + "/");
    assert.equal(await outra.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200, "sessão HTTPS vale também em outra aba");
    assert.ok(alvo.pedidos.every(p => !p.headers.cookie?.includes("anotador_sessao") && !p.url.includes(new URL(r.url).hash.slice(1))));
  } finally { await navegador.fechar(); await proxy.fechar(); await alvo.fechar(); }
});

test("retomada não devolve ao app como conectado quando o navegador recusa a sessão", { skip: !disponivel, timeout: 30_000 }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0", https: true });
  const navegador = await Navegador.abrir();
  try {
    await navegador.ignorarErrosCertificado();
    const pagina = await navegador.novaPagina();
    const canal = (pagina as unknown as { canal: ConstructorParameters<typeof Pagina>[0] }).canal;
    await canal.enviar("Page.addScriptToEvaluateOnNewDocument", { source: semMicrofone + `
      const fetchOriginal=window.fetch;window.fetch=(...args)=>new URL(String(args[0]),location.href).pathname==='${BASE}/acesso/sessao'
        ? Promise.resolve(Response.json({ok:false},{status:403})) : fetchOriginal(...args);` }, pagina.sessionId);
    const pedido = { voltar: "/", campo: "chat", armazenamento: '{"rascunho":{"id":"preservado"}}' };
    const criacao = JSON.parse((await pedir(proxy.origem + BASE + "/voz/continuar", { metodo: "POST", corpo: JSON.stringify(pedido) })).corpo) as { url: string };
    await pagina.navegar(criacao.url);
    await pagina.esperarPor("document.getElementById('voltar') && !document.getElementById('voltar').hidden");
    assert.match(await pagina.avaliar<string>("document.getElementById('status').textContent"), /não conseguiu guardar a conexão segura/);
    assert.equal(await pagina.avaliar("location.pathname"), BASE + "/voz/retomar");
    assert.equal(await pagina.avaliar("localStorage.getItem('anotador-ui:/')"), null, "não confirma transferência sem sessão válida");
    assert.equal(await pagina.avaliar("location.hash"), "");
    assert.equal(await pagina.avaliar("document.querySelectorAll('input').length"), 0, "não pede chave de terminal");
  } finally { await navegador.fechar(); await proxy.fechar(); await alvo.fechar(); }
});
