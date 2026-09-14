import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { capacidadeTranscricao, ErroTranscricao, MAX_AUDIO_BYTES, transcreverAudio, validarAudioTranscricao, type OpcoesTranscricao } from "../lib/transcricao.ts";
import { esperarAte } from "./ajuda.ts";

function wav(segundos = 1): Buffer {
  const bytes = Math.round(segundos * 16000) * 2, b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0); b.writeUInt32LE(bytes + 36, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(bytes, 40);
  return b;
}
const audio = { audio: wav().toString("base64"), mime: "audio/wav" };
const status = (s: number) => (e: unknown) => e instanceof ErroTranscricao && e.status === s;

async function ambiente(codigo: string, tarefa: (o: OpcoesTranscricao & { pasta: string; temporarios: string }) => Promise<void>): Promise<void> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-transcricao-teste-"));
  const modelo = join(pasta, "modelo"), temporarios = join(pasta, "temporarios"), script = join(pasta, "worker.mjs");
  await mkdir(modelo); await mkdir(temporarios);
  for (const nome of ["model.bin", "config.json", "tokenizer.json"]) await writeFile(join(modelo, nome), "fixture");
  await writeFile(script, `import fs from 'node:fs'; import path from 'node:path'; const args=process.argv.slice(2); const arquivo=args[args.indexOf('--audio')+1]; const raiz=path.dirname(args[args.indexOf('--modelo')+1]); ${codigo}`);
  try { await tarefa({ pasta, modelo, temporarios, python: process.execPath, script }); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}

test("validação aceita formatos de gravador e rejeita conteúdo, MIME e tamanhos inválidos", () => {
  assert.equal(validarAudioTranscricao(audio).extensao, "wav");
  const webm = Buffer.alloc(20); webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  assert.equal(validarAudioTranscricao({ audio: webm.toString("base64"), mime: "audio/webm;codecs=opus" }).extensao, "webm");
  for (const entrada of [null, [], {}, { audio: "@@==", mime: "audio/wav" }, { audio: audio.audio + "\n", mime: "audio/wav" }]) assert.throws(() => validarAudioTranscricao(entrada), status(400));
  assert.throws(() => validarAudioTranscricao({ ...audio, mime: "text/html" }), status(415));
  assert.throws(() => validarAudioTranscricao({ ...audio, mime: "audio/webm" }), status(422));
  assert.throws(() => validarAudioTranscricao({ audio: "A".repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4), mime: "audio/wav" }), status(413));
  const grande = Buffer.alloc(MAX_AUDIO_BYTES); wav().subarray(0, 44).copy(grande);
  assert.equal(validarAudioTranscricao({ audio: grande.toString("base64"), mime: "audio/wav" }).audio.length, MAX_AUDIO_BYTES);
});

test("capacidade não divulga caminhos locais nem declara modelo ausente disponível", async () => {
  const c = await capacidadeTranscricao({ python: "/arquivo-inexistente", modelo: "/modelo-inexistente" });
  assert.equal(c.disponivel, false); assert.equal(c.local, true); assert.equal(c.maxDuracaoSegundos, 120);
  assert.equal(JSON.stringify(c).includes("/modelo-inexistente"), false);
});

test("runner usa processo local sem shell, arquivo privado e remove o áudio ao concluir", async () => {
  await ambiente(`fs.writeFileSync(path.join(raiz,'inspecao.json'),JSON.stringify({args,modo:fs.statSync(arquivo).mode&0o777,pasta:fs.statSync(path.dirname(arquivo)).mode&0o777,offline:process.env.HF_HUB_OFFLINE,telemetria:process.env.HF_HUB_DISABLE_TELEMETRY,bytes:fs.statSync(arquivo).size}));console.log(JSON.stringify({texto:'  Teste em português  ',duracaoSegundos:1}));`, async (o) => {
    assert.equal((await capacidadeTranscricao(o)).disponivel, true);
    assert.deepEqual(await transcreverAudio(audio, o), { texto: "Teste em português", duracaoSegundos: 1, local: true });
    const dados = JSON.parse(await readFile(join(o.pasta, "inspecao.json"), "utf8"));
    assert.equal(dados.modo, 0o600); assert.equal(dados.pasta, 0o700); assert.equal(dados.offline, "1"); assert.equal(dados.telemetria, "1");
    assert.equal(dados.bytes, wav().length);
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("timeout e cancelamento encerram o worker e removem os arquivos temporários", async () => {
  await ambiente(`fs.writeFileSync(path.join(raiz,'iniciado'),'1');setTimeout(()=>console.log(JSON.stringify({texto:'não deve retornar',duracaoSegundos:1})),5000);`, async (o) => {
    await assert.rejects(transcreverAudio(audio, { ...o, timeoutMs: 100 }), status(504));
    assert.deepEqual(await readdir(o.temporarios), []);
    await rm(join(o.pasta, "iniciado"), { force: true });
    const controlador = new AbortController();
    const pedido = transcreverAudio(audio, { ...o, signal: controlador.signal });
    const rejeicao = assert.rejects(pedido, status(499));
    await esperarAte(async () => { try { return (await readFile(join(o.pasta, "iniciado"), "utf8")) === "1"; } catch { return false; } });
    controlador.abort(); await rejeicao;
    assert.deepEqual(await readdir(o.temporarios), []);
    await assert.rejects(transcreverAudio(audio, { ...o, signal: controlador.signal }), status(499));
  });
});

test("limite global admite dois workers e libera vagas depois de cancelar", async () => {
  await ambiente(`setTimeout(()=>console.log(JSON.stringify({texto:'fim',duracaoSegundos:1})),5000);`, async (o) => {
    const a = new AbortController(), b = new AbortController();
    const pa = assert.rejects(transcreverAudio(audio, { ...o, signal: a.signal }), status(499));
    const pb = assert.rejects(transcreverAudio(audio, { ...o, signal: b.signal }), status(499));
    await assert.rejects(transcreverAudio(audio, o), status(429));
    a.abort(); b.abort(); await Promise.all([pa, pb]);
    assert.deepEqual(await readdir(o.temporarios), []);
    await writeFile(o.script!, "console.log(JSON.stringify({texto:'vaga liberada',duracaoSegundos:1}))");
    assert.equal((await transcreverAudio(audio, o)).texto, "vaga liberada");
  });
});

test("falhas do decoder e saída exagerada não expõem stderr nem retêm áudio", async () => {
  await ambiente(`console.error('CONTEUDO_PRIVADO');console.log(JSON.stringify({erro:'DURACAO_EXCEDIDA'}));process.exitCode=2;`, async (o) => {
    await assert.rejects(transcreverAudio(audio, o), (e: unknown) => e instanceof ErroTranscricao && e.codigo === "DURACAO_EXCEDIDA" && !e.message.includes("CONTEUDO_PRIVADO"));
    assert.deepEqual(await readdir(o.temporarios), []);
    await writeFile(o.script!, "process.stdout.write('x'.repeat(150*1024));setTimeout(()=>{},1000)");
    await assert.rejects(transcreverAudio(audio, o), status(502));
    assert.deepEqual(await readdir(o.temporarios), []);
  });
});

test("worker instalado decodifica silêncio sintético e rejeita gravação acima de 120 segundos", async (t) => {
  if (!(await capacidadeTranscricao()).disponivel) { t.skip("modelo local opcional não instalado"); return; }
  assert.deepEqual(await transcreverAudio(audio), { texto: "", duracaoSegundos: 1, local: true });
  await assert.rejects(transcreverAudio({ audio: wav(121).toString("base64"), mime: "audio/wav" }), (e: unknown) => e instanceof ErroTranscricao && e.codigo === "DURACAO_EXCEDIDA");
});
