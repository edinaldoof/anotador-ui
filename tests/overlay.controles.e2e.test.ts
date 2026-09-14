import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("escolhas personalizadas de propriedades", { skip: chrome ? false : "Chromium não encontrado", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  const sombra = 'document.getElementById("__anotador_host").shadowRoot';
  const noOverlay = (seletor: string) => `${sombra}.querySelector(${JSON.stringify(seletor)})`;
  const combo = (rotulo = "Alinhamento") => noOverlay(`.an-seletor-botao[aria-label="${rotulo}"]`);
  const popup = noOverlay(".an-seletor-popup");
  const clicar = async (expressao: string) => {
    const r = await pagina.avaliar<Rect>(`(() => { const r = (${expressao}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    assert.ok(r.width > 0 && r.height > 0, "controle precisa estar visível");
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };
  const abrir = async (rotulo = "Alinhamento") => {
    await pagina.avaliar(`${combo(rotulo)}.scrollIntoView({ block: "nearest" })`);
    await clicar(combo(rotulo));
    await pagina.esperarPor(`${popup}?.checkVisibility()`);
  };
  const alinhamento = () => pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).textAlign');

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
  });
  beforeEach(async () => {
    await pagina.definirViewport(1200, 800, 1);
    await pagina.avaliar("localStorage.clear(); sessionStorage.clear()");
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado");
    await clicar('document.querySelector("p.rotulo")');
    await pagina.esperarPor(noOverlay(".an-balao"));
    await clicar(noOverlay('.an-balao [title="Propriedades do elemento"]'));
    await pagina.esperarPor(`${sombra}.activeElement === ${noOverlay(".an-painel .cab textarea")}`);
  });
  after(async () => {
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("menu estilizado marca a escolha atual e aplica pelo clique, mantendo o cancelamento do painel", async () => {
    const antes = await alinhamento();
    await abrir();
    assert.deepEqual(await pagina.avaliar<string[]>(`Array.from(${popup}.querySelectorAll('[role="option"]')).map((el) => el.textContent)`), ["start", "left", "center", "right", "justify"]);
    assert.equal(await pagina.avaliar<string>(`${popup}.querySelector('[aria-selected="true"]').textContent`), antes);
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${popup}).backgroundColor`), "rgb(26, 30, 29)");
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${popup}).borderRadius`), "12px");
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(${popup}).pointerEvents`), "auto");
    await clicar(`Array.from(${popup}.children).find((el) => el.textContent === "center")`);
    assert.equal(await alinhamento(), "center");
    assert.equal(await pagina.avaliar<string>(`${combo()}.textContent`), "center");
    assert.equal(await pagina.avaliar<string>(`${combo()}.getAttribute("aria-expanded")`), "false");
    assert.equal(await pagina.avaliar<Anotacao>("window.__anotadorDebug.atual()").then((a) => a.alteracoes.find((alt) => alt.propriedade === "text-align")?.depois), "center");
    await pagina.pressionar("Escape");
    assert.equal(await alinhamento(), antes);
  });

  test("setas e Enter escolhem; Escape fecha só o popup e restaura o foco", async () => {
    await abrir();
    await pagina.pressionar("ArrowDown");
    assert.equal(await alinhamento(), "start", "percorrer opções ainda não altera a página");
    await pagina.pressionar("Enter");
    assert.equal(await alinhamento(), "left");
    await abrir();
    await pagina.pressionar("ArrowDown");
    await pagina.pressionar("Escape");
    assert.equal(await alinhamento(), "left");
    assert.equal(await pagina.avaliar<boolean>(`${noOverlay(".an-painel")}.checkVisibility()`), true);
    assert.equal(await pagina.avaliar<boolean>(`${sombra}.activeElement === ${combo()}`), true);
    assert.equal(await pagina.avaliar<boolean>(`${popup} === null`), true);
  });

  test("Home, End, busca por letra e Tab funcionam sem prender o foco", async () => {
    await abrir();
    await pagina.pressionar("End");
    await pagina.pressionar("Home");
    await pagina.pressionar("r");
    await pagina.pressionar("Tab");
    assert.equal(await alinhamento(), "right");
    assert.equal(await pagina.avaliar<boolean>(`${popup} === null`), true);
    assert.equal(await pagina.avaliar<boolean>(`${sombra}.activeElement !== ${combo()}`), true);
    await abrir("Peso da fonte");
    await pagina.pressionar("End");
    await pagina.pressionar("Enter");
    assert.equal(await pagina.avaliar<string>('getComputedStyle(document.querySelector("p.rotulo")).fontWeight'), "900");
  });

  test("clique fora fecha sem escolher e eventos change no select mantêm compatibilidade", async () => {
    await abrir();
    await pagina.pressionar("ArrowDown");
    await clicar(noOverlay(".an-painel .cab textarea"));
    assert.equal(await pagina.avaliar<boolean>(`${popup} === null`), true);
    assert.equal(await alinhamento(), "start");
    await pagina.avaliar(`(() => { const sel = ${combo()}.parentElement.querySelector("select"); sel.value = "justify"; sel.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    assert.equal(await alinhamento(), "justify");
    assert.equal(await pagina.avaliar<string>(`${combo()}.textContent`), "justify");
  });

  test("popup cabe na janela pequena e acompanha o scroll do painel", async () => {
    await pagina.definirViewport(480, 520, 1);
    await abrir();
    const dentroDaJanela = () => pagina.avaliar<boolean>(`(() => { const r = ${popup}.getBoundingClientRect(); return r.left >= 7 && r.top >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7; })()`);
    assert.equal(await dentroDaJanela(), true);
    const antes = await pagina.avaliar<number>(`${combo()}.getBoundingClientRect().top`);
    await pagina.avaliar(`${noOverlay(".an-painel .corpo")}.scrollTop -= 8`);
    await pagina.esperarPor(`${combo()}.getBoundingClientRect().top !== ${antes}`);
    await pagina.esperarPor(`(() => { const r = ${combo()}.getBoundingClientRect(); const p = ${popup}.getBoundingClientRect(); return Math.abs((${popup}.dataset.lado === "baixo" ? p.top - r.bottom : r.top - p.bottom) - 6) < 2; })()`);
    assert.equal(await dentroDaJanela(), true);
    const alinhado = await pagina.avaliar<boolean>(`(() => { const r = ${combo()}.getBoundingClientRect(); const p = ${popup}.getBoundingClientRect(); return Math.abs((${popup}.dataset.lado === "baixo" ? p.top - r.bottom : r.top - p.bottom) - 6) < 2; })()`);
    assert.equal(alinhado, true);
    await pagina.avaliar(`${noOverlay(".an-painel")}.hidden = true`);
    await pagina.esperarPor(`${popup} === null`);
  });

  for (const [largura, altura] of [[873, 746], [390, 844]] as const) {
    test(`barra e painel permanecem acessíveis em ${largura}×${altura}`, async () => {
      await pagina.definirViewport(largura, altura, 1);
      await pagina.avaliar(`${noOverlay(".an-estado")}.textContent = "Agente trabalhando: aplicando mudanças na página e preparando a próxima revisão"`);
      const geometria = await pagina.avaliar<{ barra: boolean; painel: boolean; semOverflow: boolean; controlesFora: string[] }>(`(() => {
        const barra = ${noOverlay(".an-barra")};
        const dentro = (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; };
        return {
          barra: dentro(barra), painel: dentro(${noOverlay(".an-painel")}),
          semOverflow: barra.scrollWidth <= barra.clientWidth,
          controlesFora: Array.from(barra.querySelectorAll("button, a")).filter((el) => el.checkVisibility() && !dentro(el)).map((el) => el.title || el.textContent)
        };
      })()`);
      assert.deepEqual(geometria, { barra: true, painel: true, semOverflow: true, controlesFora: [] });
    });
  }
});
