import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { importarSessaoChat, sessoesAntigravityChat, sessoesExternasChat } from "../lib/chat-sessoes.ts";

async function ambiente(tarefa: (a: { pasta: string; fonte: string; raizAntigravity: string; raizProc: string; id: string; db: string }) => Promise<void>): Promise<void> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-sessoes-agy-")), fonte = join(pasta, "projeto");
  const raizAntigravity = join(pasta, "agy"), raizProc = join(pasta, "proc"), id = randomUUID();
  const db = join(raizAntigravity, "conversations", id + ".db");
  for (const dir of ["conversations", "cache", "presence"]) await mkdir(join(raizAntigravity, dir), { recursive: true });
  await mkdir(raizProc); await writeFile(join(raizProc, "locks"), "");
  const banco = new DatabaseSync(db);
  banco.exec("CREATE TABLE trajectory_meta (trajectory_id TEXT PRIMARY KEY, cascade_id TEXT, trajectory_type INTEGER, source INTEGER)");
  banco.prepare("INSERT INTO trajectory_meta VALUES (?, ?, 4, 17)").run(randomUUID(), id);
  banco.close();
  await writeFile(join(raizAntigravity, "cache", "last_conversations.json"), JSON.stringify({ [fonte]: id }));
  try { await tarefa({ pasta, fonte, raizAntigravity, raizProc, id, db }); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}

test("Antigravity lista e retoma metadados confirmados do próprio projeto sem inventar histórico", async () => {
  await ambiente(async ({ fonte, raizAntigravity, raizProc, id, db }) => {
    const opcoes = { raizAntigravity, raizProc };
    const antes = await readFile(db), info = await stat(db);
    const lista = await sessoesAntigravityChat(fonte, opcoes);
    assert.equal(lista.length, 1);
    assert.equal(lista[0]?.agente, "antigravity");
    assert.equal(lista[0]?.id, id);
    assert.equal(lista[0]?.cwd, fonte);
    assert.equal(lista[0]?.historicoDisponivel, false);
    assert.equal(lista[0]?.descobertaParcial, true);
    assert.equal(lista[0]?.estadoAtividade, "desconhecido");
    const conversa = await importarSessaoChat("antigravity", id, fonte, { ...opcoes, listar: () => Promise.resolve(lista) });
    assert.deepEqual(conversa.mensagens, []);
    assert.equal(conversa.sessao.historicoDisponivel, false);
    assert.deepEqual(await sessoesAntigravityChat(fonte + "-outro", opcoes), []);
    assert.deepEqual(await readFile(db), antes, "consulta não grava no banco original");
    assert.equal((await stat(db)).mtimeMs, info.mtimeMs);
    const integrada = await sessoesExternasChat(fonte, { ...opcoes, listarClaude: async () => [], listarCodex: async () => [] });
    assert.deepEqual(integrada.map((s) => s.agente), ["antigravity"]);
  });
});

test("history do Antigravity dá o título confirmado, exclui comandos e rejeita vínculos ambíguos", async () => {
  await ambiente(async ({ fonte, raizAntigravity, raizProc, id }) => {
    const historico = join(raizAntigravity, "history.jsonl");
    await writeFile(historico, [
      { display: "/model", timestamp: Date.now() - 1000, workspace: fonte, conversationId: id, type: "slash_command" },
      { display: "Revisar a tela de acesso", timestamp: Date.now(), workspace: fonte, conversationId: id },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n");
    const opcoes = { raizAntigravity, raizProc };
    assert.equal((await sessoesAntigravityChat(fonte, opcoes))[0]?.titulo, "Revisar a tela de acesso");
    await writeFile(historico, JSON.stringify({ display: "OUTRO PROJETO", timestamp: Date.now(), workspace: fonte + "-outro", conversationId: id }) + "\n");
    assert.deepEqual(await sessoesAntigravityChat(fonte, opcoes), []);
    await assert.rejects(importarSessaoChat("antigravity", id, fonte, { ...opcoes, listar: async () => [{ agente: "antigravity", id, cwd: fonte, titulo: null, nome: null, ativa: false, pid: null, em: new Date().toISOString(), origem: "cli" }] }), /não confirmada/);
  });
});

test("Antigravity rejeita banco trocado, symlinks e metadados sem a tabela própria", async () => {
  await ambiente(async ({ fonte, raizAntigravity, raizProc, id, db, pasta }) => {
    const opcoes = { raizAntigravity, raizProc };
    let banco = new DatabaseSync(db); banco.prepare("UPDATE trajectory_meta SET cascade_id = ?").run(randomUUID()); banco.close();
    assert.deepEqual(await sessoesAntigravityChat(fonte, opcoes), []);
    banco = new DatabaseSync(db); banco.prepare("UPDATE trajectory_meta SET cascade_id = ?").run(id); banco.close();
    await writeFile(join(pasta, "outro-wal"), "externo"); await symlink(join(pasta, "outro-wal"), db + "-wal");
    assert.deepEqual(await sessoesAntigravityChat(fonte, opcoes), []);
    await rm(db + "-wal");
    banco = new DatabaseSync(db); banco.exec("DROP TABLE trajectory_meta; CREATE VIEW trajectory_meta AS SELECT '" + id + "' AS cascade_id"); banco.close();
    assert.deepEqual(await sessoesAntigravityChat(fonte, opcoes), []);
    await rm(db); await symlink(join(pasta, "outro-wal"), db);
    assert.deepEqual(await sessoesAntigravityChat(fonte, opcoes), []);
  });
});

test("Antigravity só indica sessão ativa com trava mantida por um processo agy", async () => {
  await ambiente(async ({ fonte, raizAntigravity, raizProc, id }) => {
    const opcoes = { raizAntigravity, raizProc };
    const presenca = join(raizAntigravity, "presence", id + ".lock");
    await writeFile(presenca, "");
    assert.equal((await sessoesAntigravityChat(fonte, opcoes))[0]?.ativa, false, "arquivo residual não prova execução");
    const info = await stat(presenca), dev = BigInt(info.dev);
    const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn);
    const minor = (dev & 0xffn) | ((dev >> 12n) & ~0xffn);
    await mkdir(join(raizProc, "4321")); await writeFile(join(raizProc, "4321", "cmdline"), "/bin/outro\0");
    await writeFile(join(raizProc, "locks"), `1: FLOCK ADVISORY WRITE 4321 ${major.toString(16)}:${minor.toString(16)}:${info.ino} 0 EOF\n`);
    assert.equal((await sessoesAntigravityChat(fonte, opcoes))[0]?.ativa, false, "trava de outro processo não é do agente");
    await writeFile(join(raizProc, "4321", "cmdline"), "/home/exemplo/.local/bin/agy\0");
    const sessao = (await sessoesAntigravityChat(fonte, opcoes))[0];
    assert.equal(sessao?.ativa, true); assert.equal(sessao?.pid, 4321); assert.equal(sessao?.estadoAtividade, undefined);
    await writeFile(join(raizProc, "locks"), `1: -> FLOCK ADVISORY WRITE 4321 ${major.toString(16)}:${minor.toString(16)}:${info.ino} 0 EOF\n`);
    assert.equal((await sessoesAntigravityChat(fonte, opcoes))[0]?.ativa, false, "aguardar uma trava não é manter a trava");
  });
});
