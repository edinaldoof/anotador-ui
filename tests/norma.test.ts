// Duas frentes que nasceram juntas: exportar o sistema de design no formato do W3C
// e emprestar o motor de regras normativas do projeto anotado, sem virar dependência.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lerSistemaDeDesign, paraDtcg } from "../lib/design.ts";
import { REGRAS_A_LIGAR, REGRAS_QUE_FICAM_FORA, localizarNorma } from "../lib/norma.ts";
import { descobrirComandos } from "../lib/comandos.ts";
import { contaVazia, criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

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

test("paraDtcg exporta movimento como o formato manda: duração e curva, não \"valor composto\"", () => {
  const { documento, ignorados } = paraDtcg(
    sistemaDe(`@theme {
  --motion-duration-feedback: 150ms; /* retorno de clique */
  --motion-duration-panel: 0.3s;
  --motion-ease-intro: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out: ease-out;
  --animate-spin: spin 1s linear infinite;
}`)
  );
  const movimento = (documento["movimento"] ?? {}) as Record<string, Record<string, unknown>>;
  assert.equal(movimento["motion-duration-feedback"]?.["$type"], "duration");
  assert.deepEqual(movimento["motion-duration-feedback"]?.["$value"], { value: 150, unit: "ms" });
  assert.equal(movimento["motion-duration-feedback"]?.["$description"], "retorno de clique");
  assert.deepEqual(movimento["motion-duration-panel"]?.["$value"], { value: 0.3, unit: "s" }, "a unidade escrita é mantida");
  assert.equal(movimento["motion-ease-intro"]?.["$type"], "cubicBezier");
  assert.deepEqual(movimento["motion-ease-intro"]?.["$value"], [0.22, 1, 0.36, 1]);
  assert.deepEqual(movimento["ease-out"]?.["$value"], [0, 0, 0.58, 1], "curva com nome vira os quatro pontos do CSS");
  // A animação inteira (nome, duração, curva, repetição) não é um tipo do formato.
  assert.deepEqual(ignorados.map((i) => i.nome), ["--animate-spin"]);
});

test("exportação de cores preserva alpha explícito sem confundir o último canal com transparência", () => {
  const casos: Array<[string, number]> = [
    ["rgb(255, 0, 0)", 1],
    ["rgb(255 0 1)", 1],
    ["rgb(100% 0% 0%)", 1],
    ["rgba(255, 0, 0, 0.25)", 0.25],
    ["rgb(255 0 0 / 50%)", 0.5],
    ["hsl(0 100% 50% / 0.2)", 0.2],
    ["hsla(0, 100%, 50%, 0.3)", 0.3],
    ["oklch(50% 0.2 20 / 25%)", 0.25],
    ["#f008", 0.533],
    ["#ff000080", 0.502],
    ["transparent", 0],
  ];
  for (const [css, alpha] of casos) {
    const { documento } = paraDtcg(sistemaDe(`:root {\n  --color-teste: ${css};\n}`));
    const cores = documento["cor"] as Record<string, Record<string, unknown>>;
    const valor = cores["color-teste"]?.["$value"] as Record<string, unknown>;
    assert.equal(valor["alpha"], alpha, css);
  }
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

// ---------------------------------------------------------------------------
// COMANDOS DE BARRA DO AGENTE
// ---------------------------------------------------------------------------

test("descobrirComandos lê skills e comandos do projeto e da conta, e o projeto ganha o empate", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anotador-comandos-"));
  try {
    const skill = join(raiz, ".claude", "skills", "publicar");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: publicar\ndescription: Sobe a versão e publica o pacote\n---\n\n# Publicar\n");

    const comandos = join(raiz, ".claude", "commands");
    await mkdir(comandos, { recursive: true });
    await writeFile(join(comandos, "revisar.md"), "Revisa o diff atual antes do commit\n");
    await writeFile(join(comandos, "leia-me.txt"), "não é comando");

    // A conta fica numa pasta vazia: o que interessa aqui é o projeto, não a máquina.
    const conta = contaVazia(join(raiz, "conta"));
    const achados = await descobrirComandos("claude", raiz, conta);
    const porNome = new Map(achados.map((c) => [c.nome, c]));

    assert.equal(porNome.get("publicar")?.descricao, "Sobe a versão e publica o pacote");
    assert.equal(porNome.get("publicar")?.tipo, "skill");
    assert.equal(porNome.get("publicar")?.origem, "projeto");
    assert.equal(porNome.get("revisar")?.descricao, "Revisa o diff atual antes do commit", "sem frontmatter, vale a primeira linha útil");
    assert.ok(!porNome.has("leia-me"), "extensão fora do padrão do CLI não vira comando");

    assert.deepEqual(await descobrirComandos("gemini", raiz, conta), [], "cada agente procura na pasta dele, não na dos outros");
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("a rota de comandos responde pelo agente conectado e aceita outro por parâmetro", async () => {
  const raiz = await mkdtemp(join(tmpdir(), "anotador-comandos-http-"));
  const alvo = await criarAlvoFalso();
  const skill = join(raiz, ".claude", "skills", "anotar");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: anotar\ndescription: Liga a sessão ao anotador\n---\n");
  const proxy = await criarProxy(alvo, { fonte: raiz, agente: "Claude Code" });
  try {
    const r = JSON.parse((await pedir(proxy.origem + "/__anotador/agente/comandos")).corpo) as Record<string, unknown>;
    assert.equal(r["agente"], "claude", "o rótulo livre do agente vira o identificador certo");
    const lista = r["comandos"] as Array<{ nome: string; descricao: string }>;
    assert.ok(lista.some((c) => c.nome === "anotar" && c.descricao === "Liga a sessão ao anotador"));

    const outro = JSON.parse((await pedir(proxy.origem + "/__anotador/agente/comandos?agente=gemini")).corpo) as Record<string, unknown>;
    assert.equal(outro["agente"], "gemini");
    assert.deepEqual(outro["comandos"], []);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
    await rm(raiz, { recursive: true, force: true });
  }
});
