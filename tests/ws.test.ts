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

test("difusor entrega tarefas só ao agente escolhido e mantém os demais eventos públicos", { timeout: 5000 }, async () => {
  const difusor = new Difusor();
  const servidor = createServer();
  servidor.on("upgrade", (req, socket) => difusor.aceitar(req, socket));
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  const origem = `ws://127.0.0.1:${endereco.port}/eventos`;
  const clientes: Awaited<ReturnType<typeof abrirWs>>[] = [];
  try {
    const claude = await abrirWs(origem + "?agente=Claude");
    clientes.push(claude);
    const codex = await abrirWs(origem + "?agente=%20Codex%20");
    clientes.push(codex);
    const anonimo = await abrirWs(origem);
    clientes.push(anonimo);

    const lote = { tipo: "lote", id: "para-codex" } satisfies EventoAnotador;
    const avaliacao = { tipo: "avaliacao", id: "avaliacao-codex" } satisfies EventoAnotador;
    assert.equal(difusor.transmitir(lote, "codex"), 1);
    assert.equal(difusor.transmitir(avaliacao, "CoDeX"), 1);
    assert.equal(difusor.transmitir({ tipo: "lote", id: "sem-gemini" }, "gemini"), 0, "outros agentes e anônimos não impedem a ponte escolhida de iniciar");

    const parecer = { tipo: "parecer", id: "parecer-publico" } satisfies EventoAnotador;
    assert.equal(difusor.transmitir(parecer), 3);
    assert.deepEqual(JSON.parse(await claude.proximo()), parecer, "Claude não recebeu as tarefas do Codex");
    assert.deepEqual(JSON.parse(await anonimo.proximo()), parecer, "um ouvinte sem identidade não recebe tarefas dirigidas");
    assert.deepEqual(JSON.parse(await codex.proximo()), lote);
    assert.deepEqual(JSON.parse(await codex.proximo()), avaliacao);
    assert.deepEqual(JSON.parse(await codex.proximo()), parecer);

    const paraClaude = { tipo: "lote", id: "para-claude" } satisfies EventoAnotador;
    assert.equal(difusor.transmitir(paraClaude, "claude"), 1, "a identidade Claude da skill combina com o id claude");
    assert.deepEqual(JSON.parse(await claude.proximo()), paraClaude);

    for (const evento of [
      { tipo: "mensagem", id: "conversa-publica" },
      { tipo: "lote", id: "sem-ponte" },
    ] satisfies EventoAnotador[]) {
      assert.equal(difusor.transmitir(evento, null), 3, "sem filtro, mantém a difusão normal");
      for (const cliente of clientes) assert.deepEqual(JSON.parse(await cliente.proximo()), evento);
    }
  } finally {
    for (const cliente of clientes) cliente.fechar();
    difusor.fecharTodas();
    servidor.closeAllConnections();
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
  }
});
