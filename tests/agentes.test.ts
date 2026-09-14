import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { Ponte } from "../lib/agentes.ts";

test("a ponte libera o descritor do log ao iniciar e quando o spawn falha", { skip: process.platform !== "linux", timeout: 5000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-ponte-"));
  const caminhoAnterior = process.env["PATH"];
  const logs = join(pasta, "logs");
  try {
    await writeFile(join(pasta, "claude"), "#!/bin/sh\nprintf 'execução simulada\\n'\n", { mode: 0o700 });
    process.env["PATH"] = pasta;
    const ponte = new Ponte(logs, () => undefined);
    for (const fonte of [pasta, join(pasta, "pasta-inexistente")]) {
      const execucao = await ponte.iniciar({ agente: "claude", sessao: null, fonte, mensagem: "teste", motivo: "teste de descritores" });
      const inicio = Date.now();
      while (execucao.terminadoEm === null && Date.now() - inicio < 2000) {
        await new Promise((resolver) => setTimeout(resolver, 10));
      }
      assert.notEqual(execucao.terminadoEm, null, "o processo simulado terminou");
      if (fonte === pasta) {
        assert.equal(execucao.codigo, 0);
        assert.equal(await readFile(execucao.log, "utf8"), "execução simulada\n", "o filho mantém sua cópia do log");
      } else {
        assert.equal(execucao.codigo, -1);
      }
      const descritores = await readdir("/proc/self/fd");
      const destinos = await Promise.all(descritores.map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => "")));
      assert.deepEqual(destinos.filter((destino) => destino.startsWith(logs + sep)), [], "o servidor não mantém descritores dos logs");
    }
  } finally {
    if (caminhoAnterior === undefined) delete process.env["PATH"];
    else process.env["PATH"] = caminhoAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});
