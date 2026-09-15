import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Navegador, encontrarChromium } from "../lib/cdp.ts";
import { SCRIPT_MEDIDA, achadosDaTela, resumoDaTela, type MedidaTela } from "../lib/tela.ts";

const vazia = (largura: number): MedidaTela => ({
  largura, altura: 800, rolagemHorizontal: 0, vazamentos: [],
  textoMiudo: { total: 0, menor: 0, exemplos: [] }, alvosPequenos: { total: 0, exemplos: [] },
  colunas: [], quaseAlinhados: [],
});

test("a régua separa o que quebra a página do que só desalinha, e cala onde não há o que dizer", () => {
  assert.deepEqual(achadosDaTela([vazia(390), vazia(1280)]), []);

  const achados = achadosDaTela([{
    ...vazia(390),
    rolagemHorizontal: 47,
    vazamentos: [{ alvo: "table.projetos", excesso: 47 }, { alvo: "span.badge", excesso: 6 }],
    textoMiudo: { total: 3, menor: 9.5, exemplos: ["span.rodape (9.5px)", "small (11px)"] },
    alvosPequenos: { total: 2, exemplos: ["button.fechar (18x18)"] },
    quaseAlinhados: [{ alvo: "div.cartao", borda: "esquerda", valor: 27, coluna: 24 }],
  }]);
  const regras = achados.map((a) => [a.gravidade, a.regra] as const);
  // Rolar de lado no celular e um elemento fugindo 47px são falhas de verdade; três
  // pixels fora da coluna é acabamento. Misturar as duas coisas é o que faz relatório
  // de design virar ruído que ninguém lê até o fim.
  assert.deepEqual(regras, [
    ["alta", "elemento vazando"], ["alta", "rolagem horizontal"],
    ["media", "alvo de toque pequeno"], ["media", "elemento vazando"], ["media", "texto miúdo"],
    ["baixa", "quase alinhado"],
  ]);
  assert.match(achados.find((a) => a.regra === "rolagem horizontal")!.evidencia, /47px da viewport de 390px/);
  assert.match(achados.find((a) => a.regra === "quase alinhado")!.evidencia, /a 3px da coluna de 24px/);
  assert.match(achados.find((a) => a.regra === "alvo de toque pequeno")!.evidencia, /WCAG 2\.2/);

  // O dedo é que não acerta 18px; no desktop o ponteiro acerta, e acusar ali seria
  // fabricar problema para quem lê o relatório resolver.
  const noDesktop = achadosDaTela([{ ...vazia(1280), alvosPequenos: { total: 2, exemplos: ["button.fechar (18x18)"] } }]);
  assert.deepEqual(noDesktop, []);
});

test("o resumo do dossiê diz as larguras medidas e some quando não houve medida", () => {
  assert.equal(resumoDaTela([], []), "");
  const medidas = [{ ...vazia(390), rolagemHorizontal: 47, colunas: [16, 24] }, { ...vazia(1280), colunas: [24, 320] }];
  const texto = resumoDaTela(medidas, achadosDaTela(medidas));
  assert.match(texto, /390px, 1280px/);
  assert.match(texto, /\*\*390px\*\* — rolagem horizontal: 47px/);
  assert.match(texto, /\*\*1280px\*\* — rolagem horizontal: nenhuma/);
  assert.match(texto, /bordas esquerdas dominantes: 24, 320px/);
  assert.match(texto, /\| alta \| 390px \| rolagem horizontal \|/);
  const limpo = resumoDaTela([vazia(390)], []);
  assert.match(limpo, /Nenhum vazamento, texto miúdo, alvo pequeno ou borda quase alinhada/);
});

test("a medida roda na página e encontra o que só existe depois de renderizar", { skip: !encontrarChromium(), timeout: 30_000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-tela-"));
  const navegador = await Navegador.abrir({});
  try {
    // Página com um problema de cada tipo, posto de propósito: uma tabela larga demais
    // para o celular, um texto de 9px, um botão de 18px e um cartão 3px fora da coluna.
    await writeFile(join(pasta, "pagina.html"), `<!doctype html><meta charset="utf-8">
      <style>
        * { box-sizing: border-box; margin: 0; }
        body { width: 100%; font: 16px sans-serif; }
        .coluna { margin-left: 24px; width: 300px; height: 40px; background: #eee; }
        .torto { margin-left: 27px; width: 300px; height: 40px; background: #ddd; }
        .larga { margin-left: 24px; width: 900px; height: 40px; background: #cfc; }
        .miudo { font-size: 9px; }
        .fechar { width: 18px; height: 18px; }
      </style>
      <div class="coluna">um</div><div class="coluna">dois</div><div class="coluna">três</div>
      <div class="torto">quase na coluna</div>
      <div class="larga">tabela que não cabe</div>
      <p class="miudo">aviso em nove pixels</p>
      <button class="fechar">x</button>`);
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(390, 800);
    await pagina.navegar("file://" + join(pasta, "pagina.html"));
    const m = await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA);

    assert.equal(m.largura, 390);
    assert.ok(m.rolagemHorizontal > 500, `a página rola de lado: ${m.rolagemHorizontal}px`);
    assert.deepEqual(m.vazamentos.map((v) => v.alvo), ["div.larga"], "só o bloco que vaza, não a cadeia de pais arrastados junto");
    assert.equal(m.textoMiudo.menor, 9);
    assert.deepEqual(m.textoMiudo.exemplos, ["p.miudo (9px)"]);
    assert.equal(m.alvosPequenos.total, 1);
    assert.match(m.alvosPequenos.exemplos[0] ?? "", /button\.fechar \(18x18\)/);
    assert.ok(m.colunas.includes(24), `24px é a coluna de fato: ${m.colunas.join(",")}`);
    assert.deepEqual(m.quaseAlinhados.map((q) => [q.alvo, q.valor, q.coluna]), [["div.torto", 27, 24]]);

    const achados = achadosDaTela([m]);
    assert.ok(achados.some((a) => a.regra === "rolagem horizontal" && a.gravidade === "alta"));
    assert.ok(achados.some((a) => a.regra === "quase alinhado" && a.alvo === "div.torto"));
  } finally {
    await navegador.fechar();
    await rm(pasta, { recursive: true, force: true });
  }
});
