import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { atualizarModelosAntigravity, comandoDaPonte, detectarAgentes, modelosDe, Ponte, diagnosticoFalhaPonte } from "../lib/agentes.ts";
import { Fila } from "../lib/fila.ts";
import { loteDeExemplo, esperarAte } from "./ajuda.ts";

test("Antigravity diferencia o aplicativo gráfico do CLI que recebe os lotes", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-antigravity-detectar-"));
  const caminhoAnterior = process.env["PATH"];
  try {
    await writeFile(join(pasta, "antigravity"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    process.env["PATH"] = pasta;
    const desktop = detectarAgentes().find((a) => a.id === "antigravity");
    assert.equal(desktop?.instalado, true);
    assert.equal(desktop.ponte, false, "a presença do aplicativo gráfico não promete envio de prompts");
    assert.match(desktop.como, /CLI `agy`/);

    const cli = join(pasta, "cli");
    await mkdir(cli);
    await writeFile(join(cli, "agy"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    process.env["PATH"] = cli;
    const agente = detectarAgentes().find((a) => a.id === "antigravity");
    assert.equal(agente?.instalado, true, "o CLI basta, mesmo sem aplicativo gráfico");
    assert.equal(agente.ponte, true);
    assert.equal(agente.binario, "agy");
    assert.equal(agente.caminho, join(cli, "agy"));
  } finally {
    if (caminhoAnterior === undefined) delete process.env["PATH"];
    else process.env["PATH"] = caminhoAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});

test("o catálogo do Antigravity usa models, elimina linhas inválidas e não envia prompt", { skip: process.platform === "win32" }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-antigravity-modelos-"));
  const caminhoAnterior = process.env["PATH"];
  try {
    await writeFile(join(pasta, "agy"), `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["models"]') process.exit(5);\nprocess.stdout.write('Fetching available models...\\nmodelo-high\\tModelo (High)\\nmodelo-low\\tModelo (Low)\\nmodelo-high\\tDuplicado\\n--invalido\\tIgnorar\\n');\n`, { mode: 0o700 });
    process.env["PATH"] = pasta;
    await Promise.all([atualizarModelosAntigravity(), atualizarModelosAntigravity()]);
    assert.deepEqual(modelosDe("antigravity"), [
      { valor: "modelo-high", titulo: "Modelo (High)", esforcos: [] },
      { valor: "modelo-low", titulo: "Modelo (Low)", esforcos: [] },
    ]);
    assert.equal(detectarAgentes().find((a) => a.id === "antigravity")?.modelos.length, 2);
  } finally {
    if (caminhoAnterior === undefined) delete process.env["PATH"];
    else process.env["PATH"] = caminhoAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});

test("a ponte entrega o lote inteiro ao agy na pasta correta, com modelo e conversa escolhidos", { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-antigravity-ponte-"));
  const caminhoAnterior = process.env["PATH"];
  const mensagem = 'Ajuste o botão "Enviar".\nLeia o lote: $(não executar shell) `texto`';
  try {
    await writeFile(join(pasta, "agy"), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n`, { mode: 0o700 });
    process.env["PATH"] = pasta;
    const ponte = new Ponte(join(pasta, "logs"), () => undefined);
    const pedido = { agente: "antigravity" as const, sessao: "conversa-123", fonte: pasta, mensagem, motivo: "teste simulado", modelo: "modelo-high", esforco: "high" };
    const execucao = await ponte.iniciar(pedido);
    const inicio = Date.now();
    while (execucao.terminadoEm === null && Date.now() - inicio < 2000) await new Promise((resolver) => setTimeout(resolver, 10));
    assert.equal(execucao.codigo, 0);
    const enviado = JSON.parse(await readFile(execucao.log, "utf8")) as { args: string[]; cwd: string };
    assert.equal(enviado.cwd, pasta);
    assert.deepEqual(enviado.args, comandoDaPonte("antigravity", pedido.sessao, mensagem, pedido)?.slice(1));
    assert.equal(enviado.args.at(-1), mensagem, "aspas e quebras de linha chegam sem shell intermediário");
    assert.equal(enviado.args[enviado.args.indexOf("--conversation") + 1], pedido.sessao);
    assert.equal(enviado.args[enviado.args.indexOf("--model") + 1], pedido.modelo);
    assert.ok(enviado.args.includes("--disable-slash-commands"), "conteúdo do lote não dispara expansão de comandos do CLI");
    assert.ok(!enviado.args.includes("--dangerously-skip-permissions"));
  } finally {
    if (caminhoAnterior === undefined) delete process.env["PATH"];
    else process.env["PATH"] = caminhoAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});

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

test("falha da ponte é persistida no lote sem inventar conclusão nem expor o log", { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-ponte-status-"));
  const pathAnterior = process.env["PATH"];
  try {
    await writeFile(join(pasta, "claude"), '#!/bin/sh\nprintf "Failed to authenticate: OAuth session expired. segredo-nao-expor\\n"\nexit 1\n', { mode: 0o700 });
    process.env["PATH"] = pasta;
    const fila = new Fila(join(pasta, "fila")); await fila.preparar();
    const lote = loteDeExemplo(); await fila.gravar(lote);
    const ponte = new Ponte(join(pasta, "logs"), () => undefined);
    const eventos: Array<number | null> = [];
    const execucao = await ponte.iniciar({ agente: "claude", sessao: null, fonte: pasta, mensagem: "teste simulado", motivo: "teste", loteId: lote.id,
      aoAtualizar: async e => {
        eventos.push(e.codigo);
        await fila.registrarExecucao(lote.id, { id: e.id, agente: e.agente, modelo: e.modelo ?? null, iniciadoEm: e.iniciadoEm, terminadoEm: e.terminadoEm, codigo: e.codigo, erro: e.erro });
      },
    });
    await esperarAte(async () => (await fila.status(lote.id)).execucao?.codigo === 1, 3000);
    assert.equal(execucao.loteId, lote.id);
    assert.deepEqual(eventos, [null, 1]);
    const reaberta = new Fila(fila.dir);
    const status = await reaberta.status(lote.id);
    assert.equal(status.estado, 'recebido');
    assert.match(status.execucao?.erro ?? '', /sessão do Claude expirou/);
    assert.doesNotMatch(JSON.stringify(status), /segredo-nao-expor|Failed to authenticate/);
    await fila.marcarProgresso(lote.id, "retomado");
    assert.equal((await fila.status(lote.id)).execucao?.codigo, 1);
    await fila.marcarProcessado(lote.id, "feito");
    assert.equal((await fila.status(lote.id)).execucao?.codigo, 1);
    assert.equal(diagnosticoFalhaPonte('usage limit reached', 'codex', 1).includes('limite de uso'), true);
    assert.match(diagnosticoFalhaPonte("error: unexpected argument '--full-auto' found\nsegredo-nao-expor", 'codex', 2), /opção incompatível/);
    assert.doesNotMatch(diagnosticoFalhaPonte("error: unexpected argument '--full-auto' found\nsegredo-nao-expor", 'codex', 2), /full-auto|segredo-nao-expor/);
    assert.doesNotMatch(diagnosticoFalhaPonte('segredo-nao-expor', 'claude', 1), /segredo-nao-expor/);
  } finally {
    if (pathAnterior === undefined) delete process.env["PATH"]; else process.env["PATH"] = pathAnterior;
    await rm(pasta, { recursive: true, force: true });
  }
});
