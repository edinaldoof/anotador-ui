import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { ErroTranscricao, transcreverAudio, type OpcoesTranscricao } from "../lib/transcricao.ts";
import { esperarAte } from "./ajuda.ts";

const wav = Buffer.alloc(64); wav.write("RIFF", 0); wav.write("WAVE", 8);
const audio = { audio: wav.toString("base64"), mime: "audio/wav" };
const status = (s: number) => (e: unknown) => e instanceof ErroTranscricao && e.status === s;
type Ambiente = OpcoesTranscricao & { pasta: string; temporarios: string; eventos: string; pids: string };
const eventos = async (o: Ambiente): Promise<Array<{ pid: number; numero: number; audio: string; idioma?: string }>> => {
  try { return (await readFile(o.eventos, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
async function ambiente(comportamento: string, tarefa: (o: Ambiente) => Promise<void>) {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-worker-teste-"));
  const modelo = join(pasta, "modelo"), temporarios = join(pasta, "temporarios"), script = join(pasta, "worker.mjs");
  const pids = join(pasta, "pids"), registro = join(pasta, "eventos");
  await mkdir(modelo); await mkdir(temporarios);
  for (const f of ["config.json", "model.bin", "tokenizer.json"]) await writeFile(join(modelo, f), "fixture");
  await writeFile(script, `import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
    const args=process.argv.slice(2);if(!args.includes('--servir'))process.exit(77);
    const raiz=path.dirname(args[args.indexOf('--modelo')+1]);
    fs.appendFileSync(path.join(raiz,'pids'),process.pid+'\\n');let numero=0;
    readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',linha=>{
      const pedido=JSON.parse(linha);numero++;fs.appendFileSync(path.join(raiz,'eventos'),JSON.stringify({pid:process.pid,numero,...pedido})+'\\n');
      const responder=(texto='resposta '+numero)=>console.log(JSON.stringify({texto,duracaoSegundos:1}));
      ${comportamento}
    });`);
  const o: Ambiente = { pasta, modelo, temporarios, script, python: process.execPath, persistente: true, eventos: registro, pids };
  try { await tarefa(o); }
  finally {
    let ids: number[] = [];
    try { ids = (await readFile(pids, "utf8")).trim().split("\n").map(Number).filter((n) => n > 0); } catch { /* worker não chegou a iniciar */ }
    for (const id of ids) { try { process.kill(id, "SIGKILL"); } catch { /* já encerrado */ } }
    await rm(pasta, { recursive: true, force: true });
  }
}

test("worker persistente reutiliza o processo e mantém cada arquivo de áudio separado", async () => {
  await ambiente("responder();", async (o) => {
    assert.equal((await transcreverAudio(audio, o)).texto, "resposta 1");
    assert.equal((await transcreverAudio(audio, o)).texto, "resposta 2");
    const lista = await eventos(o);
    assert.equal(lista.length, 2); assert.equal(lista[0]?.pid, lista[1]?.pid);
    assert.notEqual(lista[0]?.audio, lista[1]?.audio);
    assert.deepEqual(await readdir(o.temporarios), [], "nenhum áudio permanece entre chamadas");
  });
});

test("idioma explícito acompanha cada gravação sem reiniciar o modelo nem vazar a escolha anterior", async () => {
  await ambiente("responder(pedido.idioma);", async (o) => {
    for (const idioma of ["pt", "en", "es"]) assert.equal((await transcreverAudio({ ...audio, idioma }, o)).texto, idioma);
    const lista = await eventos(o);
    assert.deepEqual(lista.map((e) => e.idioma), ["pt", "en", "es"]);
    assert.equal(new Set(lista.map((e) => e.pid)).size, 1);
    await assert.rejects(transcreverAudio({ ...audio, idioma: "../../outro" }, o), status(400));
    assert.equal((await eventos(o)).length, 3, "idioma inválido nunca chega ao subprocesso");
  });
});

test("alternar modelos mantém no máximo dois workers residentes", async () => {
  await ambiente("responder();", async (o) => {
    for (const nome of ["modelo", "modelo-segundo", "modelo-terceiro"]) {
      const modelo = join(o.pasta, nome);
      await mkdir(modelo, { recursive: true });
      for (const f of ["config.json", "model.bin", "tokenizer.json"]) await writeFile(join(modelo, f), "fixture");
      await transcreverAudio(audio, { ...o, modelo });
    }
    const ids = new Set((await eventos(o)).map((e) => e.pid));
    await esperarAte(() => {
      let vivos = 0;
      for (const id of ids) { try { process.kill(id, 0); vivos++; } catch { /* removido do pool */ } }
      return vivos <= 2;
    }, 1000, 20, "pool encerra um modelo antigo antes de manter três residentes");
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("duas gravações simultâneas usam processos distintos e bloqueiam uma terceira", async () => {
  await ambiente("setTimeout(()=>responder('pid '+process.pid),150);", async (o) => {
    const a = transcreverAudio(audio, o), b = transcreverAudio(audio, o);
    await assert.rejects(transcreverAudio(audio, o), status(429));
    const [ra, rb] = await Promise.all([a, b]);
    assert.notEqual(ra.texto, rb.texto);
    const lista = await eventos(o); assert.equal(new Set(lista.map((e) => e.pid)).size, 2);
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("cancelar mata só o worker daquele pedido, espera o encerramento e recria na próxima gravação", async () => {
  await ambiente("if(!fs.existsSync(path.join(raiz,'liberar')))setTimeout(()=>responder(),5000);else responder();", async (o) => {
    const controlador = new AbortController();
    const promessa = transcreverAudio(audio, { ...o, signal: controlador.signal });
    const rejeicao = assert.rejects(promessa, status(499));
    await esperarAte(async () => (await eventos(o)).length === 1);
    const pid = (await eventos(o))[0]!.pid;
    controlador.abort(); await rejeicao;
    assert.throws(() => process.kill(pid, 0), "resposta de cancelamento só chega depois do processo sair");
    assert.deepEqual(await readdir(o.temporarios), []);
    await writeFile(join(o.pasta, "liberar"), "1");
    assert.equal((await transcreverAudio(audio, o)).texto, "resposta 1");
    assert.notEqual((await eventos(o))[1]?.pid, pid);
  });
});

test("timeout encerra worker persistente e libera vaga sem manter áudio", async () => {
  await ambiente("setTimeout(()=>responder(),5000);", async (o) => {
    await assert.rejects(transcreverAudio(audio, { ...o, timeoutMs: 200 }), status(504));
    for (const { pid } of await eventos(o)) assert.throws(() => process.kill(pid, 0));
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("erro de um áudio não inutiliza o modelo, mas saída malformada encerra o processo", async () => {
  await ambiente("if(numero===1)console.log(JSON.stringify({erro:'DURACAO_EXCEDIDA'}));else if(numero===2)responder();else process.stdout.write('não é JSON\\n');", async (o) => {
    await assert.rejects(transcreverAudio(audio, o), status(422));
    assert.equal((await transcreverAudio(audio, o)).texto, "resposta 2");
    const pid = (await eventos(o))[0]!.pid;
    assert.equal((await eventos(o))[1]?.pid, pid, "erro de áudio preserva modelo carregado");
    await assert.rejects(transcreverAudio(audio, o), status(502));
    assert.throws(() => process.kill(pid, 0));
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("JSON válido com estrutura inválida encerra o worker antes de aceitar outra gravação", async () => {
  await ambiente("if(!fs.existsSync(path.join(raiz,'liberar')))console.log(JSON.stringify({texto:42,duracaoSegundos:1}));else responder();", async (o) => {
    await assert.rejects(transcreverAudio(audio, o), status(502));
    const pid = (await eventos(o))[0]!.pid;
    assert.throws(() => process.kill(pid, 0), "resposta inválida nunca deixa modelo contaminado no pool");
    assert.deepEqual(await readdir(o.temporarios), []);
    await writeFile(join(o.pasta, "liberar"), "1");
    assert.equal((await transcreverAudio(audio, o)).texto, "resposta 1");
    assert.notEqual((await eventos(o))[1]?.pid, pid);
  });
});

test("resposta UTF-8 fragmentada chega íntegra e cancelamento antigo não atinge reutilização", async () => {
  await ambiente("const b=Buffer.from(JSON.stringify({texto:'Anotação em português',duracaoSegundos:1})+'\\n');const i=b.indexOf(Buffer.from('ç'))+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.write(b.subarray(i)),20);", async (o) => {
    const controle = new AbortController();
    assert.equal((await transcreverAudio(audio, { ...o, signal: controle.signal })).texto, "Anotação em português");
    controle.abort();
    assert.equal((await transcreverAudio(audio, o)).texto, "Anotação em português");
    const lista = await eventos(o); assert.equal(lista[0]?.pid, lista[1]?.pid);
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("worker ocioso não impede o processo Node de terminar", async () => {
  await ambiente("responder();", async (o) => {
    const modulo = new URL("../lib/transcricao.ts", import.meta.url).href;
    const codigo = `import {transcreverAudio} from ${JSON.stringify(modulo)};await transcreverAudio(${JSON.stringify(audio)},${JSON.stringify(o)});console.log('terminou');`;
    const filho = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", codigo], { stdio: ["ignore", "pipe", "pipe"] });
    const resultado = await new Promise<{ codigo: number | null; saida: string }>((resolve, reject) => {
      let saida = ""; const timeout = setTimeout(() => { filho.kill("SIGKILL"); reject(new Error("worker ocioso manteve Node ativo")); }, 3000);
      filho.stdout.on("data", (b: Buffer) => { saida += b.toString(); });
      filho.on("error", reject); filho.on("close", (codigo) => { clearTimeout(timeout); resolve({ codigo, saida }); });
    });
    assert.equal(resultado.codigo, 0); assert.match(resultado.saida, /terminou/);
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});
