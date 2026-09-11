import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { gerarMarkdown } from "../lib/fila.ts";
import { analisarLote, arquivosDaRota, arquivosProvaveis, lerProjeto, lerTokensCss, localizar, paraRgb, sugerir, tailwindDoProjeto } from "../lib/fonte.ts";
import { loteDeExemplo } from "./ajuda.ts";

const PROJETO = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "projeto");

test("lerProjeto varre só arquivos de código e estilo", async () => {
  const arquivos = await lerProjeto(PROJETO);
  const nomes = arquivos.map((a) => a.relativo).sort();
  assert.deepEqual(nomes, ["app/entrar/page.tsx", "app/globals.css", "components/decoy.tsx", "components/escolha-de-acesso.tsx", "package.json"]);
});

test("arquivosDaRota acha a page da rota e segue os imports; a rota desempata ocorrências idênticas", async () => {
  const arquivos = await lerProjeto(PROJETO);
  const contexto = arquivosDaRota(arquivos, "/entrar?x=1");
  assert.ok(contexto);
  assert.deepEqual(Array.from(contexto.entradas), ["app/entrar/page.tsx"]);
  assert.deepEqual(Array.from(contexto.alcance), ["components/escolha-de-acesso.tsx"], "alias @/ resolvido a partir da pasta que contém app/");
  assert.equal(arquivosDaRota(arquivos, "/inexistente"), null);

  const alvo = { classes: ["font-sans", "text-xs", "font-bold", "uppercase", "tracking-[0.13em]", "text-interactive"], texto: "Acesso institucional", componentes: [] };
  const semRota = localizar(arquivos, alvo);
  assert.deepEqual(semRota.slice(0, 2).map((l) => [l.arquivo, l.pontos, l.rota ?? false]), [["app/entrar/page.tsx", 100, false], ["components/decoy.tsx", 100, false]], "sem rota, empate resolvido por nome");
  const comRota = localizar(arquivos, alvo, 6, contexto);
  assert.deepEqual(comRota.slice(0, 2).map((l) => [l.arquivo, l.rota ?? false]), [["app/entrar/page.tsx", true], ["components/decoy.tsx", false]]);
});

test("localizar ranqueia classes completas + texto acima de componente e id", async () => {
  const arquivos = await lerProjeto(PROJETO);
  const achados = localizar(arquivos, {
    classes: ["font-sans", "text-xs", "font-bold", "uppercase", "tracking-[0.13em]", "text-interactive"],
    texto: "Acesso institucional",
    componentes: ["PaginaEntrar"],
  });
  const primeiro = achados[0];
  assert.ok(primeiro);
  assert.equal(primeiro.arquivo, "app/entrar/page.tsx");
  assert.equal(primeiro.linha, 7);
  assert.deepEqual(primeiro.criterios, ["classes completas", "classes", "texto"]);
  assert.equal(primeiro.pontos, 100);
  assert.ok(achados.some((a) => a.criterios.includes("componente PaginaEntrar") && a.linha === 3));

  const porId = localizar(arquivos, { id: "salvar", classes: [], texto: "Salvar", componentes: ["EscolhaDeAcesso"] });
  assert.equal(porId[0]?.arquivo, "components/escolha-de-acesso.tsx");
  assert.equal(porId[0]?.linha, 3);
  assert.ok(porId[0]?.criterios.includes("id"));
  assert.deepEqual(localizar(arquivos, { classes: [], texto: "", componentes: [] }), []);
});

test("paraRgb entende hex, rgb, hsl e oklch", () => {
  assert.deepEqual(paraRgb("#be185d"), [190, 24, 93]);
  assert.deepEqual(paraRgb("#fff"), [255, 255, 255]);
  assert.deepEqual(paraRgb("rgb(4, 107, 102)"), [4, 107, 102]);
  assert.deepEqual(paraRgb("rgba(4 107 102 / 0.5)"), [4, 107, 102]);
  assert.deepEqual(paraRgb("hsl(0 100% 50%)"), [255, 0, 0]);
  assert.deepEqual(paraRgb("oklch(100% 0 0)"), [255, 255, 255]);
  assert.deepEqual(paraRgb("oklch(0% 0 0)"), [0, 0, 0]);
  const azul = paraRgb("oklch(54.6% 0.245 262.881)");
  assert.ok(azul && Math.abs(azul[0] - 21) <= 2 && Math.abs(azul[1] - 93) <= 2 && Math.abs(azul[2] - 252) <= 2, `oklch do blue-600 (Tailwind v4, #155dfc) deveria dar ~rgb(21, 93, 252); deu ${String(azul)}`);
  assert.equal(paraRgb("color-mix(in srgb, red, blue)"), null);
});

test("lerTokensCss mapeia cores para nomes de variáveis, resolvendo alias", async () => {
  const tokens = lerTokensCss(await lerProjeto(PROJETO));
  assert.deepEqual(tokens.get("rgb(190, 24, 93)"), ["--marca", "--marca-alias"]);
  assert.deepEqual(tokens.get("rgb(37, 99, 235)"), ["--color-primary"]);
  assert.ok(Array.from(tokens.values()).some((nomes) => nomes.includes("--color-interactive")), "token em oklch também entra");
  assert.equal(await tailwindDoProjeto(PROJETO), "4");
});

test("sugerir traduz CSS computado para a utilitária Tailwind e aponta a classe atual", async () => {
  const tokens = lerTokensCss(await lerProjeto(PROJETO));
  const lote = loteDeExemplo();
  const base = lote.anotacoes[0];
  assert.ok(base);
  const anotacao: Anotacao = {
    ...base,
    elemento: { ...base.elemento, meta: { ...base.elemento.meta, attrs: { class: "font-sans text-xs font-bold uppercase tracking-[0.13em] text-interactive rounded-lg pt-2" } } },
    alteracoes: [
      { propriedade: "font-size", antes: "12px", depois: "16px" },
      { propriedade: "color", antes: "rgb(4, 107, 102)", depois: "rgb(190, 24, 93)" },
      { propriedade: "background-color", antes: "rgba(0, 0, 0, 0)", depois: "#2563eb" },
      { propriedade: "border-color", antes: "rgb(0, 0, 0)", depois: "rgb(1, 2, 3)" },
      { propriedade: "padding-top", antes: "8px", depois: "16px" },
      { propriedade: "border-radius", antes: "8px", depois: "6px" },
      { propriedade: "font-weight", antes: "700", depois: "600" },
      { propriedade: "opacity", antes: "1", depois: "0.5" },
      { propriedade: "margin-left", antes: "0px", depois: "13px" },
    ],
  };
  const s = sugerir(anotacao, tokens, "4");
  const por = (p: string) => s.find((x) => x.propriedade === p);
  assert.deepEqual([por("font-size")?.classeAtual, por("font-size")?.sugestao], ["text-xs", "text-base"]);
  assert.deepEqual([por("color")?.classeAtual, por("color")?.sugestao, por("color")?.observacao], ["text-interactive", "text-(--marca)", "token --marca"]);
  assert.deepEqual([por("background-color")?.classeAtual, por("background-color")?.sugestao], [null, "bg-primary"]);
  assert.equal(por("border-color")?.sugestao, "border-[#010203]");
  assert.match(por("border-color")?.observacao ?? "", /sem token equivalente/);
  assert.deepEqual([por("padding-top")?.classeAtual, por("padding-top")?.sugestao], ["pt-2", "pt-4"]);
  assert.deepEqual([por("border-radius")?.classeAtual, por("border-radius")?.sugestao], ["rounded-lg", "rounded-md"]);
  assert.deepEqual([por("font-weight")?.classeAtual, por("font-weight")?.sugestao], ["font-bold", "font-semibold"]);
  assert.equal(por("opacity")?.sugestao, "opacity-50");
  assert.equal(por("margin-left")?.sugestao, "ml-[13px]");

  const semTailwind = sugerir(anotacao, tokens, null);
  assert.equal(semTailwind[0]?.sugestao, "font-size: 16px;");
  assert.match(semTailwind[0]?.observacao ?? "", /sem Tailwind/);
  assert.equal(sugerir(anotacao, tokens, "3").find((x) => x.propriedade === "color")?.sugestao, "text-[var(--marca)]");
});

test("analisarLote junta localização, sugestões e texto; o markdown expõe tudo", async () => {
  const lote = loteDeExemplo();
  const analise = await analisarLote(PROJETO, lote);
  assert.equal(analise.tailwind, "4");
  assert.equal(analise.arquivosVarridos, 5);
  assert.deepEqual(analise.rota, { caminho: "/entrar", entradas: ["app/entrar/page.tsx"], alcance: 1 });
  const a = analise.anotacoes["anot-0001"];
  assert.ok(a);
  assert.equal(a.localizacoes[0]?.arquivo, "app/entrar/page.tsx");
  assert.equal(a.localizacoes[0]?.linha, 7);
  assert.equal(a.localizacoes[0]?.rota, true);
  assert.ok(a.localizacoes[0]?.criterios.includes("texto"));
  assert.deepEqual(a.sugestoes.map((s) => [s.classeAtual, s.sugestao]), [["text-xs", "text-sm"]]);
  assert.equal(a.texto?.localizacoes[0]?.arquivo, "app/entrar/page.tsx");
  assert.deepEqual(arquivosProvaveis(analise), ["app/entrar/page.tsx", "components/escolha-de-acesso.tsx", "components/decoy.tsx"], "arquivos da rota antes dos de fora, mesmo com menos pontos");

  const md = gerarMarkdown(lote, null, analise);
  assert.match(md, /Código-fonte varrido: .*projeto \(5 arquivos\) · Tailwind 4/);
  assert.match(md, /- Rota \/entrar → `app\/entrar\/page\.tsx` \(\+1 arquivo\(s\) importado\(s\)\)/);
  assert.match(md, /### Onde está no código\n\n- `app\/entrar\/page\.tsx:7` — texto \(\d+ pts\) · na rota — `<p className=/);
  assert.match(md, /\| `font-size` \| `12px` \| `14px` \| `text-xs` \| `text-sm` \|/);
  assert.match(md, /Texto original aparece em `app\/entrar\/page\.tsx:7`/);
  assert.doesNotMatch(md, /HTML do elemento/, "sem html capturado, sem seção de HTML");

  const comHtml = gerarMarkdown({ ...lote, anotacoes: [{ ...lote.anotacoes[0]!, elemento: { ...lote.anotacoes[0]!.elemento, meta: { ...lote.anotacoes[0]!.elemento.meta, html: '<p class="x">Acesso institucional</p>', htmlPai: '<section class="acesso">' } } }] }, null, analise);
  assert.match(comHtml, /<details><summary>HTML do elemento na seleção<\/summary>\n\n```html\n<section class="acesso"> <!-- pai -->\n<p class="x">Acesso institucional<\/p>\n```/);
});
