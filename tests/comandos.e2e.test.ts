// O menu de comandos de barra no chat do overlay.
//
// A lista vem do disco, então o teste monta um projeto com dois comandos e confere que
// eles aparecem, filtram e completam — e que, com o menu aberto, Enter escolhe em vez
// de mandar uma barra solta para o agente.
//
// A lista também traz o que a conta desta máquina tiver, que varia de quem roda a
// suíte; por isso as asserções perguntam pelos comandos do projeto em vez de exigir
// uma lista exata.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, esperarAte, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("comandos de barra no chat", { skip: chrome ? false : "Chromium não encontrado (defina ANOTADOR_CHROME)", timeout: 120_000 }, () => {
  let raiz: string;
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;

  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const todosNoOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelectorAll(${JSON.stringify(seletor)})`;
  const clicarEm = async (expressao: string) => {
    const r = await pagina.avaliar<{ left: number; top: number; width: number; height: number }>(
      `(() => { const r = (${expressao}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`
    );
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const itens = () => pagina.avaliar<string[]>(`Array.from(${todosNoOverlay(".an-comando .nome")}).map((e) => e.textContent)`);
  const menuAberto = () => pagina.avaliar<boolean>(`!${noOverlay(".an-comandos")}.hidden`);

  before(async () => {
    raiz = await mkdtemp(join(tmpdir(), "anotador-e2e-comandos-"));
    for (const [nome, descricao] of [
      ["publicar", "Sobe a versão e publica o pacote"],
      ["revisar", "Revisa o diff antes do commit"],
    ]) {
      const dir = join(raiz, ".claude", "skills", nome as string);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `---\nname: ${nome}\ndescription: ${descricao}\n---\n`);
    }

    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { fonte: raiz });
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.preparar();
    await pagina.definirViewport(1280, 900);
    await pagina.navegar(proxy.origem + "/", 30_000);
    await pagina.esperarPor("window.__anotadorCarregado", 15_000);

    // Uma anotação, um lote, e a conversa daquele lote aberta: é onde o campo vive.
    const alvoTexto = await pagina.avaliar<{ left: number; top: number; width: number; height: number }>(
      `(() => { const r = document.querySelector("h1, p").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`
    );
    await pagina.clicar(alvoTexto.left + 20, alvoTexto.top + alvoTexto.height / 2);
    await pagina.esperarPor(noOverlay(".an-balao"));
    await pagina.digitar("qualquer coisa");
    await clicarEm(noOverlay(".an-balao .an-ico"));
    await esperarAte(async () => pagina.avaliar<boolean>(`!${noOverlay(".an-painel")}.hidden`), 8000);
    await clicarEm(noOverlay(".an-painel .an-ok"));
    await esperarAte(async () => (await pagina.avaliar<unknown[]>("window.__anotadorDebug.pendentes()")).length === 1);
    await clicarEm(noOverlay(".an-enviar"));
    await esperarAte(async () => (await pagina.avaliar<Array<{ id: string }>>("window.__anotadorDebug.lotes()")).length > 0, 15_000);
    const lotes = await pagina.avaliar<Array<{ id: string }>>("window.__anotadorDebug.lotes()");
    await pagina.avaliar(`window.__anotadorDebug.abrirConversa(${JSON.stringify(lotes[0]?.id ?? "")})`);
    await esperarAte(async () => pagina.avaliar<boolean>(`!!${noOverlay(".an-conversa .entrada textarea")}`), 10_000);
  });

  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
    await rm(raiz, { recursive: true, force: true });
  });

  test("a barra abre a lista do projeto, e o espaço a fecha", async () => {
    await clicarEm(noOverlay(".an-conversa .entrada textarea"));
    await pagina.digitar("/");
    await esperarAte(async () => (await itens()).includes("/publicar"), 8000);
    const todos = await itens();
    assert.ok(todos.includes("/publicar") && todos.includes("/revisar"), `as duas skills do projeto aparecem: ${todos.join(", ")}`);

    await pagina.digitar("revis");
    await esperarAte(async () => (await itens()).length === 1, 5000);
    assert.deepEqual(await itens(), ["/revisar"], "o que se digita filtra a lista");

    await pagina.digitar(" ");
    await esperarAte(async () => !(await menuAberto()), 5000);
    assert.equal(await menuAberto(), false, "o primeiro espaço começa os argumentos e o menu sai da frente");

    await pagina.avaliar(`(() => { const c = ${noOverlay(".an-conversa .entrada textarea")}; c.value = ""; c.dispatchEvent(new Event("input")); })()`);
  });

  test("com o menu aberto, Enter completa o comando em vez de enviar", async () => {
    await clicarEm(noOverlay(".an-conversa .entrada textarea"));
    await pagina.digitar("/pub");
    await esperarAte(async () => (await itens()).length > 0, 8000);
    const antes = (await pagina.avaliar<{ mensagens: unknown[] } | null>("window.__anotadorDebug.conversa()"))?.mensagens.length ?? 0;

    await pagina.pressionar("Enter");
    await esperarAte(async () => (await pagina.avaliar<string>(`${noOverlay(".an-conversa .entrada textarea")}.value`)).startsWith("/publicar "), 5000);

    const depois = (await pagina.avaliar<{ mensagens: unknown[] } | null>("window.__anotadorDebug.conversa()"))?.mensagens.length ?? 0;
    assert.equal(depois, antes, "nada foi enviado: o Enter pertencia ao menu");
    assert.equal(await menuAberto(), false, "escolhido o comando, o menu fecha");

    await pagina.avaliar(`(() => { const c = ${noOverlay(".an-conversa .entrada textarea")}; c.value = ""; c.dispatchEvent(new Event("input")); })()`);
  });

  test("a descrição e a origem de cada comando aparecem na lista", async () => {
    await clicarEm(noOverlay(".an-conversa .entrada textarea"));
    await pagina.digitar("/");
    await esperarAte(async () => (await itens()).length > 0, 8000);
    const linhas = await pagina.avaliar<Array<{ nome: string; desc: string; origem: string }>>(
      `Array.from(${todosNoOverlay(".an-comando")}).map((e) => ({ nome: e.querySelector(".nome").textContent, desc: e.querySelector(".desc").textContent, origem: e.querySelector(".origem").textContent }))`
    );
    const publicar = linhas.find((l) => l.nome === "/publicar");
    assert.equal(publicar?.desc, "Sobe a versão e publica o pacote");
    assert.equal(publicar?.origem, "projeto");
    assert.deepEqual(pagina.erros, [], "nenhum erro de página com o menu em cena");
  });
});
