// Ponta a ponta no Chromium headless: o overlay montando sob CSP estrita,
// selecionando, alterando, persistindo, enviando e recebendo o retorno.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MODIFICADORES, Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { BASE } from "../server.ts";
import { abrirWs, criarAlvoFalso, criarProxy, esperarAte, pedir, type AlvoFalso, type ClienteWs, type ProxySobTeste } from "./ajuda.ts";

const chrome = encontrarChromium();

describe("overlay no Chromium", { skip: chrome ? false : "Chromium não encontrado (defina ANOTADOR_CHROME)", timeout: 120_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;
  let navegador: Navegador;
  let pagina: Pagina;
  let ouvinte: ClienteWs;
  let posicaoPainel: Rect | null = null;

  const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;
  const rectDe = async (expressao: string): Promise<Rect> => {
    const r = await pagina.avaliar<Rect | null>(`(() => { const el = ${expressao}; if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    assert.ok(r, "elemento não encontrado: " + expressao);
    return r;
  };
  const clicarEm = async (expressao: string, opcoes: { alt?: boolean } = {}) => {
    const r = await rectDe(expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2, opcoes);
  };
  const debug = <T>(chamada: string) => pagina.avaliar<T>(`window.__anotadorDebug.${chamada}`);
  const perto = (a: number, b: number) => Math.abs(a - b) <= 3;
  const visivel = (seletor: string) => pagina.avaliar<boolean>(`(() => { const el = ${noOverlay(seletor)}; return !!el && el.checkVisibility(); })()`);

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo);
    ouvinte = await abrirWs(`ws://127.0.0.1:${proxy.porta}${BASE}/eventos`);
    await ouvinte.proximo();
    navegador = await Navegador.abrir({ caminho: chrome });
    pagina = await navegador.novaPagina();
    await pagina.definirViewport(1200, 800, 1);
  });

  after(async () => {
    ouvinte?.fechar();
    await navegador?.fechar();
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("monta sob CSP estrita sem violar nada e sem atrapalhar a página", async () => {
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    assert.equal(await pagina.avaliar<boolean>("window.hidratado"), true, "o script com nonce da própria página continua rodando");
    assert.deepEqual(pagina.erros, [], "sem violações de CSP nem exceções");
    assert.equal(await visivel(".an-barra"), true);
    assert.equal(await debug<boolean>("armado()"), true);
  });

  test("hover destaca com snap para o interativo; Alt pega o elemento exato", async () => {
    const span = await rectDe('document.querySelector("#salvar span")');
    await pagina.mover(span.left + 4, span.top + 4);
    await pagina.esperarPor(`${noOverlay(".an-caixa")}.style.display === "block"`);
    const dica = await pagina.avaliar<string>(`${noOverlay(".an-dica")}.textContent`);
    assert.match(dica, /^button#salvar "Salvar"/, "snap sobe do span para o botão");
    await pagina.mover(span.left + 4, span.top + 4, 1);
    await esperarAte(async () => /\(exato\)/.test(await pagina.avaliar<string>(`${noOverlay(".an-dica")}.textContent`)));
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-dica")}.textContent`), /^span "Salvar"/);
  });

  test("tipografia: fonte da Apple primeiro sem herdar a fonte do site", async () => {
    const fonte = await pagina.avaliar<string>(`getComputedStyle(${noOverlay(".an-barra")}).fontFamily`);
    assert.match(fonte, /^-apple-system/, "a fonte da Apple vem primeiro, para valer em iPhone, iPad e Mac");
    assert.doesNotMatch(fonte, /Filson/, "a fonte do site não altera a interface do anotador");
    assert.match(fonte, /system-ui/, "sem San Francisco, usa a fonte do sistema");
    const mono = await pagina.avaliar<string>(`getComputedStyle(${noOverlay(".an-dica")}).fontFamily`);
    assert.match(mono, /monospace/);
  });

  test("barra e painel podem ser arrastados e lembram a posição", async () => {
    const centro = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const alca = await rectDe(noOverlay(".an-barra .an-alca"));
    const barraAntes = await rectDe(noOverlay(".an-barra"));
    const origem = centro(alca);
    await pagina.arrastar(origem, { x: origem.x + 200, y: origem.y + 480 });
    const barraDepois = await rectDe(noOverlay(".an-barra"));
    const larguraViewport = await pagina.avaliar<number>("innerWidth");
    const esquerdaEsperada = Math.min(barraAntes.left + 200, larguraViewport - barraAntes.width - 8);
    assert.ok(perto(barraDepois.left, esquerdaEsperada) && perto(barraDepois.top, barraAntes.top + 480), `barra deveria ir para (${esquerdaEsperada}, ${barraAntes.top + 480}), limitada ao viewport; foi para (${barraDepois.left}, ${barraDepois.top})`);
    assert.equal(await debug<boolean>("armado()"), true, "arrastar não muda o modo");

    await clicarEm('document.querySelector("p.rotulo")');
    await pagina.esperarPor(noOverlay(".an-balao"));
    await clicarEm(noOverlay(".an-balao .an-ico"));
    await esperarAte(() => visivel(".an-painel"));
    const alcaPainel = await rectDe(noOverlay(".an-painel .an-alca"));
    const painelAntes = await rectDe(noOverlay(".an-painel"));
    const origemPainel = centro(alcaPainel);
    await pagina.arrastar(origemPainel, { x: origemPainel.x - 300, y: origemPainel.y + 90 });
    const painelDepois = await rectDe(noOverlay(".an-painel"));
    const alturaViewport = await pagina.avaliar<number>("innerHeight");
    const esperadoTop = Math.min(painelAntes.top + 90, alturaViewport - painelAntes.height - 8);
    assert.ok(perto(painelDepois.left, painelAntes.left - 300) && perto(painelDepois.top, esperadoTop), `painel deveria ir para (${painelAntes.left - 300}, ${esperadoTop}) — limitado ao viewport; foi de (${painelAntes.left}, ${painelAntes.top}) para (${painelDepois.left}, ${painelDepois.top})`);
    posicaoPainel = painelDepois;
    await pagina.pressionar("Escape");
    await esperarAte(async () => !(await visivel(".an-painel")));
    assert.equal((await debug<Anotacao[]>("pendentes()")).length, 0, "Escape descarta o rascunho usado só para abrir o painel");

    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    const barraRecarregada = await rectDe(noOverlay(".an-barra"));
    assert.ok(perto(barraRecarregada.left, barraDepois.left) && perto(barraRecarregada.top, barraDepois.top), "a barra reabre onde foi deixada");
  });

  test("clique cria a anotação, bloqueia a ação da página e aceita comentário por Enter", async () => {
    await pagina.avaliar(`window.cliquesNoBotao = 0; document.getElementById("salvar").addEventListener("click", () => window.cliquesNoBotao++)`);
    await clicarEm('document.querySelector("#salvar span")');
    await pagina.esperarPor(noOverlay(".an-balao"));
    await pagina.esperarPor(`document.getElementById("__anotador_host").shadowRoot.activeElement === ${noOverlay(".an-balao input")}`);
    assert.equal(await pagina.avaliar<number>("window.cliquesNoBotao"), 0, "o handler do app não recebe o clique em modo Selecionar");
    const atual = await debug<Anotacao | null>("atual()");
    assert.ok(atual);
    assert.equal(atual.elemento.meta.tag, "button");
    assert.deepEqual(atual.elemento.seletores[0], { tipo: "id", valor: "#salvar", unico: true, pontos: 95 });
    assert.equal(atual.elemento.interno?.meta.tag, "span", "guarda também o elemento exato clicado");
    await pagina.digitar("Deixar o botão verde");
    await pagina.pressionar("Enter");
    await esperarAte(async () => (await debug<Anotacao[]>("pendentes()")).length === 1);
    const pendentes = await debug<Anotacao[]>("pendentes()");
    assert.equal(pendentes[0]?.comentario, "Deixar o botão verde");
    assert.equal(await visivel(".an-balao"), false);
    assert.equal(await pagina.avaliar<string>(`${noOverlay(".an-enviar .n")}.textContent`), "1");
  });

  test("painel altera propriedade ao vivo e registra antes/depois", async () => {
    await clicarEm(noOverlay(".an-pin"));
    await pagina.esperarPor(noOverlay(".an-balao"));
    await clicarEm(noOverlay(".an-balao .an-ico"));
    await esperarAte(() => visivel(".an-painel"));
    if (posicaoPainel) {
      const agora = await rectDe(noOverlay(".an-painel"));
      assert.ok(Math.abs(agora.left - posicaoPainel.left) <= 3 && Math.abs(agora.top - posicaoPainel.top) <= 3, "o painel reabre onde foi deixado, mesmo após reload");
    }
    assert.equal(await pagina.avaliar<string>(`${noOverlay(".an-painel .sub .tag")}.textContent`), "button");
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-seletor code")}.textContent`), /^#salvar$/);
    const campoFundo = `Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((l) => l.querySelector("label").textContent.startsWith("Fundo")).querySelector("input[type=text]")`;
    await clicarEm(campoFundo);
    await pagina.avaliar(`${campoFundo}.select()`);
    await pagina.digitar("rgb(0, 128, 0)");
    await pagina.pressionar("Tab");
    await esperarAte(async () => (await pagina.avaliar<string>(`getComputedStyle(document.getElementById("salvar")).backgroundColor`)) === "rgb(0, 128, 0)");
    const atual = await debug<Anotacao | null>("atual()");
    assert.deepEqual(atual?.alteracoes, [{ propriedade: "background-color", antes: "rgb(37, 99, 235)", depois: "rgb(0, 128, 0)" }]);
    const quatro = await pagina.avaliar<Array<{ largura: number; campos: number[] }>>(`Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha.larga")).map((l) => ({ largura: Math.round(l.getBoundingClientRect().width), campos: Array.from(l.querySelectorAll(".an-campo")).map((c) => Math.round(c.getBoundingClientRect().width)) }))`);
    assert.equal(quatro.length, 2, "Preenchimento e Margem");
    for (const linha of quatro) {
      assert.equal(linha.campos.length, 4);
      const soma = linha.campos.reduce((s, c) => s + c, 0);
      assert.ok(soma < linha.largura, `os quatro campos (${linha.campos.join("+")}=${soma}px) precisam caber na linha de ${linha.largura}px`);
      assert.ok(linha.campos.every((c) => c >= 40), `campo estreito demais para digitar: ${linha.campos.join(", ")}`);
    }
    await clicarEm(noOverlay(".an-painel .an-ok"));
    await esperarAte(async () => !(await visivel(".an-painel")));
    const pendentes = await debug<Anotacao[]>("pendentes()");
    assert.equal(pendentes[0]?.alteracoes.length, 1);
  });

  test("fila e prévia sobrevivem a um reload da página", async () => {
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    const pendentes = await debug<Anotacao[]>("pendentes()");
    assert.equal(pendentes.length, 1);
    assert.equal(await pagina.avaliar<string>(`getComputedStyle(document.getElementById("salvar")).backgroundColor`), "rgb(0, 128, 0)", "alteração reaplicada");
    assert.equal(await pagina.avaliar<number>(`${noOverlay("div")}.querySelectorAll(".an-pin").length`), 1);
  });

  test("botão de reabrir: fonte padronizada, contador, arrasto pelo corpo e posição lembrada", async () => {
    await clicarEm(noOverlay('.an-barra .an-ico[title^="Ocultar"]'));
    await esperarAte(() => visivel(".an-religar"));
    assert.equal(await visivel(".an-barra"), false);
    assert.doesNotMatch(await pagina.avaliar<string>(`getComputedStyle(${noOverlay(".an-religar")}).fontFamily`), /Filson/, "fora do .an-raiz também mantém a fonte padronizada");
    assert.equal(await pagina.avaliar<string>(`${noOverlay(".an-religar .n")}.textContent`), "1", "contador mostra a anotação pendente");
    const antes = await rectDe(noOverlay(".an-religar"));
    const centro = { x: antes.left + antes.width / 2, y: antes.top + antes.height / 2 };
    await pagina.arrastar(centro, { x: centro.x - 240, y: centro.y - 160 });
    const depois = await rectDe(noOverlay(".an-religar"));
    assert.ok(perto(depois.left, antes.left - 240) && perto(depois.top, antes.top - 160), `deveria ter deslocado (-240, -160); foi de (${antes.left}, ${antes.top}) para (${depois.left}, ${depois.top})`);
    assert.equal(await visivel(".an-barra"), false, "arrastar não reabre o anotador");
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    await esperarAte(() => visivel(".an-religar"));
    const recarregado = await rectDe(noOverlay(".an-religar"));
    assert.ok(perto(recarregado.left, depois.left) && perto(recarregado.top, depois.top), "reaparece oculto e onde foi deixado");
    await clicarEm(noOverlay(".an-religar .rotulo"));
    await esperarAte(() => visivel(".an-barra"));
    assert.equal(await pagina.avaliar<boolean>(`!${noOverlay(".an-religar")}`), true, "clique sem mover reabre e remove o botão");
    assert.equal((await debug<Anotacao[]>("pendentes()")).length, 1);
  });

  test("Enviar grava o lote, avisa o chat e o retorno fecha o ciclo na barra", async () => {
    await clicarEm(noOverlay(".an-enviar"));
    const evento = JSON.parse(await ouvinte.proximo(15_000)) as EventoAnotador;
    assert.equal(evento.tipo, "lote");
    assert.equal(evento.quantidade, 1);
    assert.match(evento.resumo ?? "", /"Deixar o botão verde" em button/);
    const lotes = await proxy.servidor.fila.listar();
    assert.equal(lotes.length, 1);
    const md = await proxy.servidor.fila.lerMarkdown(evento.id ?? "");
    assert.match(md ?? "", /## Anotação 1 — Deixar o botão verde/);
    assert.match(md ?? "", /\| `background-color` \| `rgb\(37, 99, 235\)` \| `rgb\(0, 128, 0\)` \|/);
    assert.match(md ?? "", /Elemento exato clicado: `<span>` "Salvar"/);
    assert.match(md ?? "", /### Onde está no código[\s\S]*`pagina\.html:\d+` — id/, "o botão da fixture é localizado pelo id no código-fonte");
    assert.match(md ?? "", /\| `background-color` \| `rgb\(37, 99, 235\)` \| `rgb\(0, 128, 0\)` \| — \| `bg-\[#008000\]` — sem token equivalente/, "sem token no projeto, a sugestão é arbitrária e avisa");
    assert.match(md ?? "", /HTML do elemento na seleção[\s\S]*<button id="salvar" class="botao"><span>Salvar<\/span><\/button>/);
    await esperarAte(async () => (await debug<Anotacao[]>("pendentes()")).length === 0, 8_000, 100, "fila local esvaziar após o envio");
    assert.equal((await debug<Anotacao[]>("enviadas()")).length, 1);
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`), /Aguardando/);

    const progresso = await pedir(`${proxy.origem}${BASE}/lotes/${evento.id}/progresso`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ nota: "aplicando em pagina.html" }) });
    assert.equal(progresso.status, 200);
    assert.equal((JSON.parse(await ouvinte.proximo()) as EventoAnotador).tipo, "progresso", "o progresso também vira evento para o chat");
    const evPasso = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evPasso.mensagem?.tipo, "passo", "e entra na conversa como passo da linha do tempo");
    await esperarAte(async () => /Em andamento/.test(await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`)), 12_000, 500);
    await clicarEm(noOverlay('.an-barra .an-ico[title^="Ver fila"]'));
    await esperarAte(() => visivel(".an-fila"), 8_000, 100, "lista de lotes abrir pelo ícone da barra");
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-fila .item.lote")}.textContent`), /Claude trabalhando[\s\S]*aplicando em pagina\.html/, "a lista de lotes mostra estado e nota");
    await pagina.pressionar("Escape");

    const escolha = await pedir(`${proxy.origem}${BASE}/lotes/${evento.id}/mensagens`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ autor: "agente", tipo: "escolha", texto: "Verde em todos os botões primários ou só neste?", opcoes: ["Em todos", "Só neste"] }) });
    assert.equal(escolha.status, 201);
    const evEscolha = JSON.parse(await ouvinte.proximo()) as EventoAnotador;
    assert.equal(evEscolha.mensagem?.tipo, "escolha");
    assert.equal(evEscolha.mensagem?.autor, "agente");
    await esperarAte(async () => /Responder/.test(await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`)), 12_000, 500, "barra mostrar 'Claude perguntou'");
    await esperarAte(() => visivel(".an-conversa"), 5_000, 100, "painel de conversa abrir sozinho");
    await esperarAte(async () => /Verde em todos os botões primários/.test(await pagina.avaliar<string>(`(${noOverlay(".an-conversa .fluxo")} || {}).textContent || ""`)), 5_000, 100, "pergunta aparecer no fluxo");
    const opcoes = await pagina.avaliar<string[]>(`Array.from(${noOverlay(".an-conversa")}.querySelectorAll(".an-opcao")).map((b) => b.textContent)`);
    assert.deepEqual(opcoes, ["Em todos", "Só neste", "Outro…"]);
    await clicarEm(`${noOverlay(".an-conversa")}.querySelectorAll(".an-opcao")[0]`);
    const evResposta = JSON.parse(await ouvinte.proximo(10_000)) as EventoAnotador;
    assert.equal(evResposta.tipo, "mensagem");
    assert.equal(evResposta.mensagem?.autor, "usuario");
    assert.deepEqual(evResposta.mensagem?.opcoes, ["Em todos"]);
    await esperarAte(async () => /Você respondeu: Em todos/.test(await pagina.avaliar<string>(`${noOverlay(".an-conversa .fluxo")}.textContent`)), 8_000, 100, "fluxo registrar a resposta");
    await esperarAte(async () => !/Responder/.test(await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`)), 12_000, 500, "barra sair de 'Claude perguntou'");
    await clicarEm(noOverlay(".an-conversa .entrada textarea"));
    await pagina.digitar("E mantém o texto branco");
    await pagina.pressionar("Enter");
    const evRecado = JSON.parse(await ouvinte.proximo(10_000)) as EventoAnotador;
    assert.equal(evRecado.mensagem?.texto, "E mantém o texto branco");
    assert.equal(evRecado.mensagem?.responde, undefined, "recado livre não responde a pergunta nenhuma");
    // O painel é ancorado embaixo e cresce para cima ao receber a mensagem: esperar o re-render antes de mirar no botão.
    await esperarAte(async () => /E mantém o texto branco/.test(await pagina.avaliar<string>(`${noOverlay(".an-conversa .fluxo")}.textContent`)), 8_000, 100, "recado aparecer no fluxo");
    await clicarEm(`${noOverlay(".an-conversa .cab .an-ico[title='Fechar']")}`);
    await esperarAte(async () => !(await visivel(".an-conversa")), 8_000, 100, "painel de conversa fechar");

    const marcado = await pedir(`${proxy.origem}${BASE}/lotes/${evento.id}/processado`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: JSON.stringify({ nota: "botão verde aplicado" }) });
    assert.equal(marcado.status, 200);
    await esperarAte(async () => (await debug<Array<{ estado: string }>>("lotes()"))[0]?.estado === "processado", 15_000, 500, "lote local virar processado");
    assert.match(await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`), /Concluído/);
    assert.deepEqual(pagina.erros, [], "nenhum erro de página durante o fluxo inteiro");
  });

  test("árvore de elementos: segue o cursor, mostra os níveis e troca a seleção sem perder o comentário", async () => {
    const corpo = noOverlay(".an-arvore .corpo");
    const linhaDe = (nome: string) => `Array.from(${corpo}.querySelectorAll(".an-no")).find((n) => n.querySelector(".nome").textContent === ${JSON.stringify(nome)})`;
    const arvore = () => debug<ResumoArvore>("arvore()");

    await clicarEm(noOverlay('.an-barra .an-ico[title^="Estrutura"]'));
    await esperarAte(() => visivel(".an-arvore"), 5_000, 100, "painel da árvore abrir pelo botão da barra");
    const span = await rectDe('document.querySelector("#salvar span")');
    await pagina.mover(span.left + 4, span.top + 4);
    await esperarAte(async () => /^button#salvar/.test((await arvore()).foco ?? ""), 5_000, 100, "árvore seguir o cursor até o botão");
    let resumo = await arvore();
    assert.ok(resumo.linhas.includes("● button#salvar.botao"), `foco no botão: ${JSON.stringify(resumo.linhas)}`);
    assert.ok(resumo.linhas.includes('  span "Salvar"'), "filhos do foco aparecem abertos");
    assert.ok(resumo.linhas.some((l) => /\+2 irmãos/.test(l)), "irmãos fora do caminho ficam resumidos");
    assert.ok(!resumo.linhas.some((l) => /h2/.test(l)), "o que está em outro ramo não aparece");

    await clicarEm('document.querySelector("p.rotulo")');
    await pagina.esperarPor(noOverlay(".an-balao"));
    await pagina.digitar("Título maior");
    await esperarAte(async () => (await arvore()).linhas.includes('● p.rotulo "Acesso institucional"'), 5_000, 100, "a seleção passa a mandar na árvore");
    await pagina.mover(span.left + 4, span.top + 4);
    await pagina.esperar(300);
    assert.ok((await arvore()).linhas.includes('● p.rotulo "Acesso institucional"'), "com seleção, o cursor não muda o foco da árvore");

    await clicarEm(`Array.from(${corpo}.children).find((n) => n.classList.contains("an-mais") && /\\+2 irmãos/.test(n.textContent))`);
    await esperarAte(async () => (await arvore()).linhas.includes("  section.cartao"), 5_000, 100, "irmãos revelados");
    await clicarEm(`${linhaDe("section.cartao")}.querySelector(".seta")`);
    await esperarAte(async () => (await arvore()).linhas.includes('  h2 "Colaborador"'), 5_000, 100, "seção expandida");
    await clicarEm(`${linhaDe("h2")}.querySelector(".nome")`);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.tag === "h2", 5_000, 100, "clique na linha troca a seleção para o h2");
    const atual = await debug<Anotacao | null>("atual()");
    assert.equal(atual?.comentario, "Título maior", "o comentário digitado sobrevive à troca de alvo");
    const h2 = await rectDe('document.querySelector("section h2")');
    const caixa = await rectDe(noOverlay(".an-caixa.selecao"));
    assert.ok(perto(caixa.left, h2.left) && perto(caixa.top, h2.top) && perto(caixa.width, h2.width), "a caixa de seleção envolve o h2");
    resumo = await arvore();
    assert.ok(resumo.linhas.includes('● h2 "Colaborador"'), `foco acompanha a seleção: ${JSON.stringify(resumo.linhas)}`);

    await pagina.pressionar("ArrowUp", MODIFICADORES.alt);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.tag === "section", 5_000, 100, "Alt+↑ sobe para o pai");
    await pagina.pressionar("ArrowDown", MODIFICADORES.alt);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.tag === "h2", 5_000, 100, "Alt+↓ desce para o primeiro filho");
    await pagina.pressionar("ArrowRight", MODIFICADORES.alt);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.attrs["class"] === "descricao", 5_000, 100, "Alt+→ vai ao irmão seguinte");
    await pagina.pressionar("ArrowLeft", MODIFICADORES.alt);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.tag === "h2", 5_000, 100, "Alt+← volta ao irmão anterior");
    assert.equal((await debug<Anotacao | null>("atual()"))?.comentario, "Título maior", "o comentário segue o rascunho pelos atalhos");

    await pagina.pressionar("Escape");
    await esperarAte(async () => (await debug<Anotacao | null>("atual()")) === null);
    assert.equal((await debug<Anotacao[]>("pendentes()")).length, 0, "nada entrou na fila");
    await clicarEm(noOverlay('.an-arvore .cab .an-ico[title^="Fechar"]'));
    await esperarAte(async () => !(await visivel(".an-arvore")));
  });

  test("arrastar na página lista os elementos e inicia uma anotação da área exata", async () => {
    const corpo = noOverlay(".an-arvore .corpo");
    const arvore = () => debug<ResumoArvore>("arvore()");
    const secao = await rectDe('document.querySelector("section.cartao")');
    await pagina.arrastar({ x: secao.left + secao.width + 6, y: secao.top - 6 }, { x: secao.left - 6, y: secao.top + secao.height + 6 }, 12);
    await esperarAte(async () => !!(await arvore()).area, 5_000, 100, "área registrada");
    assert.equal(await visivel(".an-arvore"), false, "a área permanece visível sem abrir a árvore por cima");
    await clicarEm(noOverlay('.an-barra [title^="Estrutura de elementos"]'));
    await esperarAte(() => visivel(".an-arvore"), 5_000, 100, "a árvore continua disponível pelo botão");
    const resumo = await arvore();
    assert.equal(resumo.area?.contidos, 4, `section, h2, p e a cabem inteiros; main e p.rotulo não: ${JSON.stringify(resumo)}`);
    assert.match(resumo.area?.raiz ?? "", /^section/, "a raiz da área é o ancestral comum");
    for (const esperado of ["  section.cartao", '  h2 "Colaborador"', '  p.descricao "Conta institucional"', '  a.link "Ir para outra página"']) {
      assert.ok(resumo.linhas.includes(esperado), `faltou ${esperado} em ${JSON.stringify(resumo.linhas)}`);
    }
    assert.ok(!resumo.linhas.some((l) => /p\.rotulo|button#salvar/.test(l)), "o que ficou fora da área não aparece");
    assert.ok(resumo.linhas.some((l) => /\+2 fora da área/.test(l)), "os irmãos de fora ficam resumidos");
    const anotacaoArea = await debug<Anotacao | null>("atual()");
    assert.equal(anotacaoArea?.elemento.meta.tag, "area", "o arrasto cria uma região, sem substituir por um elemento");
    assert.ok(anotacaoArea?.area);
    assert.ok(Math.abs(anotacaoArea.area.rectPagina.width - (secao.width + 12)) < 1);
    assert.deepEqual(anotacaoArea.area.elementos.map((el) => el.meta.tag), ["h2", "p", "a"]);
    assert.equal((await debug<Anotacao[]>("pendentes()")).length, 0);
    assert.equal(await visivel(".an-area"), true, "o retângulo da área fica desenhado");

    await clicarEm(`Array.from(${corpo}.querySelectorAll(".an-no")).find((n) => n.querySelector(".nome").textContent === "a.link").querySelector(".nome")`);
    await esperarAte(async () => (await debug<Anotacao | null>("atual()"))?.elemento.meta.tag === "a", 5_000, 100, "clique num nó da área seleciona o elemento");
    await pagina.pressionar("Escape");
    await esperarAte(async () => (await debug<Anotacao | null>("atual()")) === null);
    assert.ok((await arvore()).area, "o primeiro Esc só cancela o rascunho");
    await pagina.pressionar("Escape");
    await esperarAte(async () => (await arvore()).area === null, 5_000, 100, "o segundo Esc limpa a área");
    assert.equal(await visivel(".an-area"), false);
    assert.deepEqual(pagina.erros, [], "nenhum erro de página com a árvore e a área");
  });

  test("auditoria acende em página com defeito e cala em página limpa", async () => {
    await pagina.navegar(proxy.origem + "/defeitos");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    await pagina.esperar(400);
    const r = await debug<ResultadoAuditoria>("auditar()");
    const contexto = await debug<{ estrutura: { cabecalhos: string[]; botoes: number; campos: number } }>("contexto()");
    // Volta para a página boa antes de afirmar: se algo falhar, o teste seguinte ainda encontra o app de pé.
    await pagina.navegar(proxy.origem + "/");
    await pagina.esperarPor("window.__anotadorCarregado", 10_000);
    await pagina.esperar(300);
    const limpa = await debug<ResultadoAuditoria>("auditar()");

    const regras = new Map<string, AchadoAuditoria[]>();
    for (const a of r.achados) regras.set(a.regra, [...(regras.get(a.regra) ?? []), a]);
    const detalhe = () => JSON.stringify(r.achados.map((a) => `${a.regra}: ${a.alvo} — ${a.evidencia}`), null, 1);

    // Cada regra precisa poder ficar vermelha; sem isso a auditoria só prova que não explode.
    for (const esperada of [
      "contraste abaixo do mínimo",
      "alvo de toque pequeno",
      "campo sem rótulo",
      "botão sem nome",
      "salto de nível",
      "hierarquia invertida",
      "transborda a janela",
      "texto cortado",
      "quase alinhado",
      "raio inconsistente",
      "altura de controle desigual",
      "vãos desiguais",
      "rótulo em versalete",
      "seta presa ao rótulo",
      "metadados colados por ponto",
    ]) {
      assert.ok(regras.has(esperada), `a regra "${esperada}" não acendeu na página de defeitos. Achados: ${detalhe()}`);
    }

    const contraste = regras.get("contraste abaixo do mínimo")?.[0];
    assert.match(contraste?.evidencia ?? "", /^[12]\.\d+:1 onde a norma pede 4\.5:1/, "a evidência traz a razão medida");
    assert.ok(contraste?.seletor, "todo achado aponta um seletor para o agente localizar no código");
    assert.ok(
      regras.get("alvo de toque pequeno")?.some((a) => a.evidencia === "16×16px, abaixo de 24×24"),
      `o botão de 16px precisa aparecer entre os alvos pequenos: ${JSON.stringify(regras.get("alvo de toque pequeno"))}`
    );
    assert.ok(r.medidos > 10, `mediu ${r.medidos} elementos`);

    assert.equal(contexto.estrutura.campos, 1);
    assert.ok(contexto.estrutura.cabecalhos[0]?.startsWith("h1:"), "o contexto lista os cabeçalhos na ordem do documento");

    // A mesma régua na página bem-comportada não pode inventar achado.
    const graves = limpa.achados.filter((a) => a.gravidade !== "baixa");
    assert.deepEqual(graves, [], `a página de teste não deveria acusar nada grave: ${JSON.stringify(graves)}`);
  });

  test("modo Navegar devolve os cliques ao app", async () => {
    await clicarEm(noOverlay(".an-modo button:nth-child(2)"));
    await esperarAte(async () => !(await debug<boolean>("armado()")));
    await pagina.avaliar(`window.cliquesNoBotao = 0; document.getElementById("salvar").addEventListener("click", () => window.cliquesNoBotao++)`);
    await clicarEm('document.querySelector("#salvar")');
    await esperarAte(async () => (await pagina.avaliar<number>("window.cliquesNoBotao")) === 1);
  });
});
