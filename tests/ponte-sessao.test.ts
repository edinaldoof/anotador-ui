import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ponte } from "../lib/agentes.ts";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// O suporte a --session-id é consultado uma vez por processo e guardado. Por isso este
// arquivo tem um teste só: um segundo cenário leria a resposta cacheada do primeiro.
test("a ponte dita o ID da sessão nova e a execução já nasce sabendo qual é a dela", { skip: process.platform === "win32", timeout: 10_000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-ponte-sessao-"));
  const pathAnterior = process.env["PATH"];
  try {
    // CLI simulado: anuncia a opção no --help e devolve os argumentos que recebeu.
    await writeFile(join(pasta, "claude"), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] === "--help") { process.stdout.write("  --session-id <uuid>  usa um ID específico\\n"); process.exit(0); }\nprocess.stdout.write(JSON.stringify(args));\n`, { mode: 0o700 });
    process.env["PATH"] = pasta;
    const ponte = new Ponte(join(pasta, "logs"), () => undefined);
    const execucao = await ponte.iniciar({ agente: "claude", sessao: null, fonte: pasta, mensagem: "Avalie a página", motivo: "teste simulado" });
    const inicio = Date.now();
    while (execucao.terminadoEm === null && Date.now() - inicio < 5000) await new Promise((r) => setTimeout(r, 10));
    assert.equal(execucao.codigo, 0);
    // Antes, isto só era preenchido depois de garimpar o ID no meio do log — quando o
    // agente já tinha respondido. A conversa passava minutos sem saber a que sessão
    // pertencia, e a avaliação não conseguia se ligar ao histórico nativo.
    assert.match(execucao.sessao ?? "", UUID);
    const argumentos = JSON.parse(await readFile(execucao.log, "utf8")) as string[];
    assert.equal(argumentos[argumentos.indexOf("--session-id") + 1], execucao.sessao, "o CLI recebe exatamente o ID que a execução registrou");
    assert.ok(!argumentos.includes("--resume"), "conversa nova não retoma nada");
    assert.equal(argumentos.at(-1), "Avalie a página");
  } finally {
    if (pathAnterior === undefined) delete process.env["PATH"];
    else process.env["PATH"] = pathAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});
