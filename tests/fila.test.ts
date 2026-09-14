import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Fila, gerarMarkdown, idSeguro, validarLote } from "../lib/fila.ts";
import { loteDeExemplo } from "./ajuda.ts";

let dir = "";
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "anotador-fila-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("idSeguro aceita uuid e recusa caminhos", () => {
  assert.equal(idSeguro("3f2a9c1e-1111-4222-8333-444455556666"), true);
  assert.equal(idSeguro("../../etc/passwd"), false);
  assert.equal(idSeguro("curto"), false);
  assert.equal(idSeguro(42), false);
});

test("validarLote recusa corpo sem id, sem anotações ou com instantâneo gigante", () => {
  assert.throws(() => validarLote(null), /não é objeto/);
  assert.throws(() => validarLote({ id: "x" }), /id ausente/);
  assert.throws(() => validarLote({ id: "lote-teste-0001", anotacoes: [] }), /sem anotações/);
  assert.throws(() => validarLote({ ...loteDeExemplo(), instantaneo: "x".repeat(9 * 1024 * 1024) }), /grande demais/);
});

test("validarLote normaliza campos e preserva o essencial", () => {
  const bruto = loteDeExemplo();
  const lote = validarLote(JSON.parse(JSON.stringify(bruto)));
  assert.equal(lote.id, bruto.id);
  assert.equal(lote.anotacoes.length, 1);
  const a = lote.anotacoes[0];
  assert.ok(a);
  assert.equal(a.comentario, "Deixar o rótulo maior");
  assert.deepEqual(a.elemento.seletores[0], { tipo: "id", valor: "#rotulo", unico: true, pontos: 95 });
  assert.deepEqual(a.elemento.meta.componentes, ["EscolhaDeAcesso", "PaginaEntrar"]);
  assert.deepEqual(a.alteracoes, [{ propriedade: "font-size", antes: "12px", depois: "14px" }]);
  assert.deepEqual(a.texto, { antes: "Acesso institucional", depois: "Acesso Institucional" });
  const semId = validarLote({ ...bruto, anotacoes: [{ ...bruto.anotacoes[0], id: "!!" }] });
  assert.equal(semId.anotacoes[0]?.id, `${bruto.id}-1`);
});

test("gerarMarkdown descreve elemento, seletores, alterações e capturas", () => {
  const md = gerarMarkdown(loteDeExemplo(), { pagina: "capturas/lote-teste-0001/pagina.png", anotacoes: { "anot-0001": "capturas/lote-teste-0001/anotacao-1.png" } });
  assert.match(md, /^# Lote de anotações lote-teste-0001/);
  assert.match(md, /## Anotação 1 — Deixar o rótulo maior/);
  assert.match(md, /componentes React: EscolhaDeAcesso ‹ PaginaEntrar/);
  assert.match(md, /Melhor seletor: `#rotulo` — id, único, 95 pts/);
  assert.match(md, /texto "Acesso institucional" em <p>/);
  assert.match(md, /Classes: `text-xs uppercase`/);
  assert.match(md, /\| `font-size` \| `12px` \| `14px` \|/);
  assert.match(md, /- Antes: "Acesso institucional"\n- Depois: "Acesso Institucional"/);
  assert.match(md, /Print da página: capturas\/lote-teste-0001\/pagina.png/);
  assert.match(md, /Recorte: capturas\/lote-teste-0001\/anotacao-1.png/);
});

test("Fila grava de forma idempotente, gera md e acompanha o status", async () => {
  const fila = new Fila(dir);
  await fila.preparar();
  const lote = loteDeExemplo();
  const primeiro = await fila.gravar(lote);
  assert.equal(primeiro.novo, true);
  const segundo = await fila.gravar(lote);
  assert.equal(segundo.novo, false);
  assert.equal((await fila.listar()).length, 1, "reenvio não duplica a fila");

  const md = await readFile(fila.caminhoMd(lote.id), "utf8");
  assert.match(md, /Deixar o rótulo maior/);
  assert.equal(await fila.lerInstantaneo(lote.id), lote.instantaneo);
  const json = JSON.parse(await readFile(fila.caminhoJson(lote.id), "utf8")) as { instantaneo?: unknown; temInstantaneo: boolean };
  assert.equal("instantaneo" in json, false, "o HTML fica em arquivo próprio, fora do JSON");
  assert.equal(json.temInstantaneo, true);

  assert.deepEqual(await fila.status(lote.id), { id: lote.id, estado: "recebido" });
  assert.equal((await fila.pendentes()).length, 1);
  const andamento = await fila.marcarProgresso(lote.id, "lendo o lote");
  assert.equal(andamento?.estado, "em_andamento");
  assert.equal(andamento?.nota, "lendo o lote");
  assert.ok(andamento?.atualizadoEm);
  assert.equal((await fila.pendentes()).length, 1, "em andamento continua pendente");
  const status = await fila.marcarProcessado(lote.id, "aplicado em app/entrar/page.tsx");
  assert.equal(status?.estado, "processado");
  assert.equal(status?.nota, "aplicado em app/entrar/page.tsx");
  assert.equal((await fila.pendentes()).length, 0);
  assert.equal((await fila.marcarProgresso(lote.id, "tarde demais"))?.estado, "processado", "progresso não reabre lote processado");
  assert.equal((await fila.status("inexistente-0000")).estado, "desconhecido");
  assert.equal(await fila.marcarProcessado("inexistente-0000"), null);
  await access(join(dir, "processadas.jsonl"));
});

test("conversa por lote: notas, perguntas, respostas únicas e contagem de abertas", async () => {
  const fila = new Fila(dir);
  await fila.preparar();
  const lote = loteDeExemplo("lote-teste-0003");
  await fila.gravar(lote);
  assert.equal(await fila.registrarMensagem({ lote: "inexistente-0000", autor: "agente", tipo: "nota", texto: "x" }), null);
  const nota = await fila.registrarMensagem({ lote: lote.id, autor: "agente", tipo: "nota", texto: "Aplicando no componente." });
  assert.equal(nota?.tipo, "nota");
  assert.equal((await fila.perguntasAbertas(lote.id)).length, 0, "nota não pede resposta");
  const pergunta = await fila.registrarMensagem({ lote: lote.id, autor: "agente", tipo: "escolha", texto: "Qual?", opcoes: ["A", "B"] });
  assert.ok(pergunta);
  assert.equal((await fila.perguntasAbertas(lote.id)).length, 1);
  assert.equal((await fila.status(lote.id)).perguntasAbertas, 1);
  await assert.rejects(fila.registrarMensagem({ lote: lote.id, autor: "usuario", tipo: "resposta", texto: "x", responde: nota!.id }), /não é pergunta/);
  const resposta = await fila.registrarMensagem({ lote: lote.id, autor: "usuario", tipo: "resposta", texto: "A", opcoes: ["A"], responde: pergunta.id });
  assert.equal(resposta?.responde, pergunta.id);
  await assert.rejects(fila.registrarMensagem({ lote: lote.id, autor: "usuario", tipo: "resposta", texto: "B", responde: pergunta.id }), /já respondida/);
  assert.equal((await fila.perguntasAbertas(lote.id)).length, 0);
  assert.equal((await fila.status(lote.id)).perguntasAbertas, undefined);
  assert.deepEqual((await fila.conversa(lote.id)).map((m) => m.tipo), ["nota", "escolha", "resposta"]);
});

test("anexarCapturas regrava o markdown com os caminhos dos prints", async () => {
  const fila = new Fila(dir);
  await fila.preparar();
  const lote = loteDeExemplo("lote-teste-0002");
  await fila.gravar(lote);
  await fila.anexarCapturas(lote.id, { pagina: "capturas/lote-teste-0002/pagina.png", anotacoes: { "anot-0001": "capturas/lote-teste-0002/anotacao-1.png" } });
  const md = await readFile(fila.caminhoMd(lote.id), "utf8");
  assert.match(md, /Print da página: capturas\/lote-teste-0002\/pagina.png/);
  assert.match(md, /Recorte: capturas\/lote-teste-0002\/anotacao-1.png/);
  assert.deepEqual(await fila.capturas(lote.id), { pagina: "capturas/lote-teste-0002/pagina.png", anotacoes: { "anot-0001": "capturas/lote-teste-0002/anotacao-1.png" } });
});

test("reenvios simultâneos do mesmo lote gravam uma única entrada completa", async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-fila-concorrente-"));
  try {
    const filas = [new Fila(pasta), new Fila(pasta)];
    await filas[0]!.preparar();
    const lote = loteDeExemplo("lote-concorrente-0001");
    const resultados = await Promise.all(Array.from({ length: 12 }, (_, i) => filas[i % 2]!.gravar(lote)));
    assert.equal(resultados.filter((r) => r.novo).length, 1);
    assert.equal((await filas[0]!.listar()).length, 1);
    assert.equal(await filas[0]!.lerInstantaneo(lote.id), lote.instantaneo);
    assert.match((await filas[0]!.lerMarkdown(lote.id)) ?? "", /Deixar o rótulo maior/);
    assert.equal((await filas[0]!.status(lote.id)).estado, "recebido");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("respostas simultâneas à mesma pergunta aceitam apenas uma e liberam a fila após rejeição", async () => {
  const fila = new Fila(dir);
  const outra = new Fila(dir);
  const lote = loteDeExemplo("lote-concorrente-0002");
  await fila.gravar(lote);
  const pergunta = await fila.registrarMensagem({ lote: lote.id, autor: "agente", tipo: "escolha", texto: "Qual?", opcoes: ["A", "B"] });
  assert.ok(pergunta);
  const respostas = await Promise.allSettled([fila, outra].map((f, i) => f.registrarMensagem({ lote: lote.id, autor: "usuario", tipo: "resposta", texto: String(i), responde: pergunta.id })));
  assert.equal(respostas.filter((r) => r.status === "fulfilled").length, 1);
  const recusada = respostas.find((r) => r.status === "rejected");
  assert.ok(recusada?.status === "rejected");
  assert.match(String(recusada.reason), /já respondida/);
  assert.equal((await fila.conversa(lote.id)).filter((m) => m.responde === pergunta.id).length, 1);
  assert.ok(await outra.registrarMensagem({ lote: lote.id, autor: "agente", tipo: "nota", texto: "Concluído." }));
});

test("progresso concorrente não reabre lote concluído", async () => {
  const fila = new Fila(dir);
  const outra = new Fila(dir);
  const lote = loteDeExemplo("lote-concorrente-0003");
  await fila.gravar(lote);
  await Promise.all([
    fila.marcarProgresso(lote.id, "começando"),
    outra.marcarProcessado(lote.id, "concluído"),
    fila.marcarProgresso(lote.id, "evento atrasado"),
  ]);
  const status = await fila.status(lote.id);
  assert.equal(status.estado, "processado");
  assert.equal(status.nota, "concluído");
});
