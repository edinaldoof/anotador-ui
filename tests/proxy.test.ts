import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { after, before, test } from "node:test";
import { BASE } from "../server.ts";
import { CSP, NONCE, abrirWs, criarAlvoFalso, criarProxy, esperarAte, loteDeExemplo, pedir, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

let alvo: AlvoFalso;
let proxy: ProxySobTeste;

before(async () => {
  alvo = await criarAlvoFalso();
  proxy = await criarProxy(alvo);
});
after(async () => {
  await proxy.fechar();
  await alvo.fechar();
});

test("HTML de navegação sai com o overlay injetado, nonce da página e CSP intacta", async () => {
  const r = await pedir(proxy.origem + "/", { headers: { "sec-fetch-dest": "document", accept: "text/html" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-security-policy"], CSP);
  assert.ok(r.corpo.includes(`<script nonce="${NONCE}" src="${BASE}/overlay.js" defer></script></head>`), "script com o nonce da página antes de </head>");
  assert.equal(Number(r.headers["content-length"]), Buffer.byteLength(r.corpo), "content-length recalculado após a injeção");
  assert.equal("transfer-encoding" in r.headers, false);
});

test("HTML comprimido é descomprimido antes da injeção", async () => {
  const r = await pedir(proxy.origem + "/gzip", { headers: { "sec-fetch-dest": "document" } });
  assert.equal(r.status, 200);
  assert.ok(r.corpo.includes(`src="${BASE}/overlay.js"`));
  assert.equal("content-encoding" in r.headers, false);
});

test("pedidos que não são navegação passam sem injeção e sem bufferização", async () => {
  const fragmento = await pedir(proxy.origem + "/", { headers: { "sec-fetch-dest": "empty" } });
  assert.equal(fragmento.corpo.includes("__anotador"), false);
  const json = await pedir(proxy.origem + "/api/dados", { headers: { origin: proxy.origem, referer: proxy.origem + "/entrar", host: `127.0.0.1:${proxy.porta}` } });
  assert.equal(json.headers["content-type"], "application/json");
  const visto = JSON.parse(json.corpo) as { host: string; origin: string; referer: string };
  assert.equal(visto.host, `127.0.0.1:${alvo.porta}`, "Host reescrito para o alvo");
  assert.equal(visto.origin, alvo.origem, "Origin da origem pública vira a do alvo");
  assert.equal(visto.referer, alvo.origem + "/entrar");
  const css = await pedir(proxy.origem + "/estilo.css");
  assert.equal(css.headers["content-type"], "text/css");
  assert.match(css.corpo, /body\{margin:0/);
});

test("redirecionamentos para o alvo voltam pela origem pública; externos ficam como estão", async () => {
  const interno = await pedir(proxy.origem + "/redireciona");
  assert.equal(interno.status, 302);
  assert.equal(interno.headers["location"], proxy.origem + "/destino?x=1");
  const externo = await pedir(proxy.origem + "/externo");
  assert.equal(externo.headers["location"], "https://exemplo.org/fora");
});

test("o overlay é servido como JavaScript sem tipos e com a configuração embutida", async () => {
  const r = await pedir(proxy.origem + BASE + "/overlay.js");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"] ?? "", /javascript/);
  assert.match(r.corpo, /window\.__ANOTADOR_CFG = \{"base":"\/__anotador","capturas":false,"nome":"teste","agente":"Claude"\}/);
  assert.doesNotMatch(r.corpo, /: string\b|: number\b|interface \w+ \{/, "tipos removidos");
  const { default: vm } = await import("node:vm");
  assert.doesNotThrow(() => new vm.Script(r.corpo), "bundle é JavaScript sintaticamente válido");
});

test("túnel WebSocket alcança o alvo nos dois sentidos", async () => {
  const cliente = await abrirWs(`ws://127.0.0.1:${proxy.porta}/ws/hmr?x=1`);
  try {
    assert.equal(await cliente.proximo(), "ola:/ws/hmr?x=1");
    cliente.enviar("ping do cliente");
    assert.equal(await cliente.proximo(), "eco:ping do cliente");
    const pedidoWs = alvo.pedidos.find((p) => p.url === "/ws/hmr?x=1");
    assert.equal(pedidoWs?.headers["host"], `127.0.0.1:${alvo.porta}`, "Host do upgrade também é reescrito");
  } finally {
    cliente.fechar();
  }
});

test("lote enviado vira arquivo, evento no WebSocket e status que fecha o ciclo", async () => {
  const ouvinte = await abrirWs(`ws://127.0.0.1:${proxy.porta}${BASE}/eventos`);
  try {
    assert.deepEqual(JSON.parse(await ouvinte.proximo()), { tipo: "ola", nome: "teste", alvo: alvo.origem });
    const lote = loteDeExemplo("lote-proxy-0001");
    const criado = await pedir(proxy.origem + BASE + "/lotes", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(lote) });
    assert.equal(criado.status, 201);
    const resposta = JSON.parse(criado.corpo) as { ok: boolean; id: string; novo: boolean; caminhoMd: string };
    assert.equal(resposta.novo, true);
    await access(resposta.caminhoMd);

    const evento = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evento.tipo, "lote");
    assert.equal(evento.id, "lote-proxy-0001");
    assert.equal(evento.quantidade, 1);
    assert.match(evento.resumo ?? "", /1 anotação\(ões\) em \/entrar: 1\) "Deixar o rótulo maior" em EscolhaDeAcesso › p/);
    assert.equal(evento.caminhoMd, resposta.caminhoMd);

    const repetido = await pedir(proxy.origem + BASE + "/lotes", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(lote) });
    assert.equal(repetido.status, 200);
    assert.equal((JSON.parse(repetido.corpo) as { novo: boolean }).novo, false, "reenvio do mesmo id é idempotente");

    const status = JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/status")).corpo) as StatusLote;
    assert.equal(status.estado, "recebido");
    const pendentes = JSON.parse((await pedir(proxy.origem + BASE + "/lotes?estado=pendente")).corpo) as { lotes: RegistroLote[] };
    assert.equal(pendentes.lotes.length, 1);
    assert.deepEqual(evento.arquivos, ["projeto/app/entrar/page.tsx", "projeto/components/escolha-de-acesso.tsx", "pagina.html"], "o evento aponta os arquivos prováveis, os da rota /entrar primeiro");
    const md = await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/md");
    assert.match(md.corpo, /## Anotação 1 — Deixar o rótulo maior/);
    assert.match(md.corpo, /### Onde está no código[\s\S]*`projeto\/app\/entrar\/page\.tsx:7`/);
    assert.match(md.corpo, /\| `font-size` \| `12px` \| `14px` \| `text-xs` \| `text-sm` \|/);
    const instantaneo = await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/instantaneo");
    assert.equal(instantaneo.corpo, lote.instantaneo);

    const progresso = await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/progresso", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ nota: "aplicando em page.tsx" }) });
    assert.equal(progresso.status, 200);
    assert.deepEqual(JSON.parse(await ouvinte.proximo()), { tipo: "progresso", id: "lote-proxy-0001", nota: "aplicando em page.tsx" });
    const andamento = JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/status")).corpo) as StatusLote;
    assert.equal(andamento.estado, "em_andamento");
    assert.equal(andamento.nota, "aplicando em page.tsx");
    assert.equal((JSON.parse((await pedir(proxy.origem + BASE + "/lotes?estado=pendente")).corpo) as { lotes: RegistroLote[] }).lotes.length, 1, "em andamento ainda conta como pendente");

    const enviarMsg = (corpo: unknown) => pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/mensagens", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify(corpo) });
    const nota = await enviarMsg({ autor: "agente", tipo: "nota", texto: "Vou aplicar no componente compartilhado." });
    assert.equal(nota.status, 201);
    const evNota = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evNota.tipo, "mensagem");
    assert.equal(evNota.mensagem?.tipo, "nota");
    const escolha = await enviarMsg({ autor: "agente", tipo: "escolha", texto: "Aplicar só na etapa ativa ou em todas?", opcoes: ["Só na ativa", "Em todas"] });
    assert.equal(escolha.status, 201);
    const idEscolha = (JSON.parse(escolha.corpo) as { mensagem: Mensagem }).mensagem.id;
    await ouvinte.proximo();
    const comPergunta = JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/status")).corpo) as StatusLote;
    assert.equal(comPergunta.perguntasAbertas, 1, "status expõe a pergunta aberta");
    assert.equal((await enviarMsg({ autor: "agente", tipo: "escolha", texto: "x", opcoes: ["só uma"] })).status, 400, "escolha exige duas opções");
    assert.equal((await enviarMsg({ autor: "usuario", tipo: "resposta", texto: "x", responde: "00000000-0000-4000-8000-000000000000" })).status, 409, "resposta a pergunta inexistente é recusada");
    assert.equal((await enviarMsg({ autor: "usuario", tipo: "nota", texto: "x" })).status, 400, "usuário não escreve nota");
    const respostaUsuario = await enviarMsg({ autor: "usuario", tipo: "resposta", texto: "Em todas", opcoes: ["Em todas"], responde: idEscolha });
    assert.equal(respostaUsuario.status, 201);
    const evResposta = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evResposta.mensagem?.autor, "usuario");
    assert.deepEqual(evResposta.mensagem?.opcoes, ["Em todas"]);
    assert.equal(evResposta.mensagem?.responde, idEscolha);
    assert.equal((await enviarMsg({ autor: "usuario", tipo: "resposta", texto: "de novo", responde: idEscolha })).status, 409, "pergunta não aceita segunda resposta");
    const recado = await enviarMsg({ autor: "usuario", tipo: "resposta", texto: "e mantenha o contraste" });
    assert.equal(recado.status, 201, "recado livre do usuário não precisa apontar pergunta");
    assert.equal((JSON.parse(await ouvinte.proximo()) as EventoAnotador).mensagem?.responde, undefined);
    const conversa = JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/conversa")).corpo) as { mensagens: Mensagem[]; abertas: string[] };
    assert.equal(conversa.mensagens.length, 4);
    assert.deepEqual(conversa.abertas, []);
    assert.equal((JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/status")).corpo) as StatusLote).perguntasAbertas, undefined);

    const processado = await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/processado", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ nota: "ajustado em page.tsx" }) });
    assert.equal(processado.status, 200);
    const eventoProcessado = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.deepEqual(eventoProcessado, { tipo: "processado", id: "lote-proxy-0001", nota: "ajustado em page.tsx" });
    await esperarAte(async () => (JSON.parse((await pedir(proxy.origem + BASE + "/lotes/lote-proxy-0001/status")).corpo) as StatusLote).estado === "processado");
    const depois = JSON.parse((await pedir(proxy.origem + BASE + "/lotes?estado=pendente")).corpo) as { lotes: RegistroLote[] };
    assert.equal(depois.lotes.length, 0);
  } finally {
    ouvinte.fechar();
  }
});

test("a API recusa lote inválido e id fora do padrão", async () => {
  const invalido = await pedir(proxy.origem + BASE + "/lotes", { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ id: "x" }) });
  assert.equal(invalido.status, 400);
  const id = await pedir(proxy.origem + BASE + "/lotes/..%2F..%2Fetc/status");
  assert.equal(id.status, 400);
  const nada = await pedir(proxy.origem + BASE + "/lotes/inexistente-0000/md");
  assert.equal(nada.status, 404);
});

test("alvo fora do ar devolve página de erro amigável em vez de derrubar o proxy", async () => {
  const morto = await criarAlvoFalso();
  await morto.fechar();
  const proxyOrfao = await criarProxy(morto);
  try {
    const r = await pedir(proxyOrfao.origem + "/", { headers: { "sec-fetch-dest": "document" } });
    assert.equal(r.status, 502);
    assert.match(r.corpo, /O anotador não alcançou o app/);
    assert.match(r.corpo, /ECONNREFUSED/);
  } finally {
    await proxyOrfao.fechar();
  }
});
