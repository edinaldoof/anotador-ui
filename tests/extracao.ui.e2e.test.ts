import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import type { ResultadoExtracao } from "../lib/extracao.ts";
import { esperarAte } from "./ajuda.ts";

const chrome = encontrarChromium();
const malicioso = '<svg/onload="window.executouConteudoRemoto=true">';
const markdown = [
  "---", "# Tokens observados", "colors:", '  accent: "#8AE0BB"', "spacing: 16", "enabled: true", "---", "# Referência de design", "", malicioso, "",
  "## Tipografia", "- **Corpo:** `16px`", "", "```html", '<img src=x onerror="window.executouConteudoRemoto=true">', "```", "",
  "| Token | Valor |", "| :--- | ---: |", "| `accent` | **#8AE0BB** |",
  '| a\\|b | \\`literal\\` |', '| `#a\\|b` | **`16px`** |', `| ${malicioso} | \`<img src=x>\` |`, "",
  '**Destaque `valor`** e \\`literal\\` e \\*\\*sem destaque\\*\\*.', 'Use ``a`b`` para nome literal.', "",
  '[Referência](https://referencia.example/catalogo)',
  '```css', '/* Cores do componente */', '.card {', '  color: #8AE0BB;', '  padding: 16px;', '}', '```',
  '```json', '{"name":"<img src=x onerror=alert(1)>","size":16,"enabled":true}', '```', "",
].join("\n");
const resultado: ResultadoExtracao = {
  nome: "Ateliê · " + malicioso,
  url: "https://referencia.example/catalogo",
  extraidoEm: "2026-09-14T12:00:00.000Z",
  markdown,
  tokens: {
    colors: { accent: "#8AE0BB", background: "#161A19", ink: "#E5EBE7", [malicioso]: "#333B37" },
    typography: {
      heading: { fontFamily: "Georgia, serif", fontSize: "32px", fontWeight: "600", lineHeight: "38px", letterSpacing: "-0.6px" },
      body: { fontFamily: "system-ui, sans-serif", fontSize: "16px", fontWeight: "400", lineHeight: "24px", letterSpacing: "normal" },
    },
    spacing: { sm: "8px", md: "16px", lg: "32px", xl: "64px" },
    rounded: { sm: "6px", md: "12px", pill: "999px" },
    shadows: { card: "0 5px 15px rgba(0,0,0,.25)" },
    components: { button: { color: "#161A19", backgroundColor: "#8AE0BB", borderRadius: "10px", exemplo: malicioso } },
  },
  evidencias: {
    viewports: [
      { nome: "desktop", largura: 1440, altura: 900, url: "https://referencia.example/catalogo", elementosAnalisados: 48, domLimitado: false },
      { nome: "mobile", largura: 390, altura: 844, url: "https://referencia.example/catalogo", elementosAnalisados: 46, domLimitado: false },
    ],
    tokens: [], componentes: [], cssVariables: [], layout: [], responsivo: [], assets: [],
    limitacoes: ["Estados de hover não foram observados.", malicioso],
  },
};

describe("interface da extração de design", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let navegador: Navegador;
  let pagina: Pagina;
  let origem: string;
  let respostaPendente: ServerResponse | null = null;
  let aguardar = false;
  let statusResposta = 200;
  const sessoes: Array<string | undefined> = [];
  const pedidos: Array<{ metodo: string; corpo: unknown; chave: string | undefined; cookie: string | undefined }> = [];
  const servidor = createServer(async (req, res) => {
    const caminho = new URL(req.url ?? "/", "http://local").pathname;
    if (caminho === "/__anotador/extrair" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "sessao-ui-teste=; Path=/; Max-Age=0; HttpOnly" });
      res.end(await readFile(new URL("../lib/extracao.html", import.meta.url), "utf8"));
      return;
    }
    if (caminho === "/__anotador/acesso/sessao" && req.method === "POST") {
      sessoes.push(req.headers["x-anotador-chave"] as string | undefined);
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "sessao-ui-teste=conectado; Path=/; HttpOnly; SameSite=Strict" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (caminho === "/__anotador/extrair" && req.method === "POST") {
      const partes: Buffer[] = [];
      for await (const parte of req) partes.push(Buffer.from(parte));
      pedidos.push({ metodo: req.method, corpo: JSON.parse(Buffer.concat(partes).toString()), chave: req.headers["x-anotador-chave"] as string | undefined, cookie: req.headers.cookie });
      if (aguardar) { respostaPendente = res; return; }
      res.writeHead(statusResposta, { "content-type": "application/json" });
      res.end(JSON.stringify(statusResposta === 200 ? { resultado } : { erro: statusResposta === 403 ? "Informe a chave de acesso." : "Site indisponível." }));
      return;
    }
    res.writeHead(204);
    res.end();
  });

  const clicar = async (seletor: string) => {
    await pagina.avaliar(`document.querySelector(${JSON.stringify(seletor)}).scrollIntoView({ block: "nearest" })`);
    const r = await pagina.avaliar<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await pagina.clicar(r.x, r.y);
  };
  const enviar = async () => {
    await pagina.avaliar('document.getElementById("url").value = "  https://referencia.example/catalogo  "');
    await clicar("#extract");
  };
  const extrair = async () => {
    await enviar();
    await pagina.esperarPor('document.getElementById("result").hidden === false');
  };

  before(async () => {
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco === "object");
    origem = `http://127.0.0.1:${endereco.port}`;
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.navegar(origem + "/__anotador/extrair");
  });
  beforeEach(async () => {
    resultado.markdown = markdown;
    pedidos.length = 0; sessoes.length = 0; statusResposta = 200; aguardar = false; respostaPendente = null;
    await pagina.definirViewport(1440, 1000, 1);
    await pagina.avaliar("sessionStorage.clear(); localStorage.clear()");
    await pagina.navegar(origem + "/__anotador/extrair");
  });
  after(async () => {
    respostaPendente?.end();
    await navegador?.fechar();
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  test("envia a URL, bloqueia submissão duplicada e apresenta tokens e Markdown como texto", async () => {
    aguardar = true;
    await enviar();
    await esperarAte(() => pedidos.length === 1);
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("extract").disabled'), true);
    await pagina.avaliar('document.getElementById("form").requestSubmit()');
    assert.equal(pedidos.length, 1);
    assert.deepEqual(pedidos[0]?.corpo, { url: "https://referencia.example/catalogo" });
    assert.ok(respostaPendente);
    respostaPendente.writeHead(200, { "content-type": "application/json" });
    respostaPendente.end(JSON.stringify({ resultado }));
    await pagina.esperarPor('document.getElementById("result").hidden === false');
    assert.equal(await pagina.avaliar<string>('document.getElementById("site-name").textContent'), resultado.nome);
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
    assert.equal(await pagina.avaliar<string>('document.getElementById("measured").textContent'), "94 elementos");
    assert.equal(await pagina.avaliar<number>('document.querySelectorAll(".swatch").length'), 4);
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("#preview svg, #preview img, #visual svg, #visual script") === null'), true);
    assert.equal(await pagina.avaliar<boolean>("window.executouConteudoRemoto === undefined"), true);
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("visual").textContent.includes(' + JSON.stringify(malicioso) + ')'), true);
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("extract").disabled'), false);
  });

  test("parâmetro url preenche o campo com segurança sem iniciar extração", async () => {
    const valor = "https://stripe.com/br?origem=" + malicioso;
    await pagina.navegar(origem + "/__anotador/extrair?url=" + encodeURIComponent(valor));
    assert.equal(await pagina.avaliar<string>('document.getElementById("url").value'), valor);
    assert.deepEqual(pedidos, []);
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("result").hidden'), true);
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("svg, img") === null'), true);
    assert.equal(await pagina.avaliar<boolean>("window.executouConteudoRemoto === undefined"), true);
  });

  test("abas alternam a prévia e o código completo", async () => {
    await extrair();
    await clicar("#tab-source");
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("preview").hidden'), true);
    assert.equal(await pagina.avaliar<string>('document.getElementById("tab-source").getAttribute("aria-selected")'), "true");
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
    await clicar("#tab-preview");
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("source").hidden'), true);
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("#preview details pre").textContent.includes("#8AE0BB")'), true);
  });

  test("realça YAML da prévia, blocos CSS/JSON/HTML e Markdown sem interpretar conteúdo remoto", async () => {
    await extrair();
    await clicar("#preview details summary");
    const tokens = await pagina.avaliar<{ yaml: string[]; comentario: string; numero: string; palavra: string; tags: string[]; css: string[]; json: string[]; cores: string[] }>(`(() => {
      const yaml=document.querySelector('#preview details code[data-language="yaml"]');
      return {
        yaml:Array.from(yaml.querySelectorAll('.syntax-key')).map(e=>e.textContent),
        comentario:yaml.querySelector('.syntax-comment').textContent,
        numero:yaml.querySelector('.syntax-number').textContent,
        palavra:yaml.querySelector('.syntax-keyword').textContent,
        tags:Array.from(document.querySelectorAll('#preview code[data-language="html"] .syntax-tag')).map(e=>e.textContent),
        css:Array.from(document.querySelectorAll('#preview code[data-language="css"] .syntax-key')).map(e=>e.textContent),
        json:Array.from(document.querySelectorAll('#preview code[data-language="json"] .syntax-key')).map(e=>e.textContent),
        cores:['.syntax-key','.syntax-string','.syntax-number','.syntax-comment'].map(s=>getComputedStyle(yaml.querySelector(s)).color)
      };
    })()`);
    assert.deepEqual(tokens.yaml, ["colors", "accent", "spacing", "enabled"]);
    assert.equal(tokens.comentario, "# Tokens observados");
    assert.equal(tokens.numero, "16"); assert.equal(tokens.palavra, "true");
    assert.deepEqual(tokens.tags, ["<img", ">"]);
    assert.deepEqual(tokens.css, ["color", "padding"]);
    assert.deepEqual(tokens.json, ['"name"', '"size"', '"enabled"']);
    assert.equal(new Set(tokens.cores).size, 4, "chaves, strings, números e comentários têm cores distintas");
    assert.equal(await pagina.avaliar<string>(`document.querySelector('#preview code[data-language="html"]').textContent`), '<img src=x onerror="window.executouConteudoRemoto=true">\n');
    await clicar("#tab-source");
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
    assert.ok(await pagina.avaliar<number>('document.querySelectorAll("#source .syntax-heading").length') >= 2);
    assert.ok(await pagina.avaliar<number>('document.querySelectorAll("#source .syntax-fence").length') >= 8);
    assert.equal(await pagina.avaliar<string>('document.querySelector("#source .syntax-link").textContent'), '[Referência](https://referencia.example/catalogo)');
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("#source img, #source svg, #source script, #source a, #preview img, #preview svg") === null'), true);
    assert.equal(await pagina.avaliar<boolean>('window.executouConteudoRemoto === undefined'), true);
  });

  test("realce preserva CRLF e Unicode e copiar/baixar mantêm os bytes originais", async () => {
    const original = markdown.replaceAll("\n", "\r\n") + "\r\n<!-- <script>window.executouConteudoRemoto=true</script> -->\r\nAção · 😀\r\n";
    resultado.markdown = original;
    await extrair();
    await clicar("#tab-source");
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), original);
    assert.ok(await pagina.avaliar<number>('document.querySelectorAll("#source .syntax-key").length') > 0);
    await pagina.avaliar(`(() => {
      Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async texto=>{window.markdownCopiado=texto}}});
      URL.createObjectURL=blob=>{window.blobBaixado=blob;return "blob:teste"};
      HTMLAnchorElement.prototype.click=function(){};
    })()`);
    await clicar("#copy"); await clicar("#download");
    assert.equal(await pagina.avaliar<string>("window.markdownCopiado"), original);
    const bytes = await pagina.avaliar<number[]>("window.blobBaixado.arrayBuffer().then(b=>Array.from(new Uint8Array(b)))");
    assert.deepEqual(Buffer.from(bytes), Buffer.from(original,"utf8"));
    assert.equal(await pagina.avaliar<boolean>("window.executouConteudoRemoto === undefined"), true);
  });

  test("conteúdo longo ou não reconhecido permanece íntegro quando o realce é limitado", async () => {
    const limites = await pagina.avaliar<{ longo: boolean; linha: boolean; desconhecido: boolean; spans: number }>(`(() => {
      const destino=document.createElement('pre');
      const longo='x'.repeat(2*1024*1024+1);realcarCodigo(destino,longo,'markdown');
      const igual=destino.textContent===longo;
      const linha='['.repeat(30000);realcarCodigo(destino,linha,'markdown');const linhaIgual=destino.textContent===linha;
      const estranho='<svg/onload=alert(1)> 42 true';realcarCodigo(destino,estranho,'nao-reconhecido');
      return {longo:igual,linha:linhaIgual,desconhecido:destino.textContent===estranho,spans:destino.querySelectorAll('span').length};
    })()`);
    assert.deepEqual(limites,{longo:true,linha:true,desconhecido:true,spans:0});
  });

  test("prévia renderiza tabela sem perder pipes escapados, código ou negrito", async () => {
    await extrair();
    const tabela = await pagina.avaliar<{ cabecalhos: string[]; linhas: string[][]; escopos: string[]; alinhamento: string }>(`(() => {
      const tabela = document.querySelector("#preview table");
      return {
        cabecalhos: Array.from(tabela.querySelectorAll("thead th")).map((el) => el.textContent),
        linhas: Array.from(tabela.querySelectorAll("tbody tr")).map((row) => Array.from(row.children).map((el) => el.textContent)),
        escopos: Array.from(tabela.querySelectorAll("th")).map((el) => el.scope),
        alinhamento: tabela.querySelector("td:last-child").style.textAlign
      };
    })()`);
    assert.deepEqual(tabela, {
      cabecalhos: ["Token", "Valor"],
      linhas: [["accent", "#8AE0BB"], ["a|b", "`literal`"], ["#a|b", "16px"], [malicioso, "<img src=x>"]],
      escopos: ["col", "col"], alinhamento: "right",
    });
    assert.equal(await pagina.avaliar<string>('document.querySelector("#preview li strong").textContent'), "Corpo:");
    assert.deepEqual(await pagina.avaliar<string[]>('Array.from(document.querySelectorAll("#preview p code")).map((el) => el.textContent)'), ["valor", "a`b"]);
    assert.equal(await pagina.avaliar<string>('document.querySelector("#preview p strong").parentElement.textContent'), "Destaque valor e `literal` e **sem destaque**.");
    assert.equal(await pagina.avaliar<string>('getComputedStyle(document.querySelector(".md-table")).overflowX'), "auto");
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("#preview svg, #preview img, #preview script") === null'), true);
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
  });

  test("copiar e baixar entregam exatamente o DESIGN.md recebido", async () => {
    await extrair();
    await pagina.avaliar(`(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (texto) => { window.markdownCopiado = texto; } } });
      const criar = URL.createObjectURL;
      URL.createObjectURL = (blob) => { window.blobBaixado = blob; return criar(blob); };
      const clicar = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.nomeBaixado = this.download; return; } return clicar.call(this); };
    })()`);
    await clicar("#copy");
    assert.equal(await pagina.avaliar<string>("window.markdownCopiado"), markdown);
    await clicar("#download");
    assert.equal(await pagina.avaliar<string>("window.nomeBaixado"), "DESIGN.md");
    assert.equal(await pagina.avaliar<string>("window.blobBaixado.text()"), markdown);
    assert.equal(await pagina.avaliar<string>("window.blobBaixado.type"), "text/markdown;charset=utf-8");
  });

  test("403 orienta usar o link compartilhado e preserva URL e resultado para tentar novamente", async () => {
    await extrair();
    statusResposta = 403;
    await enviar();
    await pagina.esperarPor('document.getElementById("access").hidden === false');
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("#access input") === null'), true);
    assert.match(await pagina.avaliar<string>('document.getElementById("access").textContent'), /link de acesso compartilhado/);
    assert.equal(await pagina.avaliar<string>('document.querySelector("#access a").getAttribute("href")'), "/__anotador/");
    assert.equal(await pagina.avaliar<string>('document.getElementById("url").value.trim()'), resultado.url);
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("result").hidden'), false);
    assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
    statusResposta = 200;
    await clicar("#extract");
    await pagina.esperarPor('document.getElementById("access").hidden === true');
    assert.equal(pedidos[2]?.chave, undefined);
  });

  test("migra chave legada para cookie HttpOnly e não repete a chave ao extrair", async () => {
    const chave = "0123456789abcdef0123456789abcdef";
    await pagina.avaliar(`sessionStorage.setItem("anotador.chave", ${JSON.stringify(chave)}); localStorage.setItem("anotador-ui:chave", ${JSON.stringify(chave)})`);
    await pagina.navegar(origem + "/__anotador/extrair");
    await pagina.esperarPor('sessionStorage.getItem("anotador.chave") === null');
    assert.deepEqual(sessoes, [chave]);
    assert.equal(await pagina.avaliar<string | null>('localStorage.getItem("anotador-ui:chave")'), null);
    await extrair();
    assert.equal(pedidos[0]?.chave, undefined);
    assert.match(pedidos[0]?.cookie ?? "", /sessao-ui-teste=conectado/);
    assert.equal(await pagina.avaliar<boolean>('document.cookie.includes("sessao-ui-teste")'), false);
  });

  test("falha do servidor permite tentar novamente e copiar tem alternativa sem clipboard", async () => {
    statusResposta = 502;
    await enviar();
    await pagina.esperarPor('document.getElementById("status").textContent === "Site indisponível."');
    assert.equal(await pagina.avaliar<boolean>('document.getElementById("extract").disabled'), false);
    statusResposta = 200;
    await extrair();
    await pagina.avaliar(`(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.execCommand = (comando) => { window.comandoCopia = comando; window.copiaAlternativa = document.querySelector("textarea").value; return true; };
    })()`);
    const scrollAntes = await pagina.avaliar<number>("scrollY");
    await clicar("#copy");
    assert.equal(await pagina.avaliar<string>("window.comandoCopia"), "copy");
    assert.equal(await pagina.avaliar<string>("window.copiaAlternativa"), markdown);
    assert.equal(await pagina.avaliar<boolean>('document.querySelector("textarea") === null'), true);
    assert.equal(await pagina.avaliar<number>("scrollY"), scrollAntes, "copiar sem clipboard não desloca a página para o fim");
  });

  for (const [largura, altura] of [[1440, 1000], [390, 844], [320, 746], [873, 746]] as const) {
    test(`resultado legível e sem overflow horizontal em ${largura}×${altura}`, async () => {
      await pagina.definirViewport(largura, altura, 1);
      await extrair();
      await pagina.avaliar("window.scrollTo(0, 0)");
      await writeFile(`/tmp/anotador-extracao-${largura}.png`, await pagina.capturar({ paginaInteira: true }));
      const dimensoes = await pagina.avaliar<{ viewport: number; documento: number; botoesFora: string[] }>(`({
        viewport: innerWidth, documento: document.documentElement.scrollWidth,
        botoesFora: Array.from(document.querySelectorAll("button")).filter((el) => el.checkVisibility() && (el.getBoundingClientRect().left < 0 || el.getBoundingClientRect().right > innerWidth)).map((el) => el.id)
      })`);
      assert.deepEqual(dimensoes, { viewport: largura, documento: largura, botoesFora: [] });
      await clicar("#preview details summary");
      await pagina.avaliar('document.getElementById("result").scrollIntoView({block:"start"})');
      await writeFile(`/tmp/anotador-extracao-syntax-preview-${largura}.png`, await pagina.capturar({paginaInteira:false}));
      assert.equal(await pagina.avaliar<number>("document.documentElement.scrollWidth"), largura);
      await clicar("#tab-source");
      await writeFile(`/tmp/anotador-extracao-syntax-source-${largura}.png`, await pagina.capturar({paginaInteira:false}));
      assert.equal(await pagina.avaliar<number>("document.documentElement.scrollWidth"), largura);
      assert.equal(await pagina.avaliar<string>('document.getElementById("source").textContent'), markdown);
    });
  }
});
