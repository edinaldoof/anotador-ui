import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErroAnexo } from "../lib/anexos.ts";
import { Fila, validarLote } from "../lib/fila.ts";
import { temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, loteDeExemplo, pedir } from "./ajuda.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");
const viewport: ViewportLote = { largura: 1, altura: 1, dpr: 1, scrollX: 0, scrollY: 0 };
const anotacaoId = "anot-0001";
const origemHttpMigrada = "http://localhost:3999";
const paginaHttp = origemHttpMigrada + "/entrar?aba=1#conteudo";
const paginaHttps = "https://localhost:3999/entrar?aba=1#conteudo";

async function comFila(tarefa: (fila: Fila) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "anotador-anexos-migracao-"));
  try { const fila = new Fila(dir); await fila.preparar(); await tarefa(fila); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("migração de anexo exige contexto do servidor e mantém URL/arquivo originais no lote", async () => {
  await comFila(async (fila) => {
    const anexo = await fila.anexos.gravar(PNG, { anotacaoId, paginaUrl: paginaHttp, viewport });
    const bruto = loteDeExemplo();
    const entrada = {
      ...bruto, origemHttpMigrada,
      pagina: { ...bruto.pagina, url: paginaHttps },
      anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id: anexo.id, origemHttpMigrada, paginaUrl: paginaHttps }] }],
    };
    const lote = validarLote(entrada);
    await assert.rejects(fila.gravar(lote), ErroAnexo, "campos do cliente não autorizam a migração");
    assert.deepEqual(await readdir(fila.dirLotes), []);
    await fila.gravar(lote, { origemHttpMigrada });
    const persistido = await fila.ler(lote.id);
    assert.equal(persistido?.pagina.url, paginaHttps);
    assert.deepEqual(persistido?.anotacoes[0]?.anexos, [anexo]);
    assert.deepEqual(await fila.anexos.ler(anexo.id), anexo, "o histórico da captura não é remapeado");
    assert.deepEqual(await readFile(anexo.caminho), PNG);
    assert.ok((await fila.lerMarkdown(lote.id))?.includes(`Página da captura: ${paginaHttp}`));
  });
});

test("permissão de migração preserva autoridade, caminho, query, fragmento e anotação", async () => {
  await comFila(async (fila) => {
    const anexo = await fila.anexos.gravar(PNG, { anotacaoId, paginaUrl: paginaHttp, viewport });
    const resolver = (pagina: string, origem = origemHttpMigrada, id = anotacaoId) => fila.anexos.resolver([{ id: anexo.id }], id, pagina, { origemHttpMigrada: origem });
    for (const pagina of [
      "https://outro.test:3999/entrar?aba=1#conteudo",
      "https://localhost:4000/entrar?aba=1#conteudo",
      "https://localhost:3999/outra?aba=1#conteudo",
      "https://localhost:3999/entrar?aba=2#conteudo",
      "https://localhost:3999/entrar?aba=1#outro",
      "http://localhost:3999/outra?aba=1#conteudo",
    ]) await assert.rejects(resolver(pagina), ErroAnexo, pagina);
    for (const origem of [
      "http://outro.test:3999", "http://localhost:4000", "https://localhost:3999",
      "http://localhost:3999/entrar", "http://localhost:3999/?aba=1", "http://localhost:3999/#conteudo",
      "http://usuario:senha@localhost:3999", "não é URL",
    ]) await assert.rejects(resolver(paginaHttps, origem), ErroAnexo, origem);
    await assert.rejects(resolver(paginaHttps, origemHttpMigrada, "outra-anotacao"), ErroAnexo);
    const seguro = await fila.anexos.gravar(PNG, { anotacaoId, paginaUrl: paginaHttps, viewport });
    await assert.rejects(fila.anexos.resolver([{ id: seguro.id }], anotacaoId, paginaHttp, { origemHttpMigrada }), ErroAnexo, "HTTPS não pode voltar a HTTP");
    assert.deepEqual(await resolver(paginaHttp), [anexo], "vínculo exato continua válido");
    assert.deepEqual(await fila.listar(), []);
  });
});

test("migração compara portas efetivas, inclusive portas padrão e IPv6", async () => {
  await comFila(async (fila) => {
    for (const [origem, destino, permitido] of [
      ["http://localhost/entrar", "https://localhost:80/entrar", true],
      ["http://localhost:443/entrar", "https://localhost/entrar", true],
      ["http://localhost/entrar", "https://localhost/entrar", false],
      ["http://[::1]:3999/entrar", "https://[::1]:3999/entrar", true],
    ] as const) {
      const anexo = await fila.anexos.gravar(PNG, { anotacaoId, paginaUrl: origem, viewport });
      const resolucao = fila.anexos.resolver([{ id: anexo.id }], anotacaoId, destino, { origemHttpMigrada: new URL(origem).origin });
      if (permitido) assert.deepEqual(await resolucao, [anexo]);
      else await assert.rejects(resolucao, ErroAnexo);
    }
  });
});

test("API permite migrar print apenas no envio TLS da mesma autoridade", { skip: !await temOpenssl(), timeout: 15_000 }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { https: true, capturas: false, fonte: null });
  try {
    const bruto = loteDeExemplo();
    const paginaUrl = proxy.origem + "/entrar?aba=1#conteudo";
    const anexo = await proxy.servidor.fila.anexos.gravar(PNG, { anotacaoId, paginaUrl, viewport });
    const corpo = {
      ...bruto, instantaneo: null, origemHttpMigrada: proxy.origem,
      pagina: { ...bruto.pagina, url: paginaUrl.replace("http:", "https:") },
      anotacoes: [{ ...bruto.anotacoes[0], anexos: [{ id: anexo.id }] }],
    };
    const semTls = await pedir(proxy.origem + "/__anotador/lotes", {
      metodo: "POST", corpo: JSON.stringify(corpo), headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    });
    assert.equal(semTls.status, 400, "o header encaminhado não substitui um socket TLS");
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    const ca = await readFile(join(proxy.saida, "tls", "autoridade.pem"));
    const resposta = await new Promise<{ status: number; corpo: string }>((resolve, reject) => {
      const req = request(proxy.origem.replace("http:", "https:") + "/__anotador/lotes", { method: "POST", ca, headers: { "content-type": "application/json" } }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (parte: Buffer) => partes.push(parte));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(JSON.stringify(corpo));
    });
    assert.equal(resposta.status, 201, resposta.corpo);
    assert.deepEqual((await proxy.servidor.fila.ler(bruto.id))?.anotacoes[0]?.anexos, [anexo]);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});
