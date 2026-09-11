// Validação visual contra um app real: sobe o proxy, abre a rota no Chromium headless,
// percorre o fluxo de anotação e salva prints de cada etapa.
//
//   node --disable-warning=ExperimentalWarning scripts/validar-real.ts --alvo http://localhost:3001 --rota /entrar --texto "acesso institucional" --saida ./prints

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Navegador, encontrarChromium } from "../lib/cdp.ts";
import { iniciarServidor } from "../server.ts";

const { values } = parseArgs({
  options: {
    alvo: { type: "string", default: "http://localhost:3001" },
    rota: { type: "string", default: "/" },
    texto: { type: "string", default: "" },
    saida: { type: "string", default: "./prints" },
    fonte: { type: "string" },
    enviar: { type: "boolean", default: false },
    largura: { type: "string", default: "1400" },
    altura: { type: "string", default: "900" },
  },
});

async function esperarAte(condicao: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("condição não satisfeita em " + timeoutMs + "ms");
}

const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;

async function principal(): Promise<void> {
  const chrome = encontrarChromium();
  if (!chrome) throw new Error("Chromium não encontrado");
  await mkdir(values.saida, { recursive: true });
  const servidor = await iniciarServidor({
    alvo: values.alvo,
    porta: 0,
    host: "127.0.0.1",
    nome: "validacao",
    saida: join(values.saida, "fila"),
    removerCsp: false,
    capturas: false,
    chrome: null,
    publico: null,
    fonte: values.fonte ?? process.cwd(),
    agente: "Claude",
    silencioso: true,
  });
  const origem = `http://127.0.0.1:${servidor.porta}`;
  const navegador = await Navegador.abrir({ caminho: chrome });
  let passo = 0;
  const salvar = async (nome: string, pagina: Awaited<ReturnType<typeof navegador.novaPagina>>) => {
    passo++;
    const caminho = join(values.saida, `${passo}-${nome}.png`);
    await writeFile(caminho, await pagina.capturar());
    console.log("print:", caminho);
  };
  try {
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(Number(values.largura), Number(values.altura), 1);
    await pagina.navegar(origem + values.rota, 90_000);
    await pagina.esperarPor("window.__anotadorCarregado", 30_000);
    await pagina.esperar(600);
    console.log("overlay montado; erros de página:", pagina.erros.length ? pagina.erros : "nenhum");
    await salvar("montado", pagina);

    const alvoExpr = values.texto
      ? `Array.from(document.querySelectorAll("p,h1,h2,h3,span,a,button,label")).find((el) => (el.textContent || "").trim().toLowerCase() === ${JSON.stringify(values.texto.toLowerCase())})`
      : `document.querySelector("main h1, h1, main p, p")`;
    const rect = await pagina.avaliar<Rect | null>(`(() => { const el = ${alvoExpr}; if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    if (!rect) throw new Error("elemento alvo não encontrado na página");
    const x = rect.left + Math.min(40, rect.width / 2);
    const y = rect.top + rect.height / 2;

    await pagina.mover(x, y);
    await pagina.esperar(200);
    console.log("dica do hover:", await pagina.avaliar<string>(`${noOverlay(".an-dica")}.textContent`));
    await salvar("hover", pagina);

    await pagina.clicar(x, y);
    await pagina.esperarPor(noOverlay(".an-balao"));
    await pagina.digitar("Deixar este rótulo mais destacado");
    await pagina.esperar(150);
    await salvar("balao", pagina);
    const medidas = await pagina.avaliar<Record<string, unknown>>(`(() => {
      const raiz = document.getElementById("__anotador_host").shadowRoot;
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), getComputedStyle(el).display]; };
      return { alvo: r((${alvoExpr})), hover: r(raiz.querySelector(".an-caixa:not(.selecao)")), selecao: r(raiz.querySelector(".an-caixa.selecao")), balao: r(raiz.querySelector(".an-balao")), dica: r(raiz.querySelector(".an-dica")), pin: r(raiz.querySelector(".an-pin")), fonteBarra: getComputedStyle(raiz.querySelector(".an-barra")).fontFamily, fonteBody: getComputedStyle(document.body).fontFamily, alcas: raiz.querySelectorAll(".an-alca").length };
    })()`);
    console.log("medidas após o clique:", JSON.stringify(medidas));

    const icone = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-balao .an-ico")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(icone.left + icone.width / 2, icone.top + icone.height / 2);
    await pagina.esperarPor(`!${noOverlay(".an-painel")}.hidden`);
    await pagina.esperar(200);
    await salvar("painel", pagina);

    const campoCor = `Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((l) => l.querySelector("label").textContent.startsWith("Cor do texto")).querySelector("input[type=text]")`;
    const rc = await pagina.avaliar<Rect>(`(() => { const r = (${campoCor}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(rc.left + rc.width / 2, rc.top + rc.height / 2);
    await pagina.avaliar(`(${campoCor}).select()`);
    await pagina.digitar("rgb(190, 24, 93)");
    await pagina.pressionar("Tab");
    const campoTamanho = `Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha")).find((l) => l.querySelector("label").textContent.startsWith("Tamanho da fonte")).querySelector("input[type=text]")`;
    const rt = await pagina.avaliar<Rect>(`(() => { const r = (${campoTamanho}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(rt.left + rt.width / 2, rt.top + rt.height / 2);
    await pagina.avaliar(`(${campoTamanho}).select()`);
    await pagina.digitar("16");
    await pagina.pressionar("Tab");
    await pagina.esperar(200);
    await salvar("alterado", pagina);

    // Fim do painel: Preenchimento e Margem, os campos de quatro lados.
    await pagina.avaliar(`(() => { const c = ${noOverlay(".an-painel .corpo")}; c.scrollTop = c.scrollHeight; })()`);
    await pagina.esperar(200);
    const painelRect = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-painel")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    passo++;
    const printEspacos = join(values.saida, `${passo}-painel-espacamentos.png`);
    await writeFile(printEspacos, await pagina.capturar({ clip: { left: painelRect.left - 8, top: painelRect.top - 8, width: painelRect.width + 16, height: painelRect.height + 16 }, alemDoViewport: false }));
    const medidasQuatro = await pagina.avaliar<unknown>(`(() => { const linhas = Array.from(${noOverlay(".an-painel")}.querySelectorAll(".an-linha.larga")); return linhas.map((l) => { const r = l.getBoundingClientRect(); const campos = Array.from(l.querySelectorAll(".an-campo")).map((c) => Math.round(c.getBoundingClientRect().width)); const inputs = Array.from(l.querySelectorAll("input")).map((i) => [i.value, Math.round(i.getBoundingClientRect().width), i.scrollWidth]); return { rotulo: l.querySelector("label").textContent.trim().slice(0, 14), largura: Math.round(r.width), altura: Math.round(r.height), campos, inputs }; }); })()`);
    console.log("print:", printEspacos, "| linhas de quatro lados:", JSON.stringify(medidasQuatro));
    const ok = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-painel .an-ok")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(ok.left + ok.width / 2, ok.top + ok.height / 2);
    await pagina.esperar(300);
    const lista = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay('.an-barra .an-ico[title^="Ver fila"]')}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(lista.left + lista.width / 2, lista.top + lista.height / 2);
    await pagina.esperar(200);
    await salvar("fila", pagina);

    await pagina.pressionar("Escape");
    const ocultar = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay('.an-barra .an-ico[title^="Ocultar"]')}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    await pagina.clicar(ocultar.left + ocultar.width / 2, ocultar.top + ocultar.height / 2);
    await pagina.esperarPor(noOverlay(".an-religar"));
    await pagina.esperar(150);
    const pilula = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-religar")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    passo++;
    const recorte = join(values.saida, `${passo}-recolhido.png`);
    await writeFile(recorte, await pagina.capturar({ clip: { left: pilula.left - 40, top: pilula.top - 40, width: pilula.width + 80, height: pilula.height + 80 }, alemDoViewport: false }));
    console.log("print:", recorte);
    await pagina.clicar(pilula.left + pilula.width - 30, pilula.top + pilula.height / 2);
    await pagina.esperarPor(`!${noOverlay(".an-religar")}`);

    // Árvore de elementos: abre pela barra, segue o cursor e mostra ancestrais → alvo → filhos.
    const rectDe = async (expr: string): Promise<Rect> => pagina.avaliar<Rect>(`(() => { const r = (${expr}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    const clicarEm = async (expr: string) => {
      const r = await rectDe(expr);
      await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
    };
    await clicarEm(noOverlay('.an-barra .an-ico[title^="Estrutura"]'));
    await pagina.esperarPor(`${noOverlay(".an-arvore")} && !${noOverlay(".an-arvore")}.hidden`);
    await pagina.mover(x, y);
    await esperarAte(async () => !!(await pagina.avaliar<string | null>("window.__anotadorDebug.arvore().foco")), 5_000);
    await pagina.esperar(300);
    console.log("árvore (cursor no alvo):", JSON.stringify(await pagina.avaliar("window.__anotadorDebug.arvore()")));
    await salvar("arvore", pagina);

    // Área: retângulo em volta do pai do alvo — a árvore lista só o que cabe inteiro nele.
    const pai = await rectDe(`(${alvoExpr}).parentElement`);
    const largura = Number(values.largura);
    await pagina.arrastar({ x: Math.min(largura - 4, pai.left + pai.width + 8), y: Math.max(4, pai.top - 8) }, { x: Math.max(4, pai.left - 8), y: pai.top + pai.height + 8 }, 12);
    await esperarAte(async () => !!(await pagina.avaliar<unknown>("window.__anotadorDebug.arvore().area")), 5_000);
    await pagina.esperar(300);
    console.log("árvore (área em volta do pai):", JSON.stringify(await pagina.avaliar("window.__anotadorDebug.arvore()")));
    await salvar("area", pagina);
    await pagina.pressionar("Escape");
    await esperarAte(async () => !(await pagina.avaliar<unknown>("window.__anotadorDebug.arvore().area")), 5_000);
    await clicarEm(noOverlay('.an-arvore .cab .an-ico[title^="Fechar"]'));
    await pagina.esperarPor(`${noOverlay(".an-arvore")}.hidden`);

    // Estados da barra: simula um lote em andamento e outro aplicado, via armazenamento local, e recorta a barra.
    for (const [nome, lotes] of [
      ["barra-andamento", [{ id: "lote-simulado-0001", enviadoEm: new Date().toISOString(), estado: "em_andamento", nota: "aplicando em step-indicator.tsx" }]],
      ["barra-aplicado", [{ id: "lote-simulado-0002", enviadoEm: new Date().toISOString(), estado: "processado", nota: "borda de 2px em todos os marcadores" }]],
    ] as Array<[string, unknown[]]>) {
      // Escreve a partir de uma página sem overlay: o overlay ativo regrava o estado a cada ciclo de sondagem.
      // Só troca a lista de lotes: a anotação pendente criada acima precisa sobreviver para o passo de envio.
      await pagina.navegar(origem + "/__anotador/saude", 30_000);
      await pagina.avaliar(`(() => { const k = "anotador-ui:" + ${JSON.stringify(values.rota)}; const atual = JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify({ ...atual, lotes: ${JSON.stringify(lotes)}, armado: true })); })()`);
      await pagina.navegar(origem + values.rota, 90_000);
      await pagina.esperarPor("window.__anotadorCarregado", 30_000);
      await pagina.esperar(400);
      const barra = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-barra")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      passo++;
      const arquivo = join(values.saida, `${passo}-${nome}.png`);
      await writeFile(arquivo, await pagina.capturar({ clip: { left: barra.left - 24, top: barra.top - 16, width: barra.width + 48, height: barra.height + 32 }, alemDoViewport: false }));
      console.log("print:", arquivo, "| estado:", await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`));
    }
    await pagina.navegar(origem + "/__anotador/saude", 30_000);
    await pagina.avaliar(`(() => { const k = "anotador-ui:" + ${JSON.stringify(values.rota)}; const atual = JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify({ ...atual, lotes: [] })); })()`);
    await pagina.navegar(origem + values.rota, 90_000);
    await pagina.esperarPor("window.__anotadorCarregado", 30_000);
    await pagina.esperar(300);

    console.log("pendentes:", JSON.stringify(await pagina.avaliar("window.__anotadorDebug.pendentes().map(a => ({ ordem: a.ordem, comentario: a.comentario, tag: a.elemento.meta.tag, componentes: a.elemento.meta.componentes, seletor: a.elemento.seletores[0], alteracoes: a.alteracoes }))"), null, 2));
    if (values.enviar) {
      await pagina.pressionar("Escape");
      const enviar = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-enviar")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      await pagina.clicar(enviar.left + enviar.width / 2, enviar.top + enviar.height / 2);
      await esperarAte(async () => (await servidor.fila.listar()).length === 1, 20_000);
      const id = (await servidor.fila.listar())[0]?.id ?? "";
      await esperarAte(async () => ((await servidor.fila.lerMarkdown(id)) ?? "").includes("Onde está no código"), 30_000);
      console.log("=== markdown do lote " + id + " ===\n" + (await servidor.fila.lerMarkdown(id)));

      // Conversa: o Claude explica e pergunta; o painel abre sozinho na página.
      const mensagens = `${origem}/__anotador/lotes/${id}/mensagens`;
      const postar = (corpo: unknown) => fetch(mensagens, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
      await postar({ autor: "agente", tipo: "nota", texto: "Esse rótulo vem de um estilo compartilhado (auth-card, page e outros). Vou aplicar na família inteira." });
      await postar({ autor: "agente", tipo: "escolha", texto: "A cor rgb(190, 24, 93) não tem token no tema. Como prefere?", opcoes: ["Criar token --color-destaque", "Usar text-interactive existente", "Deixar a cor como está"] });
      await esperarAte(async () => pagina.avaliar<boolean>(`!!${noOverlay(".an-conversa")} && ${noOverlay(".an-conversa")}.checkVisibility() && /Como prefere/.test(${noOverlay(".an-conversa .fluxo")}.textContent)`), 20_000);
      await pagina.esperar(300);
      const conv = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-conversa")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      passo++;
      const printConversa = join(values.saida, `${passo}-conversa-pergunta.png`);
      await writeFile(printConversa, await pagina.capturar({ clip: { left: conv.left - 16, top: conv.top - 16, width: conv.width + 32, height: conv.height + 32 }, alemDoViewport: false }));
      console.log("print:", printConversa, "| estado da barra:", await pagina.avaliar<string>(`${noOverlay(".an-estado")}.textContent`));
      const opcao = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-conversa .an-opcao")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      await pagina.clicar(opcao.left + opcao.width / 2, opcao.top + opcao.height / 2);
      await esperarAte(async () => pagina.avaliar<boolean>(`/Você respondeu/.test(${noOverlay(".an-conversa .fluxo")}.textContent)`), 10_000);
      await pagina.esperar(300);
      const conv2 = await pagina.avaliar<Rect>(`(() => { const r = ${noOverlay(".an-conversa")}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      passo++;
      const printResposta = join(values.saida, `${passo}-conversa-respondida.png`);
      await writeFile(printResposta, await pagina.capturar({ clip: { left: conv2.left - 16, top: conv2.top - 16, width: conv2.width + 32, height: conv2.height + 32 }, alemDoViewport: false }));
      console.log("print:", printResposta);
      console.log("conversa gravada:", JSON.stringify((await servidor.fila.conversa(id)).map((m) => `${m.autor}/${m.tipo}: ${m.texto.slice(0, 50)}${m.opcoes ? " " + JSON.stringify(m.opcoes) : ""}`)));
    }
    console.log("erros de página ao final:", pagina.erros.length ? JSON.stringify(pagina.erros) : "nenhum");
    await pagina.fechar();
  } finally {
    await navegador.fechar();
    await servidor.fechar();
  }
}

for (const sinal of ["SIGINT", "SIGTERM"] as const) process.on(sinal, () => process.exit(1));

principal().catch((erro: Error) => {
  console.error("falhou:", erro.message);
  process.exit(1);
});
