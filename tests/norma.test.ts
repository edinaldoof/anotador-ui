// Duas frentes que nasceram juntas: exportar o sistema de design no formato do W3C
// e emprestar o motor de regras normativas do projeto anotado, sem virar dependência.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lerSistemaDeDesign, paraDtcg } from "../lib/design.ts";
import { REGRAS_A_LIGAR, REGRAS_QUE_FICAM_FORA, localizarNorma } from "../lib/norma.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

function sistemaDe(css: string) {
  return lerSistemaDeDesign([{ relativo: "app/tokens.css", linhas: css.split("\n") }]);
}

test("paraDtcg traduz cor, medida e alias para o formato do W3C", () => {
  const { documento, ignorados } = paraDtcg(
    sistemaDe(`:root {
  --color-marca: #0a6b62;
  --color-marca-escura: rgba(10, 107, 98, 0.5);
  --color-texto: var(--color-marca); /* o texto herda a marca */
  --spacing-base: 8px;
  --radius-md: 0.5rem;
}`)
  );

  const cor = (documento["cor"] ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(cor["color-marca"]?.["$value"], {
    colorSpace: "srgb",
    components: [0.0392, 0.4196, 0.3843],
    alpha: 1,
    hex: "#0a6b62",
  });
  assert.equal((cor["color-marca-escura"]?.["$value"] as Record<string, unknown>)["alpha"], 0.5, "alpha declarado em rgba sobrevive");
  assert.equal(cor["color-texto"]?.["$value"], "{cor.color-marca}", "var() vira referência, que é como o formato expressa alias");
  assert.equal(cor["color-texto"]?.["$description"], "o texto herda a marca", "o comentário do autor vira descrição do token");

  const espaco = (documento["espaco"] ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(espaco["spacing-base"]?.["$value"], { value: 8, unit: "px" });
  assert.equal(espaco["spacing-base"]?.["$type"], "dimension");

  const raio = (documento["raio"] ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(raio["radius-md"]?.["$value"], { value: 0.5, unit: "rem" }, "rem é uma das duas unidades que o formato aceita");

  assert.equal(documento["$schema"], "https://tr.designtokens.org/format/");
  assert.deepEqual(ignorados, []);
});

test("paraDtcg recusa o que o formato não representa, dizendo o motivo", () => {
  const { documento, ignorados } = paraDtcg(
    sistemaDe(`:root {
  --borda-composta: 2px solid #ccc;
  --altura-relativa: 4em;
  --aponta-para-fora: var(--que-ninguem-declarou);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.1);
}`)
  );

  const motivos = new Map(ignorados.map((i) => [i.nome, i.motivo]));
  assert.match(motivos.get("--borda-composta") ?? "", /valor composto/);
  assert.match(motivos.get("--altura-relativa") ?? "", /só aceita px e rem/);
  assert.match(motivos.get("--aponta-para-fora") ?? "", /nenhum arquivo lido declara/);
  assert.ok(!motivos.has("--shadow-card"), "sombra simples o formato representa");

  const sombra = (documento["sombra"] ?? {}) as Record<string, Record<string, unknown>>;
  const valor = sombra["shadow-card"]?.["$value"] as Record<string, unknown>;
  assert.equal(sombra["shadow-card"]?.["$type"], "shadow");
  assert.deepEqual(valor["offsetY"], { value: 1, unit: "px" });
  assert.deepEqual(valor["spread"], { value: 0, unit: "px" }, "o que o CSS omite vira zero explícito, que o formato exige");
});

test("cada token carrega de onde saiu, para a viagem de volta ser possível", () => {
  const { documento } = paraDtcg(sistemaDe(":root {\n  --color-marca: #123456;\n}"));
  const cor = (documento["cor"] ?? {}) as Record<string, Record<string, unknown>>;
  assert.deepEqual(cor["color-marca"]?.["$extensions"], {
    "dev.anotador": { css: "--color-marca", origem: "app/tokens.css:2" },
  });
});

test("localizarNorma acha o axe-core na árvore do projeto e não inventa quando não há", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anotador-norma-"));
  try {
    await writeFile(join(raiz, "package.json"), JSON.stringify({ name: "projeto-de-teste" }));
    assert.equal(await localizarNorma(raiz), null, "projeto sem axe-core não ganha motor");
    assert.equal(await localizarNorma(null), null, "sem pasta de código-fonte, nada a procurar");

    const pasta = join(raiz, "node_modules", "axe-core");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "package.json"), JSON.stringify({ name: "axe-core", version: "9.9.9", main: "axe.js" }));
    await writeFile(join(pasta, "axe.min.js"), "window.axe = {};");

    const achado = await localizarNorma(raiz);
    assert.ok(achado, "com a dependência instalada, o motor aparece");
    assert.equal(achado.versao, "9.9.9");
    assert.equal(achado.caminho, join(pasta, "axe.min.js"));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("as regras que ligamos e as que deixamos fora não se cruzam, e cada escolha tem motivo escrito", () => {
  const ligadas = Object.keys(REGRAS_A_LIGAR);
  const fora = Object.keys(REGRAS_QUE_FICAM_FORA);
  assert.deepEqual(ligadas.filter((r) => fora.includes(r)), [], "nenhuma regra em dois lados ao mesmo tempo");
  for (const [regra, motivo] of Object.entries({ ...REGRAS_A_LIGAR, ...REGRAS_QUE_FICAM_FORA })) {
    assert.ok(motivo.length > 10, `a regra ${regra} precisa dizer por que está onde está`);
  }
  assert.ok(ligadas.includes("target-size"), "o alvo de toque da WCAG 2.2 vem desligado de fábrica; é o caso que mais dói esquecer");
});

test("o servidor empresta o motor do projeto anotado e conta o que fez com ele", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anotador-norma-http-"));
  const alvo = await criarAlvoFalso();
  await writeFile(join(raiz, "package.json"), JSON.stringify({ name: "projeto-de-teste" }));
  const pasta = join(raiz, "node_modules", "axe-core");
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, "package.json"), JSON.stringify({ name: "axe-core", version: "4.12.1" }));
  await writeFile(join(pasta, "axe.min.js"), "window.axe = { run: function () {} };");
  const proxy = await criarProxy(alvo, { fonte: raiz });
  try {
    const estado = JSON.parse((await pedir(proxy.origem + "/__anotador/norma")).corpo) as Record<string, unknown>;
    assert.equal(estado["disponivel"], true);
    assert.equal(estado["versao"], "4.12.1");
    assert.ok(Object.keys(estado["ligadas"] as object).length > 0);

    const motor = await pedir(proxy.origem + "/__anotador/norma.js");
    assert.equal(motor.status, 200);
    assert.equal(motor.headers["x-anotador-norma"], "4.12.1");
    assert.match(motor.corpo, /window\.axe/);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
    await rm(raiz, { recursive: true, force: true });
  }
});

test("sem axe-core no projeto, a rota responde 404 e a página não tenta carregar nada", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const estado = JSON.parse((await pedir(proxy.origem + "/__anotador/norma")).corpo) as Record<string, unknown>;
    assert.equal(estado["disponivel"], false);
    assert.equal((await pedir(proxy.origem + "/__anotador/norma.js")).status, 404);

    const overlay = await pedir(proxy.origem + "/__anotador/overlay.js");
    assert.match(overlay.corpo, /"norma":null/, "a configuração diz que não há motor, e o overlay nem tenta");
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("a rota de tokens devolve o sistema do projeto no formato do W3C", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const r = JSON.parse((await pedir(proxy.origem + "/__anotador/design/tokens")).corpo) as Record<string, unknown>;
    assert.equal(r["ok"], true);
    const doc = r["documento"] as Record<string, unknown>;
    assert.equal(doc["$schema"], "https://tr.designtokens.org/format/");
    assert.ok(Array.isArray(r["ignorados"]));
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});
