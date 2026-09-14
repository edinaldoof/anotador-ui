import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Navegador } from "../lib/cdp.ts";

test("Chromium inexistente rejeita a captura sem erro de processo não tratado", { timeout: 5000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-cdp-"));
  const ouvintesAntes = process.listenerCount("exit");
  try {
    await assert.rejects(
      Navegador.abrir({ caminho: join(pasta, "chromium-inexistente"), timeoutMs: 10_000 }),
      /não foi possível iniciar o Chromium:.*ENOENT/
    );
    assert.equal(process.listenerCount("exit"), ouvintesAntes, "a falha também remove a rotina de limpeza do processo");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("Chromium sem permissão de execução rejeita a captura", { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-cdp-"));
  const caminho = join(pasta, "chromium");
  try {
    await writeFile(caminho, "não é executável", { mode: 0o600 });
    await assert.rejects(Navegador.abrir({ caminho, timeoutMs: 10_000 }), /não foi possível iniciar o Chromium:.*EACCES/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
