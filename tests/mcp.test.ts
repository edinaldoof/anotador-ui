import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, afterEach, before, describe, test } from "node:test";
import { encontrarChromium } from "../lib/cdp.ts";
import { lerSistemaDeDesign } from "../lib/design.ts";
import { lerProjeto } from "../lib/fonte.ts";
import { buscarComponente, conferirValor } from "../lib/mcp.ts";

const RAIZ = new URL("..", import.meta.url).pathname;

// Um projeto pequeno com as armadilhas de verdade: a mesma cor como primitiva, como
// semântica e como variável interna de uma biblioteca; um passo de 8px com uma exceção
// explicada (4 de 5 no passo: o mínimo de 80% que a escala exige para existir); um
// Dialog muito usado ao lado de um Modal esquecido.
async function criarProjeto(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-mcp-"));
  await mkdir(join(pasta, "app"), { recursive: true });
  await mkdir(join(pasta, "components", "ui"), { recursive: true });
  await writeFile(join(pasta, "app", "globals.css"), [
    ":root {",
    "  --rdp-accent-color: #0f766e;",
    "  --color-teal-700: #0f766e;",
    "  --color-action-primary: var(--color-teal-700); /* ação principal: botões e links de destaque */",
    "  --color-surface: #ffffff;",
    "  --spacing-2: 8px;",
    "  --spacing-4: 16px;",
    "  --spacing-6: 24px;",
    "  --spacing-8: 32px;",
    "  --spacing-hairline: 1px; /* borda de separação, não espaçamento */",
    "  --radius-md: 6px;",
    "  --motion-duration-feedback: 150ms;",
    "  --motion-duration-panel: 300ms; /* painel que expande */",
    "}",
    ".botao { background: var(--color-action-primary); padding: var(--spacing-2) var(--spacing-4); }",
  ].join("\n"));
  await writeFile(join(pasta, "components", "ui", "dialog.tsx"), "export function Dialog({ open, children }: { open: boolean; children: React.ReactNode }) { return null; }\nexport const DialogFooter = () => null;\n");
  await writeFile(join(pasta, "components", "ui", "modal.tsx"), "export function Modal() { return null; }\n");
  await writeFile(join(pasta, "components", "ui", "dialog.stories.tsx"), "export const DialogStory = () => <Dialog open />;\n");
  await writeFile(join(pasta, "app", "page.tsx"), "export default function Page() { return <><Dialog open><DialogFooter /></Dialog><Dialog open /><Dialog open /></>; }\n");
  return pasta;
}

describe("consultas do servidor MCP", () => {
  let pasta = "";
  before(async () => { pasta = await criarProjeto(); });
  after(async () => { await rm(pasta, { recursive: true, force: true }); });

  test("a cor escrita à mão encontra o token do projeto — nunca a variável interna da biblioteca", async () => {
    const sistema = lerSistemaDeDesign(await lerProjeto(pasta));
    const exato = conferirValor(sistema, "#0f766e");
    assert.equal(exato["noSistema"], true);
    // Três tokens com o mesmo valor. O semântico é o que o autor quis que fosse usado;
    // o do date picker bate no valor e erra o sistema inteiro.
    assert.equal(exato["usar"], "var(--color-action-primary)");
    assert.deepEqual((exato["exatos"] as Array<{ nome: string }>).map((t) => t.nome), ["--color-action-primary", "--color-teal-700", "--rdp-accent-color"]);
    assert.equal((exato["exatos"] as Array<{ biblioteca?: boolean }>)[2]?.biblioteca, true);

    // Um dígito trocado: não é outra cor, é a mesma escrita errada.
    const quase = conferirValor(sistema, "#0f776e");
    assert.equal(quase["noSistema"], false);
    assert.equal(quase["usar"], "var(--color-action-primary)");
    assert.equal((quase["proximos"] as Array<{ quaseIgual: boolean }>)[0]?.quaseIgual, true);
    assert.ok(!(quase["proximos"] as Array<{ nome: string }>).some((t) => t.nome.startsWith("--rdp-")), "biblioteca fora das sugestões");

    // Dois tokens crus com a mesma cor são dois papéis, não uma camada: nada de "usar".
    const papeis = conferirValor(lerSistemaDeDesign([{ relativo: "a.css", linhas: [":root {", "  --color-action-primary: #046b66;", "  --color-brand-teal: #046b66; /* marca; nunca em botão */", "}"] }]), "#046b66");
    assert.equal(papeis["usar"], null, "recomendar o primeiro ensinaria o agente a pintar botão com a cor da marca");
    assert.deepEqual((papeis["papeis"] as Array<{ nome: string; intencao?: string }>).map((t) => [t.nome, t.intencao ?? null]), [["--color-brand-teal", "marca; nunca em botão"], ["--color-action-primary", null]]);
    assert.match(String(papeis["observacao"]), /escolha pelo papel/);

    // Formatos diferentes, mesma cor.
    assert.equal(conferirValor(sistema, "rgb(15 118 110)")["usar"], "var(--color-action-primary)");
    assert.equal(conferirValor(sistema, "#dc2626")["usar"], null, "vermelho não tem parente no sistema e não se inventa um");
  });

  test("a medida diz se tem token, se respeita o passo e qual é o mais perto", async () => {
    const sistema = lerSistemaDeDesign(await lerProjeto(pasta));
    assert.equal(conferirValor(sistema, "16px")["usar"], "var(--spacing-4)");
    assert.equal(conferirValor(sistema, "1rem")["usar"], "var(--spacing-4)", "rem vira px antes de comparar");
    const torto = conferirValor(sistema, "13px");
    assert.equal(torto["noSistema"], false);
    assert.equal(torto["naEscala"], false);
    assert.equal(torto["passo"], 8);
    assert.deepEqual((torto["proximos"] as Array<{ nome: string }>).map((t) => t.nome), ["--spacing-4"]);
    assert.equal(conferirValor(sistema, "6px", "raio")["usar"], "var(--radius-md)");
    assert.equal(conferirValor(sistema, "flex")["tipo"], "desconhecido");
  });

  test("a duração diz o token que já existe e em que faixa do orçamento de movimento ela cai", async () => {
    const sistema = lerSistemaDeDesign(await lerProjeto(pasta));
    assert.equal(conferirValor(sistema, "300ms")["usar"], "var(--motion-duration-panel)");
    assert.equal(conferirValor(sistema, "0.3s")["usar"], "var(--motion-duration-panel)", "segundo vira milissegundo antes de comparar");
    assert.match(String(conferirValor(sistema, "300ms")["faixa"]), /^padrão \(200–300ms\)/);
    assert.match(String(conferirValor(sistema, "180ms")["faixa"]), /^entre rápido \(100–150ms\) e padrão \(200–300ms\)$/, "entre duas faixas, diz entre quais — não arredonda pelo autor");
    const lenta = conferirValor(sistema, "800ms");
    assert.equal(lenta["usar"], null);
    assert.match(String(lenta["observacao"]), /acima dos 500ms/);
    assert.equal(conferirValor(sistema, "300ms", "cor")["tipo"], "desconhecido", "pedir cor para uma duração não inventa resposta");
  });

  test("componente: o que já existe e é usado vem antes, e história de Storybook não conta como definição", async () => {
    const arquivos = await lerProjeto(pasta);
    const achados = buscarComponente(arquivos, "dialog");
    assert.deepEqual(achados.map((c) => [c.nome, c.usos]), [["Dialog", 3], ["DialogFooter", 1]]);
    assert.equal(achados[0]?.arquivo, "components/ui/dialog.tsx");
    assert.match(achados[0]?.assinatura ?? "", /open: boolean/);
    // Pela pasta, o Modal aparece — com zero usos, que é a informação que interessa.
    assert.deepEqual(buscarComponente(arquivos, "ui").map((c) => [c.nome, c.usos]).find(([n]) => n === "Modal"), ["Modal", 0]);
    assert.deepEqual(buscarComponente(arquivos, "   "), []);
  });
});

// O servidor de verdade, como um cliente MCP o lança: processo, stdin e stdout.
describe("servidor MCP por stdio", () => {
  let pasta = "";
  let alvo: ReturnType<typeof createServer> | null = null;
  let urlAlvo = "";
  before(async () => {
    pasta = await criarProjeto();
    alvo = createServer((req, res) => {
      // Como um app de verdade: rota protegida sem sessão vai para o login.
      if (req.url === "/protegida") { res.writeHead(302, { location: "/entrar" }); res.end(); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      if (req.url === "/entrar") { res.end('<!doctype html><main><form><label>Senha <input type="password"></label></form></main>'); return; }
      res.end('<!doctype html><style>*{margin:0}body{font:16px sans-serif}.larga{width:900px;height:40px}</style><div class="larga">não cabe no celular</div>');
    });
    await new Promise<void>((r) => alvo!.listen(0, "127.0.0.1", r));
    urlAlvo = `http://127.0.0.1:${(alvo.address() as AddressInfo).port}/`;
  });
  after(async () => {
    await new Promise<void>((r) => alvo ? alvo.close(() => r()) : r());
    await rm(pasta, { recursive: true, force: true });
  });

  const abrir = () => {
    const filho = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(RAIZ, "server.ts"), "mcp", "--fonte", pasta], { stdio: ["pipe", "pipe", "pipe"] });
    const linhas: string[] = [];
    const esperando: Array<(l: string) => void> = [];
    createInterface({ input: filho.stdout }).on("line", (l) => { const e = esperando.shift(); if (e) e(l); else linhas.push(l); });
    const proxima = () => new Promise<string>((r) => { const l = linhas.shift(); if (l !== undefined) r(l); else esperando.push(r); });
    const enviar = (m: unknown) => filho.stdin.write((typeof m === "string" ? m : JSON.stringify(m)) + "\n");
    const pedir = async (id: number, method: string, params?: unknown) => { enviar({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }); return JSON.parse(await proxima()) as Record<string, any>; };
    const fechar = () => new Promise<number | null>((r) => { if (filho.exitCode !== null) return r(filho.exitCode); filho.on("exit", (c) => r(c)); filho.stdin.end(); });
    abertos.push(filho);
    return { enviar, pedir, proxima, fechar };
  };
  // Uma asserção que falha no meio não pode deixar o servidor vivo: o processo filho
  // seguraria o executor de testes até o tempo esgotar, e a falha viraria travamento.
  const abertos: Array<ReturnType<typeof spawn>> = [];
  afterEach(() => { for (const f of abertos.splice(0)) if (f.exitCode === null) f.kill(); });

  test("negocia a versão, lista as ferramentas e devolve erro de ferramenta como resultado", { timeout: 30_000 }, async () => {
    const mcp = abrir();
    const inicio = await mcp.pedir(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "0" } });
    assert.equal(inicio.result.protocolVersion, "2025-06-18");
    assert.equal(inicio.result.serverInfo.name, "anotador-ui");
    assert.match(inicio.result.instructions, /conferir_valor/, "as instruções dizem quando usar cada ferramenta");
    // Notificação não tem resposta: se tivesse, a próxima linha seria ela e não o ping.
    mcp.enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.deepEqual((await mcp.pedir(2, "ping")).result, {});

    const lista = await mcp.pedir(3, "tools/list");
    assert.deepEqual(lista.result.tools.map((f: { name: string }) => f.name), ["listar_tokens", "conferir_valor", "buscar_componente", "auditar_sistema", "medir_pagina", "conferir_arquivos_de_agente", "gerar_skill_de_design", "extrair_design"]);
    assert.ok(lista.result.tools.every((f: { annotations: { readOnlyHint: boolean } }) => f.annotations.readOnlyHint), "nenhuma ferramenta mexe no projeto");

    const conferido = await mcp.pedir(4, "tools/call", { name: "conferir_valor", arguments: { valor: "#0f766e" } });
    assert.equal(conferido.result.structuredContent.usar, "var(--color-action-primary)");
    assert.equal(JSON.parse(conferido.result.content[0].text).usar, "var(--color-action-primary)", "o texto e o estruturado dizem o mesmo");

    // Erro da ferramenta é para o agente ler e corrigir, não para o cliente descartar.
    const invalido = await mcp.pedir(5, "tools/call", { name: "listar_tokens", arguments: { categoria: "cores" } });
    assert.equal(invalido.result.isError, true);
    assert.match(invalido.result.content[0].text, /categoria inválida/);

    assert.equal((await mcp.pedir(6, "tools/call", { name: "apagar_tudo", arguments: {} })).error.code, -32602);
    assert.equal((await mcp.pedir(7, "prompts/list")).error.code, -32601);
    mcp.enviar("{isto não é json");
    assert.equal(JSON.parse(await mcp.proxima()).error.code, -32700);

    const agentes = await mcp.pedir(9, "tools/call", { name: "conferir_arquivos_de_agente", arguments: {} });
    assert.equal(agentes.result.structuredContent.total, 0);
    const skill = await mcp.pedir(10, "tools/call", { name: "gerar_skill_de_design", arguments: {} });
    assert.match(skill.result.content[0].text, /^---\nname: design-system\n/);
    assert.match(skill.result.content[0].text, /\| `components\/ui\/dialog` \| `Dialog`, `DialogFooter` \| 4 \|/, "sem tsconfig, o caminho do arquivo");
    assert.doesNotMatch(skill.result.content[0].text, /Não existe `Modal`/, "o projeto tem um Modal, mesmo esquecido: não se diz que ele não existe");

    const recurso = await mcp.pedir(8, "resources/read", { uri: "anotador://tokens.dtcg.json" });
    assert.match(recurso.result.contents[0].text, /ação principal: botões e links de destaque/, "a intenção do comentário chega como $description");
    assert.equal(await mcp.fechar(), 0);
  });

  test("versão desconhecida do cliente recebe a mais nova que o servidor fala", { timeout: 30_000 }, async () => {
    const mcp = abrir();
    assert.equal((await mcp.pedir(1, "initialize", { protocolVersion: "2099-01-01", capabilities: {} })).result.protocolVersion, "2025-11-25");
    assert.equal(await mcp.fechar(), 0);
  });

  test("medir_pagina renderiza a tela e aponta o que vaza no celular", { skip: !encontrarChromium(), timeout: 60_000 }, async () => {
    const mcp = abrir();
    await mcp.pedir(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    const r = await mcp.pedir(2, "tools/call", { name: "medir_pagina", arguments: { url: urlAlvo, larguras: [390, 1280] } });
    assert.equal(r.result.isError, undefined, r.result.content?.[0]?.text);
    const { medidas, achados } = r.result.structuredContent;
    assert.deepEqual(medidas.map((m: { largura: number }) => m.largura), [390, 1280]);
    assert.ok(achados.some((a: { regra: string; largura: number }) => a.regra === "rolagem horizontal" && a.largura === 390));
    assert.ok(!achados.some((a: { regra: string; largura: number }) => a.regra === "rolagem horizontal" && a.largura === 1280), "no desktop os 900px cabem");
    const recusada = await mcp.pedir(3, "tools/call", { name: "medir_pagina", arguments: { url: "file:///etc/passwd" } });
    assert.equal(recusada.result.isError, true, "só http e https");
    assert.equal(r.result.structuredContent.aviso, undefined, "sem redirecionamento, sem aviso");

    // Pedir o painel e medir o login, calado, era o erro mais perigoso da ferramenta.
    const protegida = await mcp.pedir(4, "tools/call", { name: "medir_pagina", arguments: { url: urlAlvo + "protegida", larguras: [390] } });
    assert.equal(protegida.result.isError, true, "o que foi medido não é o que foi pedido: o agente precisa parar");
    const { aviso, urlMedida } = protegida.result.structuredContent;
    assert.equal(urlMedida, urlAlvo + "entrar");
    assert.match(aviso, /redirecionou para .*\/entrar, que tem campo de senha/);
    assert.match(aviso, /use a avaliação no overlay/);
    assert.ok(protegida.result.content[0].text.startsWith('{\n  "aviso"'), "o aviso é a primeira coisa que o agente lê");
    assert.equal(await mcp.fechar(), 0);
  });
});
