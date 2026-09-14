import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ChatAgentes, ErroChat } from "../lib/chat.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

const BASE = "/__anotador/chat";
const ip = Object.values(networkInterfaces()).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address;

test("API de chat autentica histórico e mantém criar/enviar independentes da fila de anotações", async () => {
  const prototipo = ChatAgentes.prototype as unknown as Record<string, unknown>;
  const metodos = ["catalogo", "listar", "obter", "criar", "enviar", "configurar"];
  const originais = new Map(metodos.map((nome) => [nome, prototipo[nome]]));
  const chamadas: Array<{ instancia: object; metodo: string; argumentos: unknown[] }> = [];
  const conversa = { id: "sessao-teste-0001", agente: "codex", modelo: "modelo-teste", esforco: "high", titulo: "Conversa de teste", criadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), ocupada: false, mensagens: [] };
  const responder = (metodo: string, resposta: unknown) => function (this: object, ...argumentos: unknown[]) {
    chamadas.push({ instancia: this, metodo, argumentos }); return Promise.resolve(resposta);
  };
  prototipo.catalogo = responder("catalogo", { agentes: [{ id: "codex", nome: "Codex", instalado: true, ponte: true, modelos: [] }], sessoesExternas: [] });
  prototipo.listar = responder("listar", [conversa]);
  prototipo.obter = responder("obter", conversa);
  prototipo.criar = responder("criar", conversa);
  prototipo.enviar = responder("enviar", { ...conversa, ocupada: true });
  prototipo.configurar = responder("configurar", { ...conversa, modelo: "outro-modelo", esforco: "medium" });
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: "0.0.0.0" });
  const fonteNova = await mkdtemp(join(tmpdir(), "anotador-chat-fonte-"));
  try {
    const local = proxy.origem + BASE;
    for (const caminho of ["/catalogo", "/limites?agente=codex", "/comandos?agente=claude", "/sessoes", "/sessoes/" + conversa.id]) {
      const cruzado = await pedir(local + caminho, { headers: { "sec-fetch-site": "cross-site" } });
      assert.equal(cruzado.status, 403);
      assert.ok(!cruzado.corpo.includes(conversa.titulo));
      if (ip) assert.equal((await pedir(`http://${ip}:${proxy.porta}${BASE}` + caminho)).status, 403);
    }
    assert.equal(chamadas.length, 0, "autorização ocorre antes de consultar o histórico");
    assert.equal((await pedir(local + "/limites?agente=inventado")).status, 400);
    assert.equal((await pedir(local + "/limites")).status, 400);
    assert.equal((await pedir(local + "/limites?agente=codex", { metodo: "POST", corpo: "{}" })).status, 405);
    const limitesSemFonte = await pedir(local + "/limites?agente=cursor");
    assert.equal(limitesSemFonte.status, 200);
    assert.equal(limitesSemFonte.headers["cache-control"], "no-store");
    const limites = JSON.parse(limitesSemFonte.corpo);
    assert.equal(limites.agente, "cursor");
    assert.equal(limites.disponivel, false);
    assert.equal(limites.atualizadoEm, null);
    assert.deepEqual(limites.janelas, [], "sem fonte de uso não inventa cotas zeradas");
    const catalogo = await pedir(local + "/catalogo");
    assert.equal(catalogo.status, 200);
    assert.equal(catalogo.headers["cache-control"], "no-store");
    assert.equal(JSON.parse(catalogo.corpo).agentes[0].id, "codex");
    const listar = await pedir(local + "/sessoes");
    assert.deepEqual(JSON.parse(listar.corpo), { ok: true, sessoes: [conversa] });
    await pedir(local + "/sessoes?agente=codex");
    assert.deepEqual(chamadas.filter((v) => v.metodo === "listar").at(-1)?.argumentos,["codex"]);
    const criar = await pedir(local + "/sessoes", { metodo: "POST", corpo: JSON.stringify({ agente: "codex", modelo: "modelo-teste", esforco: "high", sessaoExterna: "sessao-externa-1" }) });
    assert.equal(criar.status, 201);
    assert.deepEqual(JSON.parse(criar.corpo), { ok: true, conversa });
    assert.deepEqual(chamadas.find((v) => v.metodo === "criar")?.argumentos, [{ agente: "codex", modelo: "modelo-teste", esforco: "high", sessaoExterna: "sessao-externa-1" }]);
    assert.equal(chamadas.some((v) => v.metodo === "enviar"), false, "criar conversa não dispara mensagem nem agente");
    assert.deepEqual(JSON.parse((await pedir(local + "/sessoes/" + conversa.id)).corpo), { ok: true, conversa });
    await pedir(local + "/sessoes/" + conversa.id + "?agente=codex");
    assert.deepEqual(chamadas.filter((v) => v.metodo === "obter").at(-1)?.argumentos,[conversa.id,"codex"]);
    const envio = await pedir(local + "/sessoes/" + conversa.id + "/mensagens", { metodo: "POST", corpo: JSON.stringify({ texto: "Minha pergunta", promptSistema: "não usar" }) });
    assert.equal(envio.status, 200);
    assert.equal(JSON.parse(envio.corpo).conversa.ocupada, true);
    assert.deepEqual(chamadas.find((v) => v.metodo === "enviar")?.argumentos, [conversa.id, "Minha pergunta", undefined]);
    await pedir(local + "/sessoes/" + conversa.id + "/mensagens", { metodo:"POST",corpo:JSON.stringify({texto:"Outra pergunta",agente:"codex"}) });
    assert.deepEqual(chamadas.filter((v) => v.metodo === "enviar").at(-1)?.argumentos,[conversa.id,"Outra pergunta","codex"]);
    const configurar = await pedir(local + "/sessoes/" + conversa.id + "/configuracao", { metodo: "POST", corpo: JSON.stringify({ agente: "codex", modelo: "outro-modelo", esforco: "medium", mensagens: ["não usar"] }) });
    assert.equal(configurar.status, 200);
    assert.equal(JSON.parse(configurar.corpo).conversa.modelo, "outro-modelo");
    assert.deepEqual(chamadas.find((v) => v.metodo === "configurar")?.argumentos, [conversa.id, { modelo: "outro-modelo", esforco: "medium" }, "codex"]);
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
    const instancias = new Set(chamadas.map((v) => v.instancia));
    assert.equal(instancias.size, 1, "mesmo projeto reutiliza a instância em execução");
    await proxy.servidor.conectar({ alvo: alvo.origem, fonte: fonteNova });
    await pedir(local + "/sessoes");
    assert.equal(new Set(chamadas.map((v) => v.instancia)).size, 2, "trocar projeto cria serviço independente");
    await mkdir(join(fonteNova, ".claude/commands"), { recursive: true });
    await writeFile(join(fonteNova, ".claude/commands/comando-api.md"), "---\ndescription: Comando deste projeto\n---\nSomente texto.");
    const comandos = await pedir(local + "/comandos?agente=claude");
    assert.equal(comandos.status, 200);
    assert.ok(JSON.parse(comandos.corpo).comandos.some((c: { nome: string; suporte: string }) => c.nome === "comando-api" && c.suporte === "chat"));
    assert.equal((await pedir(local + "/comandos?agente=inventado")).status, 400);
    assert.equal((await pedir(local + "/sessoes/..%2fsegredo")).status, 400);
    assert.equal((await pedir(local + "/sessoes", { metodo: "POST", corpo: JSON.stringify({ agente: 12 }) })).status, 400);
    assert.equal((await pedir(local + "/sessoes/" + conversa.id + "/mensagens", { metodo: "POST", corpo: JSON.stringify({ texto: {} }) })).status, 400);
    assert.equal((await pedir(local + "/sessoes/" + conversa.id + "/configuracao", { metodo: "POST", corpo: JSON.stringify({ modelo: [] }) })).status, 400);
    assert.equal((await pedir(local + "/sessoes/" + conversa.id + "/configuracao", { metodo: "POST", corpo: "[]" })).status, 400);
    assert.equal((await pedir(local + "/sessoes", { metodo: "POST", corpo: "{quebrado" })).status, 400);
    for (const status of [400, 404, 409, 503]) {
      prototipo.enviar = async () => { throw new ErroChat("Recusa esperada", status); };
      assert.equal((await pedir(local + "/sessoes/" + conversa.id + "/mensagens", { metodo: "POST", corpo: JSON.stringify({ texto: "Olá" }) })).status, status);
    }
    if (ip) assert.equal((await pedir(`http://${ip}:${proxy.porta}${BASE}/sessoes`, { headers: { "x-anotador-chave": proxy.servidor.chave, "sec-fetch-site": "cross-site" } })).status, 403);
  } finally {
    for (const [nome, valor] of originais) prototipo[nome] = valor;
    await proxy.fechar(); await alvo.fechar(); await rm(fonteNova, { recursive: true, force: true });
  }
});
