import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Anexos, ErroAnexo, idAnexoSeguro, normalizarPaginaAnexo } from "../lib/anexos.ts";
import { Fila, validarLote } from "../lib/fila.ts";
import { encontrarChromium } from "../lib/cdp.ts";
import { BASE } from "../server.ts";
import { abrirWs, criarAlvoFalso, criarProxy, loteDeExemplo, pedir } from "./ajuda.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");
const viewport: ViewportLote = { largura: 1, altura: 1, dpr: 1, scrollX: 0, scrollY: 0 };
const vinculo = { anotacaoId: "anot-0001", paginaUrl: "http://localhost:3000/entrar", viewport };
const chrome = encontrarChromium();
const ip = Object.values(networkInterfaces()).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address;
async function comFila(tarefa: (fila: Fila) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "anotador-anexos-"));
  try { const fila = new Fila(dir); await fila.preparar(); await tarefa(fila); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("store publica PNG e metadados completos, canônicos e legíveis por outra instância", async () => {
  await comFila(async (fila) => {
    const anexo = await fila.anexos.gravar(PNG, { ...vinculo, paginaUrl: "HTTP://EXAMPLE.TEST:80/entrada?q=1#titulo" });
    assert.equal(idAnexoSeguro(anexo.id), true);
    assert.equal(anexo.paginaUrl, "http://example.test/entrada?q=1#titulo");
    assert.equal(anexo.anotacaoId, vinculo.anotacaoId);
    assert.equal(anexo.largura, 1); assert.equal(anexo.altura, 1);
    assert.ok(Math.abs(Date.now() - Date.parse(anexo.capturadoEm)) < 5000);
    assert.equal(anexo.caminho, await realpath(join(fila.dir, "anexos", anexo.id, "imagem.png")));
    assert.deepEqual(await readFile(anexo.caminho), PNG);
    assert.deepEqual(JSON.parse(await readFile(join(dirname(anexo.caminho), "anexo.json"), "utf8")), anexo);
    const reiniciado = new Anexos(fila.dir);
    assert.deepEqual(await reiniciado.ler(anexo.id), anexo);
    assert.deepEqual(await reiniciado.imagem(anexo.id), PNG);
    assert.deepEqual(await fila.listar(), [], "tirar print não cria nem envia lote");
    assert.deepEqual(await readdir(join(fila.dir, "anexos")), [anexo.id], "não expõe diretório temporário incompleto");
  });
});

test("validação aceita só UUIDs, no máximo três, e descarta metadados do cliente", () => {
  const id = randomUUID();
  const bruto = loteDeExemplo();
  const entrada = { ...bruto, anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id, caminho: "/etc/passwd", anotacaoId: "outra-id", paginaUrl: "https://outro.test", largura: 999, capturadoEm: "inventado" }] }] };
  assert.deepEqual(validarLote(entrada).anotacoes[0]?.anexos, [{ id }]);
  for (const anexos of [null, "print", [{}], [{ id: "../../etc/passwd" }], [{ id: "%2e%2e%2fsegredo" }], [{ id }, { id }], Array.from({ length: 4 }, () => ({ id: randomUUID() }))]) {
    assert.throws(() => validarLote({ ...bruto, anotacoes: [{ ...bruto.anotacoes[0], anexos }] }), ErroAnexo);
  }
  assert.equal(idAnexoSeguro("../../etc/passwd"), false);
  assert.throws(() => normalizarPaginaAnexo("file:///etc/passwd"), ErroAnexo);
  assert.throws(() => normalizarPaginaAnexo("https://user:secret@example.test/"), ErroAnexo);
});

test("Fila.gravar resolve pelo store e markdown mantém print manual junto da captura automática", async () => {
  await comFila(async (fila) => {
    const bruto = loteDeExemplo();
    const anexo = await fila.anexos.gravar(PNG, { ...vinculo, paginaUrl: bruto.pagina.url });
    const lote = validarLote({ ...bruto, anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id: anexo.id, caminho: "/arquivo-forjado.png", largura: 999 }] }] });
    await fila.gravar(lote);
    assert.deepEqual(lote.anotacoes[0]?.anexos, [anexo], "objeto entregue ao processamento também recebe o vínculo confiável");
    assert.deepEqual((await fila.ler(lote.id))?.anotacoes[0]?.anexos, [anexo]);
    let md = await readFile(fila.caminhoMd(lote.id), "utf8");
    assert.match(md, /### Prints anexados manualmente/);
    assert.match(md, /Captura manual em:/);
    assert.ok(md.includes(`Página da captura: ${anexo.paginaUrl}`));
    assert.ok(md.includes(`![Print manual 1 da anotação 1](<${anexo.caminho}>)`));
    assert.ok(md.includes(`Arquivo: \`${anexo.caminho}\``));
    assert.ok(!md.includes("arquivo-forjado"));
    await fila.anexarCapturas(lote.id, { pagina: "/automatico/pagina.png", anotacoes: { "anot-0001": "/automatico/recorte.png" } });
    md = await readFile(fila.caminhoMd(lote.id), "utf8");
    assert.ok(md.includes(anexo.caminho));
    assert.match(md, /Print da página: \/automatico\/pagina.png/);
    assert.match(md, /Recorte: \/automatico\/recorte.png/);
  });
});

test("vínculos ausentes, de outra anotação/página ou repetidos não gravam nenhum arquivo do lote", async () => {
  await comFila(async (fila) => {
    const bruto = loteDeExemplo();
    const anexo = await fila.anexos.gravar(PNG, { ...vinculo, paginaUrl: bruto.pagina.url });
    for (const [i, alteracao] of [
      { anexos: [{ id: randomUUID() }] },
      { id: "outra-anotacao", anexos: [{ id: anexo.id }] },
      { anexos: [{ id: anexo.id }], outraPagina: true },
    ].entries()) {
      const { outraPagina, ...campos } = alteracao;
      const lote = validarLote({ ...bruto, id: `lote-recusado-${i}`, pagina: { ...bruto.pagina, url: outraPagina ? bruto.pagina.url + "?outro=1" : bruto.pagina.url }, anotacoes: [{ ...bruto.anotacoes[0], ...campos }] });
      await assert.rejects(fila.gravar(lote), ErroAnexo);
    }
    const repetido = validarLote({ ...bruto, anotacoes: Array.from({ length: 2 }, () => ({ ...bruto.anotacoes[0], anexos: [{ id: anexo.id }] })) });
    await assert.rejects(fila.gravar(repetido), /identificadores únicos/);
    assert.deepEqual(await readdir(fila.dirLotes), []);
    assert.deepEqual(await fila.listar(), []);
  });
});

test("metadados falsos não redirecionam arquivo e symlinks/traversal são recusados", async () => {
  await comFila(async (fila) => {
    const anexo = await fila.anexos.gravar(PNG, vinculo);
    const metadados = join(dirname(anexo.caminho), "anexo.json");
    await writeFile(metadados, JSON.stringify({ ...anexo, caminho: "/etc/passwd", largura: 999, altura: 999 }));
    assert.deepEqual(await fila.anexos.ler(anexo.id), anexo);
    await assert.rejects(fila.anexos.imagem("../../etc/passwd"), ErroAnexo);
    await assert.rejects(fila.anexos.ler("%2e%2e%2fsegredo"), ErroAnexo);
    const externo = join(fila.dir, "fora.png");
    await writeFile(externo, PNG);
    await rm(anexo.caminho);
    await symlink(externo, anexo.caminho);
    assert.equal(await fila.anexos.imagem(anexo.id), null);
    assert.equal(await fila.anexos.ler(anexo.id), null);
  });
});

test("PNG inválido e vínculo inválido não publicam anexo", async () => {
  await comFila(async (fila) => {
    await assert.rejects(fila.anexos.gravar(Buffer.from("não é PNG"), vinculo), ErroAnexo);
    await assert.rejects(fila.anexos.gravar(PNG, { ...vinculo, anotacaoId: "../../etc/passwd" }), ErroAnexo);
    await assert.rejects(fila.anexos.gravar(PNG, { ...vinculo, paginaUrl: "file:///tmp/segredo" }), ErroAnexo);
    await assert.rejects(fila.anexos.gravar(PNG, { ...vinculo, viewport: { ...viewport, dpr: Infinity } }), ErroAnexo);
    assert.deepEqual(await fila.listar(), []);
    assert.equal((await readdir(fila.dir)).includes("anexos"), false);
  });
});

test("rotas de anexos exigem acesso, rejeitam caminhos e não servem metadados", { skip: ip ? false : "sem endereço de rede" }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0", chrome: "/chromium-inexistente-anexo" });
  try {
    const anexo = await proxy.servidor.fila.anexos.gravar(PNG, vinculo);
    const remoto = `http://${ip}:${proxy.porta}${BASE}`;
    const get = await pedir(remoto + `/anexos/${anexo.id}/imagem`);
    assert.equal(get.status, 403);
    assert.ok(!get.corpo.includes(anexo.caminho));
    const pedido = { instantaneo: "<!doctype html><p>Print</p>", anotacaoId: "anot-0001", pagina: { url: vinculo.paginaUrl, caminho: "/entrar", viewport } };
    assert.equal((await pedir(remoto + "/anexos/captura", { metodo: "POST", corpo: JSON.stringify(pedido) })).status, 403);
    const autorizado = await fetch(remoto + `/anexos/${anexo.id}/imagem`, { headers: { "x-anotador-chave": proxy.servidor.chave } });
    assert.equal(autorizado.status, 200);
    assert.equal(autorizado.headers.get("content-type"), "image/png");
    assert.equal(autorizado.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await autorizado.arrayBuffer()), PNG);
    assert.equal((await pedir(proxy.origem + BASE + `/anexos/${anexo.id}/imagem`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.equal((await pedir(proxy.origem + BASE + "/anexos/..%2f..%2fetc%2fpasswd/imagem")).status, 400);
    assert.equal((await pedir(proxy.origem + BASE + `/anexos/${anexo.id}/anexo.json`)).status, 404);
    assert.equal((await pedir(proxy.origem + BASE + `/anexos/${randomUUID()}/imagem`)).status, 404);
    const invalido = { ...pedido, anotacaoId: "../arquivo" };
    assert.equal((await pedir(proxy.origem + BASE + "/anexos/captura", { metodo: "POST", corpo: JSON.stringify(invalido) })).status, 400);
    assert.equal((await pedir(proxy.origem + BASE + "/anexos/captura", { metodo: "POST", corpo: JSON.stringify(pedido) })).status, 503);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("POST lote devolve 400 para referência ausente ou de outro alvo sem criar lote", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const bruto = loteDeExemplo();
    const outro = await proxy.servidor.fila.anexos.gravar(PNG, { ...vinculo, anotacaoId: "outra-anotacao", paginaUrl: bruto.pagina.url });
    for (const id of [randomUUID(), outro.id]) {
      const corpo = { ...bruto, anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id }] }] };
      const resposta = await pedir(proxy.origem + BASE + "/lotes", { metodo: "POST", corpo: JSON.stringify(corpo) });
      assert.equal(resposta.status, 400);
      assert.equal(JSON.parse(resposta.corpo).ok, false);
    }
    assert.deepEqual(await readdir(proxy.servidor.fila.dirLotes), []);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("envio entrega ao ouvinte somente caminho canônico do print, ignorando caminho do cliente", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { fonte: null, capturas: false });
  const ouvinte = await abrirWs(proxy.origem.replace("http:", "ws:") + BASE + "/eventos");
  try {
    await ouvinte.proximo();
    const bruto = loteDeExemplo();
    const anexo = await proxy.servidor.fila.anexos.gravar(PNG, { ...vinculo, paginaUrl: bruto.pagina.url });
    const resposta = await pedir(proxy.origem + BASE + "/lotes", {
      metodo: "POST", corpo: JSON.stringify({
        ...bruto, instantaneo: null,
        anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id: anexo.id, caminho: "/etc/imagem-forjada.png", paginaUrl: "https://falso.test", largura: 999 }] }],
      }),
    });
    assert.equal(resposta.status, 201);
    const evento = JSON.parse(await ouvinte.proximo());
    assert.equal(evento.tipo, "lote");
    assert.deepEqual(evento.imagens, [anexo.caminho]);
    assert.equal(JSON.stringify(evento).includes("imagem-forjada"), false);
    assert.deepEqual((await proxy.servidor.fila.ler(bruto.id))?.anotacoes[0]?.anexos, [anexo]);
  } finally { ouvinte.fechar(); await proxy.fechar(); await alvo.fechar(); }
});

test("POST captura publica PNG real antes de responder e mantém a fila vazia", { skip: chrome ? false : "Chromium não encontrado", timeout: 30_000 }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { chrome, capturas: false });
  try {
    const resposta = await pedir(proxy.origem + BASE + "/anexos/captura", {
      metodo: "POST", corpo: JSON.stringify({
        anotacaoId: "anot-0001", instantaneo: '<!doctype html><html><body style="background:#2563eb">Print manual</body></html>',
        pagina: { url: proxy.origem + "/entrar", caminho: "/entrar", viewport: { largura: 160, altura: 120, dpr: 2, scrollX: 0, scrollY: 0 } },
      }),
    });
    assert.equal(resposta.status, 201);
    const { ok, anexo } = JSON.parse(resposta.corpo) as { ok: boolean; anexo: AnexoImagem };
    assert.equal(ok, true);
    assert.equal(anexo.largura, 320); assert.equal(anexo.altura, 240);
    assert.deepEqual(anexo.viewport, { largura: 160, altura: 120, dpr: 2, scrollX: 0, scrollY: 0 });
    const salvo = await readFile(anexo.caminho);
    assert.equal(salvo.readUInt32BE(16), 320); assert.equal(salvo.readUInt32BE(20), 240);
    const servido = await fetch(proxy.origem + BASE + `/anexos/${anexo.id}/imagem`);
    assert.deepEqual(Buffer.from(await servido.arrayBuffer()), salvo);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
    assert.equal((await readdir(proxy.servidor.fila.dirLotes)).length, 0);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});
