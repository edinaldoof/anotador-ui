import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ponte, type Execucao, type PedidoPonte } from "../lib/agentes.ts";
import { BASE, type PonteConfig } from "../server.ts";
import { criarAlvoFalso, criarProxy, esperarAte, loteDeExemplo, pedir } from "./ajuda.ts";

function execucaoSimulada(pedido: PedidoPonte): Execucao {
  return {
    id: "execucao-simulada", agente: pedido.agente, sessao: pedido.sessao,
    modelo: pedido.modelo ?? null, comando: ["simulado"], pid: null,
    iniciadoEm: new Date().toISOString(), terminadoEm: null, codigo: null,
    log: "", motivo: pedido.motivo,
  };
}

test("lote mantém agente, modelo e projeto escolhidos antes do preparo assíncrono", { timeout: 10_000 }, async (t) => {
  const chamadas: PedidoPonte[] = [];
  t.mock.method(Ponte.prototype, "iniciar", async (pedido: PedidoPonte) => {
    chamadas.push(pedido);
    return execucaoSimulada(pedido);
  });
  const pasta = await mkdtemp(join(tmpdir(), "anotador-roteamento-snapshot-"));
  const alvo = await criarAlvoFalso();
  const novoAlvo = await criarAlvoFalso();
  const ponteOriginal: PonteConfig = { agente: "codex", sessao: "sessao-original", modelo: null, esforco: "high" };
  const proxy = await criarProxy(alvo, { fonte: pasta, nome: "Projeto original", ponte: ponteOriginal });
  const eventos: Array<{ tipo: string; agente?: string }> = [];
  t.mock.method(proxy.servidor.difusor, "transmitir", (evento: { tipo: string }, agente?: string) => {
    eventos.push({ tipo: evento.tipo, agente });
    return 0;
  });
  const anexarAnalise = proxy.servidor.fila.anexarAnalise.bind(proxy.servidor.fila);
  let preparoIniciado = false;
  let liberarPreparo!: () => void;
  const preparo = new Promise<void>((resolver) => { liberarPreparo = resolver; });
  t.mock.method(proxy.servidor.fila, "anexarAnalise", async (...args: Parameters<typeof anexarAnalise>) => {
    preparoIniciado = true;
    await preparo;
    return anexarAnalise(...args);
  });
  const pathAnterior = process.env["PATH"];
  try {
    // Só a detecção lê este arquivo; Ponte.iniciar está totalmente simulada.
    await writeFile(join(pasta, "claude"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    process.env["PATH"] = pasta;
    const lote = loteDeExemplo("lote-snapshot-da-conexao");
    const resposta = await pedir(proxy.origem + BASE + "/lotes", {
      metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(lote),
    });
    assert.equal(resposta.status, 201);
    await esperarAte(() => preparoIniciado, 3000, 10);
    assert.equal(chamadas.length, 0, "a entrega aguarda a preparação do lote");

    // Também cobre a cópia do objeto aninhado, além de a API trocar a ponte inteira.
    ponteOriginal.modelo = "modelo-mutado-depois";
    ponteOriginal.sessao = "sessao-mutada-depois";
    ponteOriginal.esforco = "low";
    const troca = await pedir(proxy.origem + BASE + "/agente/ponte", {
      metodo: "POST", headers: { "content-type": "application/json" },
      corpo: JSON.stringify({ agente: "claude", sessao: null, modelo: "sonnet" }),
    });
    assert.equal(troca.status, 200, troca.corpo);
    await proxy.servidor.conectar({ alvo: novoAlvo.origem, nome: "Projeto seguinte", fonte: proxy.saida, agente: "Claude" });
    liberarPreparo();
    await esperarAte(() => chamadas.length === 1, 3000, 10);

    const pedido = chamadas[0]!;
    assert.equal(pedido.agente, "codex");
    assert.equal(pedido.sessao, "sessao-original");
    assert.equal(pedido.modelo, null);
    assert.equal(pedido.esforco, "high");
    assert.equal(pedido.fonte, pasta);
    assert.ok(pedido.mensagem.includes('app "Projeto original"'));
    assert.ok(pedido.mensagem.includes(alvo.origem));
    assert.ok(!pedido.mensagem.includes(novoAlvo.origem));
    assert.ok(!pedido.mensagem.includes("Projeto seguinte"));
    assert.deepEqual(eventos.filter((evento) => evento.tipo === "lote"), [{ tipo: "lote", agente: "codex" }]);
    assert.equal((await proxy.servidor.fila.status(lote.id)).estado, "recebido");
  } finally {
    liberarPreparo();
    if (pathAnterior === undefined) delete process.env["PATH"]; else process.env["PATH"] = pathAnterior;
    await proxy.fechar();
    await alvo.fechar();
    await novoAlvo.fechar();
    await rm(pasta, { recursive: true, force: true });
  }
});

test("falha anterior ao spawn aparece no status sem perder o lote ou expor detalhes internos", { timeout: 10_000 }, async (t) => {
  let chamadas = 0;
  t.mock.method(Ponte.prototype, "iniciar", async () => {
    chamadas++;
    throw new Error("EACCES /privado/credenciais segredo-de-teste");
  });
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, {
    fonte: null,
    ponte: { agente: "claude", sessao: null, modelo: "sonnet", esforco: "high" },
  });
  try {
    const lote = loteDeExemplo("lote-falha-antes-do-spawn");
    const enviar = () => pedir(proxy.origem + BASE + "/lotes", {
      metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(lote),
    });
    assert.equal((await enviar()).status, 201, "o recebimento não depende de o CLI conseguir abrir");
    await esperarAte(async () => (await proxy.servidor.fila.status(lote.id)).execucao?.codigo === -1, 3000, 10);
    const resposta = await pedir(`${proxy.origem}${BASE}/lotes/${lote.id}/status`);
    assert.equal(resposta.status, 200);
    const status = JSON.parse(resposta.corpo) as StatusLote;
    assert.equal(status.estado, "recebido");
    assert.equal(status.execucao?.agente, "claude");
    assert.equal(status.execucao?.modelo, "sonnet");
    assert.equal(status.execucao?.codigo, -1);
    assert.ok(status.execucao?.id);
    assert.ok(Number.isFinite(Date.parse(status.execucao!.iniciadoEm)));
    assert.ok(Number.isFinite(Date.parse(status.execucao!.terminadoEm!)));
    assert.match(status.execucao?.erro ?? "", /Não foi possível iniciar o agente/);
    assert.match(status.execucao?.erro ?? "", /anotações continuam salvas/);
    assert.doesNotMatch(resposta.corpo, /EACCES|privado|credenciais|segredo-de-teste/);
    assert.match(await readFile(proxy.servidor.fila.caminhoMd(lote.id), "utf8"), /Deixar o rótulo maior/);
    assert.equal((await enviar()).status, 200, "repetir o mesmo recebimento não duplica o lote nem inicia outra execução");
    assert.equal(chamadas, 1);
    await proxy.servidor.fila.marcarProgresso(lote.id, "retomado");
    assert.equal((await proxy.servidor.fila.status(lote.id)).execucao?.codigo, -1);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});
