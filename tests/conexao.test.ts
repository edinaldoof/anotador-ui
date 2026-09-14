// Página de conexão e API: servidor sem alvo, detecção, sondagem, conectar/desconectar, registro e agentes.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { comandoDaPonte, modelosDe } from "../lib/agentes.ts";
import { RegistroConexoes } from "../lib/conexoes.ts";
import { FAMILIAS, estadoDasFontes, pastaDasFontes } from "../lib/fontes.ts";
import { marcaDe } from "../lib/marcas.ts";
import { alvoPermitido, detectarFramework, detectarServidores, extrairTitulo, sondar } from "../lib/deteccao.ts";
import { BASE } from "../server.ts";
import { abrirWs, criarAlvoFalso, criarProxy, pedir, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

describe("deteccao", () => {
  test("alvoPermitido aceita a própria máquina e a rede local, recusa a internet", () => {
    for (const ok of ["http://localhost:3000", "http://127.0.0.1:3001", "http://[::1]:3000", "http://192.168.3.19:3001", "http://10.0.0.5", "http://172.20.0.2:8080", "http://app.local", "http://minha-maquina:3000", "https://dev.localhost"]) {
      assert.equal(alvoPermitido(new URL(ok)), null, ok);
    }
    for (const nao of ["http://example.com", "https://8.8.8.8", "http://172.32.0.1", "ftp://localhost"]) {
      assert.notEqual(alvoPermitido(new URL(nao)), null, nao);
    }
  });

  test("IPv6 público não passa como nome simples de máquina", () => {
    for (const local of ["http://[fc00::1]", "http://[fd12:3456::1]", "http://[fe80::1]"]) {
      assert.equal(alvoPermitido(new URL(local)), null, local);
    }
    for (const publico of ["http://[2606:4700:4700::1111]", "http://[2001:4860:4860::8888]", "http://[::ffff:8.8.8.8]"]) {
      assert.notEqual(alvoPermitido(new URL(publico)), null, publico);
    }
  });

  test("detectarFramework e extrairTitulo leem sinais do HTML e dos cabeçalhos", () => {
    assert.equal(detectarFramework(new Headers({ "x-powered-by": "Next.js" }), ""), "Next.js");
    assert.equal(detectarFramework(new Headers(), '<script type="module" src="/@vite/client"></script>'), "Vite");
    assert.equal(detectarFramework(new Headers(), '<div id="__nuxt"></div>'), "Nuxt");
    assert.equal(detectarFramework(new Headers(), "<p>oi</p>"), null);
    assert.equal(extrairTitulo("<html><head><title>\n  Portal  de teste </title></head></html>"), "Portal de teste");
    assert.equal(extrairTitulo("<html></html>"), null);
  });
});

describe("modelos e comando da ponte", () => {
  test("cada agente recebe modelo e nível de raciocínio do jeito que a sua CLI espera", () => {
    const claude = comandoDaPonte("claude", null, "oi", { modelo: "opus", esforco: "high" }) ?? [];
    assert.equal(claude[claude.indexOf("--model") + 1], "opus");
    assert.equal(claude[claude.indexOf("--effort") + 1], "high");
    assert.equal(claude[claude.length - 1], "oi", "a mensagem continua sendo o último argumento");

    const codex = comandoDaPonte("codex", null, "oi", { modelo: "gpt-6-astra", esforco: "high" }) ?? [];
    assert.deepEqual(codex.slice(0, 4), ["codex", "exec", "--sandbox", "workspace-write"]);
    assert.equal(codex[codex.indexOf("-m") + 1], "gpt-6-astra");
    assert.ok(codex.includes('model_reasoning_effort="high"'), `o esforço do Codex vai como override de config: ${codex.join(" ")}`);

    const retomada = comandoDaPonte("codex", "019f-abc", "oi", { modelo: "gpt-6-astra" }) ?? [];
    assert.ok(retomada.indexOf("-m") < retomada.indexOf("resume"), "as flags vêm antes do subcomando resume");
    assert.equal(retomada[retomada.indexOf("resume") + 1], "019f-abc");

    assert.deepEqual(comandoDaPonte("gemini", null, "oi", { modelo: "gemini-3" })?.slice(0, 3), ["gemini", "-m", "gemini-3"]);
    assert.deepEqual(comandoDaPonte("antigravity", null, "oi")?.slice(0, 3), ["agy", "--mode", "accept-edits"], "Antigravity usa o CLI agy, não o executável gráfico");
    const semEscolha = comandoDaPonte("claude", null, "oi") ?? [];
    assert.ok(!semEscolha.includes("--model") && !semEscolha.includes("--effort"), "sem escolha, nada é imposto");
  });

  test("o catálogo de modelos traz níveis de raciocínio e marca do provedor", () => {
    const claude = modelosDe("claude");
    assert.ok(claude.length >= 3);
    assert.ok(claude.every((m) => m.esforcos.includes("high")), "todo modelo do Claude aceita esforço alto");
    assert.equal(claude.filter((m) => m.padrao).length, 1, "exatamente um marcado como padrão");
    assert.ok(Array.isArray(modelosDe("antigravity")), "Antigravity usa o catálogo disponibilizado pelo CLI");
    assert.match(marcaDe("codex"), /^<svg/, "o Codex usa a marca da OpenAI");
    assert.equal(marcaDe("codex"), marcaDe("openai"));
    assert.notEqual(marcaDe("claude"), marcaDe("generico"));
  });
});

describe("fontes da Apple", () => {
  test("a pasta de destino segue a plataforma e o estado cobre as três famílias", async () => {
    const pasta = pastaDasFontes();
    if (process.platform === "darwin") assert.match(pasta, /Library\/Fonts$/);
    else assert.match(pasta, /apple-sf$/, "no Linux fica numa pasta própria, separada das fontes do usuário");

    const estado = await estadoDasFontes();
    assert.equal(estado.nativa, process.platform === "darwin", "só o macOS já traz a San Francisco");
    assert.equal(
      estado.instaladas.length + estado.faltando.length,
      FAMILIAS.length,
      "cada família conhecida está num dos dois lados"
    );
    for (const f of FAMILIAS) {
      assert.ok([...estado.instaladas, ...estado.faltando].includes(f.familia), `faltou classificar ${f.familia}`);
    }
    assert.deepEqual(
      FAMILIAS.filter((f) => f.padrao).map((f) => f.familia),
      ["SF Pro", "SF Mono"],
      "a SF Compact é só de relógio: não entra na instalação padrão"
    );
    if (estado.nativa) assert.deepEqual(estado.faltamFerramentas, [], "no macOS não se extrai nada");
  });
});

describe("registro de conexões", () => {
  test("gravações e remoções simultâneas preservam as conexões entre instâncias", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "anotador-conexoes-concorrente-"));
    try {
      const arquivo = join(pasta, "conexoes.json");
      const registros = [new RegistroConexoes(arquivo), new RegistroConexoes(arquivo)];
      const entrada = (i: number) => ({ alvo: `http://localhost:${3000 + i}`, nome: `projeto-${i}`, fonte: `/tmp/projeto-${i}`, agente: "Teste" });
      await Promise.all(Array.from({ length: 10 }, (_, i) => registros[i % 2]!.registrar(entrada(i))));
      assert.equal((await registros[0]!.listar()).length, 10);
      await Promise.all([
        registros[0]!.esquecer(entrada(0).alvo, entrada(0).fonte),
        registros[1]!.registrar(entrada(10)),
      ]);
      const lista = await registros[0]!.listar();
      assert.equal(lista.length, 10);
      assert.equal(lista.some((c) => c.nome === "projeto-0"), false);
      assert.equal(lista.some((c) => c.nome === "projeto-10"), true);
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });

  test("grava, reencontra pela pasta e mantém a mais recente primeiro", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "anotador-conexoes-"));
    try {
      const registro = new RegistroConexoes(join(pasta, "sub", "conexoes.json"));
      assert.deepEqual(await registro.listar(), []);
      await registro.registrar({ alvo: "http://localhost:3000", nome: "a", fonte: "/tmp/projeto-a", agente: "Claude", ponte: null });
      await new Promise((r) => setTimeout(r, 5));
      await registro.registrar({ alvo: "http://localhost:3001", nome: "b", fonte: "/tmp/projeto-b", agente: "Codex", ponte: { agente: "codex", sessao: null } });
      const lista = await registro.listar();
      assert.equal(lista.length, 2);
      assert.equal(lista[0]?.nome, "b", "a mais recente vem primeiro");
      assert.equal((await registro.procurarPorFonte("/tmp/projeto-a/"))?.alvo, "http://localhost:3000", "a pasta é comparada resolvida");
      await registro.registrar({ alvo: "http://localhost:3000", nome: "a2", fonte: "/tmp/projeto-a", agente: "Claude", ponte: null });
      assert.equal((await registro.listar()).length, 2, "mesma pasta e alvo atualiza em vez de duplicar");
      assert.equal((await registro.procurarPorFonte("/tmp/projeto-a"))?.nome, "a2");
      assert.match(await readFile(registro.arquivo, "utf8"), /"conexoes"/);
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });
});

describe("servidor sem alvo e página de conexão", () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let casa: string;
  const antesEnv = process.env["ANOTADOR_HOME"];

  before(async () => {
    casa = await mkdtemp(join(tmpdir(), "anotador-home-"));
    process.env["ANOTADOR_HOME"] = casa;
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { alvo: null, saida: null, registro: join(casa, "conexoes.json"), nome: "inicial" });
  });

  after(async () => {
    await proxy?.fechar();
    await alvo?.fechar();
    if (antesEnv === undefined) delete process.env["ANOTADOR_HOME"];
    else process.env["ANOTADOR_HOME"] = antesEnv;
    await rm(casa, { recursive: true, force: true });
  });

  test("sem alvo, navegação vai para a página de conexão e a API responde 503", async () => {
    const r = await pedir(proxy.origem + "/qualquer", { headers: { accept: "text/html" } });
    assert.equal(r.status, 302);
    assert.equal(r.headers["location"], BASE + "/");
    const api = await pedir(proxy.origem + "/api/dados", { headers: { accept: "application/json", "sec-fetch-dest": "empty" } });
    assert.equal(api.status, 503);
    const semBarra = await pedir(proxy.origem + BASE);
    assert.equal(semBarra.status, 302);
    assert.equal(semBarra.headers["location"], BASE + "/");
    const pagina = await pedir(proxy.origem + BASE + "/");
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers["content-type"] ?? "", /text\/html/);
    assert.match(pagina.corpo, /Conectar e abrir/);
    assert.match(pagina.corpo, /Agente que aplica as anotações/);
    assert.equal(pagina.headers["x-anotador"] !== undefined, true, "as respostas do anotador se identificam");
    const saude = JSON.parse((await pedir(proxy.origem + BASE + "/saude")).corpo) as { conectado: boolean; alvo: string | null; app: unknown; quemOuve: unknown[]; conexoes: unknown[] };
    assert.equal(saude.conectado, false);
    assert.equal(saude.alvo, null);
    assert.equal(saude.app, null);
    assert.deepEqual(saude.quemOuve, []);
  });

  test("detecção encontra o servidor de teste e ignora a própria porta", async () => {
    const r = JSON.parse((await pedir(`${proxy.origem}${BASE}/deteccao?portas=${alvo.porta},${proxy.porta},1`)).corpo) as { servidores: Array<{ porta: number; titulo: string | null; html: boolean }> };
    assert.deepEqual(
      r.servidores.map((s) => s.porta),
      [alvo.porta],
      "só o alvo falso: a própria porta é ignorada e a porta 1 está fechada"
    );
    assert.equal(r.servidores[0]?.titulo, "Página de teste");
    assert.equal(r.servidores[0]?.html, true);
    const direto = await detectarServidores([alvo.porta], { host: "127.0.0.1" });
    assert.equal(direto.length, 1);
  });

  test("sondar informa alcance, título e recusa hosts públicos", async () => {
    const ok = JSON.parse((await pedir(`${proxy.origem}${BASE}/sondar`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ alvo: alvo.origem }) })).corpo) as { ok: boolean; sondagem: { alcancavel: boolean; titulo: string | null; status: number } };
    assert.equal(ok.sondagem.alcancavel, true);
    assert.equal(ok.sondagem.status, 200);
    assert.equal(ok.sondagem.titulo, "Página de teste");
    const publico = await pedir(`${proxy.origem}${BASE}/sondar`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ alvo: "https://example.com" }) });
    assert.equal(publico.status, 400);
    const fechado = await sondar("http://127.0.0.1:1", 1500);
    assert.equal(fechado.alcancavel, false);
    assert.ok(fechado.erro);
  });

  test("conectar valida origem, alcance e alvo; depois disso o proxy injeta o overlay", async () => {
    const json = (corpo: unknown, headers: Record<string, string> = {}) => pedir(`${proxy.origem}${BASE}/conectar`, { metodo: "POST", headers: { "content-type": "application/json", ...headers }, corpo: JSON.stringify(corpo) });
    const ouvinte = await abrirWs(`ws://127.0.0.1:${proxy.porta}${BASE}/eventos?agente=Teste&sessao=abc123`);
    const ola = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(ola.tipo, "ola");
    assert.equal(ola.alvo, null);

    const estranho = await json({ alvo: alvo.origem }, { origin: "http://malicioso.example" });
    assert.equal(estranho.status, 403, "Origin de outro site não troca o alvo");
    const publico = await json({ alvo: "https://example.com" });
    assert.equal(publico.status, 400);
    const fechado = await json({ alvo: "http://127.0.0.1:1" });
    assert.equal(fechado.status, 409, "sem resposta no alvo: pede confirmação (forcar)");
    const proprio = await json({ alvo: proxy.origem });
    assert.equal(proprio.status, 400, "apontar para o próprio anotador é recusado");

    const ok = await json({ alvo: alvo.origem, nome: "conectado", fonte: process.cwd(), agente: "Codex" }, { origin: `http://127.0.0.1:${proxy.porta}` });
    assert.equal(ok.status, 200, ok.corpo);
    const saude = (JSON.parse(ok.corpo) as { saude: { conectado: boolean; alvo: string; nome: string; agente: string; saida: string; app: { alcancavel: boolean; titulo: string | null }; quemOuve: Array<{ agente: string | null; sessao: string | null }> } }).saude;
    assert.equal(saude.conectado, true);
    assert.equal(saude.alvo, alvo.origem);
    assert.equal(saude.nome, "conectado");
    assert.equal(saude.agente, "Codex");
    assert.ok(saude.saida.endsWith(join("conectado")), `a fila segue o nome do projeto: ${saude.saida}`);
    assert.ok(saude.saida.startsWith(casa), "e fica na pasta-base do anotador (ANOTADOR_HOME)");
    assert.equal(saude.app.alcancavel, true);
    assert.deepEqual(saude.quemOuve, [{ ...saude.quemOuve[0], agente: "Teste", sessao: "abc123" }], "o ouvinte se identificou pela query string");
    assert.equal(proxy.servidor.alvo, alvo.origem);
    assert.ok(proxy.servidor.fila.dir.endsWith("conectado"), "a instância do servidor expõe a fila nova");

    const evento = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evento.tipo, "conexao");
    assert.equal(evento.alvo, alvo.origem);
    ouvinte.fechar();

    const pagina = await pedir(proxy.origem + "/", { headers: { accept: "text/html" } });
    assert.equal(pagina.status, 200);
    assert.match(pagina.corpo, /__anotador\/overlay\.js/, "conectado: o HTML do app volta com o overlay injetado");
    const overlay = await pedir(proxy.origem + BASE + "/overlay.js");
    assert.match(overlay.corpo, /"agente":"Codex"/, "o overlay usa o rótulo do agente da conexão");

    const registro = JSON.parse(await readFile(join(casa, "conexoes.json"), "utf8")) as { conexoes: Array<{ alvo: string; nome: string; agente: string }> };
    assert.equal(registro.conexoes[0]?.alvo, alvo.origem);
    assert.equal(registro.conexoes[0]?.nome, "conectado");
  });

  test("agentes: lista os conhecidos, suas sessões e a ponte; ponte exige agente instalado", async () => {
    const r = JSON.parse((await pedir(`${proxy.origem}${BASE}/agentes`)).corpo) as { ok: boolean; agentes: Array<{ id: string; instalado: boolean; ponte: boolean }>; sessoes: Array<{ agente: string; id: string }>; ponte: unknown; execucoes: unknown[] };
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.agentes.map((a) => a.id),
      ["claude", "codex", "gemini", "opencode", "antigravity", "cursor"]
    );
    assert.ok(Array.isArray(r.sessoes));
    assert.equal(r.ponte, null);
    const ruim = await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: "cursor" }) });
    assert.equal(ruim.status, 400, "aplicativo sem CLI compatível não tem ponte por linha de comando");
    const antigravity = r.agentes.find((a) => a.id === "antigravity");
    const selecionar = await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: "antigravity" }) });
    assert.equal(selecionar.status, antigravity?.instalado && antigravity.ponte ? 200 : 400, "o Antigravity pode ser selecionado quando seu CLI está instalado");
    const desliga = await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: null }) });
    assert.equal(desliga.status, 200);
    if (r.agentes.some((a) => a.id === "claude" && a.instalado)) {
      const inventado = await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: "claude", modelo: "modelo-que-nao-existe", esforco: "turbo" }) });
      assert.equal(inventado.status, 200);
      const ponte = (JSON.parse(inventado.corpo) as { ponte: { modelo: string | null; esforco: string | null } }).ponte;
      assert.equal(ponte.modelo, null, "modelo desconhecido não entra na linha de comando");
      assert.equal(ponte.esforco, null);
      const sessaoAlheia = await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo:"POST",corpo:JSON.stringify({agente:"claude",sessao:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}) });
      assert.equal(sessaoAlheia.status,400,"a ponte também recusa sessão sem vínculo com agente e projeto");
      assert.match(JSON.parse(sessaoAlheia.corpo).erro,/não pertence ao agente e projeto/);
      assert.deepEqual(JSON.parse((await pedir(`${proxy.origem}${BASE}/agentes`)).corpo).ponte,ponte,"erro não substitui a ponte selecionada");
      await pedir(`${proxy.origem}${BASE}/agente/ponte`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: null }) });
    }
    const iniciarRuim = await pedir(`${proxy.origem}${BASE}/agente/iniciar`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ agente: "cursor" }) });
    assert.equal(iniciarRuim.status, 400);
    const log = await pedir(`${proxy.origem}${BASE}/agente/execucoes/nao-existe/log`);
    assert.equal(log.status, 404);
  });

  test("desconectar volta ao estado inicial e avisa os ouvintes", async () => {
    const ouvinte = await abrirWs(`ws://127.0.0.1:${proxy.porta}${BASE}/eventos`);
    await ouvinte.proximo();
    const r = await pedir(`${proxy.origem}${BASE}/desconectar`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: "{}" });
    assert.equal(r.status, 200);
    const evento = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evento.tipo, "conexao");
    assert.equal(evento.alvo, null);
    ouvinte.fechar();
    assert.equal(proxy.servidor.alvo, null);
    const nav = await pedir(proxy.origem + "/", { headers: { accept: "text/html" } });
    assert.equal(nav.status, 302);
  });
});
