import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { test } from "node:test";
import { MAX_AUDIO_BYTES } from "../lib/transcricao.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

const BASE = "/__anotador/voz";
const ip = Object.values(networkInterfaces()).flat().find(item => item?.family === "IPv4" && !item.internal)?.address;
const json = { "content-type": "application/json" };

test("API de voz exige credencial e mesma origem antes de interpretar gravação", { skip: !ip }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0" });
  try {
    const remota = `http://${ip}:${proxy.porta}`;
    for (const caminho of ["/capacidade", "/transcrever"]) {
      const resposta = await pedir(remota + BASE + caminho, { metodo: caminho === "/capacidade" ? "GET" : "POST", headers: { ...json, "sec-fetch-site": "same-origin" }, corpo: caminho === "/transcrever" ? "{JSON inválido que não deve ser lido" : undefined });
      assert.equal(resposta.status, 403); assert.equal(resposta.headers["cache-control"], "no-store");
      assert.equal(JSON.parse(resposta.corpo).ok, false); assert.ok(JSON.parse(resposta.corpo).erro.length > 0);
      assert.equal(resposta.headers["set-cookie"], undefined);
      assert.ok(!resposta.corpo.includes(proxy.servidor.chave));
      const cruzada = await pedir(remota + BASE + caminho, { metodo: caminho === "/capacidade" ? "GET" : "POST", headers: { ...json, "x-anotador-chave": proxy.servidor.chave, "sec-fetch-site": "cross-site" }, corpo: caminho === "/transcrever" ? "{}" : undefined });
      assert.equal(cruzada.status, 403); assert.ok(JSON.parse(cruzada.corpo).erro.length > 0, "recusa por origem tem mensagem mesmo com chave válida");
    }
    assert.equal((await pedir(proxy.origem + BASE + "/capacidade", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.equal(alvo.pedidos.length, 0, "nenhuma gravação nem rota de voz chega ao app anotado");
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("capacidade de voz informa apenas disponibilidade e limites, com métodos delimitados", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const resposta = await pedir(proxy.origem + BASE + "/capacidade");
    assert.equal(resposta.status, 200); assert.equal(resposta.headers["cache-control"], "no-store");
    const dados = JSON.parse(resposta.corpo);
    assert.equal(dados.ok, true); assert.equal(typeof dados.disponivel, "boolean"); assert.equal(dados.local, true);
    assert.equal(dados.idioma, "pt"); assert.equal(dados.maxAudioBytes, MAX_AUDIO_BYTES); assert.equal(dados.maxDuracaoSegundos, 120);
    assert.ok(!resposta.corpo.includes(proxy.servidor.chave)); assert.ok(!resposta.corpo.includes("/home/"));
    for (const [caminho, metodo] of [["/capacidade", "POST"], ["/capacidade", "PUT"], ["/transcrever", "GET"], ["/transcrever", "DELETE"]]) {
      const r = await pedir(proxy.origem + BASE + caminho, { metodo, headers: json, corpo: metodo === "POST" ? "{}" : undefined });
      assert.equal(r.status, 405, caminho + " " + metodo); assert.equal(JSON.parse(r.corpo).ok, false);
    }
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("transcrição rejeita JSON, MIME e bytes inválidos antes de executar modelo local", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    for (const tipo of ["text/plain", "application/json-falso", "multipart/form-data"]) {
      const r = await pedir(proxy.origem + BASE + "/transcrever", { metodo: "POST", headers: { "content-type": tipo }, corpo: "{}" });
      assert.equal(r.status, 400, tipo); assert.equal(JSON.parse(r.corpo).ok, false);
      assert.match(JSON.parse(r.corpo).erro, /formato esperado/, "MIME recusado antes de ler o JSON");
    }
    const casos: Array<[string, number]> = [
      ["{", 400], ["null", 400], ["[]", 400], ["{}", 400],
      [JSON.stringify({ audio: "@@==", mime: "audio/webm" }), 400],
      [JSON.stringify({ audio: "YWJj", mime: "text/plain" }), 415],
      [JSON.stringify({ audio: Buffer.alloc(32).toString("base64"), mime: "audio/wav", python: "/bin/sh", script: "comando que não deve executar", modelo: "/tmp/indesejado" }), 422],
    ];
    for (const [corpo, status] of casos) {
      const r = await pedir(proxy.origem + BASE + "/transcrever", { metodo: "POST", headers: { "content-type": "application/json; charset=utf-8" }, corpo });
      assert.equal(r.status, status, corpo.slice(0, 70)); assert.equal(r.headers["cache-control"], "no-store");
      const dado = JSON.parse(r.corpo); assert.equal(dado.ok, false); assert.equal(typeof dado.erro, "string");
      assert.ok(!r.corpo.includes("/bin/sh") && !r.corpo.includes("/tmp/indesejado"));
    }
    assert.deepEqual(await proxy.servidor.fila.listar(), []); assert.equal(alvo.pedidos.length, 0);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("áudio acima de oito MiB é recusado antes de decodificação ou transcrição", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const audio = "A".repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4);
    const r = await pedir(proxy.origem + BASE + "/transcrever", { metodo: "POST", headers: json, corpo: JSON.stringify({ audio, mime: "audio/webm" }) });
    assert.equal(r.status, 413); assert.equal(JSON.parse(r.corpo).ok, false);
    assert.deepEqual(await proxy.servidor.fila.listar(), []); assert.equal(alvo.pedidos.length, 0);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});
