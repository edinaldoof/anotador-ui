import assert from "node:assert/strict";
import { test } from "node:test";
import { Navegador, encontrarChromium } from "../lib/cdp.ts";
import type { ResultadoExtracao } from "../lib/extracao.ts";
import { BASE } from "../server.ts";
import { criarAlvoFalso, criarProxy, esperarAte, pedir } from "./ajuda.ts";

const chrome = encontrarChromium();
const post = (origem: string, corpo: unknown, headers: Record<string, string> = {}) => pedir(origem + BASE + "/extrair", {
  metodo: "POST", headers: { "content-type": "application/json", ...headers }, corpo: JSON.stringify(corpo),
});

test("extração serve a página e recusa origem cruzada e URLs inválidas antes de abrir o navegador", async (t) => {
  const abertura = t.mock.method(Navegador, "abrir", async () => { throw new Error("não deveria abrir Chromium"); });
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    for (const caminho of ["/extrair", "/extrair/"]) {
      const resposta = await pedir(proxy.origem + BASE + caminho);
      assert.equal(resposta.status, 200);
      assert.match(resposta.headers["content-type"] ?? "", /text\/html/);
      assert.match(resposta.corpo, /<title\b[^>]*>Extrair design/);
      assert.match(resposta.corpo, /id="url"/);
    }
    const proibida = await post(proxy.origem, { url: alvo.origem }, { "sec-fetch-site": "cross-site" });
    assert.equal(proibida.status, 403);
    assert.equal(JSON.parse(proibida.corpo).ok, false);
    for (const url of [undefined, "", "http://[invalido", "file:///tmp", "javascript:alert(1)", "https://usuario:senha@example.com", "https://example.com/" + "x".repeat(4000)]) {
      const resposta = await post(proxy.origem, { url });
      assert.equal(resposta.status, 400, String(url));
      assert.ok(JSON.parse(resposta.corpo).erro);
    }
    assert.equal(abertura.mock.callCount(), 0);
    assert.equal(proxy.servidor.alvo, alvo.origem);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("extração simultânea responde 409 e libera a próxima tentativa depois de falhar", { timeout: 5000 }, async (t) => {
  let liberar!: () => void;
  const bloqueio = new Promise<void>((resolver) => { liberar = resolver; });
  const abertura = t.mock.method(Navegador, "abrir", async () => {
    await bloqueio;
    throw new Error("falha controlada do navegador");
  });
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  let primeira: ReturnType<typeof post> | undefined;
  try {
    primeira = post(proxy.origem, { url: alvo.origem });
    await esperarAte(() => abertura.mock.callCount() === 1, 2000, 20, "a primeira extração iniciou");
    const concorrente = await post(proxy.origem, { url: alvo.origem });
    assert.equal(concorrente.status, 409);
    assert.match(JSON.parse(concorrente.corpo).erro, /em andamento/);
    assert.equal(abertura.mock.callCount(), 1, "o segundo pedido não inicia outro navegador");
    liberar();
    assert.equal((await primeira).status, 502);
    const proxima = await post(proxy.origem, { url: alvo.origem });
    assert.equal(proxima.status, 502, "a tentativa seguinte chega novamente ao navegador");
    assert.match(JSON.parse(proxima.corpo).erro, /falha controlada/);
    assert.equal(abertura.mock.callCount(), 2);
  } finally {
    liberar();
    await primeira?.catch(() => undefined);
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("API extrai a fixture em Chromium e devolve Markdown, tokens e evidências sem trocar o app", {
  skip: chrome ? false : "Chromium não encontrado", timeout: 45_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { chrome });
  try {
    const resposta = await post(proxy.origem, { url: alvo.origem + "/" });
    assert.equal(resposta.status, 200, resposta.corpo.slice(0, 250));
    const corpo = JSON.parse(resposta.corpo) as { ok: boolean; resultado: ResultadoExtracao };
    assert.equal(corpo.ok, true);
    const resultado = corpo.resultado;
    assert.equal(resultado.nome, "Página de teste");
    assert.equal(resultado.url, alvo.origem + "/");
    assert.ok(Number.isFinite(Date.parse(resultado.extraidoEm)));
    assert.ok(resultado.markdown.startsWith("---\n"), "o Markdown inclui os tokens no frontmatter");
    assert.ok(resultado.markdown.includes("## Colors"));
    assert.deepEqual(Object.keys(resultado.tokens).sort(), ["colors", "components", "rounded", "shadows", "spacing", "typography"]);
    assert.ok(Object.values(resultado.tokens.colors).includes("#2563EB"), "o azul do botão veio da fixture");
    assert.deepEqual(resultado.evidencias.viewports.map((v) => v.nome), ["desktop", "mobile"]);
    assert.ok(resultado.evidencias.viewports.every((v) => v.elementosAnalisados > 0));
    assert.ok(resultado.evidencias.tokens.length > 0);
    assert.ok(Array.isArray(resultado.evidencias.limitacoes));
    assert.ok(resultado.capturas?.desktop && resultado.capturas.mobile);
    for (const imagem of [resultado.capturas.desktop, resultado.capturas.mobile]) {
      assert.deepEqual(Buffer.from(imagem, "base64").subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    assert.equal(proxy.servidor.alvo, alvo.origem);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    assert.deepEqual(await proxy.servidor.avaliacoes.listar(), []);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});
