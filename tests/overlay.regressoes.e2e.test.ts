import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, esperarAte, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("regressões de edição e envio no overlay", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const pendentes = () => pagina.avaliar<Anotacao[]>("window.__anotadorDebug.pendentes()");
  const clicarElemento = async (seletor: string) => {
    const r = await pagina.avaliar<Rect>(`(() => { const r = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
    await pagina.esperarPor(noOverlay(".an-balao input"));
  };
  const comentar = async (seletor: string, comentario: string) => {
    await clicarElemento(seletor);
    await pagina.avaliar(`(() => { const campo = ${noOverlay(".an-balao input")}; campo.value = ${JSON.stringify(comentario)}; campo.dispatchEvent(new Event("input")); campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
  };
  const abrirPropriedades = async () => {
    await pagina.avaliar(`${noOverlay(".an-balao .an-ico")}.click()`);
    await pagina.esperarPor(`!${noOverlay(".an-painel")}.hidden`);
  };
  const alterarTexto = (texto: string) => pagina.avaliar(`(() => {
    const linha = Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((l) => l.querySelector("label").textContent === "Texto");
    const campo = linha.querySelector("input"); campo.value = ${JSON.stringify(texto)}; campo.dispatchEvent(new Event("input"));
  })()`);

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1200, 800, 1);
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });

  beforeEach(async () => {
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });

  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("envio lento preserva anotações novas e mantém o botão bloqueado", async () => {
    await comentar("#salvar", "Primeira anotação");
    await pagina.avaliar(`(() => {
      const original = window.fetch;
      window.enviosDeTeste = 0;
      window.fetch = async (...args) => {
        if (String(args[0]).endsWith("/lotes") && args[1]?.method === "POST") {
          window.enviosDeTeste++;
          await new Promise((resolve) => { window.liberarEnvioDeTeste = resolve; });
        }
        return original(...args);
      };
      ${noOverlay(".an-enviar")}.click();
    })()`);
    await pagina.esperarPor("window.enviosDeTeste === 1");
    await pagina.avaliar(`${noOverlay(".an-pin")}.click()`);
    assert.equal(await pagina.avaliar<Anotacao | null>("window.__anotadorDebug.atual()"), null, "a anotação em trânsito não pode ser alterada");
    await comentar("p.rotulo", "Criada durante o envio");
    const bloqueado = await pagina.avaliar<boolean>(`${noOverlay(".an-enviar")}.disabled`);
    await pagina.avaliar("window.liberarEnvioDeTeste()");
    await esperarAte(async () => (await pagina.avaliar<Anotacao[]>("window.__anotadorDebug.enviadas()")).length === 1);
    assert.equal((await pendentes()).length, 1, "a resposta só pode remover a anotação que foi enviada");
    assert.equal((await pendentes())[0]?.comentario, "Criada durante o envio");
    assert.equal(bloqueado, true, "atualizar a barra durante o envio não libera um segundo envio");
    assert.equal(await pagina.avaliar<boolean>(`${noOverlay(".an-enviar")}.disabled`), false, "a nova anotação pode ser enviada depois da resposta");
  });

  test("falha de envio preserva a fila e permite tentar novamente", async () => {
    await comentar("#salvar", "Tentar novamente");
    await pagina.avaliar(`(() => {
      const original = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).endsWith("/lotes") && args[1]?.method === "POST") {
          window.fetch = original;
          return Promise.resolve(new Response("indisponível", { status: 503 }));
        }
        return original(...args);
      };
      ${noOverlay(".an-enviar")}.click();
    })()`);
    await pagina.esperarPor(`${noOverlay(".an-estado")}.textContent.includes("Falha ao enviar")`);
    assert.equal((await pendentes()).length, 1);
    assert.equal(await pagina.avaliar<boolean>(`${noOverlay(".an-enviar")}.disabled`), false);
    await pagina.avaliar(`${noOverlay(".an-enviar")}.click()`);
    await esperarAte(async () => (await pendentes()).length === 0);
    assert.equal((await pagina.avaliar<Anotacao[]>("window.__anotadorDebug.enviadas()")).length, 1);
  });

  test("Escape recupera o texto quando o rascunho apagou todo o conteúdo", async () => {
    const original = await pagina.avaliar<string>('document.querySelector("p.rotulo").textContent');
    await clicarElemento("p.rotulo");
    await abrirPropriedades();
    await alterarTexto("");
    assert.equal(await pagina.avaliar<string>('document.querySelector("p.rotulo").textContent'), "");
    await pagina.pressionar("Escape");
    assert.equal(await pagina.avaliar<string>('document.querySelector("p.rotulo").textContent'), original);
    assert.deepEqual(await pendentes(), []);
  });

  test("editar novamente e excluir uma anotação de texto vazio restaura o original", async () => {
    const original = await pagina.avaliar<string>('document.querySelector("p.rotulo").textContent');
    await clicarElemento("p.rotulo");
    await abrirPropriedades();
    await alterarTexto("");
    await pagina.avaliar(`${noOverlay(".an-painel .an-ok")}.click()`);
    assert.equal((await pendentes())[0]?.texto?.depois, "");
    await pagina.avaliar(`${noOverlay(".an-pin")}.click()`);
    await abrirPropriedades();
    const habilitado = await pagina.avaliar<boolean>(`Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((l) => l.querySelector("label").textContent === "Texto").querySelector("input").disabled === false`);
    await pagina.avaliar(`${noOverlay('.an-balao [title="Excluir anotação"]')}.click()`);
    assert.equal(await pagina.avaliar<string>('document.querySelector("p.rotulo").textContent'), original);
    assert.equal(habilitado, true, "um elemento esvaziado continua aceitando edição de texto");
  });
});
