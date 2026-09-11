import assert from "node:assert/strict";
import { test } from "node:test";
import { cabecalhosParaAlvo, ehHtml, extrairNonce, filtrarCabecalhosResposta, injetarScript, reescreverLocation } from "../lib/injetar.ts";

const alvo = new URL("http://localhost:3001");
const publica = "http://192.168.3.19:3999";

test("extrairNonce pega o nonce do primeiro script e aceita aspas simples", () => {
  assert.equal(extrairNonce('<head><script nonce="AbC+/==" src="x"></script></head>'), "AbC+/==");
  assert.equal(extrairNonce("<link nonce='q1' rel=preload><script nonce='q2'></script>"), "q2");
  assert.equal(extrairNonce("<html><body>sem nada</body></html>"), null);
});

test("injetarScript entra antes de </head>, senão antes de </body>, senão no fim", () => {
  const src = "/__anotador/overlay.js";
  assert.equal(injetarScript("<html><head></head><body></body></html>", { src, nonce: "n1" }), `<html><head><script nonce="n1" src="${src}" defer></script></head><body></body></html>`);
  assert.equal(injetarScript("<body>x</body>", { src, nonce: null }), `<body>x<script src="${src}" defer></script></body>`);
  assert.equal(injetarScript("fragmento", { src, nonce: null }), `fragmento<script src="${src}" defer></script>`);
  assert.ok(!injetarScript("<head></head>", { src, nonce: 'a"b' }).includes('nonce="a"b"'), "aspas no nonce não podem quebrar o atributo");
});

test("ehHtml só reconhece text/html", () => {
  assert.equal(ehHtml({ "content-type": "text/html; charset=utf-8" }), true);
  assert.equal(ehHtml({ "content-type": "text/x-component" }), false);
  assert.equal(ehHtml({}), false);
});

test("reescreverLocation troca a origem do alvo pela pública e deixa o resto em paz", () => {
  assert.equal(reescreverLocation("http://localhost:3001/entrar?x=1#a", alvo, publica), "http://192.168.3.19:3999/entrar?x=1#a");
  assert.equal(reescreverLocation("http://127.0.0.1:3001/painel", alvo, publica), "http://192.168.3.19:3999/painel");
  assert.equal(reescreverLocation("/relativo", alvo, publica), "http://192.168.3.19:3999/relativo");
  assert.equal(reescreverLocation("https://accounts.google.com/o/oauth2", alvo, publica), "https://accounts.google.com/o/oauth2");
  assert.equal(reescreverLocation("http://localhost:9000/minio", alvo, publica), "http://localhost:9000/minio");
});

test("filtrarCabecalhosResposta remove hop-a-hop, reescreve location e respeita bufferização/CSP", () => {
  const entrada = {
    connection: "keep-alive",
    "transfer-encoding": "chunked",
    "content-length": "10",
    "content-encoding": "gzip",
    "content-security-policy": "default-src 'self'",
    location: "http://localhost:3001/x",
    "set-cookie": ["a=1"],
    "x-outro": "fica",
  };
  const bufferizado = filtrarCabecalhosResposta(entrada, { alvo, origemPublica: publica, removerCsp: false, bufferizado: true });
  assert.deepEqual(bufferizado, {
    "content-security-policy": "default-src 'self'",
    location: "http://192.168.3.19:3999/x",
    "set-cookie": ["a=1"],
    "x-outro": "fica",
  });
  const fluxo = filtrarCabecalhosResposta(entrada, { alvo, origemPublica: publica, removerCsp: true, bufferizado: false });
  assert.equal(fluxo["content-length"], "10");
  assert.equal(fluxo["content-encoding"], "gzip");
  assert.equal("content-security-policy" in fluxo, false);
  assert.equal("transfer-encoding" in fluxo, false);
});

test("cabecalhosParaAlvo faz o dev server enxergar mesma origem", () => {
  const saida = cabecalhosParaAlvo(
    {
      host: "192.168.3.19:3999",
      origin: publica,
      referer: publica + "/entrar",
      "accept-encoding": "gzip, br",
      cookie: "sessao=1",
      connection: "Upgrade",
      upgrade: "websocket",
    },
    { alvo, origemPublica: publica }
  );
  assert.equal(saida["host"], "localhost:3001");
  assert.equal(saida["origin"], "http://localhost:3001");
  assert.equal(saida["referer"], "http://localhost:3001/entrar");
  assert.equal("accept-encoding" in saida, false);
  assert.equal(saida["cookie"], "sessao=1");
  assert.equal(saida["upgrade"], "websocket");
  assert.equal(saida["connection"], "Upgrade");
  const externo = cabecalhosParaAlvo({ origin: "https://outro.site" }, { alvo, origemPublica: publica });
  assert.equal(externo["origin"], "https://outro.site");
});
