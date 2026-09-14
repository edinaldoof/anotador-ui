import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { capturarLote } from "../lib/captura.ts";
import { encontrarChromium } from "../lib/cdp.ts";
import { temOpenssl } from "../lib/tls.ts";
import { BASE } from "../server.ts";
import { criarAlvoFalso, criarProxy, loteDeExemplo, pedir } from "./ajuda.ts";

const chrome = encontrarChromium();
const temTls = await temOpenssl();
const pagina = { url: "http://localhost/pagina", caminho: "/pagina", viewport: { largura: 800, altura: 600, dpr: 1 } };
const pedidoValido = { instantaneo: "<!doctype html><html><body>Print</body></html>", pagina };

test("captura avulsa valida instantâneo, URL, viewport e tamanho antes de abrir Chromium", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { chrome: "/chromium-inexistente-para-teste" });
  try {
    const invalidos = [
      {},
      { ...pedidoValido, instantaneo: "" },
      { ...pedidoValido, pagina: null },
      { ...pedidoValido, pagina: { ...pagina, url: "file:///tmp/pagina" } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: 0, altura: 600 } } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: 800, altura: 5000 } } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: "800", altura: 600 } } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: 800, altura: 600, dpr: -1 } } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: 800, altura: 600, scrollX: "300" } } },
      { ...pedidoValido, pagina: { ...pagina, viewport: { largura: 800, altura: 600, scrollY: {} } } },
      { ...pedidoValido, instantaneo: "x".repeat(8 * 1024 * 1024 + 1) },
    ];
    for (const corpo of invalidos) {
      const resposta = await pedir(proxy.origem + BASE + "/captura", {
        metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(corpo),
      });
      assert.equal(resposta.status, 400);
      assert.equal(JSON.parse(resposta.corpo).ok, false);
      assert.ok(JSON.parse(resposta.corpo).erro);
    }
    const semChrome = await pedir(proxy.origem + BASE + "/captura", {
      metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(pedidoValido),
    });
    assert.equal(semChrome.status, 503);
    assert.match(JSON.parse(semChrome.corpo).erro, /Chromium não encontrado/);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

for (const https of [false, true]) test(`captura avulsa ${https ? "HTTPS" : "HTTP"} devolve PNG sem criar lote ou guardar instantâneo`, {
  skip: !chrome ? "Chromium não encontrado" : https && !temTls ? "openssl não encontrado" : false,
  timeout: 30_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { chrome, https });
  try {
    const arquivosAntes = (await readdir(proxy.saida, { recursive: true })).sort();
    const origemDaPagina = https ? proxy.origem.replace("http:", "https:") : proxy.origem;
    const instantaneo = (await readFile(new URL("./fixtures/pagina.html", import.meta.url), "utf8"))
      .replace("<head>", `<head><base href="${origemDaPagina}/"><meta name="referrer" content="unsafe-url">`);
    const resposta = await fetch(proxy.origem + BASE + "/captura", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instantaneo, pagina: { ...pagina, url: origemDaPagina + "/pagina" } }),
    });
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get("content-type"), "image/png");
    const png = Buffer.from(await resposta.arrayBuffer());
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), pagina.viewport.largura);
    assert.equal(png.readUInt32BE(20), pagina.viewport.altura);
    assert.ok(png.length > 1000);
    const recurso = alvo.pedidos.find((p) => p.url === "/estilo.css");
    assert.ok(recurso, "os recursos da página continuam sendo renderizados pelo proxy");
    const referer = recurso.headers["referer"];
    assert.ok(referer);
    const caminhoInstantaneo = new URL(referer).pathname;
    assert.match(caminhoInstantaneo, /\/captura\/[\w-]+\/instantaneo$/);
    assert.equal((await pedir(proxy.origem + caminhoInstantaneo)).status, 404, "o instantâneo é removido após o download");
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
    assert.deepEqual((await readdir(proxy.saida, { recursive: true })).sort(), arquivosAntes, "o print não deixa arquivos no histórico");
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("print preserva rolagem horizontal e vertical e captura apenas o viewport em DPR 2", {
  skip: chrome ? false : "Chromium não encontrado", timeout: 30_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { chrome });
  try {
    const instantaneo = `<!doctype html><html><head><style>
      html { scroll-behavior: smooth; }
      body { margin: 0; width: 1200px; height: 1600px; background: rgb(255, 0, 0); }
      #visivel { position: absolute; left: 300px; top: 600px; width: 200px; height: 160px; background: rgb(0, 255, 0); }
    </style></head><body><div id="visivel"></div></body></html>`;
    const resposta = await fetch(proxy.origem + BASE + "/captura", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instantaneo, pagina: { ...pagina, viewport: { largura: 200, altura: 160, dpr: 2, scrollX: 300, scrollY: 600 } } }),
    });
    assert.equal(resposta.status, 200);
    const png = Buffer.from(await resposta.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 400, "DPR escala os pixels, sem ampliar o enquadramento CSS");
    assert.equal(png.readUInt32BE(20), 320);
    assert.equal(png[24], 8, "PNG de oito bits por canal");
    assert.ok(png[25] === 2 || png[25] === 6, "PNG RGB ou RGBA");
    assert.equal(png[28], 0, "PNG sem entrelaçamento");
    const partes: Buffer[] = [];
    for (let pos = 8; pos + 12 <= png.length;) {
      const tamanho = png.readUInt32BE(pos);
      if (png.toString("ascii", pos + 4, pos + 8) === "IDAT") partes.push(png.subarray(pos + 8, pos + 8 + tamanho));
      pos += tamanho + 12;
    }
    const pixels = inflateSync(Buffer.concat(partes));
    // No primeiro pixel da primeira linha, todos os preditores dos filtros PNG
    // são zero. Seus três primeiros bytes já contêm o RGB original.
    assert.ok((pixels[0] ?? 5) <= 4);
    assert.deepEqual([...pixels.subarray(1, 4)], [0, 255, 0], "a imagem começa na área rolada, e não no topo vermelho");
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("recorte de área respeita limites desenhados sem margem extra em DPR 2", { skip: !chrome, timeout: 30_000 }, async()=>{
  const alvo=await criarAlvoFalso(), proxy=await criarProxy(alvo,{chrome,capturas:false});
  try {
    const lote=loteDeExemplo();
    lote.pagina.viewport={largura:800,altura:600,dpr:2,scrollX:0,scrollY:200};
    lote.instantaneo='<!doctype html><html><body style="margin:0;height:1400px;background:red"><div style="position:absolute;left:80px;top:300px;width:220px;height:95px;background:lime"></div></body></html>';
    const anotacao=lote.anotacoes[0]!;
    anotacao.area={rectPagina:{left:80,top:300,width:220,height:95},viewport:lote.pagina.viewport,elementos:[],truncado:false};
    anotacao.elemento.rectPagina=anotacao.area.rectPagina;
    await proxy.servidor.fila.gravar(lote);
    const capturas=await capturarLote(proxy.servidor.fila,lote,{chrome,urlsInstantaneo:[proxy.origem+BASE+'/lotes/'+lote.id+'/instantaneo']});
    assert.ok(capturas.anotacoes[anotacao.id],capturas.erro);
    const png=await readFile(join(proxy.servidor.fila.dir,capturas.anotacoes[anotacao.id]!));
    assert.equal(png.readUInt32BE(16),440,"220 pixels CSS com DPR 2");
    assert.equal(png.readUInt32BE(20),190,"95 pixels CSS com DPR 2");
    const partes: Buffer[] = [];
    for (let pos=8; pos+12<=png.length;) {
      const tamanho=png.readUInt32BE(pos);
      if(png.toString("ascii",pos+4,pos+8)==="IDAT") partes.push(png.subarray(pos+8,pos+8+tamanho));
      pos+=tamanho+12;
    }
    assert.deepEqual([...inflateSync(Buffer.concat(partes)).subarray(1,4)],[0,255,0],"a imagem começa no canto da região verde, sem incluir fundo vermelho");
  }finally{await proxy.fechar();await alvo.fechar()}
});
