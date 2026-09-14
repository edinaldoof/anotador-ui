import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { BASE } from "../server.ts";
import { criarAlvoFalso, criarProxy, loteDeExemplo, pedir, type AlvoFalso } from "./ajuda.ts";

test("progresso atrasado não anuncia a reabertura de um lote processado", async (t) => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const id = "lote-finalizado-0001";
    await proxy.servidor.fila.gravar(loteDeExemplo(id));
    await proxy.servidor.fila.marcarProcessado(id, "Concluído");
    const transmitir = t.mock.method(proxy.servidor.difusor, "transmitir", () => 0);
    const r = await pedir(proxy.origem + BASE + `/lotes/${id}/progresso`, {
      metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ nota: "Ainda trabalhando" }),
    });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.corpo).status.estado, "processado");
    assert.equal(transmitir.mock.callCount(), 0);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("permitir alvos externos continua exigindo HTTP ou HTTPS", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { permitirExterno: true });
  try {
    await assert.rejects(proxy.servidor.conectar({ alvo: "ftp://127.0.0.1:21" }), /http/i);
    assert.equal(proxy.servidor.alvo, alvo.origem, "conexão inválida mantém o alvo anterior");
    const r = await pedir(proxy.origem + BASE + "/conectar", {
      metodo: "POST", headers: { "content-type": "application/json" },
      corpo: JSON.stringify({ alvo: "file:///tmp", forcar: true }),
    });
    assert.equal(r.status, 400);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("proxy alcança um servidor de desenvolvimento em IPv6", async (t) => {
  const servidor = createServer((_req, res) => res.end("IPv6 alcançado"));
  try {
    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(0, "::1", resolve);
    });
  } catch (erro) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes((erro as NodeJS.ErrnoException).code ?? "")) {
      t.skip("IPv6 indisponível nesta máquina");
      return;
    }
    throw erro;
  }
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  const alvo: AlvoFalso = {
    porta: endereco.port, origem: `http://[::1]:${endereco.port}`, pedidos: [],
    fechar: () => new Promise<void>((resolve) => { servidor.closeAllConnections(); servidor.close(() => resolve()); }),
  };
  let proxy;
  try {
    proxy = await criarProxy(alvo);
    const r = await pedir(proxy.origem + "/");
    assert.equal(r.status, 200);
    assert.equal(r.corpo, "IPv6 alcançado");
  } finally {
    await proxy?.fechar();
    await alvo.fechar();
  }
});

function pedidoBruto(porta: number, caminho: string, upgrade = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(porta, "127.0.0.1");
    let resposta = "";
    socket.setTimeout(3000, () => socket.destroy(new Error("pedido sem resposta")));
    socket.on("error", reject);
    socket.on("data", (dados) => { resposta += dados.toString(); });
    socket.on("end", () => resolve(resposta));
    socket.on("connect", () => socket.write(
      `GET ${caminho} HTTP/1.1\r\nHost: 127.0.0.1:${porta}\r\nConnection: ${upgrade ? "Upgrade" : "close"}\r\n${upgrade ? "Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" : ""}\r\n`
    ));
  });
}

test("URLs malformadas recebem 400 sem derrubar HTTP nem WebSocket", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    for (const upgrade of [false, true]) {
      const resposta = await pedidoBruto(proxy.porta, "http://[invalido/", upgrade);
      assert.match(resposta, /^HTTP\/1\.1 400 /);
    }
    assert.equal((await pedir(proxy.origem + BASE + "/lotes/%XX/md")).status, 400);
    assert.equal((await pedir(proxy.origem + BASE + "/saude")).status, 200);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("resposta interrompida pelo alvo encerra o pedido e mantém o proxy disponível", { timeout: 10_000 }, async () => {
  const servidor = createServer((req, res) => {
    res.writeHead(200, { "content-type": req.url === "/html" ? "text/html" : "application/octet-stream", "content-length": "1000", ...(req.url === "/gzip" ? { "content-type": "text/html", "content-encoding": "gzip" } : {}) });
    res.write(req.url === "/gzip" ? Buffer.from([0x1f, 0x8b, 0x08, 0x00]) : "resposta parcial");
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const endereco = servidor.address();
  assert.ok(endereco && typeof endereco === "object");
  const alvo: AlvoFalso = {
    porta: endereco.port, origem: `http://127.0.0.1:${endereco.port}`, pedidos: [],
    fechar: () => new Promise<void>((resolve) => { servidor.closeAllConnections(); servidor.close(() => resolve()); }),
  };
  const proxy = await criarProxy(alvo);
  try {
    for (const caminho of ["/html", "/gzip"]) {
      const r = await pedir(proxy.origem + caminho);
      assert.equal(r.status, 502);
    }
    await new Promise<void>((resolve, reject) => {
      const req = request(proxy.origem + "/binario", (res) => {
        res.on("error", () => resolve());
        res.on("end", () => reject(new Error("resposta truncada foi aceita")));
        res.resume();
      });
      req.setTimeout(3000, () => req.destroy(new Error("pedido ficou pendurado")));
      req.on("error", reject);
      req.end();
    });
    assert.equal((await pedir(proxy.origem + BASE + "/overlay.js")).status, 200);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});
