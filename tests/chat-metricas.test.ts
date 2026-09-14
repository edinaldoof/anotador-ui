import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarMetricasChat, extrairMetricasChat, invalidarContextoMetricasChat, metricasChatVazias } from "../lib/chat-metricas.ts";

const em = "2026-09-14T12:00:00.000Z";
const jsonl = (...eventos: unknown[]) => eventos.map((e) => JSON.stringify(e)).join("\n");
const claudeUsage = { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 80 };
const codexUsage = { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50, reasoning_output_tokens: 20, total_tokens: 1050 };
const modelo = "modelo-local-atual";
const codexEvento = (total = codexUsage, last = codexUsage, timestamp = em) => ({ timestamp, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 2000 } } });

test("Claude soma entrada fresca/cache uma vez; result acumulado não ocupa contexto", () => {
  const o = extrairMetricasChat("claude", JSON.stringify({ type: "result", usage: claudeUsage, total_cost_usd: 0.03125 }), { origem: "execucao", em })!;
  assert.equal(o.uso?.entrada, 1050); assert.equal(o.uso?.saida, 80); assert.equal(o.uso?.total, 1130);
  assert.equal(o.uso?.cacheLeitura, 900); assert.equal(o.uso?.custoUSD, 0.03125);
  assert.equal(o.contexto, null);
});

test("Claude modelUsage inclui subagentes e janela somente do modelo identificado", () => {
  const saida = jsonl({ type: "assistant", timestamp: em, message: { id: "msg-a", model: modelo, usage: claudeUsage } }, {
    type: "result", usage: claudeUsage, total_cost_usd: 0.05,
    modelUsage: { [modelo]: { inputTokens: 100, outputTokens: 80, cacheReadInputTokens: 900, cacheCreationInputTokens: 50, contextWindow: 3000, costUSD: 0.03 },
      "subagente-outro": { inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 9999, costUSD: 0.02 } },
  });
  const o = extrairMetricasChat("claude", saida, { origem: "execucao", em })!;
  assert.equal(o.uso?.total, 1155); assert.equal(o.uso?.custoUSD, 0.05);
  assert.equal(o.contexto?.usados, 1050); assert.equal(o.contexto?.limite, 3000); assert.equal(o.contexto?.percentual, 35);
});

test("Claude não escolhe janela arbitrária entre modelos nem usa acumulado como contexto", () => {
  const o = extrairMetricasChat("claude", JSON.stringify({ type: "result", usage: claudeUsage,
    modelUsage: { a: { contextWindow: 9000 }, b: { contextWindow: 50000 } } }), { origem: "execucao", em })!;
  assert.equal(o.contexto, null);
});

test("Claude transcript deduplica respostas paralelas e ignora subagentes e saída provisória", () => {
  const assistente = { type: "assistant", timestamp: em, message: { id: "msg-duplicada", model: modelo, usage: claudeUsage } };
  const o = extrairMetricasChat("claude", jsonl(assistente, assistente, { ...assistente, parent_tool_use_id: "ferramenta", message: { ...assistente.message, id: "outra", usage: { ...claudeUsage, input_tokens: 9999 } } }), { origem: "transcript", parcial: true, em })!;
  assert.equal(o.tipo, "parcial"); assert.equal(o.uso?.entrada, 1050); assert.equal(o.uso?.saida, null); assert.equal(o.uso?.total, null);
  assert.equal(o.contexto?.usados, 1050); assert.equal(o.contexto?.limite, null);
});

test("Claude última chamada substitui contexto mesmo quando ele diminui após compactação", () => {
  const a = (id: string, n: number, t: string) => ({ type: "assistant", timestamp: t, message: { id, model: modelo, usage: { ...claudeUsage, input_tokens: n } } });
  const o = extrairMetricasChat("claude", jsonl(a("a", 8000, em), { type: "system", subtype: "compact_boundary" }, a("b", 20, "2026-09-14T12:00:10Z")), { origem: "transcript" })!;
  assert.equal(o.contexto?.usados, 970); assert.equal(o.contexto?.atualizadoEm, "2026-09-14T12:00:10.000Z");
});

test("Claude compactação sem próxima chamada invalida ocupação, sem zerar consumo", () => {
  const o = extrairMetricasChat("claude", jsonl({ type: "assistant", timestamp: em, message: { id: "a", model: modelo, usage: claudeUsage } },
    { type: "system", subtype: "compact_boundary", timestamp: "2026-09-14T12:00:10Z" }), { origem: "transcript" })!;
  assert.equal(o.contexto?.usados, null); assert.equal(o.uso?.entrada, 1050);
});

test("Codex last_token_usage mede contexto; total_token_usage mede consumo e cache/raciocínio não duplicam", () => {
  const total = { ...codexUsage, input_tokens: 30000, output_tokens: 1000, total_tokens: 31000 };
  const o = extrairMetricasChat("codex", jsonl({ type: "turn_context", payload: { model: modelo } }, codexEvento(total)), { origem: "transcript", em })!;
  assert.equal(o.tipo, "sessao"); assert.equal(o.uso?.total, 31000); assert.equal(o.uso?.raciocinio, 20);
  assert.equal(o.contexto?.usados, 1050); assert.equal(o.contexto?.percentual, 52.5); assert.equal(o.contexto?.modelo, modelo);
  assert.equal(o.ultimoTurno, null);
});

test("Codex stdout turn.completed não fornece ocupação nem preço", () => {
  const o = extrairMetricasChat("codex", JSON.stringify({ type: "turn.completed", usage: codexUsage }), { origem: "execucao", em })!;
  assert.equal(o.tipo, "execucao"); assert.equal(o.uso?.total, 1050); assert.equal(o.contexto, null); assert.equal(o.uso?.custoUSD, null);
});

test("Codex ignora token_count sem info e ferramentas com falsos contadores", () => {
  const o = extrairMetricasChat("codex", jsonl(codexEvento(), { type: "event_msg", payload: { type: "token_count", info: null } },
    { type: "item.completed", item: { type: "command_execution", usage: { input_tokens: 999999 } } }), { origem: "transcript", em })!;
  assert.equal(o.uso?.total, 1050); assert.equal(o.contexto?.usados, 1050);
});

test("Antigravity usa snapshot final cumulativo e não trata checkpoint como contexto", () => {
  const o = extrairMetricasChat("antigravity", jsonl({ event: "step_update", step_update: { state: "DONE", step_type: "checkpoint", usage: { input_tokens: 100 } } },
    { event: "result", result: { conversation_id: "id", status: "SUCCESS", usage: { input_tokens: 10418, output_tokens: 589, thinking_tokens: 551, cache_read_tokens: 8113, total_tokens: 11007 } } }), { origem: "execucao", em })!;
  assert.equal(o.tipo, "sessao"); assert.equal(o.uso?.total, 11007); assert.equal(o.uso?.raciocinio, 551); assert.equal(o.uso?.cacheLeitura, 8113);
  assert.equal(o.contexto, null); assert.equal(o.uso?.custoUSD, null);
});

test("ausência, números inválidos e zero verdadeiro permanecem distintos", () => {
  assert.equal(extrairMetricasChat("codex", '{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":"30"}}', { origem: "execucao", em }), null);
  const o = extrairMetricasChat("codex", '{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}', { origem: "execucao", em })!;
  assert.equal(o.uso?.total, 0); assert.equal(o.uso?.cacheLeitura, null);
  assert.equal(extrairMetricasChat("desconhecido", JSON.stringify({ type: "result", usage: claudeUsage }), { origem: "execucao", em }), null);
});

test("resultado de erro com consumo válido também é contabilizado", () => {
  const o = extrairMetricasChat("claude", JSON.stringify({ type: "result", is_error: true, usage: claudeUsage, total_cost_usd: 0.02 }), { origem: "execucao", em })!;
  assert.equal(o.uso?.total, 1130); assert.equal(o.uso?.custoUSD, 0.02);
});

test("acumular stdout é idempotente mesmo após serialização e restart", () => {
  const o = extrairMetricasChat("codex", JSON.stringify({ type: "turn.completed", usage: codexUsage }), { origem: "execucao", em })!;
  const a = aplicarMetricasChat(undefined, o, "mensagem-1");
  assert.deepEqual(aplicarMetricasChat(JSON.parse(JSON.stringify(a)), o, "mensagem-1"), a);
  const b = aplicarMetricasChat(a, o, "mensagem-2"); assert.equal(b.acumulado.total, 2100); assert.equal(a.acumulado.total, 1050);
});

test("snapshot nativo substitui delta já contado em vez de duplicar consumo", () => {
  const delta = extrairMetricasChat("codex", JSON.stringify({ type: "turn.completed", usage: codexUsage }), { origem: "execucao", em })!;
  const snap = extrairMetricasChat("codex", JSON.stringify(codexEvento()), { origem: "transcript", em: "2026-09-14T12:00:01Z" })!;
  let m = aplicarMetricasChat(undefined, delta, "envio-1"); m = aplicarMetricasChat(m, snap, "snapshot");
  assert.equal(m.acumulado.total, 1050); assert.equal(m.cobertura, "sessao");
  m = aplicarMetricasChat(m, snap, "snapshot"); assert.equal(m.acumulado.total, 1050);
  m = aplicarMetricasChat(m, delta, "envio-1"); assert.equal(m.acumulado.total, 1050);
});

test("snapshot lido após stdout aceita evento anterior em milissegundos e mantém timestamp da medição", () => {
  const delta = extrairMetricasChat("codex", JSON.stringify({ type: "turn.completed", usage: codexUsage }), { origem: "execucao", em: "2026-09-14T12:00:01.020Z" })!;
  const snap = extrairMetricasChat("codex", JSON.stringify(codexEvento({ ...codexUsage, total_tokens: 9990 }, codexUsage, "2026-09-14T12:00:01.000Z")), { origem: "transcript", em: "2026-09-14T12:00:01.030Z" })!;
  const m = aplicarMetricasChat(aplicarMetricasChat(undefined, delta, "envio"), snap, "leitura");
  assert.equal(m.acumulado.total, 9990); assert.equal(m.contexto.atualizadoEm, "2026-09-14T12:00:01.000Z");
});

test("última entrada Claude preenche janela do stdout ligeiramente posterior no mesmo modelo", () => {
  const stdout = extrairMetricasChat("claude", JSON.stringify({ type: "result", usage: claudeUsage,
    modelUsage: { [modelo]: { inputTokens: 100, outputTokens: 80, cacheReadInputTokens: 900, cacheCreationInputTokens: 50, contextWindow: 3000 } } }),
    { origem: "execucao", em: "2026-09-14T12:00:00.020Z" })!;
  const transcript = extrairMetricasChat("claude", JSON.stringify({ type: "assistant", timestamp: em, message: { id: "msg", model: modelo, usage: claudeUsage } }), { origem: "transcript", em: "2026-09-14T12:00:00.030Z" })!;
  const m = aplicarMetricasChat(aplicarMetricasChat(undefined, stdout, "envio"), transcript, "leitura");
  assert.equal(m.contexto.usados, 1050); assert.equal(m.contexto.limite, 3000); assert.equal(m.contexto.percentual, 35);
  assert.equal(m.acumulado.total, 1130); assert.equal(m.ultimoTurno?.total, 1130);
});

test("trocar modelo invalida contexto sem perder consumo, nova medição não herda janela anterior", () => {
  const snap = extrairMetricasChat("codex", jsonl({ type: "turn_context", payload: { model: modelo } }, codexEvento()), { origem: "transcript", em })!;
  const a = aplicarMetricasChat(undefined, snap, "snapshot");
  const b = invalidarContextoMetricasChat(a, "outro-modelo");
  assert.equal(b.contexto.percentual, null); assert.equal(b.contexto.limite, null); assert.equal(b.acumulado.total, 1050);
  assert.equal(a.contexto.limite, 2000);
});

test("snapshot antigo não faz consumo/contexto atual voltar no tempo", () => {
  const antigo = extrairMetricasChat("codex", JSON.stringify(codexEvento()), { origem: "transcript", em })!;
  const atual = extrairMetricasChat("codex", JSON.stringify(codexEvento({ ...codexUsage, total_tokens: 3000 }, { ...codexUsage, total_tokens: 1500 }, "2026-09-14T12:01:00Z")), { origem: "transcript", em: "2026-09-14T12:01:00Z" })!;
  const m = aplicarMetricasChat(aplicarMetricasChat(undefined, atual, "novo"), antigo, "antigo");
  assert.equal(m.acumulado.total, 3000); assert.equal(m.contexto.usados, 1500);
});

test("contador vazio não finge zero nem sessão nova para histórico desconhecido", () => {
  const vazio = metricasChatVazias(); assert.equal(vazio.acumulado.total, null); assert.equal(vazio.contexto.percentual, null);
  assert.deepEqual(aplicarMetricasChat(vazio, null, "sem-metricas"), vazio);
});
