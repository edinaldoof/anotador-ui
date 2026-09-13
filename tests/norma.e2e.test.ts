// A fusão das duas réguas, dentro do navegador.
//
// O motor aqui é falso de propósito. Quem precisa ser testado é a calibração desta
// casa — ligar as regras que vêm desligadas, excluir o próprio overlay do exame, não
// repetir o que a régua já disse e não despejar quarenta linhas da mesma regra. O
// axe-core tem os testes dele, e depender da presença dele aqui tornaria esta suíte
// refém de uma dependência que o projeto faz questão de não ter.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

/** Devolve sempre as mesmas violações, e guarda como foi chamado. */
const MOTOR_FALSO = `window.axe = {
  run: function (contexto, opcoes) {
    window.__chamada = { contexto: contexto, opcoes: opcoes };
    return Promise.resolve({
      violations: [
        {
          id: "color-contrast",
          impact: "serious",
          help: "Elements must meet minimum contrast",
          description: "contraste insuficiente",
          nodes: [{ target: ["p.apagado"] }]
        },
        {
          id: "region",
          impact: "moderate",
          help: "All page content should be contained by landmarks",
          description: "conteudo fora de regiao",
          nodes: [{ target: ["h1"] }, { target: ["h3"] }, { target: ["h4"] }, { target: [".larga"] }, { target: [".cortado"] }]
        },
        {
          id: "td-has-header",
          impact: "critical",
          help: "Data cells must have headers",
          description: "celula sem cabecalho",
          nodes: [{ target: ["td.que-nao-existe"] }]
        }
      ]
    });
  }
};`;

describe("motor de normas emprestado", { skip: chrome ? false : "Chromium não encontrado (defina ANOTADOR_CHROME)", timeout: 120_000 }, () => {
  let raiz: string;
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;

  before(async () => {
    raiz = await mkdtemp(join(tmpdir(), "anotador-e2e-norma-"));
    const pasta = join(raiz, "node_modules", "axe-core");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(raiz, "package.json"), JSON.stringify({ name: "projeto-com-motor" }));
    await writeFile(join(pasta, "package.json"), JSON.stringify({ name: "axe-core", version: "4.12.1" }));
    await writeFile(join(pasta, "axe.min.js"), MOTOR_FALSO);

    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { fonte: raiz });
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.preparar();
    await pagina.definirViewport(1280, 900);
    await pagina.navegar(proxy.origem + "/defeitos", 30_000);
    await pagina.esperarPor("window.__anotadorCarregado", 15_000);
  });

  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
    await rm(raiz, { recursive: true, force: true });
  });

  test("o motor soma achados sem repetir o que a régua já mediu", async () => {
    const so = await pagina.avaliar<ResultadoAuditoria>("window.__anotadorDebug.auditar()");
    const com = await pagina.avaliar<ResultadoAuditoria>("window.__anotadorDebug.auditarNorma()");

    const daRegua = com.achados.filter((a) => a.origem === "regua");
    const daNorma = com.achados.filter((a) => a.origem === "norma");
    assert.equal(daRegua.length, so.achados.length, "a régua continua dizendo exatamente o que dizia");
    assert.ok(daNorma.length > 0, "o motor entrou em cena");
    assert.equal(
      com.achados.filter((a) => !a.origem).length,
      0,
      "todo achado diz de onde veio, senão o painel não sabe qual selo pintar"
    );

    assert.ok(
      !daNorma.some((a) => a.norma === "color-contrast"),
      "a régua já acusou o mesmo parágrafo; repetir o achado no painel é ruído"
    );
    assert.ok(
      so.achados.some((a) => a.regra === "contraste abaixo do mínimo"),
      "e a régua continua sendo quem fala de contraste, com a calibração dela"
    );
  });

  test("uma regra que acende em muitos lugares vira três linhas e um resumo", async () => {
    const com = await pagina.avaliar<ResultadoAuditoria>("window.__anotadorDebug.auditarNorma()");
    const regiao = com.achados.filter((a) => a.norma === "region");
    assert.equal(regiao.length, 4, `cinco nós viram três achados e um resumo: ${JSON.stringify(regiao.map((r) => r.alvo))}`);
    assert.equal(regiao.filter((r) => r.seletor !== null).length, 3);
    const resumo = regiao.find((r) => r.seletor === null);
    assert.match(resumo?.alvo ?? "", /e mais 2 elemento\(s\)/);
    assert.match(resumo?.evidencia ?? "", /acende em 5 lugares/);
  });

  test("a regra ganha nome em português e o identificador fica na evidência", async () => {
    const com = await pagina.avaliar<ResultadoAuditoria>("window.__anotadorDebug.auditarNorma()");
    const celula = com.achados.find((a) => a.norma === "td-has-header");
    assert.ok(celula, "achado cujo seletor não resolve ainda precisa aparecer");
    assert.equal(celula.regra, "célula de dado sem cabeçalho");
    assert.equal(celula.alvo, "td.que-nao-existe", "sem elemento, o alvo é o seletor que o motor devolveu");
    assert.match(celula.evidencia, /^td-has-header — /);
    assert.equal(celula.categoria, "acessibilidade");
  });

  test("o motor é chamado com as regras desligadas ligadas e sem enxergar o overlay", async () => {
    await pagina.avaliar("window.__anotadorDebug.auditarNorma()");
    const chamada = await pagina.avaliar<{ contexto: { exclude: string[][] }; opcoes: Record<string, unknown> }>("window.__chamada");
    assert.deepEqual(chamada.contexto.exclude, [["#__anotador_host"]], "o overlay não pode ser auditado como se fosse o app");

    const regras = chamada.opcoes["rules"] as Record<string, { enabled: boolean }>;
    assert.equal(regras["target-size"]?.enabled, true, "o alvo de toque da WCAG 2.2 vem desligado de fábrica e precisa ser ligado");
    assert.equal(regras["td-has-header"]?.enabled, true);
    assert.ok(!("color-contrast-enhanced" in regras), "o nível AAA fica de fora de propósito");

    const tags = (chamada.opcoes["runOnly"] as { values: string[] }).values;
    assert.ok(tags.includes("wcag22aa") && tags.includes("wcag2a"), `as tags pedidas foram ${tags.join(", ")}`);
  });

  test("a página não acusa erro nenhum com o motor em cena", async () => {
    assert.deepEqual(pagina.erros, []);
  });
});
