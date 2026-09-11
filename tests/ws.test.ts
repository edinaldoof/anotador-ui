import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Difusor, aceitarWs, chaveAceite, codificarQuadro, codificarTexto, decodificarQuadros } from "../lib/ws.ts";
import { abrirWs } from "./ajuda.ts";

test("chaveAceite reproduz o vetor da RFC 6455", () => {
  assert.equal(chaveAceite("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("codificar e decodificar quadros cobre os três tamanhos e máscara", () => {
  const curto = codificarTexto("oi");
  const medio = codificarTexto("x".repeat(300));
  const longo = codificarTexto("y".repeat(70_000));
  const dec = decodificarQuadros(Buffer.concat([curto, medio, longo]));
  assert.equal(dec.quadros.length, 3);
  assert.equal(dec.resto.length, 0);
  assert.equal(dec.quadros[0]?.payload.toString(), "oi");
  assert.equal(dec.quadros[1]?.payload.length, 300);
  assert.equal(dec.quadros[2]?.payload.length, 70_000);
  assert.ok(dec.quadros.every((q) => q.fin && q.opcode === 0x1));

  const mascara = Buffer.from([1, 2, 3, 4]);
  const dados = Buffer.from("mascarado");
  const mascarado = Buffer.alloc(dados.length);
  for (let i = 0; i < dados.length; i++) mascarado[i] = (dados[i] ?? 0) ^ (mascara[i % 4] ?? 0);
  const quadro = Buffer.concat([Buffer.from([0x81, 0x80 | dados.length]), mascara, mascarado]);
  assert.equal(decodificarQuadros(quadro).quadros[0]?.payload.toString(), "mascarado");

  const parcial = decodificarQuadros(curto.subarray(0, 2));
  assert.equal(parcial.quadros.length, 0);
  assert.equal(parcial.resto.length, 2);
  assert.equal(codificarQuadro(0x9, Buffer.from("p"))[0], 0x89);
});

test("aceitarWs entrega texto ao cliente nativo, recebe texto e fecha limpo", async () => {
  const difusor = new Difusor();
  const recebidos: string[] = [];
  const servidor = createServer((_req, res) => res.end("http"));
  servidor.on("upgrade", (req, socket) => {
    const conexao = difusor.aceitar(req, socket, (t) => recebidos.push(t));
    conexao.enviar("primeira");
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const endereco = servidor.address();
  const porta = endereco && typeof endereco === "object" ? endereco.port : 0;
  try {
    const cliente = await abrirWs(`ws://127.0.0.1:${porta}/eventos`);
    assert.equal(await cliente.proximo(), "primeira");
    assert.equal(difusor.tamanho, 1);
    assert.equal(difusor.transmitir({ tipo: "lote", id: "abc" }), 1);
    assert.deepEqual(JSON.parse(await cliente.proximo()), { tipo: "lote", id: "abc" });
    cliente.enviar("do cliente");
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(recebidos, ["do cliente"]);
    cliente.fechar();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(difusor.tamanho, 0, "fechamento do cliente remove a conexão");
    assert.equal(difusor.transmitir({ tipo: "processado", id: "abc" }), 0);
  } finally {
    difusor.fecharTodas();
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});

test("aceitarWs responde ping com pong", async () => {
  const servidor = createServer();
  servidor.on("upgrade", (req, socket) => aceitarWs(req, socket));
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const endereco = servidor.address();
  const porta = endereco && typeof endereco === "object" ? endereco.port : 0;
  const { connect } = await import("node:net");
  const socket = connect(porta, "127.0.0.1");
  try {
    await new Promise<void>((r) => socket.once("connect", () => r()));
    socket.write("GET /x HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    const cabecalho = await new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    assert.match(cabecalho, /101 Switching Protocols/);
    assert.match(cabecalho, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
    const ping = Buffer.from([0x89, 0x80 | 2, 0, 0, 0, 0, 0x68, 0x69]);
    socket.write(ping);
    const pong = await new Promise<Buffer>((r) => socket.once("data", (d) => r(d)));
    assert.equal(pong[0], 0x8a);
    assert.equal(pong.subarray(2).toString(), "hi");
  } finally {
    socket.destroy();
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});
