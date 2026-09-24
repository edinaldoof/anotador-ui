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
  assert.match(limpo, /Nenhum achado nessas medidas/);
  // Sem achado não é "acessível": o checklist lembra que a automação pega uma fração.
  assert.match(limpo, /nome genérico, texto de link que não se sustenta sozinho e estado comunicado só por cor ficam para o seu julgamento/);
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

test("contraste nos dois temas, região principal e movimento: aponta o que falha e cala sobre o tema que não existe", async () => {
  const achados = achadosDaTela([vazia(1280)], {
    largura: 1280,
    temas: [
      { tema: "claro", detectado: true, total: 0, pior: 21, exemplos: [] },
      { tema: "escuro", detectado: true, total: 2, pior: 2.1, exemplos: ["p.aviso (2.1:1, mínimo 4.5)", "span.nota (3.9:1, mínimo 4.5)"] },
    ],
    semMain: true,
    movimento: { total: 1, exemplos: ["div.brilho (pulsar)"] },
  });
  assert.deepEqual(achados.map((a) => [a.gravidade, a.regra]), [["alta", "contraste abaixo do mínimo"], ["media", "sem região principal"], ["baixa", "animação ignora movimento reduzido"]]);
  assert.match(achados[0]!.evidencia, /no tema escuro, o pior com 2\.1:1/);
  // Tema que a página não tem não é tema aprovado.
  const semEscuro = { largura: 1280, temas: [{ tema: "claro" as const, detectado: true, total: 0, pior: 21, exemplos: [] }, { tema: "escuro" as const, detectado: false, total: 3, pior: 1.5, exemplos: ["x"] }], semMain: false, movimento: null };
  assert.deepEqual(achadosDaTela([vazia(1280)], semEscuro), [], "contraste de um tema que não reagiu não vira achado");
  assert.match(resumoDaTela([vazia(1280)], [], semEscuro), /tema escuro\*\* — não detectado/);
});

test("forçando o tema e o movimento reduzido na página renderizada", { skip: !encontrarChromium(), timeout: 60_000 }, async () => {
  const { createServer } = await import("node:http");
  const { medirUrl } = await import("../lib/captura.ts");
  // /ruim: texto que some no escuro (por data-theme, como o Pré-Projetos), sem <main>,
  // e um brilho em loop que o CSS não desliga. /boa: o mesmo, feito direito.
  const paginas: Record<string, string> = {
    "/ruim": `<!doctype html><html data-theme="light"><style>
      body{background:#fff;color:#222;font:16px sans-serif}
      [data-theme=dark] body{background:#111;color:#eee}
      [data-theme=dark] .aviso{color:#333}
      .brilho{width:40px;height:40px;animation:pulsar 1s infinite}
      @keyframes pulsar{50%{opacity:.4}}
    </style><div><p class="aviso">prazo encerra hoje</p><div class="brilho"></div></div></html>`,
    "/boa": `<!doctype html><html><style>
      body{background:#fff;color:#222;font:16px sans-serif}
      .brilho{width:40px;height:40px;animation:pulsar 1s infinite}
      @keyframes pulsar{50%{opacity:.4}}
      @media (prefers-reduced-motion: reduce){.brilho{animation:none}}
    </style><main><p>prazo encerra hoje</p><div class="brilho"></div></main></html>`,
  };
  const servidor = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(paginas[req.url ?? ""] ?? ""); });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  try {
    const ruim = (await medirUrl(base + "/ruim", { larguras: [1280] })).acessibilidade;
    assert.ok(ruim);
    assert.deepEqual(ruim.temas.map((t) => [t.tema, t.detectado, t.total]), [["claro", true, 0], ["escuro", true, 1]]);
    assert.match(ruim.temas[1]!.exemplos[0] ?? "", /^div > p\.aviso \(1\.\d:1, mínimo 4\.5\)$/);
    assert.equal(ruim.semMain, true);
    assert.equal(ruim.movimento?.total, 1);
    assert.match(ruim.movimento?.exemplos[0] ?? "", /div\.brilho \(pulsar\)/);

    const boa = (await medirUrl(base + "/boa", { larguras: [1280] })).acessibilidade;
    assert.ok(boa);
    assert.equal(boa.temas[1]?.detectado, false, "sem tema escuro, nada muda ao forçá-lo — e isso é dito, não aprovado");
    assert.equal(boa.semMain, false);
    assert.equal(boa.movimento?.total, 0, "o CSS desliga o brilho com movimento reduzido");
  } finally { await new Promise<void>((r) => servidor.close(() => r())); }
});
