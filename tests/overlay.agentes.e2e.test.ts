import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("seleção de agente no overlay", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const botaoCodex = `Array.from(${noOverlay(".an-agentes")}.querySelectorAll("button")).find((el) => el.querySelector(".nome")?.textContent === "Codex CLI")`;
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect | null>(`(() => {
      const el = ${expressao};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);
    assert.ok(r && r.width > 0 && r.height > 0, "elemento precisa estar visível: " + expressao);
    // Clique real: element.click() não detecta menus que herdam pointer-events: none.
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const abrirMenu = async () => {
    await clicar(noOverlay(".an-agente-atual"));
    await pagina.esperarPor(`${noOverlay(".an-agentes")}?.checkVisibility()`);
    await pagina.esperarPor(botaoCodex);
  };

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1400, 900, 1);
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });

  beforeEach(async () => {
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
    await pagina.avaliar(`(() => {
      const original = window.fetch;
      window.consultasAgentesDeTeste = 0;
      window.trocasAgentesDeTeste = [];
      window.cliquesNaPaginaDeTeste = 0;
      document.addEventListener("click", (e) => {
        if (e.target !== document.getElementById("__anotador_host")) window.cliquesNaPaginaDeTeste++;
      });
      window.fetch = (...args) => {
        const caminho = new URL(String(args[0]), location.href).pathname;
        if (caminho.endsWith("/agentes")) {
          window.consultasAgentesDeTeste++;
          return Promise.resolve(Response.json({
            agentes: [
              {
                id: "claude", nome: "Claude Code", instalado: true, ponte: true, marca: "", como: "Claude Code",
                modelos: [
                  { valor: "modelo-padrao-teste", titulo: "Modelo padrão de teste", esforcos: ["low", "medium"], esforcoPadrao: "medium", padrao: true },
                  { valor: "modelo-avancado-teste", titulo: "Modelo avançado de teste", esforcos: ["high", "max"], esforcoPadrao: "high" }
                ]
              },
              { id: "codex", nome: "Codex CLI", instalado: true, ponte: true, marca: "", como: "Codex CLI" },
              { id: "gemini", nome: "Gemini CLI", instalado: false, ponte: true, marca: "", como: "Gemini CLI" }
            ],
            ponte: null,
            ouvintes: [{ agente: "claude", rotulo: "Claude Code" }]
          }));
        }
        if (caminho.endsWith("/agente/ponte")) {
          window.trocasAgentesDeTeste.push({ metodo: args[1]?.method, corpo: JSON.parse(args[1]?.body ?? "null") });
          return Promise.resolve(Response.json({ ok: true }));
        }
        return original(...args);
      };
    })()`);
  });

  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("primeiro clique abre o menu e consulta a lista de agentes", async () => {
    await abrirMenu();
    assert.equal(await pagina.avaliar<number>("window.consultasAgentesDeTeste"), 1);
    assert.equal(await pagina.avaliar<boolean>(`(${botaoCodex}).disabled`), false);
    assert.deepEqual(await pagina.avaliar("window.trocasAgentesDeTeste"), []);
  });

  for (const modo of ["Selecionar", "Navegar"] as const) {
    test(`clique em Codex troca o agente sem atingir a página no modo ${modo}`, async () => {
      await clicar(noOverlay(modo === "Selecionar" ? ".an-modo button:first-child" : ".an-modo button:last-child"));
      assert.equal(await pagina.avaliar<boolean>("window.__anotadorDebug.armado()"), modo === "Selecionar");
      await abrirMenu();
      await clicar(botaoCodex);
      await pagina.esperarPor("window.trocasAgentesDeTeste.length === 1");
      await pagina.esperarPor(`${noOverlay(".an-agentes")}.hidden`);
      assert.deepEqual(await pagina.avaliar("window.trocasAgentesDeTeste"), [{ metodo: "POST", corpo: { agente: "codex", modelo: null, esforco: null } }]);
      assert.equal(await pagina.avaliar<number>("window.cliquesNaPaginaDeTeste"), 0, "a página não recebe os cliques do menu");
      assert.equal(await pagina.avaliar<Anotacao | null>("window.__anotadorDebug.atual()"), null, "escolher agente não inicia uma anotação por baixo do menu");
      assert.deepEqual(await pagina.avaliar<Anotacao[]>("window.__anotadorDebug.pendentes()"), []);
    });
  }

  test("Claude ao vivo permite escolher modelo e raciocínio antes de aplicar", async () => {
    await abrirMenu();
    const botaoClaude = `Array.from(${noOverlay(".an-agentes")}.querySelectorAll("button")).find((el) => el.querySelector(".nome")?.textContent === "Claude Code")`;
    await clicar(botaoClaude);
    await pagina.esperarPor(`${noOverlay('.an-agentes [role="combobox"][aria-label="Modelo"]')}?.checkVisibility()`);
    assert.deepEqual(await pagina.avaliar("window.trocasAgentesDeTeste"), [], "abrir a escolha de modelo não deve trocar o agente");

    await clicar(noOverlay('.an-agentes [role="combobox"][aria-label="Modelo"]'));
    await clicar(`Array.from(${noOverlay('.an-seletor-popup')}.querySelectorAll('[role="option"]')).find(el => el.textContent === "Modelo avançado de teste")`);
    assert.deepEqual(
      await pagina.avaliar<string[]>(`Array.from(${noOverlay(".an-esforco-select")}.options).map((opcao) => opcao.value)`),
      ["high", "max"],
      "os níveis de raciocínio acompanham o modelo escolhido"
    );
    await clicar(noOverlay('.an-agentes [role="combobox"][aria-label="Raciocínio"]'));
    await clicar(`Array.from(${noOverlay('.an-seletor-popup')}.querySelectorAll('[role="option"]')).find(el => el.textContent === "Máximo")`);
    await clicar(noOverlay(".an-modelo-aplicar"));
    await pagina.esperarPor("window.trocasAgentesDeTeste.length === 1");
    await pagina.esperarPor(`${noOverlay(".an-agentes")}.hidden`);
    assert.deepEqual(await pagina.avaliar("window.trocasAgentesDeTeste"), [
      { metodo: "POST", corpo: { agente: "claude", modelo: "modelo-avancado-teste", esforco: "max" } },
    ]);
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-agente-atual")}.title`), /Claude Code · Modelo avançado de teste · max/);
    assert.equal(await pagina.avaliar<number>("window.cliquesNaPaginaDeTeste"), 0);
    assert.equal(await pagina.avaliar<Anotacao | null>("window.__anotadorDebug.atual()"), null);
    assert.deepEqual(await pagina.avaliar<Anotacao[]>("window.__anotadorDebug.pendentes()"), []);
  });
});
