import assert from "node:assert/strict";
import { test } from "node:test";
import { Ponte, type Execucao, type PedidoPonte } from "../lib/agentes.ts";
import { BASE } from "../server.ts";
import { abrirWs, criarAlvoFalso, criarProxy, esperarAte, loteDeExemplo, pedir, type ClienteWs } from "./ajuda.ts";

test("modelo explícito usa a ponte para lote e avaliação mesmo com agentes ouvindo", { timeout: 10_000 }, async (t) => {
  const chamadas: PedidoPonte[] = [];
  t.mock.method(Ponte.prototype, "iniciar", async (pedido: PedidoPonte): Promise<Execucao> => {
    chamadas.push(pedido);
    return {
      id: `execucao-simulada-${chamadas.length}`, agente: pedido.agente, sessao: pedido.sessao,
      modelo: pedido.modelo, comando: ["simulado"], pid: null, iniciadoEm: new Date().toISOString(),
      terminadoEm: null, codigo: null, log: "", motivo: pedido.motivo,
    };
  });
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, {
    fonte: null,
    ponte: { agente: "codex", sessao: "sessao-escolhida", modelo: "modelo-escolhido", esforco: "high" },
  });
  const clientes: ClienteWs[] = [];
  try {
    for (const agente of ["Codex", "Claude"]) {
      const cliente = await abrirWs(`ws://127.0.0.1:${proxy.porta}${BASE}/eventos?agente=${agente}`);
      clientes.push(cliente);
      assert.equal(JSON.parse(await cliente.proximo()).tipo, "ola");
    }
    const lote = loteDeExemplo("lote-modelo-explicito");
    const pedidoLote = await pedir(proxy.origem + BASE + "/lotes", {
      metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(lote),
    });
    assert.equal(pedidoLote.status, 201);
    const idAvaliacao = "avaliacao-modelo-explicito";
    const pedidoAvaliacao = await pedir(proxy.origem + BASE + "/avaliacoes", {
      metodo: "POST", headers: { "content-type": "application/json" },
      corpo: JSON.stringify({ id: idAvaliacao, pagina: lote.pagina, contexto: {}, achados: [] }),
    });
    assert.equal(pedidoAvaliacao.status, 201);
    await esperarAte(() => chamadas.length === 2, 3000, 20);
    for (const pedido of chamadas) {
      assert.equal(pedido.agente, "codex");
      assert.equal(pedido.sessao, pedido.loteId ? "sessao-escolhida" : null,
        "o lote retoma a sessão configurada; a avaliação tem sua própria conversa");
      assert.equal(pedido.modelo, "modelo-escolhido");
      assert.equal(pedido.esforco, "high");
    }
    assert.ok(chamadas.some((pedido) => pedido.mensagem.includes(lote.id)));
    assert.ok(chamadas.some((pedido) => pedido.mensagem.includes(idAvaliacao)));

    const nota = await pedir(`${proxy.origem}${BASE}/lotes/${lote.id}/mensagens`, {
      metodo: "POST", headers: { "content-type": "application/json" },
      corpo: JSON.stringify({ autor: "usuario", tipo: "resposta", texto: "Conversa continua pública" }),
    });
    assert.equal(nota.status, 201, nota.corpo);
    for (const cliente of clientes) {
      const evento = JSON.parse(await cliente.proximo());
      assert.equal(evento.tipo, "mensagem", "o ouvinte não recebeu lote/avaliação destinados ao modelo explícito");
      assert.equal(evento.mensagem.texto, "Conversa continua pública");
    }
  } finally {
    for (const cliente of clientes) cliente.fechar();
    await proxy.fechar();
    await alvo.fechar();
  }
});
