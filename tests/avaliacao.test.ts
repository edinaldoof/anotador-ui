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
  // A seção da tela é a metade medida do sistema de design: entra quando houve medida
  // e some quando não houve, para o agente não receber um título vazio para interpretar.
  assert.doesNotMatch(gerarDossie(pedido, { porta: 3999 }), /Responsividade, grade e alinhamento/);
  // O que automação não pega vai pedido por escrito ao agente, com exemplos concretos.
  assert.match(gerarDossie(pedido, { porta: 3999 }), /Acessibilidade que a régua não alcança\*\*: nome genérico de botão ou link \("Enviar", "Saiba mais"/);
  assert.match(gerarDossie(pedido, { porta: 3999, tela: "- **390px** — rolagem horizontal: 47px" }), /## Responsividade, grade e alinhamento\n\n- \*\*390px\*\*/);
  assert.throws(() => validarPedido({ pagina, instantaneo: "x".repeat(8 * 1024 * 1024 + 1) }), /grande demais/);
});

test("viewport não persiste números não finitos ou medidas negativas", () => {
  const pedido = validarPedido({ pagina: { ...pagina, viewport: { largura: "Infinity", altura: -1, dpr: Infinity } } });
  assert.deepEqual(pedido.pagina.viewport, { largura: 0, altura: 0, dpr: 1 });
});

test("estado da execução persiste em ordem, fica isolado do pedido e aceita parecer após falha", async () => {
  const base = await mkdtemp(join(tmpdir(), "anotador-avaliacao-estado-"));
  try {
    const avaliacoes = new Avaliacoes(base);
    const pedido = validarPedido({ pagina, id: "avaliacao-estado-0001" });
    await avaliacoes.gravar(pedido, "Dossiê");
    assert.equal(await avaliacoes.lerEstado(pedido.id), null);
    await Promise.all([
      avaliacoes.registrarEstado(pedido.id, { fase: "executando", agente: "claude", atualizadoEm: "2026-09-14T10:00:00Z" }),
      avaliacoes.registrarEstado(pedido.id, { fase: "falhou", agente: "claude", atualizadoEm: "2026-09-14T10:00:01Z", erro: "A autenticação do agente expirou." }),
    ]);
    const reabertas = new Avaliacoes(base);
    assert.equal((await reabertas.lerEstado(pedido.id))?.fase, "falhou");
    assert.equal((await reabertas.listar()).length, 1, "estado não vira uma avaliação extra");
    await reabertas.gravarParecer(pedido.id, { agente: "claude", em: "2026-09-14T10:00:02Z", resumo: "Retorno recebido", perguntas: [], itens: [] });
    assert.equal((await reabertas.lerParecer(pedido.id))?.resumo, "Retorno recebido");
    assert.equal((await reabertas.listar())[0]?.temParecer, true);
    await assert.rejects(reabertas.registrarEstado("avaliacao-inexistente", { fase: "falhou", agente: null, atualizadoEm: "agora" }), /não encontrada/);
    await assert.rejects(reabertas.registrarEstado("../escape", { fase: "falhou", agente: null, atualizadoEm: "agora" }), /id inválido/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
