import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { slugProjetoClaude, type SessaoAgente } from "../lib/agentes.ts";
import { importarSessaoChat, lerMetricasSessaoChat, sessoesExternasChat, type OpcoesImportacaoSessao, type OpcoesListagemSessoes } from "../lib/chat-sessoes.ts";

async function ambiente(tarefa: (a: { pasta: string; fonte: string; id: string; claude: string; codex: string; listas: OpcoesListagemSessoes; importar: OpcoesImportacaoSessao }) => Promise<void>): Promise<void> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-sessoes-"));
  const fonte = join(pasta, "projeto"), id = randomUUID(), raizClaude = join(pasta, "claude"), raizCodex = join(pasta, "codex");
  const claude = join(raizClaude, "projects", slugProjetoClaude(fonte), id + ".jsonl");
  const codex = join(raizCodex, "sessions", "2026", "09", "14", "rollout-2026-09-14-" + id + ".jsonl");
  await mkdir(join(claude, ".."), { recursive: true }); await mkdir(join(codex, ".."), { recursive: true });
  const base = { id, cwd: fonte, ativa: false, pid: null, em: "2026-09-14T12:00:00.000Z", nome: null, titulo: "Sessão do projeto", origem: "cli" };
  const listarClaude = async (): Promise<SessaoAgente[]> => [{ ...base, agente: "claude" }];
  const listarCodex = async (): Promise<SessaoAgente[]> => [{ ...base, agente: "codex" }];
  const listas = { raizClaude, raizCodex, listarClaude, listarCodex };
  const importar = { raizClaude, raizCodex, listar: (f: string | null) => sessoesExternasChat(f, listas) };
  await writeFile(claude, JSON.stringify({ type: "user", cwd: fonte, sessionId: id, message: { content: "Pergunta Claude" } }) + "\n");
  await writeFile(codex, [
    { type: "session_meta", payload: { id, cwd: fonte, source: "cli" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Pergunta Codex" }] } },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n");
  try { await tarefa({ pasta, fonte, id, claude, codex, listas, importar }); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}

test("sessões nativas com o mesmo UUID permanecem separadas por agente", async () => {
  await ambiente(async ({ fonte, id, listas, importar }) => {
    const sessoes = await sessoesExternasChat(fonte, listas);
    assert.deepEqual(sessoes.map((s) => s.agente).sort(), ["claude", "codex"]);
    assert.deepEqual((await importarSessaoChat("claude", id, fonte, importar)).mensagens.map((m) => m.texto), ["Pergunta Claude"]);
    assert.deepEqual((await importarSessaoChat("codex", id, fonte, importar)).mensagens.map((m) => m.texto), ["Pergunta Codex"]);
    await assert.rejects(importarSessaoChat("antigravity", id, fonte, importar), /não encontrada/);
  });
});

test("a listagem não revela o título de um projeto cujo slug do Claude colide", async () => {
  await ambiente(async ({ fonte, id, claude, listas, importar }) => {
    const outro = fonte.replace(/\/projeto$/, "-projeto");
    assert.equal(slugProjetoClaude(outro), slugProjetoClaude(fonte));
    await writeFile(claude, JSON.stringify({ type: "user", cwd: outro, sessionId: id, message: { content: "NÃO EXPOR OUTRO PROJETO" } }));
    assert.deepEqual((await sessoesExternasChat(fonte, listas)).map((s) => s.agente), ["codex"]);
    await assert.rejects(importarSessaoChat("claude", id, fonte, importar), /não encontrada/);
  });
});

test("origem nativa rejeita symlink, UUID divergente e transcript com pastas misturadas", async () => {
  await ambiente(async ({ fonte, id, claude, codex, listas, importar }) => {
    await rm(claude); await symlink(codex, claude);
    assert.deepEqual((await sessoesExternasChat(fonte, listas)).map((s) => s.agente), ["codex"]);
    await assert.rejects(importarSessaoChat("claude", id, fonte, importar));
    await rm(claude);
    await writeFile(claude, JSON.stringify({ type: "user", cwd: fonte, sessionId: randomUUID(), message: { content: "Outra sessão" } }));
    assert.deepEqual((await sessoesExternasChat(fonte, listas)).map((s) => s.agente), ["codex"]);
    await writeFile(claude, [{ cwd: fonte, sessionId: id }, { cwd: fonte + "-outro", sessionId: id }].map((o) => JSON.stringify(o)).join("\n"));
    assert.deepEqual((await sessoesExternasChat(fonte, listas)).map((s) => s.agente), ["codex"]);
  });
});

test("Codex exclui sessões de subagentes nos formatos antigo e atual", async () => {
  await ambiente(async ({ fonte, id, codex, listas, importar }) => {
    for (const dados of [{ thread_source: "subagent" }, { source: "subagent" }, { source: { subagent: { thread_spawn: { parent_thread_id: randomUUID() } } } }]) {
      await writeFile(codex, JSON.stringify({ type: "session_meta", payload: { id, cwd: fonte, ...dados } }) + "\n");
      assert.deepEqual((await sessoesExternasChat(fonte, listas)).map((s) => s.agente), ["claude"]);
      await assert.rejects(importarSessaoChat("codex", id, fonte, importar), /não encontrada/);
    }
  });
});

test("métricas não aceitam agente trocado, projeto divergente ou arquivo apontado por symlink", async () => {
  await ambiente(async ({ fonte, id, claude, codex, importar }) => {
    assert.equal(await lerMetricasSessaoChat("antigravity", id, fonte, importar), null);
    assert.equal(await lerMetricasSessaoChat("claude", id, fonte + "-outro", importar), null);
    assert.equal(await lerMetricasSessaoChat("codex", id, fonte + "-outro", importar), null);
    await rm(claude); await symlink(codex, claude);
    assert.equal(await lerMetricasSessaoChat("claude", id, fonte, importar), null);
  });
});

test("métricas de uma sessão Codex usam o evento nativo mesmo com leitura limitada do histórico", async () => {
  await ambiente(async ({ fonte, id, codex, importar }) => {
    await appendFile(codex, JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "CONTEÚDO_PRIVADO".repeat(180_000) }] } }) + "\n");
    await appendFile(codex, [
      { type: "turn_context", payload: { model: "modelo-nativo" } },
      { type: "event_msg", timestamp: "2026-09-14T13:00:00.000Z", payload: { type: "token_count", info: {
        total_token_usage: { input_tokens: 90_000, cached_input_tokens: 60_000, output_tokens: 1000, reasoning_output_tokens: 400, total_tokens: 91_000 },
        last_token_usage: { input_tokens: 7000, output_tokens: 500, total_tokens: 7500 }, model_context_window: 30_000,
      } } },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n");
    const m = await lerMetricasSessaoChat("codex", id, fonte, importar);
    assert.equal(m?.tipo, "sessao");
    assert.equal(m?.uso?.total, 91_000, "acumulado nativo não é estimado a partir do texto");
    assert.equal(m?.contexto?.usados, 7500);
    assert.equal(m?.contexto?.percentual, 25);
    assert.equal(m?.contexto?.modelo, "modelo-nativo");
    assert.equal(JSON.stringify(m).includes("CONTEÚDO_PRIVADO"), false);
  });
});

test("métricas de Claude só carregam contadores do próprio transcript", async () => {
  await ambiente(async ({ fonte, id, claude, importar }) => {
    await appendFile(claude, JSON.stringify({ type: "assistant", sessionId: id, timestamp: "2026-09-14T13:00:00.000Z", message: {
      id: "resposta-original", model: "claude-proprio", content: [{ type: "text", text: "NÃO EXPOR RESPOSTA" }],
      usage: { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50, output_tokens: 1 },
    } }) + "\n");
    const m = await lerMetricasSessaoChat("claude", id, fonte, importar);
    assert.equal(m?.tipo, "parcial");
    assert.equal(m?.contexto?.usados, 350);
    assert.equal(m?.contexto?.limite, null, "não inventa limite pelo nome do modelo");
    assert.equal(m?.uso?.saida, null, "saída provisória do transcript não vira consumo final");
    assert.equal(JSON.stringify(m).includes("NÃO EXPOR RESPOSTA"), false);
  });
});
