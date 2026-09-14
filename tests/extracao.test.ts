import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { encontrarChromium } from "../lib/cdp.ts";
import { extrairDesign, type ResultadoExtracao } from "../lib/extracao.ts";

test("extração rejeita protocolos, credenciais e parâmetros inválidos antes de abrir o navegador", async () => {
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,oi", "ftp://localhost/teste"]) {
    await assert.rejects(extrairDesign(url), /somente URLs HTTP ou HTTPS/);
  }
  await assert.rejects(extrairDesign("https://usuario:senha@example.org"), /não pode conter usuário ou senha/);
  await assert.rejects(extrairDesign("isso não é uma URL"), /URL HTTP ou HTTPS válida/);
  await assert.rejects(extrairDesign("http://localhost", { timeoutMs: 0 }), /timeout/);
  await assert.rejects(extrairDesign("http://localhost", { timeoutMs: Infinity }), /timeout/);
});

const chrome = encontrarChromium();
const HTML = `<!doctype html><html lang="pt-BR"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Design de teste</title><link rel="stylesheet" href="/styles/main.css"><link rel="icon" href="/favicon.svg">
  </head><body>
    <header id="cabecalho"><nav id="navegacao"><a href="#conteudo">Navegação de teste</a></nav></header>
    <main id="conteudo"><h1 id="titulo">Interface medida</h1>
      <section id="grade"><article class="card"><p>Primeiro cartão</p><button class="acao">Continuar</button></article>
      <article class="card"><p>Segundo cartão</p><button class="acao">Continuar</button></article></section>
      <label>Nome <input id="nome" placeholder="Seu nome"></label><img id="logo" src="/images/logo.svg" width="40" height="40" alt="Logo de teste">
      <div id="componente-shadow"></div><div class="oculto"><p>Não renderizado</p></div>
    </main><footer id="rodape">Rodapé de teste</footer>
    <script>document.getElementById('componente-shadow').attachShadow({mode:'open'}).innerHTML = '<style>button { background: rgb(10, 100, 70); color: white; padding: 7px; border: 0; }</style><button id="shadow-button">Botão shadow</button>';</script>
  </body></html>`;
const CSS = `
  @font-face { font-family: "FonteDeclarada"; src: url("../fonts/fixture.woff2") format("woff2"); }
  :root { --brand-color: #2244aa; --card-radius: 12px; --space-card: 24px; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fafafa; color: #17212b; font: 16px/1.5 Arial, sans-serif; }
  #cabecalho { padding: 16px 24px; background: #fff; }
  #conteudo { max-width: 1120px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 40px; line-height: 1.2; letter-spacing: -1px; }
  a { color: var(--brand-color); }
  #grade { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .card { background: #fff; padding: var(--space-card); border-radius: var(--card-radius); box-shadow: 0 4px 12px rgba(0,0,0,.12); }
  .acao { width: 140px; height: 44px; background: var(--brand-color); color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font: 600 14px/20px Arial, sans-serif; }
  input { margin-top: 16px; padding: 8px 12px; border: 1px solid #789abc; border-radius: 4px; }
  #rodape { background: rgba(34, 68, 170, .5); padding: 32px; background-image: url('/images/background.svg'); }
  .oculto { display: none; color: #fa0102; }
  @media(max-width: 600px) { #grade { grid-template-columns: 1fr; gap: 16px; } h1 { font-size: 26px; } #conteudo { padding: 16px; } #navegacao { display: none; } }
`;

describe("extração real de design pelo Chromium", { skip: chrome ? false : "Chromium não encontrado", timeout: 45_000 }, () => {
  let servidor: Server;
  let origem: string;
  let resultado: ResultadoExtracao;
  let navegacaoLentaAbriu = false;
  let navegacaoLentaFechou = false;

  before(async () => {
    servidor = createServer((req, res) => {
      if (req.url === "/lenta") {
        navegacaoLentaAbriu = true;
        res.on("close", () => { navegacaoLentaFechou = true; });
        return;
      }
      if (req.url === "/styles/main.css") {
        res.writeHead(200, { "content-type": "text/css" }); res.end(CSS); return;
      }
      if (req.url?.endsWith(".svg")) {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2244aa"/></svg>'); return;
      }
      if (req.url === "/" || req.url === "/#conteudo") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(HTML); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    origem = `http://127.0.0.1:${endereco.port}`;
    resultado = await extrairDesign(origem + "/", { chrome, timeoutMs: 15_000 });
  });

  after(async () => {
    servidor?.closeAllConnections();
    if (servidor) await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  test("mede tokens reais, preserva evidência e exclui conteúdo escondido", () => {
    assert.equal(resultado.nome, "Design de teste");
    assert.equal(resultado.url, origem + "/");
    assert.ok(!Number.isNaN(Date.parse(resultado.extraidoEm)));
    assert.ok(Object.values(resultado.tokens.colors).includes("#2244AA"));
    assert.ok(Object.values(resultado.tokens.colors).includes("#2244AA80"), "alfa de fundo é preservado");
    assert.ok(!Object.values(resultado.tokens.colors).includes("#FA0102"), "texto não renderizado não contribui para a paleta");
    assert.ok(Object.values(resultado.tokens.typography).some((t) => t.fontSize === "40px" && t.fontFamily.includes("Arial")));
    assert.ok(Object.values(resultado.tokens.typography).some((t) => t.fontSize === "26px"));
    assert.ok(Object.values(resultado.tokens.spacing).includes("24px"));
    assert.ok(Object.values(resultado.tokens.rounded).includes("12px"));
    assert.ok(Object.values(resultado.tokens.shadows).some((s) => s.includes("12px")));
    const azul = resultado.evidencias.tokens.find((t) => t.valor === "#2244AA");
    assert.ok(azul && azul.frequencia >= 4 && azul.amostras.length > 0);
    assert.ok(azul.amostras.every((a) => a.seletor && a.propriedade && /desktop|mobile/.test(a.viewport)));
    assert.ok(resultado.evidencias.cssVariables.some((v) => v.nome === "--brand-color" && v.valor === "#2244aa"));
    assert.ok(resultado.evidencias.componentes.some((c) => c.seletor.includes("#componente-shadow >>> #shadow-button")), "inspeciona componentes em Shadow DOM aberto");
    assert.ok(resultado.evidencias.componentes.some((c) => c.tipo === "button" && c.frequencia === 2), "agrupa instâncias com as mesmas medidas");
  });

  test("compara viewports e entrega capturas PNG com dimensões limitadas", () => {
    assert.deepEqual(resultado.evidencias.viewports.map((v) => [v.nome, v.largura, v.altura]), [["desktop", 1440, 900], ["mobile", 390, 844]]);
    assert.ok(resultado.evidencias.viewports.every((v) => v.elementosAnalisados > 10 && !v.domLimitado));
    assert.ok(resultado.evidencias.responsivo.some((d) => d.seletor === "#titulo" && d.propriedade === "fontSize" && d.desktop === "40px" && d.mobile === "26px"));
    assert.ok(resultado.evidencias.responsivo.some((d) => d.seletor === "#navegacao" && d.propriedade === "display" && d.mobile === "none"));
    assert.ok(resultado.evidencias.responsivo.some((d) => d.seletor === "#grade" && d.propriedade === "gridTemplateColumns"));
    assert.ok(resultado.capturas);
    for (const [nome, largura, altura] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      const png: Buffer = Buffer.from(resultado.capturas[nome], "base64");
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.readUInt32BE(16), largura);
      assert.equal(png.readUInt32BE(20), altura);
      assert.ok(png.length <= 2 * 1024 * 1024);
    }
  });

  test("exporta schema YAML, seções e URLs de assets sem inventar regras de marca", () => {
    assert.match(resultado.markdown, /^---\nversion: "alpha"\nname: "Design de teste"\n/);
    const yaml = resultado.markdown.split("\n---\n")[0] ?? "";
    for (const chave of ["colors", "typography", "spacing", "rounded", "components"]) assert.match(yaml, new RegExp("\\n" + chave + ":\\n"));
    for (const secao of ["Overview", "Colors", "Typography", "Layout", "Elevation & Depth", "Shapes", "Components", "Do's and Don'ts", "Responsive Behavior", "Evidence & Limitations"]) assert.ok(resultado.markdown.includes("## " + secao));
    assert.match(resultado.markdown, /identificadores gerados por frequência/);
    assert.match(resultado.markdown, /breakpoints intermediários não foram testados/);
    assert.ok(resultado.evidencias.assets.some((a) => a.tipo === "imagem" && a.url === origem + "/images/logo.svg"));
    assert.ok(resultado.evidencias.assets.some((a) => a.tipo === "fonte" && a.url === origem + "/fonts/fixture.woff2"), "fontes relativas usam a URL da folha CSS");
    assert.ok(resultado.evidencias.assets.some((a) => a.tipo === "icone" && a.url === origem + "/favicon.svg"));
    assert.ok(resultado.evidencias.assets.some((a) => a.tipo === "background" && a.url === origem + "/images/background.svg"));
  });

  test("timeout encerra o navegador e interrompe navegação pendente", async () => {
    const inicio = Date.now();
    const ouvintesAntes = process.listenerCount("exit");
    await assert.rejects(extrairDesign(origem + "/lenta", { chrome, timeoutMs: 5000 }), /limite de 5000 ms/);
    assert.ok(Date.now() - inicio < 9000, "timeout global não espera a navegação completar");
    assert.equal(navegacaoLentaAbriu, true, "navegação pendente foi iniciada antes do timeout");
    const esperarFechamentoAte = Date.now() + 1000;
    while ((!navegacaoLentaFechou || process.listenerCount("exit") !== ouvintesAntes) && Date.now() < esperarFechamentoAte) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(navegacaoLentaFechou, true, "fechar Chromium cancela a conexão HTTP pendente");
    assert.equal(process.listenerCount("exit"), ouvintesAntes, "rotinas de limpeza não ficam registradas após encerrar Chromium");
  });
});
