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

  // O 2.5.8 vale para qualquer ponteiro, mouse incluído: no desktop também é achado. Mas o
  // mesmo botão reprovado em duas larguras vira um achado só, na mais estreita.
  const pequeno = { total: 1, exemplos: ["button.fechar (18x18, o círculo de 24px encosta em button.abrir)"] };
  const duas = achadosDaTela([{ ...vazia(1280), alvosPequenos: pequeno }, { ...vazia(390), alvosPequenos: pequeno }]);
  assert.deepEqual(duas.map((a) => [a.regra, a.largura]), [["alvo de toque pequeno", 390]]);
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
        .fechar, .irmao { width: 18px; height: 18px; padding: 0; border: 0; }
        .isolado { width: 18px; height: 18px; padding: 0; border: 0; margin: 40px; }
      </style>
      <div class="coluna">um</div><div class="coluna">dois</div><div class="coluna">três</div>
      <div class="torto">quase na coluna</div>
      <div class="larga">tabela que não cabe</div>
      <div style="overflow-x: auto; margin-left: 24px; width: 300px"><table style="width: 900px"><tr><td>tabela larga com rolagem própria</td></tr></table></div>
      <p class="miudo">aviso em nove pixels</p>
      <div><button class="fechar">x</button><button class="irmao">y</button></div>
      <div><button class="isolado">z</button></div>`);
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(390, 800);
    await pagina.navegar("file://" + join(pasta, "pagina.html"));
    const m = await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA);

    assert.equal(m.largura, 390);
    assert.ok(m.rolagemHorizontal > 500, `a página rola de lado: ${m.rolagemHorizontal}px`);
    assert.deepEqual(m.vazamentos.map((v) => v.alvo), ["div.larga"], "só o bloco que vaza — nem a cadeia de pais, nem a tabela que rola dentro do próprio contêiner");
    assert.equal(m.textoMiudo.menor, 9);
    assert.deepEqual(m.textoMiudo.exemplos, ["p.miudo (9px)"]);
    // Dois colados reprovam um ao outro; o isolado tem espaço em volta e é isento.
    assert.equal(m.alvosPequenos.total, 2);
    assert.equal(m.alvosPequenos.isentos, 1);
    assert.match(m.alvosPequenos.exemplos[0] ?? "", /button\.fechar \(18x18, o círculo de 24px encosta em div > button\.irmao\)/);
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

test("leitura e tipografia: linha comprida, tamanho a meio pixel, peso entre degraus e texto colado na borda", () => {
  const desktop: MedidaTela = {
    ...vazia(1280),
    linhasLongas: { total: 2, maior: 112, exemplos: ["main > p.descricao (~112ch, 138 caracteres por linha)", "div.ajuda (~86ch, 106 caracteres por linha)"] },
    tipografia: { tamanhos: [12, 12.5, 14, 16, 16.5, 24], pesos: [400, 600, 650, 700] },
    margemLateral: { minima: 48, alvo: "header > h1" },
  };
  const celular: MedidaTela = {
    ...vazia(390),
    linhasLongas: { total: 0, maior: 0, exemplos: [] },
    tipografia: { tamanhos: [12, 12.5], pesos: [400], onde: { "12": "p", "12.5": "span.meta" } },
    margemLateral: { minima: 12, alvo: "header > span.marca" },
  };
  const achados = achadosDaTela([desktop, celular]);
  assert.deepEqual(achados.map((a) => [a.gravidade, a.largura, a.regra]), [
    ["media", 1280, "linha longa demais"],
    ["baixa", 390, "margem lateral estreita"], ["baixa", 390, "tamanhos quase iguais"],
    ["baixa", 1280, "escada de pesos"], ["baixa", 1280, "tamanhos quase iguais"],
  ]);
  const por = (regra: string, largura: number) => achados.find((a) => a.regra === regra && a.largura === largura)!.evidencia;
  assert.match(por("linha longa demais", 1280), /2 parágrafo\(s\) acima de 75ch por linha, o mais longo com ~112ch — o playbook lê bem entre 45 e 75ch/);
  // O par 12/12,5 já foi dito no celular; no desktop só entra o que é novo.
  assert.match(por("tamanhos quase iguais", 390), /^12 e 12\.5px \(span\.meta\) na mesma tela/, "o tamanho intruso vem com o elemento onde mora");
  assert.equal(achados.find((a) => a.regra === "tamanhos quase iguais" && a.largura === 390)?.alvo, "span.meta");
  assert.match(por("tamanhos quase iguais", 1280), /^16 e 16\.5px na mesma tela, de 6 tamanhos ao todo/);
  assert.match(por("escada de pesos", 1280), /4 peso\(s\) na tela \(400, 600, 650, 700\), 650 entre dois degraus/);
  assert.match(por("margem lateral estreita", 390), /texto a 12px da borda da tela em 390px — o playbook usa 16px/);
  // 12px no desktop não é achado: a margem do celular não vale para a tela larga, só o piso de 8px.
  assert.deepEqual(achadosDaTela([{ ...desktop, margemLateral: { minima: 12, alvo: "x" } }]).filter((a) => a.regra === "margem lateral estreita"), []);
  assert.equal(achadosDaTela([{ ...desktop, margemLateral: { minima: 4, alvo: "x" } }]).find((a) => a.regra === "margem lateral estreita")?.gravidade, "media");

  const texto = resumoDaTela([celular, desktop], achados);
  assert.match(texto, /\*\*390px\*\* — .* · margem lateral: 12px/);
  assert.match(texto, /\*\*tipografia\*\* \(1280px\) — 6 tamanho\(s\) de texto: 12, 12\.5, 14, 16, 16\.5, 24px · pesos 400, 600, 650, 700/);
  // Medida antiga, sem os campos novos, continua funcionando e não inventa linha.
  assert.doesNotMatch(resumoDaTela([vazia(390)], []), /margem lateral|tipografia/);
});

test("leitura, tipografia e margem medidas na página renderizada", { skip: !encontrarChromium(), timeout: 30_000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-leitura-"));
  const navegador = await Navegador.abrir({});
  const frase = "O relatório final do projeto precisa trazer a execução física e financeira, com as metas atingidas, as justificativas de cada desvio e os anexos comprobatórios. ";
  try {
    // Um parágrafo largo demais, o mesmo texto contido em 65ch, um com código em linha
    // (mais alto que as letras, e na mesma linha), um bloco de código comprido — que tem a
    // linha que o autor quis — e um texto de leitor de tela colado na borda, que não conta.
    await writeFile(join(pasta, "pagina.html"), `<!doctype html><meta charset="utf-8">
      <style>* { box-sizing: border-box; margin: 0; } body { font: 16px/1.5 sans-serif; padding: 0 32px; }
        .largo { width: 1100px; } .contido { max-width: 65ch; } .limite { max-width: 80ch; } code { font-size: 12.5px; padding: 3px 4px; background: #eee; }
        .sr { position: absolute; left: 0; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .marca { position: absolute; top: 4px; left: 6px; font-weight: 650; }</style>
      <span class="marca">Portal</span><span class="sr">Ir para o conteúdo principal</span>
      <p class="largo" id="largo">${frase.repeat(3)}</p>
      <p class="contido" id="contido">${frase.repeat(3)}</p>
      <p class="limite" id="limite">${frase.repeat(3)}</p>
      <p class="contido" id="codigo">Use <code>max-width: 65ch</code> no parágrafo e <code>text-wrap: pretty</code> no título; ${frase.repeat(2)}</p>
      <pre>${"const linhaDeCodigoMuitoComprida = calcular(".repeat(4)}</pre>`);
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(1280, 800);
    await pagina.navegar("file://" + join(pasta, "pagina.html"));
    const m = await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA);
    // A correção que a régua recomenda (65ch) passa na própria régua; 80ch, não.
    assert.deepEqual(m.linhasLongas?.exemplos.map((e) => e.split(" (")[0]), ["p#largo", "p#limite"], "o largo e o de 80ch: o de 65ch, o com código e o pre ficam de fora");
    assert.ok((m.linhasLongas?.maior ?? 0) > 110, `~120ch a 1100px: ${m.linhasLongas?.maior}`);
    assert.match(m.linhasLongas?.exemplos[1] ?? "", /^p#limite \(~(79|80)ch, \d+ caracteres por linha\)$/);
    assert.deepEqual(m.tipografia?.tamanhos, [12.5, 16], "o código em linha e o texto — o pre herda os 16px do body");
    assert.deepEqual(m.tipografia?.pesos, [400, 650]);
    assert.equal(m.margemLateral?.minima, 6, "a marca a 6px; o texto de leitor de tela em left: 0 não é texto na tela");
    assert.equal(m.margemLateral?.alvo, "span.marca");

    // No celular, o de 65ch e o de 80ch quebram cedo; só o de 1100px fixos segue comprido.
    await pagina.definirViewport(390, 800);
    const celular = await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA);
    assert.equal(celular.linhasLongas?.total, 1, "o p#largo tem 1100px fixos e continua comprido — ele vaza, e a régua diz as duas coisas");
    const achados = achadosDaTela([m, celular]);
    // O p#largo aparece no celular e não se repete no desktop; o de 80ch só estoura no
    // desktop. A marca a 6px é média nas duas larguras; o peso 650, dito uma vez.
    const novas = achados.filter((a) => ["linha longa demais", "margem lateral estreita", "escada de pesos"].includes(a.regra));
    assert.deepEqual(novas.map((a) => [a.gravidade, a.largura, a.regra]), [
      ["media", 390, "linha longa demais"], ["media", 390, "margem lateral estreita"],
      ["media", 1280, "linha longa demais"], ["media", 1280, "margem lateral estreita"],
      ["baixa", 390, "escada de pesos"],
    ]);
    assert.match(achados.find((a) => a.regra === "linha longa demais" && a.largura === 390)?.alvo ?? "", /^p#largo /);
    assert.match(achados.find((a) => a.regra === "linha longa demais" && a.largura === 1280)?.alvo ?? "", /^p#limite /);
  } finally {
    await navegador.fechar();
    await rm(pasta, { recursive: true, force: true });
  }
});

test("contraste nos dois temas, região principal e movimento: aponta o que falha e cala sobre o tema que não existe", async () => {
  const achados = achadosDaTela([vazia(1280)], {
    largura: 1280,
    temas: [
      { tema: "claro", detectado: true, total: 0, pior: null, exemplos: [] },
      { tema: "escuro", detectado: true, total: 2, pior: 2.1, exemplos: ["p.aviso (2.1:1, mínimo 4.5)", "span.nota (3.9:1, mínimo 4.5)"] },
    ],
    semMain: true,
    movimento: { total: 1, exemplos: ["div.brilho (pulsar)"] },
  });
  assert.deepEqual(achados.map((a) => [a.gravidade, a.regra]), [["alta", "contraste abaixo do mínimo"], ["media", "sem região principal"], ["baixa", "animação ignora movimento reduzido"]]);
  assert.match(achados[0]!.evidencia, /no tema escuro, o pior com 2\.1:1/);
  // Tema que a página não tem não é tema aprovado.
  const semEscuro = { largura: 1280, temas: [{ tema: "claro" as const, detectado: true, total: 0, pior: null, exemplos: [] }, { tema: "escuro" as const, detectado: false, total: 3, pior: 1.5, exemplos: ["x"] }], semMain: false, movimento: null };
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
    assert.equal(ruim.temas[0]?.pior, null, "sem falha não há pior caso — nem um 21 para alguém ler como nota");
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

test("alvo de toque: as exceções do WCAG 2.5.8 que se verificam olhando a página", { skip: !encontrarChromium(), timeout: 30_000 }, async () => {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-alvos-"));
  const navegador = await Navegador.abrir({});
  try {
    // O caso real que a regra antiga errava — a tela de entrada do Pré-Projetos —, mais
    // os dois jeitos de uma exceção ser concedida por engano.
    await writeFile(join(pasta, "pagina.html"), `<!doctype html><meta charset="utf-8">
      <style>* { margin: 0; } body { font: 14px/17px sans-serif; padding: 24px; } li { list-style: none; margin: 16px 0; }
        .mini { width: 18px; height: 18px; padding: 0; border: 0; }</style>
      <ul><li><a href="#e" id="esqueci">Esqueci minha senha</a></li>
          <li>Ainda não tem acesso? <a href="#c" id="criar">Criar conta</a></li></ul>
      <div style="margin-top: 40px"><h2 style="display: inline; font-size: 14px">Projetos</h2><button class="mini" id="fechar">x</button><button class="mini" id="abrir">+</button></div>
      <div style="margin-top: 40px"><button class="mini" id="a">A</button><button class="mini" id="b">B</button><span> rótulo</span></div>`);
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(390, 800);
    await pagina.navegar("file://" + join(pasta, "pagina.html"));
    const m = await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA);
    const reprovados = m.alvosPequenos.exemplos.map((e) => e.split(" (")[0]);
    // "Esqueci minha senha": sozinho na linha, com espaço em volta — isento pelo espaçamento.
    // "Criar conta": link no meio da frase — isento por estar em linha.
    // Os botões ao lado do título NÃO estão numa frase (são inline-block e o texto é de
    // outro elemento), e os dois do fim NÃO se salvam pelo rótulo ao lado: colados, reprovam.
    assert.deepEqual(reprovados, ["button#fechar", "button#abrir", "button#a"], "os três primeiros, em ordem do documento");
    assert.equal(m.alvosPequenos.total, 4, "fechar, abrir, a e b: pequenos e colados um no outro");
    assert.equal(m.alvosPequenos.isentos, 2, "os dois links da tela de entrada");
  } finally {
    await navegador.fechar();
    await rm(pasta, { recursive: true, force: true });
  }
});
