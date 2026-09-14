import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { test } from "node:test";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";
import { Navegador, encontrarChromium } from "../lib/cdp.ts";
import { temOpenssl } from "../lib/tls.ts";

const ip = Object.values(networkInterfaces()).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address;
const chrome = encontrarChromium();
const BASE = "/__anotador";

test("link conecta com cookie e remove credenciais da URL sem permitir redirecionamento externo", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const emitir = (voltar: string) => pedir(proxy.origem + BASE + "/acesso/link", { metodo: "POST", corpo: JSON.stringify({ voltar }) });
    const convite = JSON.parse((await emitir("/outra?teste=1")).corpo);
    assert.equal(convite.ok, true);
    assert.equal(convite.caminho.includes(proxy.servidor.chave), false);
    const login = await pedir(proxy.origem + convite.caminho);
    assert.equal(login.status, 303);
    assert.equal(login.headers.location, "/outra?teste=1");
    assert.match(login.headers["set-cookie"] ?? "", /anotador_sessao=.*HttpOnly/i);
    assert.match(login.headers["set-cookie"] ?? "", /Path=\/__anotador/);
    assert.match(login.headers["set-cookie"] ?? "", /SameSite=Strict/);
    assert.equal(login.headers["referrer-policy"], "no-referrer");
    assert.ok(!login.corpo.includes(proxy.servidor.chave));
    const invalido = await pedir(proxy.origem + BASE + "/acesso?convite=falso");
    assert.equal(invalido.status, 403);
    assert.equal(invalido.headers["set-cookie"], undefined);
    for (const voltar of ["https://outro.example/", "//outro.example/", "/\\outro.example/", "/\r\nLocation: x"]) {
      const link = JSON.parse((await emitir(voltar)).corpo);
      assert.equal((await pedir(proxy.origem + link.caminho)).headers.location, BASE + "/");
    }
    const antigo = await pedir(proxy.origem + BASE + "/?chave=" + proxy.servidor.chave + "&aba=app");
    assert.equal(antigo.status, 303);
    assert.equal(antigo.headers.location, BASE + "/?aba=app");
    assert.ok(antigo.headers["set-cookie"]);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("browser na rede usa o link uma vez e acessa agente e extrator em abas diferentes sem chave", {
  skip: !ip ? "sem endereço de rede" : !chrome ? "sem Chromium" : false, timeout: 30_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0" });
  const origem = `http://${ip}:${proxy.porta}`;
  const navegador = await Navegador.abrir({ caminho: chrome });
  try {
    const pagina = await navegador.novaPagina();
    await pagina.navegar(origem + "/");
    const trocar = `fetch('${BASE}/agente/ponte', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({agente:null})}).then(r=>r.status)`;
    assert.equal(await pagina.avaliar(trocar), 403);
    const semAcesso = await pedir(origem + BASE + "/acesso/link", { metodo: "POST", corpo: "{}" });
    assert.equal(semAcesso.status, 403);
    const convite = JSON.parse((await pedir(proxy.origem + BASE + "/acesso/link", { metodo: "POST", corpo: JSON.stringify({ voltar: "/outra" }) })).corpo);
    await pagina.navegar(origem + convite.caminho);
    assert.equal(await pagina.avaliar("location.pathname"), "/outra");
    assert.equal(await pagina.avaliar(trocar), 200, "a sessão substitui o cabeçalho manual");
    const outra = await navegador.novaPagina();
    await outra.navegar(origem + BASE + "/extrair");
    assert.equal(await outra.avaliar("document.cookie.includes('anotador_sessao')"), false, "HttpOnly impede leitura da sessão por JavaScript");
    assert.equal(await outra.avaliar(`fetch('${BASE}/extrair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'file:///tmp'})}).then(r=>r.status)`), 400, "outra aba passa a autorização e chega à validação da URL");
    assert.equal(await outra.avaliar("sessionStorage.getItem('anotador.chave')"), null);
    assert.ok(alvo.pedidos.every((pedido) => !pedido.headers.cookie?.includes("anotador_sessao")), "credencial não segue para o app");
  } finally { await navegador.fechar(); await proxy.fechar(); await alvo.fechar(); }
});

test("menu HTTP reutiliza a sessão HTTPS e seus botões abrem e desconectam o app", {
  skip: !ip ? "sem endereço de rede" : !chrome ? "sem Chromium" : !await temOpenssl() ? "sem OpenSSL" : false, timeout: 60_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0", https: true });
  const origem = `https://${ip}:${proxy.porta}`;
  const navegador = await Navegador.abrir({ caminho: chrome });
  try {
    await navegador.ignorarErrosCertificado();
    const pagina = await navegador.novaPagina();
    const convite = JSON.parse((await pedir(proxy.origem + BASE + "/acesso/link", { metodo: "POST", corpo: JSON.stringify({ voltar: BASE + "/" }) })).corpo);
    await pagina.navegar(origem + convite.caminho);
    await pagina.esperarPor('!document.getElementById("btn-copiar-acesso").hidden');
    await pagina.navegar(origem.replace('https:', 'http:') + BASE + '/');
    await pagina.esperarPor('!document.getElementById("bloco-conectado").hidden && !document.getElementById("btn-copiar-acesso").hidden');
    assert.equal(await pagina.avaliar('location.origin'), origem);
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200);
    await pagina.avaliar('document.getElementById("abrir-app").focus()');
    await pagina.pressionar('Enter');
    await pagina.esperarPor('!!window.__anotadorCarregado');
    assert.equal(await pagina.avaliar('location.href'), origem + '/');
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200);
    await pagina.navegar(origem + BASE + '/');
    await pagina.esperarPor('!document.getElementById("bloco-conectado").hidden');
    await pagina.avaliar('document.getElementById("btn-desconectar").click()');
    await pagina.esperarPor('document.getElementById("resultado").textContent.startsWith("Desconectado.")');
    assert.equal(await pagina.avaliar('document.getElementById("bloco-conectado").hidden'), true);
    assert.equal(JSON.parse((await pedir(proxy.origem + BASE + '/saude')).corpo).conectado, false);
    assert.equal((await pedir(alvo.origem)).status, 200, 'o dev server continua funcionando');
    assert.equal(await pagina.avaliar(`fetch('${BASE}/acesso/sessao').then(r=>r.status)`), 200, 'desconectar o app preserva acesso ao anotador');
  } finally { await navegador.fechar(); await proxy.fechar(); await alvo.fechar(); }
});
