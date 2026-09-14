import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { paginaConexao } from "../lib/conexao.ts";

const chrome = encontrarChromium();
const chaveLegada = "0123456789abcdef0123456789abcdef";

describe("acesso compartilhado pela página de conexão", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let navegador: Navegador;
  let pagina: Pagina;
  let origem: string;
  let porta: number;
  let autorizar = true;
  let recusarCookie = false;
  let conectado = false;
  let erroDesconectar = 0;
  const pedidos: Array<{ caminho: string; chave?: string; cookie?: string; corpo?: unknown }> = [];
  const servidor = createServer(async (req, res) => {
    const caminho = new URL(req.url ?? "/", "http://local").pathname;
    if (caminho === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><title>App de teste</title><h1>App aberto</h1>');
      return;
    }
    if (caminho === "/__anotador/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "acesso-ui-teste=; Path=/; Max-Age=0; HttpOnly" });
      res.end(await paginaConexao());
      return;
    }
    const partes: Buffer[] = [];
    for await (const parte of req) partes.push(Buffer.from(parte));
    const corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : undefined;
    pedidos.push({ caminho, chave: req.headers["x-anotador-chave"] as string | undefined, cookie: req.headers.cookie, corpo });
    res.setHeader("content-type", "application/json");
    if (caminho === "/__anotador/acesso/sessao") {
      const permitido = autorizar && (req.method === "POST" || !!req.headers.cookie?.includes("acesso-ui-teste=conectado"));
      res.statusCode = permitido ? 200 : 403;
      if (permitido && req.method === "POST" && !recusarCookie) res.setHeader("set-cookie", "acesso-ui-teste=conectado; Path=/; HttpOnly; SameSite=Strict");
      res.end(JSON.stringify({ ok: permitido }));
    } else if (caminho === "/__anotador/acesso/link") {
      const autorizado = autorizar && req.headers.cookie?.includes("acesso-ui-teste=conectado");
      res.statusCode = autorizado ? 200 : 403;
      res.end(JSON.stringify(autorizado ? { ok: true, caminho: "/__anotador/acesso?convite=convite-assinado-teste&voltar=%2F__anotador%2F", expiraEm: "2099-09-14T12:00:00.000Z" } : { ok: false, erro: "Acesso necessário" }));
    } else if (caminho.endsWith("/desconectar")) {
      await new Promise(resolve => setTimeout(resolve, 150));
      res.statusCode = erroDesconectar || (autorizar ? 200 : 403);
      if (res.statusCode === 200) conectado = false;
      res.end(JSON.stringify({ ok: res.statusCode === 200, erro: res.statusCode === 403 ? "Este navegador ainda não está conectado." : "Falha temporária ao desconectar." }));
    } else if (caminho.endsWith("/saude")) {
      res.end(JSON.stringify({ ok: true, nome: "Teste", versao: "0.2", conectado, alvo: conectado ? "http://localhost:3001" : null, app: { alcancavel: true, titulo: "App de teste", framework: "Next.js", status: 200 }, fonte: null, saida: "/tmp/teste", porta, ips: ["192.168.0.42"], quemOuve: [], ponte: null, conexoes: [] }));
    } else if (caminho.endsWith("/deteccao")) res.end(JSON.stringify({ ok: true, servidores: [] }));
    else if (caminho.endsWith("/agentes")) res.end(JSON.stringify({ ok: true, agentes: [], execucoes: [] }));
    else res.end(JSON.stringify({ ok: true, sessoes: [], execucoes: [] }));
  });
  const carregar = async () => {
    await pagina.navegar(origem + "/__anotador/");
    await pagina.esperarPor('document.getElementById("acesso-descricao").textContent !== "Conectando este navegador…"');
  };
  const clicarLink = async () => {
    await pagina.avaliar(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (texto) => { window.linkCopiado = texto; } } })`);
    await pagina.avaliar('document.getElementById("btn-copiar-acesso").click()');
    await pagina.esperarPor('typeof window.linkCopiado === "string"');
  };

  before(async () => {
    await new Promise<void>((resolve) => servidor.listen(0, "0.0.0.0", resolve));
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    porta = endereco.port;
    origem = `http://127.0.0.1:${porta}`;
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await carregar();
  });
  beforeEach(async () => {
    autorizar = true;
    recusarCookie = false;
    conectado = false;
    erroDesconectar = 0;
    pedidos.length = 0;
    await pagina.avaliar("sessionStorage.clear(); localStorage.clear()");
    await carregar();
  });
  after(async () => {
    await navegador?.fechar();
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  test("sessão autorizada usa cookie HttpOnly e copia convite pelo IP da rede", async () => {
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("btn-copiar-acesso").hidden'), false);
    await clicarLink();
    const pedido = pedidos.find((p) => p.caminho.endsWith("/acesso/link"));
    assert.deepEqual(pedido?.corpo, { voltar: "/__anotador/" });
    assert.equal(pedido?.chave, undefined);
    assert.match(pedido?.cookie ?? "", /acesso-ui-teste=conectado/);
    const link = new URL(await pagina.avaliar<string>("window.linkCopiado"));
    assert.equal(link.origin, `http://192.168.0.42:${porta}`);
    assert.equal(link.searchParams.get("convite"), "convite-assinado-teste");
    assert.equal(link.searchParams.get("voltar"), "/__anotador/");
    assert.equal(await pagina.avaliar<boolean>('document.cookie.includes("acesso-ui-teste")'), false);
    assert.equal(await pagina.avaliar<boolean>('document.body.textContent.includes("convite-assinado-teste")'), false);
  });

  test("chave antiga é enviada apenas na migração e removida dos dois armazenamentos", async () => {
    await pagina.avaliar(`sessionStorage.setItem("anotador.chave", ${JSON.stringify(chaveLegada)}); localStorage.setItem("anotador-ui:chave", ${JSON.stringify(chaveLegada)})`);
    pedidos.length = 0;
    await carregar();
    assert.equal(pedidos.find((p) => p.caminho.endsWith("/acesso/sessao"))?.chave, chaveLegada);
    assert.equal(await pagina.avaliar<string | null>('sessionStorage.getItem("anotador.chave")'), null);
    assert.equal(await pagina.avaliar<string | null>('localStorage.getItem("anotador-ui:chave")'), null);
    await clicarLink();
    assert.equal(pedidos.filter((p) => !p.caminho.endsWith("/acesso/sessao")).some((p) => p.chave !== undefined), false);
  });

  test("navegador não autorizado não gera convite nem pede uma chave no terminal", async () => {
    autorizar = false;
    await pagina.avaliar(`sessionStorage.setItem("anotador.chave", ${JSON.stringify(chaveLegada)})`);
    await carregar();
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("btn-copiar-acesso").hidden'), true);
    const orientacao = await pagina.avaliar<string>('document.getElementById("acesso-descricao").textContent');
    assert.match(orientacao, /link de acesso compartilhado/);
    assert.doesNotMatch(orientacao, /terminal|chave/i);
    await pagina.avaliar('document.getElementById("btn-copiar-acesso").click()');
    assert.equal(pedidos.some((p) => p.caminho.endsWith("/acesso/link")), false);
    assert.equal(await pagina.avaliar<string | null>('sessionStorage.getItem("anotador.chave")'), chaveLegada, "falha na migração não apaga a credencial antiga");
  });

  test("sem acesso à área de transferência oferece o link selecionável", async () => {
    await pagina.avaliar(`Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); document.execCommand = () => false; document.getElementById("btn-copiar-acesso").click()`);
    await pagina.esperarPor('document.getElementById("link-acesso").hidden === false');
    assert.match(await pagina.avaliar<string>('document.getElementById("link-acesso").value'), /convite=convite-assinado-teste/);
    assert.equal(await pagina.avaliar<boolean>('document.activeElement === document.getElementById("link-acesso")'), true);
  });

  test("não anuncia conexão nem apaga chave antiga se o navegador recusa o cookie", async () => {
    recusarCookie = true;
    await pagina.avaliar(`sessionStorage.setItem("anotador.chave", ${JSON.stringify(chaveLegada)})`);
    await carregar();
    assert.equal(await pagina.avaliar('document.getElementById("btn-copiar-acesso").hidden'), true);
    assert.match(await pagina.avaliar<string>('document.getElementById("acesso-descricao").textContent'), /não guardou a conexão/);
    assert.equal(await pagina.avaliar('sessionStorage.getItem("anotador.chave")'), chaveLegada);
    recusarCookie = false;
    await pagina.avaliar('document.getElementById("btn-verificar-acesso").click()');
    await pagina.esperarPor('!document.getElementById("btn-copiar-acesso").hidden');
    assert.equal(await pagina.avaliar('sessionStorage.getItem("anotador.chave")'), null);
  });

  test("retomar a aba verifica novamente a autorização", async () => {
    autorizar = false; await carregar();
    assert.equal(await pagina.avaliar('document.getElementById("btn-verificar-acesso").hidden'), false);
    autorizar = true;
    await pagina.avaliar('window.dispatchEvent(new Event("focus"))');
    await pagina.esperarPor('!document.getElementById("btn-copiar-acesso").hidden');
  });

  test("abrir app é um link acessível e navega pela origem do anotador", async () => {
    conectado = true; await carregar();
    await pagina.esperarPor('!document.getElementById("bloco-conectado").hidden');
    assert.equal(await pagina.avaliar('document.querySelector("#abrir-app button")'), null);
    await pagina.avaliar('document.getElementById("abrir-app").focus()');
    await pagina.pressionar('Enter');
    await pagina.esperarPor('document.querySelector("h1")?.textContent === "App aberto"');
    assert.equal(await pagina.avaliar('location.origin'), origem);
    assert.equal(await pagina.avaliar('location.pathname'), '/');
  });

  test("desconectar atualiza o estado, evita pedidos duplicados e informa falhas", async () => {
    conectado = true; await carregar();
    await pagina.esperarPor('!document.getElementById("bloco-conectado").hidden');
    erroDesconectar = 403;
    await pagina.avaliar('document.getElementById("btn-desconectar").click(); document.getElementById("btn-desconectar").click()');
    await pagina.esperarPor('document.getElementById("resultado").classList.contains("erro")');
    assert.equal(pedidos.filter(p => p.caminho.endsWith('/desconectar')).length, 1);
    assert.match(await pagina.avaliar<string>('document.getElementById("resultado").textContent'), /não está conectado/);
    assert.equal(await pagina.avaliar('document.activeElement.id'), 'acesso-descricao');
    assert.equal(await pagina.avaliar('document.getElementById("btn-desconectar").disabled'), false);
    assert.equal(await pagina.avaliar('document.getElementById("bloco-conectado").hidden'), false);
    erroDesconectar = 0;
    await pagina.avaliar('document.getElementById("btn-desconectar").click()');
    await pagina.esperarPor('document.getElementById("bloco-conectado").hidden');
    assert.equal(conectado, false);
    assert.match(await pagina.avaliar<string>('document.getElementById("resultado").textContent'), /Desconectado/);
  });

  test("abrir app sem autorização explica o acesso e preserva a página", async () => {
    conectado = true; autorizar = false; await carregar();
    await pagina.esperarPor('!document.getElementById("bloco-conectado").hidden');
    await pagina.avaliar('document.getElementById("abrir-app").click()');
    await pagina.esperarPor('document.getElementById("resultado").classList.contains("erro")');
    assert.equal(await pagina.avaliar('location.pathname'), '/__anotador/');
    assert.equal(await pagina.avaliar('document.activeElement.id'), 'acesso-descricao');
  });
});
