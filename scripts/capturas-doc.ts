// Gera as imagens da documentação contra um app real, sempre com o mesmo enquadramento.
//
//   node --disable-warning=ExperimentalWarning scripts/capturas-doc.ts --alvo http://localhost:3001 --rota /entrar --saida docs/imagens

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Navegador, encontrarChromium, type Pagina } from "../lib/cdp.ts";
import { iniciarServidor } from "../server.ts";

const { values } = parseArgs({
  options: {
    alvo: { type: "string", default: "http://localhost:3001" },
    rota: { type: "string", default: "/" },
    texto: { type: "string", default: "" },
    fonte: { type: "string" },
    saida: { type: "string", default: "docs/imagens" },
    largura: { type: "string", default: "1360" },
    altura: { type: "string", default: "860" },
  },
});

const noOverlay = (seletor: string) => `document.getElementById("__anotador_host").shadowRoot.querySelector(${JSON.stringify(seletor)})`;

async function esperarAte(condicao: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("condição não satisfeita em " + timeoutMs + "ms");
}

async function principal(): Promise<void> {
  const chrome = encontrarChromium();
  if (!chrome) throw new Error("Chromium não encontrado (defina ANOTADOR_CHROME)");
  await mkdir(values.saida, { recursive: true });
  const servidor = await iniciarServidor({
    alvo: values.alvo,
    porta: 0,
    host: "127.0.0.1",
    nome: "demonstracao",
    saida: null,
    removerCsp: false,
    capturas: false,
    chrome: null,
    publico: null,
    fonte: values.fonte ?? process.cwd(),
    agente: "Claude",
    registro: null,
    silencioso: true,
  });
  const origem = `http://127.0.0.1:${servidor.porta}`;
  const navegador = await Navegador.abrir({ caminho: chrome });
  // O clip do Chrome usa coordenadas do documento; com alemDoViewport dá para recortar o que está abaixo da dobra sem rolar.
  const salvar = async (nome: string, pagina: Pagina, clip?: Rect) => {
    const caminho = join(values.saida, nome + ".png");
    await writeFile(caminho, await pagina.capturar(clip ? { clip, alemDoViewport: true } : { alemDoViewport: false }));
    console.log("imagem:", caminho);
  };
  const rectDe = async (pagina: Pagina, expressao: string): Promise<Rect> =>
    pagina.avaliar<Rect>(`(() => { const r = (${expressao}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const clicarEm = async (pagina: Pagina, expressao: string) => {
    const r = await rectDe(pagina, expressao);
    await pagina.clicar(r.left + r.width / 2, r.top + r.height / 2);
  };

  try {
    const pagina = await navegador.novaPagina();
    await pagina.definirViewport(Number(values.largura), Number(values.altura), 2);

    // 1. página de conexão — um recorte por cartão, para caber legível no README
    await pagina.navegar(origem + "/__anotador/", 30_000);
    await esperarAte(async () => pagina.avaliar<boolean>(`document.getElementById("passo-1").classList.contains("feito") && document.querySelectorAll(".agente").length > 0`));
    await pagina.esperar(1500);
    const folga = 18;
    const recorteDe = async (seletor: string, comTopo = false): Promise<Rect> => {
      const r = await rectDe(pagina, `document.querySelector(${JSON.stringify(seletor)})`);
      const topo = comTopo ? await rectDe(pagina, "document.querySelector('.topo')") : r;
      const inicio = comTopo ? topo.top : r.top;
      return { left: r.left - folga, top: inicio - folga, width: r.width + folga * 2, height: r.top + r.height - inicio + folga * 2 };
    };
    await salvar("conexao", pagina, await recorteDe(".cartao", true));
    await salvar("agentes", pagina, await recorteDe(".casca > section:nth-of-type(2)"));
    // A página segue o tema do sistema; o README mostra a versão certa para cada leitor.
    await pagina.emularTema("dark");
    await pagina.esperar(500);
    await salvar("conexao-escuro", pagina, await recorteDe(".cartao", true));
    await pagina.emularTema("light");

    // 2. anotar: selecionar um elemento, comentar e abrir o painel de propriedades
    await pagina.navegar(origem + values.rota, 90_000);
    await pagina.esperarPor("window.__anotadorCarregado", 30_000);
    await pagina.esperar(800);
    const alvoExpr = values.texto
      ? `Array.from(document.querySelectorAll("p,h1,h2,h3,span,a,button,label")).find((el) => (el.textContent || "").trim().toLowerCase() === ${JSON.stringify(values.texto.toLowerCase())})`
      : `document.querySelector("main h1, h1, main p, p")`;
    // O painel abre onde foi deixado; posicionar à esquerda evita que ele cubra o balão do elemento.
    await pagina.avaliar(`localStorage.setItem("anotador-ui:pos:painel", JSON.stringify({ left: 44, top: 96 }))`);
    const alvo = await rectDe(pagina, alvoExpr);
    const x = alvo.left + Math.min(40, alvo.width / 2);
    const y = alvo.top + alvo.height / 2;
    await pagina.mover(x, y);
    await pagina.esperar(250);
    await pagina.clicar(x, y);
    await pagina.esperarPor(noOverlay(".an-balao"));
    await pagina.digitar("Dar mais destaque a este rótulo");
    await clicarEm(pagina, noOverlay(".an-balao .an-ico"));
    await esperarAte(async () => pagina.avaliar<boolean>(`!${noOverlay(".an-painel")}.hidden`));
    await pagina.esperar(500);
    await salvar("anotar", pagina);

    // 3. estrutura: árvore de elementos e seleção por área (com a anotação já confirmada na fila)
    await clicarEm(pagina, noOverlay(".an-painel .an-ok"));
    await esperarAte(async () => (await pagina.avaliar<unknown[]>("window.__anotadorDebug.pendentes()")).length === 1);
    await clicarEm(pagina, noOverlay('.an-barra .an-ico[title^="Estrutura"]'));
    await esperarAte(async () => pagina.avaliar<boolean>(`!!${noOverlay(".an-arvore")} && !${noOverlay(".an-arvore")}.hidden`));
    const pai = await rectDe(pagina, `(${alvoExpr}).parentElement`);
    await pagina.arrastar({ x: Math.min(Number(values.largura) - 6, pai.left + pai.width + 10), y: Math.max(6, pai.top - 10) }, { x: Math.max(6, pai.left - 10), y: pai.top + pai.height + 10 }, 14);
    await esperarAte(async () => !!(await pagina.avaliar<unknown>("window.__anotadorDebug.arvore().area")));
    await pagina.esperar(500);
    await salvar("estrutura", pagina);
    await pagina.pressionar("Escape");
    await clicarEm(pagina, noOverlay('.an-barra .an-ico[title^="Estrutura"]'));
    await esperarAte(async () => pagina.avaliar<boolean>(`${noOverlay(".an-arvore")}.hidden`));
    await pagina.esperar(300);

    // 4. conversa: o agente explica, pergunta e espera a resposta
    // A fila pode já ter lotes de execuções anteriores: espere ela crescer e use o lote novo, o último.
    const antes = (await servidor.fila.listar()).length;
    await clicarEm(pagina, noOverlay(".an-enviar"));
    await esperarAte(async () => (await servidor.fila.listar()).length > antes, 20_000);
    const lotes = await servidor.fila.listar();
    const id = lotes[lotes.length - 1]?.id ?? "";
    const postar = (corpo: unknown) => fetch(`${origem}/__anotador/lotes/${id}/mensagens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    await fetch(`${origem}/__anotador/lotes/${id}/progresso`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nota: "aplicando em components/ui/page.tsx" }) });
    await postar({ autor: "agente", tipo: "nota", texto: "Esse rótulo vem de um componente compartilhado, usado em nove telas de entrada. Vou aplicar na família inteira, não só aqui." });
    await postar({ autor: "agente", tipo: "escolha", texto: "O tamanho pedido não tem passo equivalente na escala tipográfica do projeto. Como prefere?", opcoes: ["Usar o passo acima (text-sm)", "Criar um passo novo na escala", "Manter como está"] });
    await esperarAte(async () => pagina.avaliar<boolean>(`!!${noOverlay(".an-conversa")} && ${noOverlay(".an-conversa")}.checkVisibility() && /Como prefere/.test(${noOverlay(".an-conversa .fluxo")}.textContent)`), 20_000);
    await pagina.esperar(600);
    await salvar("conversa", pagina);
    // 5. banner de apresentação (imagem de compartilhamento do repositório, 1200×630)
    const capa = join(tmpdir(), "anotador-capa.html");
    await writeFile(capa, banner(resolve(values.saida, "anotar.png")));
    await pagina.definirViewport(1200, 630, 2);
    await pagina.navegar("file://" + capa, 30_000);
    await pagina.esperar(700);
    await salvar("banner", pagina);

    console.log("erros de página:", pagina.erros.length ? JSON.stringify(pagina.erros) : "nenhum");
    await pagina.fechar();
  } finally {
    await navegador.fechar();
    await servidor.fechar();
  }
}

function banner(captura: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#0d1017;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e9ecec}
.brilho{position:absolute;width:760px;height:760px;border-radius:50%;right:-190px;top:-300px;
  background:radial-gradient(circle,rgba(47,109,246,.42),transparent 62%)}
.conteudo{position:absolute;inset:0;padding:62px 0 0 68px;width:560px}
.logo{width:66px;height:66px;border-radius:18px;background:linear-gradient(160deg,#5b90ff,#2f6df6);
  display:grid;place-items:center;box-shadow:0 10px 30px rgba(47,109,246,.45)}
h1{font-size:54px;letter-spacing:-.03em;margin:24px 0 0;font-weight:800}
p.linha{font-size:19.5px;line-height:1.45;color:#aeb6bd;margin-top:14px}
p.linha b{color:#e9ecec;font-weight:600}
.selos{display:flex;gap:8px;margin-top:26px;flex-wrap:wrap;max-width:500px}
.selo{font-size:13.5px;font-weight:600;padding:7px 14px;border-radius:999px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);color:#cdd4da}
.tela{position:absolute;right:-140px;top:104px;width:680px;border-radius:16px;overflow:hidden;
  border:1px solid rgba(255,255,255,.14);box-shadow:0 40px 90px rgba(0,0,0,.6)}
.tela img{display:block;width:100%}
.rodape{position:absolute;left:68px;bottom:46px;font-size:15px;color:#7f8890;font-family:ui-monospace,monospace}
</style>
<div class="brilho"></div>
<div class="conteudo">
  <div class="logo"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"><path d="M4 8h8M18 8h2M4 16h4M14 16h6"/><circle cx="15" cy="8" r="2.2"/><circle cx="11" cy="16" r="2.2"/></svg></div>
  <h1>anotador-ui</h1>
  <p class="linha">Anote a interface do app <b>em desenvolvimento</b> e entregue tudo a um <b>agente de código</b> como pedidos de mudança precisos.</p>
  <div class="selos"><span class="selo">Claude Code</span><span class="selo">Codex</span><span class="selo">Gemini</span><span class="selo">qualquer agente</span></div>
</div>
<div class="tela"><img src="file://${captura}"></div>
<div class="rodape">github.com/edinaldoof/anotador-ui</div>`;
}

for (const sinal of ["SIGINT", "SIGTERM"] as const) process.on(sinal, () => process.exit(1));

principal().catch((erro: Error) => {
  console.error("falhou:", erro.message);
  process.exit(1);
});
