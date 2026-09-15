import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Continuacoes, ErroContinuacao, LIMITE_ARMAZENAMENTO_CONTINUACAO, hostContinuacao, validarContinuacao } from "../lib/continuacao.ts";
import { temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

const BASE = "/__anotador";
const pedido = { voltar: "/entrar?aba=1#titulo", armazenamento: JSON.stringify({ anotacoes: [{ id: "anotacao-1", comentario: "Meu rascunho" }], rascunho: { id: "rascunho-1" }, conversaRascunho: { loteId: "lote-1", texto: "Fala parcial" }, posicaoPagina: { x: 0, y: 320 } }), campo: "anotacao" };
const temTls = await temOpenssl();
const ip = Object.values(networkInterfaces()).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address;

test("continuação preserva JSON opaco e exige retorno relativo, objeto e tamanho limitado", () => {
  assert.deepEqual(validarContinuacao(pedido), pedido);
  assert.equal(validarContinuacao({ ...pedido, campo: "chat" }).campo, "chat");
  for (const voltar of ["https://externo.test/", "//externo.test/", "/\\externo.test/", "/\nexterno", "/__anotador", "/__anotador/voz/retomar", "/x/../__anotador/lotes", "/%5f%5fanotador/lotes", "/%2f%2fexterno.test/"]) {
    assert.throws(() => validarContinuacao({ ...pedido, voltar }), ErroContinuacao, voltar);
  }
  for (const armazenamento of [null, [], "null", "[]", '"texto"', "{invalido}", '{"texto":"' + "x".repeat(LIMITE_ARMAZENAMENTO_CONTINUACAO) + '"}']) {
    assert.throws(() => validarContinuacao({ ...pedido, armazenamento }), ErroContinuacao);
  }
  assert.throws(() => validarContinuacao({ ...pedido, campo: "outro" }), ErroContinuacao);
  const noLimite = " ".repeat(LIMITE_ARMAZENAMENTO_CONTINUACAO - 2) + "{}";
  assert.equal(validarContinuacao({ ...pedido, armazenamento: noLimite }).armazenamento.length, LIMITE_ARMAZENAMENTO_CONTINUACAO);
});

test("token aleatório é de uso único, expira em cinco minutos e só funciona no mesmo host", () => {
  let agora = 1000;
  const continuacoes = new Continuacoes(() => agora);
  const token = continuacoes.criar(pedido, "localhost:3999");
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.throws(() => continuacoes.consumir(token, "outro.test:3999"), /expirou ou já foi usada/);
  assert.deepEqual(continuacoes.consumir(token, "localhost:3999"), pedido);
  assert.throws(() => continuacoes.consumir(token, "localhost:3999"), /expirou ou já foi usada/);
  const vencido = continuacoes.criar(pedido, "localhost:3999");
  agora += 5 * 60_000;
  assert.throws(() => continuacoes.consumir(vencido, "localhost:3999"), /expirou ou já foi usada/);
  assert.throws(() => continuacoes.consumir("inventado", "localhost:3999"), /expirou ou já foi usada/);
});

test("o limite em memória recusa a 51ª continuação sem apagar as anteriores", () => {
  let agora = 1000;
  const continuacoes = new Continuacoes(() => agora);
  const tokens = Array.from({ length: 50 }, () => continuacoes.criar(pedido, "localhost:3999"));
  assert.throws(() => continuacoes.criar(pedido, "localhost:3999"), (erro: unknown) => erro instanceof ErroContinuacao && erro.status === 429);
  assert.deepEqual(continuacoes.consumir(tokens[0], "localhost:3999"), pedido);
  continuacoes.criar(pedido, "localhost:3999");
  agora += 5 * 60_000;
  assert.doesNotThrow(() => continuacoes.criar(pedido, "localhost:3999"));
});

test("autoridade aceita IPv6 e rejeita usuário, caminho, query ou host malformado", () => {
  assert.equal(hostContinuacao("[::1]:3999"), "[::1]:3999");
  assert.equal(hostContinuacao("LOCALHOST:3999"), "localhost:3999");
  for (const host of ["", "user@externo.test", "localhost:3999/fora", "localhost?fora=1", "localhost#fora", "localhost\\externo", "localhost\n", "localhost:invalido"]) {
    assert.throws(() => hostContinuacao(host), ErroContinuacao, host);
  }
});

test("API faz a troca apenas em TLS, entrega sessão segura e nunca encaminha token ao app", { skip: !temTls, timeout: 20_000 }, async () => {
  const alvo = await criarAlvoFalso();
  // Escuta na rede para valer: parte deste teste é justamente o que chega de fora,
  // que precisa de um endereço além do laço local.
  const proxy = await criarProxy(alvo, { https: true, host: "0.0.0.0" });
  const seguro = proxy.origem.replace("http:", "https:");
  try {
    const ca = await readFile(join(proxy.saida, "tls", "certificado.pem"));
    const tls = (caminho: string, corpo?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; corpo: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const req = request(seguro + caminho, { ca, method: corpo === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (parte: Buffer) => partes.push(parte));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8"), headers: res.headers }));
      });
      req.on("error", reject); req.end(corpo === undefined ? undefined : JSON.stringify(corpo));
    });
    const criar = await pedir(proxy.origem + BASE + "/voz/continuar", { metodo: "POST", corpo: JSON.stringify(pedido), headers: { "x-forwarded-host": "externo.test" } });
    assert.equal(criar.status, 200);
    const transferencia = JSON.parse(criar.corpo) as { ok: boolean; url: string };
    const url = new URL(transferencia.url);
    assert.equal(url.origin, seguro);
    assert.equal(url.pathname, BASE + "/voz/retomar");
    assert.equal(url.search, "");
    const token = url.hash.slice(1);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(criar.headers["cache-control"], "no-store");
    assert.equal(criar.headers["referrer-policy"], "no-referrer");
    assert.ok(!criar.corpo.includes(pedido.armazenamento));
    assert.ok(!criar.corpo.includes(proxy.servidor.chave));
    // Texto claro pelo laço local é aceito: é assim que o pedido chega quando a porta
    // está encaminhada por SSH, e para o navegador aquela origem é `localhost`, um
    // contexto seguro tão bom quanto TLS — sem certificado a aceitar.
    assert.equal((await pedir(proxy.origem + BASE + "/voz/retomar")).status, 200);
    // Pelo endereço da rede, em texto claro, continua recusando. Dizer-se HTTPS num
    // cabeçalho não muda o protocolo real, e é o endereço do socket que decide.
    if (ip) {
      assert.equal((await pedir(`http://${ip}:${proxy.porta}${BASE}/voz/retomar`)).status, 426);
      assert.equal((await pedir(`http://${ip}:${proxy.porta}${BASE}/voz/retomar`, { metodo: "POST", corpo: JSON.stringify({ token }), headers: { "x-forwarded-proto": "https" } })).status, 426);
    }
    const html = await tls(BASE + "/voz/retomar");
    assert.equal(html.status, 200);
    assert.equal(html.headers["cache-control"], "no-store");
    assert.equal(html.headers["referrer-policy"], "no-referrer");
    assert.match(String(html.headers["content-security-policy"]), /frame-ancestors 'none'/);
    assert.ok(!html.corpo.includes(token) && !html.corpo.includes(proxy.servidor.chave) && !html.corpo.includes("overlay.js"));
    const cruzado = await tls(BASE + "/voz/retomar", { token }, { "sec-fetch-site": "cross-site" });
    assert.equal(cruzado.status, 403);
    assert.equal(cruzado.headers["set-cookie"], undefined);
    const outroHost = await tls(BASE + "/voz/retomar", { token }, { host: `localhost:${proxy.porta}` });
    assert.equal(outroHost.status, 410);
    const resposta = await tls(BASE + "/voz/retomar", { token });
    assert.equal(resposta.status, 200);
    assert.deepEqual(JSON.parse(resposta.corpo), { ok: true, ...pedido });
    const cookie = String(resposta.headers["set-cookie"]);
    // Sem Secure de propósito: quem volta do ditado para o app, que o proxy serve em
    // HTTP, precisa continuar autorizado a enviar o lote que acabou de ditar.
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.doesNotMatch(cookie, /; Secure(?:;|$)/);
    const reuso = await tls(BASE + "/voz/retomar", { token });
    assert.equal(reuso.status, 410); assert.equal(reuso.headers["set-cookie"], undefined);
    assert.ok(!reuso.corpo.includes(token));
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.ok(alvo.pedidos.every((v) => !v.url.includes(token) && !v.url.includes("/voz/")));
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("criação exige acesso e disponibilidade real de TLS", { skip: !ip }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0", https: false, publico: "https://publico.example" });
  try {
    const corpo = JSON.stringify(pedido);
    assert.equal((await pedir(`http://${ip}:${proxy.porta}${BASE}/voz/continuar`, { metodo: "POST", corpo })).status, 403);
    assert.equal((await pedir(proxy.origem + BASE + "/voz/continuar", { metodo: "POST", corpo, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.equal((await pedir(proxy.origem + BASE + "/voz/continuar", { metodo: "POST", corpo })).status, 503);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});
