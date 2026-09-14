import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Avaliacoes, gerarDossie, validarPedido } from "../lib/avaliacao.ts";
import { idSeguro } from "../lib/fila.ts";

const pagina = { url: "http://localhost:3000/", titulo: "Página", viewport: { largura: 1280, altura: 800, dpr: 1 } };

test("avaliações geram ids seguros e rejeitam caminhos no corpo do pedido", async () => {
  assert.ok(idSeguro(validarPedido({ pagina }).id));
  for (const id of ["../fora-das-avaliacoes", "../../escape", "/tmp/escape", "", "curto", null]) {
    assert.throws(() => validarPedido({ pagina, id }), /id inválido/);
  }
  const base = await mkdtemp(join(tmpdir(), "anotador-avaliacao-"));
  try {
    const avaliacoes = new Avaliacoes(base);
    const pedido = validarPedido({ pagina, id: "avaliacao-0001", instantaneo: "<p>Olá</p>" });
    await assert.rejects(avaliacoes.gravar({ ...pedido, id: "../fora-das-avaliacoes" }, "inválido"), /id inválido/);
    assert.deepEqual(await readdir(base), ["avaliacoes"]);
    await avaliacoes.gravar(pedido, gerarDossie(pedido, { porta: 3999 }));
    assert.equal((await avaliacoes.ler(pedido.id))?.id, pedido.id);
    assert.equal(await avaliacoes.lerInstantaneo(pedido.id), "<p>Olá</p>");
    assert.match((await avaliacoes.lerMarkdown(pedido.id)) ?? "", /Página/);
    assert.equal((await avaliacoes.listar()).length, 1);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("validação rejeita achados e contexto que quebrariam a geração do dossiê", () => {
  for (const achados of [[null], [42], [{}], [{ regra: "r", alvo: "p", evidencia: "e", gravidade: "inexistente" }]]) {
    assert.throws(() => validarPedido({ pagina, achados }), /achado inválido/);
  }
  for (const contexto of ["inválido", [], { componentes: "App" }, { estrutura: { cabecalhos: "Título" } }, { estrutura: { marcos: [null] } }]) {
    assert.throws(() => validarPedido({ pagina, contexto }), /contexto inválido|estrutura da página inválida/);
  }
  const pedido = validarPedido({ pagina, contexto: { medidos: 2, componentes: ["App"], estrutura: { cabecalhos: ["Título"], marcos: ["main"] } } });
  assert.match(gerarDossie(pedido, { porta: 3999 }), /Componentes React em cena: App/);
  assert.throws(() => validarPedido({ pagina, instantaneo: "x".repeat(8 * 1024 * 1024 + 1) }), /grande demais/);
});

test("viewport não persiste números não finitos ou medidas negativas", () => {
  const pedido = validarPedido({ pagina: { ...pagina, viewport: { largura: "Infinity", altura: -1, dpr: Infinity } } });
  assert.deepEqual(pedido.pagina.viewport, { largura: 0, altura: 0, dpr: 1 });
});
