import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ponte, comandoDaPonte, type Execucao, type PedidoPonte } from "../lib/agentes.ts";
import { idConversaAvaliacao, parecerDaResposta, saidaPublicaAvaliacao } from "../lib/avaliacao-conversa.ts";
import { BASE } from "../server.ts";
import { criarAlvoFalso, criarProxy, esperarAte, pedir } from "./ajuda.ts";

const linhas = (...eventos: unknown[]) => eventos.map(e => JSON.stringify(e)).join("\n");
const parecer = { resumo: "A hierarquia foi revisada.", itens: [], perguntas: [{ texto: "Quem pode se cadastrar?", opcoes: ["Equipe", "Participantes"] }] };

test("parecer vem da mensagem pública, sem depender de HTTP ou vazar raciocínio/ferramentas", () => {
  const id = randomUUID();
  const saida = saidaPublicaAvaliacao("codex", linhas(
    { type: "thread.started", thread_id: id },
    { type: "item.completed", item: { type: "reasoning", text: "raciocínio privado" } },
    { type: "item.completed", item: { type: "agent_message", phase: "analysis", text: "análise privada" } },
    { type: "item.completed", item: { type: "command_execution", aggregated_output: "segredo do terminal" } },
    { type: "item.completed", item: { type: "agent_message", phase: "commentary", text: "Conferindo a página." } },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(parecer) } },
  ));
  assert.equal(saida.sessao, id);
  assert.equal(saida.parecer?.resumo, parecer.resumo);
  assert.equal(saida.mensagens.length, 2);
  assert.match(saida.mensagens[1]!, /Quem pode se cadastrar/);
  assert.doesNotMatch(saida.mensagens.join(" "), /privad|segredo|"resumo"/);
  assert.equal(parecerDaResposta("Concluí o trabalho", "codex"), null);
  assert.equal(parecerDaResposta('{"resumo":"","itens":[],"perguntas":[]}', "codex"), null);
  assert.equal(parecerDaResposta("```json\n" + JSON.stringify(parecer) + "\n```", "claude")?.resumo, parecer.resumo);
});

test("Claude e Antigravity retornam revisão pública; mensagens internas e tool results são ignorados", () => {
  const id = randomUUID();
  const saida = saidaPublicaAvaliacao("claude", linhas(
    { type: "system", subtype: "init", session_id: id },
    { type: "assistant", parent_tool_use_id: "subagente", message: { content: [{ type: "text", text: "privado" }] } },
    { type: "assistant", message: { content: [{ type: "thinking", thinking: "segredo" }, { type: "text", text: "Revisando os controles." }] } },
    { type: "tool_result", result: "saída privada" },
    { type: "result", result: JSON.stringify(parecer), is_error: false },
  ));
  assert.equal(saida.sessao, id); assert.equal(saida.parecer?.resumo, parecer.resumo);
  assert.doesNotMatch(saida.mensagens.join(" "), /privad|segredo/);
  const agy = saidaPublicaAvaliacao("antigravity", JSON.stringify({ conversation_id: id, response: JSON.stringify(parecer) }, null, 2));
  assert.equal(agy.sessao, id); assert.equal(agy.parecer?.resumo, parecer.resumo);
  assert.equal(saidaPublicaAvaliacao("claude", JSON.stringify({ type: "result", is_error: true, result: JSON.stringify(parecer) })).parecer, null);
});

test("execuções antigas só leem a sessão no banner e logs persistidos não atravessam a pasta", async () => {
  const id = randomUUID();
  assert.equal(saidaPublicaAvaliacao("codex", "session id: " + id + "\nuser\nconteúdo da página").sessao, id);
  assert.equal(saidaPublicaAvaliacao("codex", "banner\nuser\nsession id: " + id).sessao, null);
  const pasta = await mkdtemp(join(tmpdir(), "anotador-saida-avaliacao-"));
  try {
    const execucao = "2026-09-14T19-40-56-510Z-codex";
    const ponte = new Ponte(pasta, () => {});
    await writeFile(join(pasta, execucao + ".log"), linhas({ type: "thread.started", thread_id: id }));
    assert.match(await ponte.lerSaidaAvaliacao(execucao, "codex"), /thread.started/);
    assert.equal(await ponte.lerSaidaAvaliacao(execucao, "claude"), "");
    assert.equal(await ponte.lerSaidaAvaliacao("../segredo", "codex"), "");
    await symlink(join(pasta, execucao + ".log"), join(pasta, "2026-09-14T19-40-57-510Z-codex.log"));
    assert.equal(await ponte.lerSaidaAvaliacao("2026-09-14T19-40-57-510Z-codex", "codex"), "");
  } finally { await rm(pasta, { recursive: true, force: true }); }
});

test("avaliar abre uma conversa própria, acompanha mensagens e entrega JSON sem callback nem reenvio", async (t) => {
  const chamadas: Array<{ pedido: PedidoPonte; execucao: Execucao }> = [];
  const nativa = randomUUID();
  let stdout = linhas({ type: "thread.started", thread_id: nativa }, { type: "item.completed", item: { type: "agent_message", text: "Conferindo a página." } });
  t.mock.method(Ponte.prototype, "lerSaidaAvaliacao", async () => stdout);
  t.mock.method(Ponte.prototype, "iniciar", async (pedido: PedidoPonte) => {
    const execucao: Execucao = { id: "2026-09-14T19-40-56-510Z-codex", agente: pedido.agente, sessao: null, modelo: pedido.modelo, pid: null, comando: ["simulado"], log: "", motivo: pedido.motivo, iniciadoEm: new Date().toISOString(), terminadoEm: null, codigo: null };
    chamadas.push({ pedido, execucao }); await pedido.aoAtualizar?.(execucao); return execucao;
  });
  const alvo = await criarAlvoFalso(), proxy = await criarProxy(alvo, { capturas: false, fonte: null, agente: "Codex CLI", ponte: { agente: "codex", sessao: randomUUID(), modelo: "gpt-6-astra", esforco: "high" } });
  const id = randomUUID(), chatId = idConversaAvaliacao(id);
  const ler = async (path: string) => JSON.parse((await pedir(proxy.origem + BASE + path)).corpo);
  const post = (path: string, corpo: unknown) => pedir(proxy.origem + BASE + path, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(corpo) });
  try {
    const enviada = await post("/avaliacoes", { id, pagina: { url: alvo.origem, caminho: "/entrar" }, foco: "A clareza do cadastro" });
    assert.equal(enviada.status, 201, enviada.corpo); assert.equal(JSON.parse(enviada.corpo).conversa.id, chatId);
    await esperarAte(() => chamadas.length === 1, 3000, 20);
    const chamada = chamadas[0]!;
    assert.equal(chamada.pedido.sessao, null, "a avaliação não assume a sessão configurada para lotes");
    assert.equal(chamada.pedido.saidaEstruturada, true);
    assert.match(await proxy.servidor.avaliacoes.lerMarkdown(id) ?? "", /resposta final/);
    const estado = await ler("/avaliacoes/" + id);
    assert.equal(estado.conversa.id, chatId); assert.equal(estado.conversa.sessaoExterna, nativa);
    const andamento = await ler("/chat/sessoes/" + chatId + "?agente=codex");
    assert.equal(andamento.conversa.somenteLeitura, true); assert.equal(andamento.conversa.avaliacao.emAndamento, true);
    assert.match(andamento.conversa.mensagens.at(-1).texto, /Conferindo/);
    assert.equal((await pedir(proxy.origem + BASE + "/chat/sessoes/" + chatId + "?agente=claude")).status, 409);
    assert.equal((await post("/chat/sessoes/" + chatId + "/mensagens", { agente: "codex", texto: "Continuar" })).status, 409);
    assert.equal((await post("/chat/sessoes/" + chatId + "/configuracao", { agente: "codex", modelo: null })).status, 409);
    stdout += "\n" + linhas({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(parecer) } }, { type: "turn.completed", usage: { input_tokens: 150, output_tokens: 50, cached_input_tokens: 0 } });
    await chamada.pedido.aoAtualizar?.({ ...chamada.execucao, codigo: 0, terminadoEm: new Date().toISOString() });
    const pronta = await ler("/avaliacoes/" + id);
    assert.equal(pronta.parecer.resumo, parecer.resumo); assert.equal(pronta.estado.fase, "concluida");
    const final = (await ler("/chat/sessoes/" + chatId + "?agente=codex")).conversa;
    assert.equal(final.avaliacao.emAndamento, false); assert.equal(final.somenteLeitura, undefined);
    assert.equal(final.sessaoExterna, nativa); assert.equal(final.metricas.acumulado.total, 200);
    assert.match(final.mensagens.at(-1).texto, /Quem pode se cadastrar/);
    const novamente = (await ler("/chat/sessoes/" + chatId + "?agente=codex")).conversa;
    assert.deepEqual(novamente.mensagens.map((m: { id: string }) => m.id), final.mensagens.map((m: { id: string }) => m.id));
    assert.equal(novamente.metricas.acumulado.total, 200); assert.equal(chamadas.length, 1);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("a saída estruturada usa flags nativas sem alterar os comandos normais de lotes", () => {
  for (const agente of ["claude", "codex", "antigravity"] as const) {
    const comando = comandoDaPonte(agente, null, "Avaliar", { saidaEstruturada: true })!;
    assert.ok(comando.includes(agente === "codex" ? "--json" : "--output-format"));
    assert.ok(!comandoDaPonte(agente, null, "Aplicar lote")!.includes("--output-format"));
  }
});
