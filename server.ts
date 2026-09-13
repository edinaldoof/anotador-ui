// anotador-ui — proxy reverso que injeta o overlay de anotação num app em
// desenvolvimento e entrega as anotações ao chat do Claude Code.

import { createServer, request as pedidoHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { request as pedidoHttps } from "node:https";
import * as modulo from "node:module";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Ponte, detectarAgentes, mensagemDeAbertura, mensagemParaLote, modelosDe, sessoesClaude, sessoesCodex, type IdAgente } from "./lib/agentes.ts";
import { capturarLote } from "./lib/captura.ts";
import { encontrarChromium } from "./lib/cdp.ts";
import { paginaConexao } from "./lib/conexao.ts";
import { RegistroConexoes, pastaBase } from "./lib/conexoes.ts";
import { marcaPeloNome } from "./lib/marcas.ts";
import { PORTAS_COMUNS, alvoPermitido, detectarServidores, sondar, type Sondagem } from "./lib/deteccao.ts";
import { estadoDasFontes, instalarFontes, tamanhoInstalado } from "./lib/fontes.ts";
import { Fila, idSeguro, validarLote } from "./lib/fila.ts";
import { analisarLote, arquivosProvaveis, lerProjeto } from "./lib/fonte.ts";
import { cabecalhosParaAlvo, ehHtml, extrairNonce, filtrarCabecalhosResposta, injetarScript } from "./lib/injetar.ts";
import { Difusor, ehPedidoWs, type InfoOuvinte } from "./lib/ws.ts";

export const BASE = "/__anotador";
const RAIZ = dirname(fileURLToPath(import.meta.url));
const LIMITE_CORPO = 12 * 1024 * 1024;
const ARQUIVOS_OVERLAY = ["engine.ts", "estilos.ts", "ui.ts"];

type RemovedorDeTipos = (codigo: string, opcoes?: { mode?: "strip" | "transform" }) => string;
const removerTipos = (modulo as unknown as { stripTypeScriptTypes?: RemovedorDeTipos }).stripTypeScriptTypes;

export interface PonteConfig {
  agente: IdAgente;
  sessao: string | null;
  /** modelo e nível de raciocínio, quando o agente aceita escolher */
  modelo?: string | null;
  esforco?: string | null;
}

export interface OpcoesServidor {
  /** app em desenvolvimento; null = sem conexão, a página em /__anotador/ pede uma */
  alvo: string | null;
  porta: number;
  host: string;
  nome: string;
  /** pasta da fila; null = ~/.claude/anotacoes/<nome> (ANOTADOR_HOME troca a base) */
  saida: string | null;
  removerCsp: boolean;
  capturas: boolean;
  chrome: string | null;
  publico: string | null;
  /** raiz do código-fonte do app, para localizar os elementos anotados */
  fonte: string | null;
  /** nome do agente que recebe e aplica os lotes (aparece na interface) */
  agente: string;
  /** agente chamado pela linha de comando a cada lote quando ninguém está ouvindo */
  ponte?: PonteConfig | null;
  /** arquivo do registro de conexões; null desliga a persistência (testes) */
  registro?: string | null;
  /** aceita alvos fora da máquina/rede local */
  permitirExterno?: boolean;
  silencioso?: boolean;
}

export interface PedidoConexao {
  alvo: string;
  nome?: string;
  fonte?: string;
  agente?: string;
}

export interface ServidorAnotador {
  porta: number;
  readonly fila: Fila;
  difusor: Difusor;
  readonly alvo: string | null;
  conectar(pedido: PedidoConexao): Promise<void>;
  desconectar(): void;
  fechar(): Promise<void>;
}

const VERSAO: string = (() => {
  try {
    return String((JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { version?: string }).version ?? "0");
  } catch {
    return "0";
  }
})();

function registrar(opcoes: OpcoesServidor, mensagem: string): void {
  if (opcoes.silencioso) return;
  const hora = new Date().toTimeString().slice(0, 8);
  console.log(`[anotador ${hora}] ${mensagem}`);
}

// ---------- bundle do overlay ----------
let cacheOverlay: { assinatura: string; codigo: string } | null = null;

export async function montarOverlay(cfg: ConfigOverlay): Promise<string> {
  if (!removerTipos) throw new Error("este Node não expõe module.stripTypeScriptTypes (exige Node >= 22.13)");
  const caminhos = ARQUIVOS_OVERLAY.map((f) => join(RAIZ, "overlay", f));
  const estatisticas = await Promise.all(caminhos.map((c) => stat(c)));
  const assinatura = JSON.stringify(cfg) + "|" + estatisticas.map((s) => s.mtimeMs).join(",");
  if (cacheOverlay && cacheOverlay.assinatura === assinatura) return cacheOverlay.codigo;
  const fontes = await Promise.all(caminhos.map((c) => readFile(c, "utf8")));
  const js = fontes.map((ts, i) => `// ---- ${ARQUIVOS_OVERLAY[i]} ----\n` + removerTipos(ts, { mode: "strip" })).join("\n");
  const codigo =
    `(() => {\n"use strict";\nif (window.__anotadorCarregado) return;\nwindow.__ANOTADOR_CFG = ${JSON.stringify(cfg)};\n` +
    js +
    `\n})();\n//# sourceURL=anotador-ui/overlay.js\n`;
  cacheOverlay = { assinatura, codigo };
  return codigo;
}

// ---------- utilidades HTTP ----------
function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(texto), "x-anotador": VERSAO });
  res.end(texto);
}

function responderTexto(res: ServerResponse, status: number, corpo: string, tipo = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": tipo, "cache-control": "no-store", "content-length": Buffer.byteLength(corpo), "x-anotador": VERSAO });
  res.end(corpo);
}

function lerCorpo(req: IncomingMessage, limite = LIMITE_CORPO): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on("data", (pedaco: Buffer) => {
      total += pedaco.length;
      if (total > limite) {
        rejeitar(new Error("corpo maior que o limite"));
        req.destroy();
        return;
      }
      partes.push(pedaco);
    });
    req.on("end", () => resolver(Buffer.concat(partes)));
    req.on("error", rejeitar);
  });
}

function descomprimir(resposta: IncomingMessage): NodeJS.ReadableStream {
  const codificacao = String(resposta.headers["content-encoding"] ?? "").toLowerCase();
  if (codificacao === "gzip") return resposta.pipe(createGunzip());
  if (codificacao === "deflate") return resposta.pipe(createInflate());
  if (codificacao === "br") return resposta.pipe(createBrotliDecompress());
  return resposta;
}

function coletar(fluxo: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    fluxo.on("data", (p: Buffer) => partes.push(p));
    fluxo.on("end", () => resolver(Buffer.concat(partes)));
    fluxo.on("error", rejeitar);
  });
}

function paginaErro(alvo: URL, erro: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>anotador-ui</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#1f2221;color:#e7e7e7;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:560px;padding:32px;background:#242827;border:1px solid #343837;border-radius:16px}code{color:#cfe3ff}h1{font-size:18px;margin:0 0 12px}</style></head>
<body><main><h1>O anotador não alcançou o app</h1>
<p>Alvo: <code>${alvo.origin}</code></p><p>Erro: <code>${erro}</code></p>
<p>Confira se o servidor de desenvolvimento está rodando nessa porta e recarregue — ou <a href="${BASE}/" style="color:#9dbdf7">troque o app conectado</a>.</p></main></body></html>`;
}

function origemPublicaDe(req: IncomingMessage, opcoes: OpcoesServidor): string {
  if (opcoes.publico) return opcoes.publico;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]?.trim() || "http";
  return `${proto}://${req.headers.host ?? `localhost:${opcoes.porta}`}`;
}

function enderecoInterno(opcoes: OpcoesServidor, porta: number): string {
  const host = opcoes.host === "0.0.0.0" || opcoes.host === "::" || opcoes.host === "" ? "127.0.0.1" : opcoes.host;
  return `http://${host}:${porta}`;
}

// ---------- proxy ----------
function encaminhar(req: IncomingMessage, res: ServerResponse, alvo: URL, opcoes: OpcoesServidor): void {
  const origemPublica = origemPublicaDe(req, opcoes);
  const ctx = { alvo, origemPublica };
  const pedir = alvo.protocol === "https:" ? pedidoHttps : pedidoHttp;
  const pedido = pedir(
    {
      protocol: alvo.protocol,
      hostname: alvo.hostname,
      port: alvo.port || (alvo.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url ?? "/",
      headers: cabecalhosParaAlvo(req.headers, ctx),
      rejectUnauthorized: false,
    },
    (resposta) => {
      const destino = String(req.headers["sec-fetch-dest"] ?? "");
      const navegacao = !destino || destino === "document" || destino === "iframe" || destino === "frame";
      const injetar = req.method === "GET" && resposta.statusCode === 200 && ehHtml(resposta.headers) && navegacao;
      if (!injetar) {
        res.writeHead(resposta.statusCode ?? 502, filtrarCabecalhosResposta(resposta.headers, { ...ctx, removerCsp: opcoes.removerCsp, bufferizado: false }));
        resposta.pipe(res);
        return;
      }
      coletar(descomprimir(resposta))
        .then((corpo) => {
          const html = corpo.toString("utf8");
          const nonce = extrairNonce(html);
          const saida = injetarScript(html, { src: `${BASE}/overlay.js`, nonce });
          const cabecalhos = filtrarCabecalhosResposta(resposta.headers, { ...ctx, removerCsp: opcoes.removerCsp, bufferizado: true });
          cabecalhos["content-length"] = Buffer.byteLength(saida);
          res.writeHead(resposta.statusCode ?? 200, cabecalhos);
          res.end(saida);
        })
        .catch((erro: Error) => {
          registrar(opcoes, `falha ao reescrever HTML de ${req.url}: ${erro.message}`);
          if (!res.headersSent) responderTexto(res, 502, paginaErro(alvo, erro.message), "text/html; charset=utf-8");
        });
    }
  );
  pedido.on("error", (erro: NodeJS.ErrnoException) => {
    registrar(opcoes, `alvo indisponível (${erro.code ?? erro.message}) em ${req.method} ${req.url}`);
    if (!res.headersSent) responderTexto(res, 502, paginaErro(alvo, erro.code ?? erro.message), "text/html; charset=utf-8");
  });
  req.pipe(pedido);
}

function tunelarWs(req: IncomingMessage, socket: Duplex, cabeca: Buffer, alvo: URL, opcoes: OpcoesServidor): void {
  const ctx = { alvo, origemPublica: origemPublicaDe(req, opcoes) };
  const pedir = alvo.protocol === "https:" ? pedidoHttps : pedidoHttp;
  const pedido = pedir({
    protocol: alvo.protocol,
    hostname: alvo.hostname,
    port: alvo.port || (alvo.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: req.url ?? "/",
    headers: cabecalhosParaAlvo(req.headers, ctx),
    rejectUnauthorized: false,
  });
  pedido.on("upgrade", (resposta, socketAlvo, cabecaAlvo) => {
    const linhas = [`HTTP/1.1 ${resposta.statusCode ?? 101} ${resposta.statusMessage ?? "Switching Protocols"}`];
    for (const [nome, valor] of Object.entries(resposta.headers)) {
      if (valor === undefined) continue;
      for (const v of Array.isArray(valor) ? valor : [valor]) linhas.push(`${nome}: ${v}`);
    }
    socket.write(linhas.join("\r\n") + "\r\n\r\n");
    if (cabecaAlvo.length) socket.write(cabecaAlvo);
    if (cabeca.length) socketAlvo.write(cabeca);
    socketAlvo.pipe(socket);
    socket.pipe(socketAlvo);
    const derrubar = () => {
      socket.destroy();
      socketAlvo.destroy();
    };
    socket.on("error", derrubar);
    socketAlvo.on("error", derrubar);
    socket.on("close", derrubar);
    socketAlvo.on("close", derrubar);
  });
  pedido.on("response", (resposta) => {
    socket.write(`HTTP/1.1 ${resposta.statusCode ?? 502} ${resposta.statusMessage ?? ""}\r\nConnection: close\r\n\r\n`);
    socket.end();
  });
  pedido.on("error", () => socket.destroy());
  pedido.end();
}

// ---------- API da fila ----------
interface ContextoApi {
  fila: Fila;
  difusor: Difusor;
  opcoes: OpcoesServidor;
  porta: () => number;
  alvo: () => URL | null;
  conectar: (pedido: PedidoConexao) => Promise<void>;
  desconectar: () => void;
  ponte: Ponte;
  registro: RegistroConexoes | null;
  /** última sondagem do alvo, para a página de conexão não martelar o app */
  sondagem: { em: number; alvo: string | null; valor: Sondagem | null };
}

// POSTs que mudam a conexão só de quem está na própria página (ou de uma CLI, que não manda Origin).
function mesmaOrigem(req: IncomingMessage): boolean {
  const site = String(req.headers["sec-fetch-site"] ?? "");
  if (site) return site === "same-origin" || site === "none";
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(String(origem)).host === String(req.headers.host ?? "");
  } catch {
    return false;
  }
}

async function lerJson(req: IncomingMessage, limite = 64 * 1024): Promise<Record<string, unknown>> {
  const bruto = (await lerCorpo(req, limite)).toString("utf8");
  if (!bruto.trim()) return {};
  const valor = JSON.parse(bruto) as unknown;
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
}

function ipsDaRede(): string[] {
  const saida: string[] = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const iface of lista ?? []) {
      if (iface.family === "IPv4" && !iface.internal) saida.push(iface.address);
    }
  }
  return saida;
}

async function sondagemDoAlvo(ctx: ContextoApi): Promise<Sondagem | null> {
  const alvo = ctx.opcoes.alvo;
  if (!alvo) return null;
  const agora = Date.now();
  if (ctx.sondagem.alvo === alvo && ctx.sondagem.valor && agora - ctx.sondagem.em < 4000) return ctx.sondagem.valor;
  // Primeira resposta de um dev server compilando pode passar de 2 s; a página só pergunta a cada 4 s.
  const valor = await sondar(alvo, 4000);
  ctx.sondagem = { em: agora, alvo, valor };
  return valor;
}

/** "Opus 5 · alto" a partir da configuração da ponte, para mostrar de quem é a resposta. */
function rotuloDoModelo(ponte: PonteConfig | null | undefined): string | null {
  if (!ponte?.modelo) return null;
  const modelo = modelosDe(ponte.agente).find((m) => m.valor === ponte.modelo);
  const titulo = modelo?.titulo ?? ponte.modelo;
  return ponte.esforco ? `${titulo} · ${ponte.esforco}` : titulo;
}

async function saude(ctx: ContextoApi): Promise<Record<string, unknown>> {
  const { fila, difusor, opcoes } = ctx;
  const [app, pendentes, conexoes, fontes] = await Promise.all([
    sondagemDoAlvo(ctx),
    fila.pendentes().then((l) => l.length).catch(() => 0),
    ctx.registro ? ctx.registro.listar() : Promise.resolve([]),
    estadoDasFontes().catch(() => null),
  ]);
  return {
    ok: true,
    nome: opcoes.nome,
    agente: opcoes.agente,
    alvo: opcoes.alvo,
    conectado: opcoes.alvo !== null,
    fonte: opcoes.fonte,
    saida: fila.dir,
    porta: ctx.porta(),
    host: opcoes.host,
    ips: ipsDaRede(),
    ouvintes: difusor.tamanho,
    quemOuve: difusor.ouvintes(),
    capturas: opcoes.capturas,
    ponte: opcoes.ponte ?? null,
    app,
    pendentes,
    conexoes: conexoes.slice(0, 8),
    fontes,
    versao: VERSAO,
    protocolo: 1,
  };
}

function resumoLote(lote: Lote): string {
  const itens = [...lote.anotacoes]
    .sort((a, b) => a.ordem - b.ordem)
    .map((a) => {
      const comp = a.elemento.meta.componentes[0];
      const quem = (comp ? comp + " › " : "") + a.elemento.meta.tag;
      const oQue = a.comentario ? `"${a.comentario.slice(0, 80)}"` : `${a.alteracoes.length + (a.texto ? 1 : 0)} alteração(ões)`;
      return `${a.ordem}) ${oQue} em ${quem}`;
    });
  const texto = `${lote.anotacoes.length} anotação(ões) em ${lote.pagina.caminho || lote.pagina.url}: ${itens.join(" · ")}`;
  return texto.length > 600 ? texto.slice(0, 597) + "..." : texto;
}

async function processarLote(ctx: ContextoApi, lote: Lote, origemPublica: string): Promise<void> {
  const { fila, difusor, opcoes } = ctx;
  let arquivos: string[] = [];
  if (opcoes.fonte) {
    try {
      const analise = await analisarLote(opcoes.fonte, lote);
      await fila.anexarAnalise(lote.id, analise);
      arquivos = arquivosProvaveis(analise);
    } catch (erro) {
      registrar(opcoes, `análise do código-fonte falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  let capturas: CapturaLote | null = null;
  if (opcoes.capturas && lote.instantaneo) {
    // Mesma origem que a página usa primeiro: fontes e assets do instantâneo dependem disso (CORS).
    const caminhoInstantaneo = `${BASE}/lotes/${lote.id}/instantaneo`;
    const urlsInstantaneo = Array.from(new Set([origemPublica + caminhoInstantaneo, enderecoInterno(opcoes, ctx.porta()) + caminhoInstantaneo]));
    capturas = await capturarLote(fila, lote, { urlsInstantaneo, chrome: opcoes.chrome });
    await fila.anexarCapturas(lote.id, capturas);
    if (capturas.erro) registrar(opcoes, `capturas do lote ${lote.id}: ${capturas.erro}`);
  }
  const entregues = difusor.transmitir({
    tipo: "lote",
    id: lote.id,
    quantidade: lote.anotacoes.length,
    url: lote.pagina.url,
    resumo: resumoLote(lote),
    caminhoMd: fila.caminhoMd(lote.id),
    capturas,
    arquivos,
  });
  registrar(
    opcoes,
    `lote ${lote.id}: ${lote.anotacoes.length} anotação(ões) em ${lote.pagina.caminho}${arquivos.length ? ` → ${arquivos.join(", ")}` : ""} — ${entregues} ouvinte(s) avisado(s); md em ${fila.caminhoMd(lote.id)}`
  );
  if (entregues === 0 && opcoes.ponte) {
    try {
      await ctx.ponte.iniciar({
        agente: opcoes.ponte.agente,
        sessao: opcoes.ponte.sessao,
        modelo: opcoes.ponte.modelo ?? null,
        esforco: opcoes.ponte.esforco ?? null,
        fonte: opcoes.fonte,
        motivo: `lote ${lote.id.slice(0, 8)} sem ninguém ouvindo`,
        mensagem: mensagemParaLote({ porta: ctx.porta(), nome: opcoes.nome, alvo: opcoes.alvo, fonte: opcoes.fonte, raizFerramenta: RAIZ }, { id: lote.id, caminhoMd: fila.caminhoMd(lote.id), resumo: resumoLote(lote) }),
      });
    } catch (erro) {
      registrar(opcoes, `ponte não iniciou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
}

async function tratarApi(req: IncomingMessage, res: ServerResponse, url: URL, ctx: ContextoApi): Promise<boolean> {
  const { fila, difusor, opcoes } = ctx;
  const caminho = url.pathname.slice(BASE.length) || "/";
  const metodo = req.method ?? "GET";

  if (caminho === "/" && metodo === "GET") {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(302, { location: BASE + "/" + url.search });
      res.end();
      return true;
    }
    responderTexto(res, 200, await paginaConexao(), "text/html; charset=utf-8");
    return true;
  }
  if (caminho === "/saude" && metodo === "GET") {
    responderJson(res, 200, await saude(ctx));
    return true;
  }
  if (caminho === "/deteccao" && metodo === "GET") {
    const pedidas = (url.searchParams.get("portas") ?? "")
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
    const servidores = await detectarServidores(pedidas.length ? pedidas : PORTAS_COMUNS, { ignorar: [ctx.porta()] });
    responderJson(res, 200, { ok: true, servidores });
    return true;
  }
  if (caminho === "/sondar" && metodo === "POST") {
    let corpo: Record<string, unknown>;
    try {
      corpo = await lerJson(req);
    } catch {
      responderJson(res, 400, { ok: false, erro: "corpo inválido" });
      return true;
    }
    const alvoTexto = typeof corpo["alvo"] === "string" ? corpo["alvo"].trim() : "";
    let alvoUrl: URL;
    try {
      alvoUrl = new URL(/^[a-z]+:\/\//i.test(alvoTexto) ? alvoTexto : "http://" + alvoTexto);
    } catch {
      responderJson(res, 400, { ok: false, erro: "URL inválida" });
      return true;
    }
    const motivo = opcoes.permitirExterno ? null : alvoPermitido(alvoUrl);
    if (motivo) {
      responderJson(res, 400, { ok: false, erro: motivo });
      return true;
    }
    responderJson(res, 200, { ok: true, sondagem: await sondar(alvoUrl.origin, 3000) });
    return true;
  }
  if (caminho === "/conectar" && metodo === "POST") {
    if (!mesmaOrigem(req)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode trocar o alvo" });
      return true;
    }
    let corpo: Record<string, unknown>;
    try {
      corpo = await lerJson(req);
    } catch {
      responderJson(res, 400, { ok: false, erro: "corpo inválido" });
      return true;
    }
    const alvoTexto = typeof corpo["alvo"] === "string" ? corpo["alvo"].trim() : "";
    if (!alvoTexto) {
      responderJson(res, 400, { ok: false, erro: "informe a URL do servidor de desenvolvimento" });
      return true;
    }
    let alvoUrl: URL;
    try {
      alvoUrl = new URL(/^[a-z]+:\/\//i.test(alvoTexto) ? alvoTexto : "http://" + alvoTexto);
    } catch {
      responderJson(res, 400, { ok: false, erro: "URL inválida" });
      return true;
    }
    const motivo = opcoes.permitirExterno ? null : alvoPermitido(alvoUrl);
    if (motivo) {
      responderJson(res, 400, { ok: false, erro: motivo });
      return true;
    }
    if (corpo["forcar"] !== true) {
      const s = await sondar(alvoUrl.origin, 3000);
      if (s.anotador) {
        responderJson(res, 400, { ok: false, erro: "essa URL é o próprio anotador; aponte para o servidor do app" });
        return true;
      }
      if (!s.alcancavel) {
        responderJson(res, 409, { ok: false, erro: `nada respondeu em ${alvoUrl.origin} (${s.erro ?? "sem detalhes"}); o servidor de desenvolvimento está rodando?` });
        return true;
      }
    }
    const pedido: PedidoConexao = { alvo: alvoUrl.origin };
    if (typeof corpo["nome"] === "string" && corpo["nome"].trim()) pedido.nome = corpo["nome"].trim().slice(0, 80);
    if (typeof corpo["fonte"] === "string" && corpo["fonte"].trim()) pedido.fonte = corpo["fonte"].trim();
    if (typeof corpo["agente"] === "string" && corpo["agente"].trim()) pedido.agente = corpo["agente"].trim().slice(0, 40);
    try {
      await ctx.conectar(pedido);
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
      return true;
    }
    responderJson(res, 200, { ok: true, saude: await saude(ctx) });
    return true;
  }
  if (caminho === "/desconectar" && metodo === "POST") {
    if (!mesmaOrigem(req)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode desconectar" });
      return true;
    }
    ctx.desconectar();
    responderJson(res, 200, { ok: true, saude: await saude(ctx) });
    return true;
  }
  if (caminho === "/agentes" && metodo === "GET") {
    const fonte = opcoes.fonte;
    const [claude, codex] = await Promise.all([sessoesClaude(fonte).catch(() => []), sessoesCodex(fonte).catch(() => [])]);
    responderJson(res, 200, { ok: true, agentes: detectarAgentes(), sessoes: [...claude, ...codex], ponte: opcoes.ponte ?? null, execucoes: ctx.ponte.execucoes, ouvintes: difusor.ouvintes() });
    return true;
  }
  if (caminho === "/agente/iniciar" && metodo === "POST") {
    if (!mesmaOrigem(req)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode iniciar um agente" });
      return true;
    }
    let corpo: Record<string, unknown>;
    try {
      corpo = await lerJson(req);
    } catch {
      responderJson(res, 400, { ok: false, erro: "corpo inválido" });
      return true;
    }
    const agente = String(corpo["agente"] ?? "") as IdAgente;
    if (!detectarAgentes().some((a) => a.id === agente && a.ponte)) {
      responderJson(res, 400, { ok: false, erro: "agente sem ponte por linha de comando" });
      return true;
    }
    const sessao = typeof corpo["sessao"] === "string" && /^[\w.-]{1,120}$/.test(corpo["sessao"]) ? corpo["sessao"] : null;
    try {
      const pendentes = (await fila.pendentes()).length;
      const modelos = modelosDe(agente);
      const modelo = typeof corpo["modelo"] === "string" && modelos.some((m) => m.valor === corpo["modelo"]) ? corpo["modelo"] : opcoes.ponte?.agente === agente ? (opcoes.ponte.modelo ?? null) : null;
      const esforco = typeof corpo["esforco"] === "string" && modelos.find((m) => m.valor === modelo)?.esforcos.includes(corpo["esforco"]) ? corpo["esforco"] : opcoes.ponte?.agente === agente ? (opcoes.ponte.esforco ?? null) : null;
      const execucao = await ctx.ponte.iniciar({
        agente,
        sessao,
        modelo,
        esforco,
        fonte: opcoes.fonte,
        motivo: "iniciado pela página de conexão",
        mensagem: typeof corpo["mensagem"] === "string" && corpo["mensagem"].trim() ? corpo["mensagem"].trim().slice(0, 4000) : mensagemDeAbertura({ porta: ctx.porta(), nome: opcoes.nome, alvo: opcoes.alvo, fonte: opcoes.fonte, raizFerramenta: RAIZ }, pendentes),
      });
      responderJson(res, 201, { ok: true, execucao });
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
    }
    return true;
  }
  if (caminho === "/agente/ponte" && metodo === "POST") {
    if (!mesmaOrigem(req)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode mudar a ponte" });
      return true;
    }
    let corpo: Record<string, unknown>;
    try {
      corpo = await lerJson(req);
    } catch {
      responderJson(res, 400, { ok: false, erro: "corpo inválido" });
      return true;
    }
    if (corpo["agente"] === null || corpo["agente"] === undefined || corpo["agente"] === "") {
      opcoes.ponte = null;
    } else {
      const agente = String(corpo["agente"]) as IdAgente;
      if (!detectarAgentes().some((a) => a.id === agente && a.ponte && a.instalado)) {
        responderJson(res, 400, { ok: false, erro: "agente não instalado ou sem ponte por linha de comando" });
        return true;
      }
      const modelos = modelosDe(agente);
      const modelo = typeof corpo["modelo"] === "string" && modelos.some((m) => m.valor === corpo["modelo"]) ? corpo["modelo"] : null;
      const esforco = typeof corpo["esforco"] === "string" && modelos.find((m) => m.valor === modelo)?.esforcos.includes(corpo["esforco"]) ? corpo["esforco"] : null;
      opcoes.ponte = { agente, sessao: typeof corpo["sessao"] === "string" && /^[\w.-]{1,120}$/.test(corpo["sessao"]) ? corpo["sessao"] : null, modelo, esforco };
    }
    if (ctx.registro && opcoes.alvo) await ctx.registro.registrar({ alvo: opcoes.alvo, nome: opcoes.nome, fonte: opcoes.fonte, agente: opcoes.agente, ponte: opcoes.ponte ?? null });
    registrar(opcoes, opcoes.ponte ? `ponte automática: ${opcoes.ponte.agente}${opcoes.ponte.modelo ? ` · ${rotuloDoModelo(opcoes.ponte)}` : ""}${opcoes.ponte.sessao ? ` (sessão ${opcoes.ponte.sessao.slice(0, 8)})` : ""}` : "ponte automática desligada");
    responderJson(res, 200, { ok: true, ponte: opcoes.ponte ?? null });
    return true;
  }
  const mLog = /^\/agente\/execucoes\/([^/]+)\/log$/.exec(caminho);
  if (mLog && metodo === "GET") {
    const texto = await ctx.ponte.lerLog(decodeURIComponent(mLog[1] ?? ""));
    if (texto === null) responderJson(res, 404, { ok: false, erro: "execução não encontrada" });
    else responderTexto(res, 200, texto);
    return true;
  }
  if (caminho === "/overlay.js" && metodo === "GET") {
    const codigo = await montarOverlay({
      base: BASE,
      capturas: opcoes.capturas,
      nome: opcoes.nome,
      agente: opcoes.agente,
      marca: marcaPeloNome(opcoes.ponte?.agente ?? opcoes.agente),
      modelo: rotuloDoModelo(opcoes.ponte),
    });
    responderTexto(res, 200, codigo, "application/javascript; charset=utf-8");
    return true;
  }
  if (caminho === "/lotes" && metodo === "POST") {
    let lote: Lote;
    try {
      lote = validarLote(JSON.parse((await lerCorpo(req)).toString("utf8")));
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
      return true;
    }
    const { registro, novo } = await fila.gravar(lote);
    responderJson(res, novo ? 201 : 200, { ok: true, id: lote.id, novo, caminhoMd: registro.caminhoMd });
    if (novo) processarLote(ctx, lote, origemPublicaDe(req, opcoes)).catch((erro: Error) => registrar(opcoes, `falha ao processar lote ${lote.id}: ${erro.message}`));
    return true;
  }
  if (caminho === "/lotes" && metodo === "GET") {
    const registros = url.searchParams.get("estado") === "pendente" ? await fila.pendentes() : await fila.listar();
    responderJson(res, 200, { ok: true, lotes: registros });
    return true;
  }
  const m = /^\/lotes\/([^/]+)(?:\/(status|md|instantaneo|progresso|processado|capturas|conversa|mensagens))?$/.exec(caminho);
  if (m) {
    const id = decodeURIComponent(m[1] ?? "");
    const sub = m[2];
    if (!idSeguro(id)) {
      responderJson(res, 400, { ok: false, erro: "id inválido" });
      return true;
    }
    if (sub === "status" && metodo === "GET") {
      responderJson(res, 200, await fila.status(id));
      return true;
    }
    if (sub === "md" && metodo === "GET") {
      const md = await fila.lerMarkdown(id);
      if (md === null) responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
      else responderTexto(res, 200, md, "text/markdown; charset=utf-8");
      return true;
    }
    if (sub === "instantaneo" && metodo === "GET") {
      const html = await fila.lerInstantaneo(id);
      if (html === null) responderJson(res, 404, { ok: false, erro: "instantâneo não encontrado" });
      else responderTexto(res, 200, html, "text/html; charset=utf-8");
      return true;
    }
    if (sub === "capturas" && metodo === "GET") {
      responderJson(res, 200, (await fila.capturas(id)) ?? { anotacoes: {} });
      return true;
    }
    if (sub === "conversa" && metodo === "GET") {
      if (!(await fila.existe(id))) {
        responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
        return true;
      }
      responderJson(res, 200, { ok: true, mensagens: await fila.conversa(id), abertas: (await fila.perguntasAbertas(id)).map((p) => p.id) });
      return true;
    }
    if (sub === "mensagens" && metodo === "POST") {
      let corpo: Record<string, unknown>;
      try {
        corpo = JSON.parse((await lerCorpo(req, 256 * 1024)).toString("utf8")) as Record<string, unknown>;
      } catch {
        responderJson(res, 400, { ok: false, erro: "corpo inválido" });
        return true;
      }
      const autor = corpo["autor"] === "usuario" ? "usuario" : "agente";
      const tipo = String(corpo["tipo"] ?? (autor === "usuario" ? "resposta" : "nota"));
      if (!["nota", "pergunta", "escolha", "resposta"].includes(tipo) || (autor === "usuario") !== (tipo === "resposta")) {
        responderJson(res, 400, { ok: false, erro: "tipo incompatível com o autor" });
        return true;
      }
      const texto = typeof corpo["texto"] === "string" ? corpo["texto"].trim() : "";
      const alternativas = Array.isArray(corpo["opcoes"]) ? (corpo["opcoes"] as unknown[]).filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : [];
      if (!texto && !alternativas.length) {
        responderJson(res, 400, { ok: false, erro: "mensagem vazia" });
        return true;
      }
      if (tipo === "escolha" && alternativas.length < 2) {
        responderJson(res, 400, { ok: false, erro: "escolha exige pelo menos duas opções" });
        return true;
      }
      // Resposta sem `responde` é recado livre do usuário sobre o lote.
      const responde = typeof corpo["responde"] === "string" && idSeguro(corpo["responde"]) ? corpo["responde"] : undefined;
      let mensagem: Mensagem | null;
      try {
        const entrada: Omit<Mensagem, "id" | "em"> = { lote: id, autor, tipo: tipo as TipoMensagem, texto };
        if (autor === "agente") entrada.agente = typeof corpo["agente"] === "string" && corpo["agente"].trim() ? corpo["agente"].trim() : opcoes.agente;
        if (alternativas.length) entrada.opcoes = alternativas;
        if (responde) entrada.responde = responde;
        if (corpo["multipla"] === true) entrada.multipla = true;
        mensagem = await fila.registrarMensagem(entrada);
      } catch (erro) {
        responderJson(res, 409, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
        return true;
      }
      if (!mensagem) {
        responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
        return true;
      }
      difusor.transmitir({ tipo: "mensagem", id, mensagem });
      registrar(opcoes, `lote ${id} · ${mensagem.autor} ${mensagem.tipo}: ${mensagem.texto.slice(0, 120)}${mensagem.opcoes?.length ? ` [${mensagem.opcoes.join(" | ")}]` : ""}`);
      responderJson(res, 201, { ok: true, mensagem });
      return true;
    }
    if ((sub === "processado" || sub === "progresso") && metodo === "POST") {
      let nota = "";
      try {
        const corpo = (await lerCorpo(req, 64 * 1024)).toString("utf8");
        nota = corpo ? String((JSON.parse(corpo) as { nota?: unknown }).nota ?? "") : "";
      } catch {
        nota = "";
      }
      if (sub === "progresso") {
        const status = await fila.marcarProgresso(id, nota);
        if (!status) {
          responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
          return true;
        }
        difusor.transmitir({ tipo: "progresso", id, nota });
        registrar(opcoes, `lote ${id} em andamento: ${nota}`);
        responderJson(res, 200, { ok: true, status });
        return true;
      }
      const status = await fila.marcarProcessado(id, nota);
      if (!status) {
        responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
        return true;
      }
      difusor.transmitir({ tipo: "processado", id, nota });
      registrar(opcoes, `lote ${id} marcado como processado${nota ? `: ${nota}` : ""}`);
      responderJson(res, 200, { ok: true, status });
      return true;
    }
    if (!sub && metodo === "GET") {
      const lote = await fila.ler(id);
      if (!lote) responderJson(res, 404, { ok: false, erro: "lote não encontrado" });
      else responderJson(res, 200, { ok: true, lote, status: await fila.status(id), capturas: await fila.capturas(id) });
      return true;
    }
  }
  responderJson(res, 404, { ok: false, erro: "rota desconhecida" });
  return true;
}

// ---------- servidor ----------
export async function iniciarServidor(opcoesIniciais: OpcoesServidor): Promise<ServidorAnotador> {
  // Cópia mutável: a conexão (alvo, nome, fonte, agente) pode mudar pela página sem reiniciar.
  const opcoes: OpcoesServidor = { ...opcoesIniciais, ponte: opcoesIniciais.ponte ?? null };
  const saidaDe = (nome: string) => opcoesIniciais.saida ?? join(pastaBase(), nome);
  let fila = new Fila(saidaDe(opcoes.nome));
  await fila.preparar();
  const difusor = new Difusor();
  const registro = opcoes.registro === null ? null : new RegistroConexoes(opcoes.registro ?? undefined);
  const ponte = new Ponte(join(fila.dir, "agentes"), (m) => registrar(opcoes, m));
  let alvoUrl: URL | null = null;
  let portaReal = opcoes.porta;

  const aplicarAlvo = (texto: string | null): void => {
    if (texto === null) {
      alvoUrl = null;
      opcoes.alvo = null;
      return;
    }
    const url = new URL(texto);
    const motivo = opcoes.permitirExterno ? null : alvoPermitido(url);
    if (motivo) throw new Error(`alvo ${url.origin} recusado: ${motivo} (--permitir-externo libera)`);
    alvoUrl = url;
    opcoes.alvo = url.origin;
  };

  const conectar = async (pedido: PedidoConexao): Promise<void> => {
    if (pedido.fonte) {
      const info = await stat(pedido.fonte).catch(() => null);
      if (!info || !info.isDirectory()) throw new Error(`pasta do código-fonte não encontrada: ${pedido.fonte}`);
    }
    aplicarAlvo(pedido.alvo);
    if (pedido.nome && pedido.nome !== opcoes.nome) {
      opcoes.nome = pedido.nome;
      if (!opcoesIniciais.saida) {
        fila = new Fila(saidaDe(pedido.nome));
        await fila.preparar();
        ctx.fila = fila;
        ponte.pasta = join(fila.dir, "agentes");
      }
    }
    if (pedido.fonte) opcoes.fonte = pedido.fonte;
    if (pedido.agente) opcoes.agente = pedido.agente;
    ctx.sondagem = { em: 0, alvo: null, valor: null };
    if (registro) await registro.registrar({ alvo: opcoes.alvo ?? pedido.alvo, nome: opcoes.nome, fonte: opcoes.fonte, agente: opcoes.agente, ponte: opcoes.ponte ?? null });
    difusor.transmitir({ tipo: "conexao", nome: opcoes.nome, alvo: opcoes.alvo, url: opcoes.alvo ?? undefined });
    registrar(opcoes, `conectado a ${opcoes.alvo} · projeto ${opcoes.nome} · fonte ${opcoes.fonte ?? "—"} · agente ${opcoes.agente}`);
    if (opcoes.fonte) {
      const inicio = Date.now();
      void lerProjeto(opcoes.fonte)
        .then((arquivos) => registrar(opcoes, `código-fonte: ${arquivos.length} arquivos indexados em ${Date.now() - inicio} ms`))
        .catch((erro: Error) => registrar(opcoes, `falha ao indexar o código-fonte: ${erro.message}`));
    }
  };

  const desconectar = (): void => {
    aplicarAlvo(null);
    ctx.sondagem = { em: 0, alvo: null, valor: null };
    difusor.transmitir({ tipo: "conexao", nome: opcoes.nome, alvo: null });
    registrar(opcoes, "desconectado do app; a página em " + BASE + "/ pede um novo alvo");
  };

  const ctx: ContextoApi = { fila, difusor, opcoes, porta: () => portaReal, alvo: () => alvoUrl, conectar, desconectar, ponte, registro, sondagem: { em: 0, alvo: null, valor: null } };

  if (opcoes.alvo) {
    const inicial = opcoes.alvo;
    opcoes.alvo = null;
    await conectar({ alvo: inicial });
  }

  const servidor = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://interno");
    if (url.pathname === BASE || url.pathname.startsWith(BASE + "/")) {
      tratarApi(req, res, url, ctx).catch((erro: Error) => {
        registrar(opcoes, `erro na API ${req.url}: ${erro.message}`);
        if (!res.headersSent) responderJson(res, 500, { ok: false, erro: erro.message });
      });
      return;
    }
    if (!alvoUrl) {
      const destino = String(req.headers["sec-fetch-dest"] ?? "");
      const navegacao = req.method === "GET" && (!destino || destino === "document") && /text\/html/.test(String(req.headers.accept ?? "text/html"));
      if (navegacao) {
        res.writeHead(302, { location: BASE + "/", "cache-control": "no-store" });
        res.end();
      } else {
        responderJson(res, 503, { ok: false, erro: `anotador sem app conectado; abra ${BASE}/` });
      }
      return;
    }
    encaminhar(req, res, alvoUrl, opcoes);
  });

  // Sockets promovidos a WebSocket saem do controle do http.Server: sem isto, fechar() espera por eles para sempre.
  const socketsPromovidos = new Set<Duplex>();
  servidor.on("upgrade", (req, socket, cabeca) => {
    socketsPromovidos.add(socket);
    socket.once("close", () => socketsPromovidos.delete(socket));
    const url = new URL(req.url ?? "/", "http://interno");
    if (url.pathname === BASE + "/eventos" && ehPedidoWs(req)) {
      const conexao = difusor.aceitar(req, socket);
      conexao.enviar(JSON.stringify({ tipo: "ola", nome: opcoes.nome, alvo: opcoes.alvo } satisfies EventoAnotador));
      const quem: InfoOuvinte | undefined = difusor.ouvintes().pop();
      registrar(opcoes, `ouvinte conectado aos eventos (${difusor.tamanho} no total)${quem?.agente ? ` — ${quem.agente}${quem.sessao ? ` sessão ${quem.sessao.slice(0, 8)}` : ""}` : ""}`);
      return;
    }
    if (!alvoUrl) {
      socket.destroy();
      return;
    }
    tunelarWs(req, socket, cabeca, alvoUrl, opcoes);
  });

  await new Promise<void>((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(opcoes.porta, opcoes.host, () => {
      const endereco = servidor.address();
      if (endereco && typeof endereco === "object") portaReal = endereco.port;
      servidor.off("error", rejeitar);
      resolver();
    });
  });

  return {
    porta: portaReal,
    get fila() {
      return ctx.fila;
    },
    difusor,
    get alvo() {
      return opcoes.alvo;
    },
    conectar,
    desconectar,
    fechar: () =>
      new Promise<void>((resolver) => {
        difusor.fecharTodas();
        for (const s of socketsPromovidos) s.destroy();
        socketsPromovidos.clear();
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
  };
}

// ---------- linha de comando ----------
function ajuda(): string {
  return `anotador-ui — anote a interface do app em desenvolvimento e entregue as anotações a um agente de código

uso:
  anotador                        sobe na porta 3999; reconecta ao último app desta pasta ou abre a página de conexão
  anotador servir [--alvo http://localhost:3000] [--porta 3999] [--host 0.0.0.0] [--nome slug] [--saida dir] [--fonte dir]
                  [--agente Claude] [--publico http://ip:porta] [--sem-csp] [--sem-capturas] [--chrome caminho] [--permitir-externo]
  anotador conectar <url> [--porta 3999]        (troca o app de um anotador já no ar)
  anotador desconectar [--porta 3999]
  anotador fontes [--compact] [--forcar]        (instala a San Francisco da Apple nesta máquina)
  anotador saude [--porta 3999]
  anotador pendentes [--porta 3999] [--saida dir]
  anotador ver <id> [--porta 3999] [--saida dir]
  anotador progresso <id> --nota "o que está sendo feito" [--porta 3999]
  anotador nota <id> --texto "explicação para o usuário" [--agente Nome] [--porta 3999]
  anotador perguntar <id> --texto "pergunta" [--opcoes "A|B|C"] [--multipla] [--agente Nome] [--porta 3999]
  anotador conversa <id> [--porta 3999]        (mensagens e respostas do lote)
  anotador processado <id> [--nota "o que foi feito"] [--porta 3999] [--saida dir]

padrões: porta 3999 · nome = pasta atual · saída ~/.claude/anotacoes/<nome> (ANOTADOR_HOME troca a base) · fonte = pasta atual · agente Claude
a página http://localhost:<porta>/__anotador/ detecta servidores em dev, conecta, mostra os agentes instalados (Claude Code, Codex, Gemini…),
as sessões do projeto e quem está ouvindo; a ponte automática chama o agente escolhido quando ninguém ouve.

qualquer agente pode operar a fila: ouça ws://127.0.0.1:<porta>/__anotador/eventos?agente=Nome, leia lotes/<id>.md e use a API REST (ver README).`;
}

async function chamarApi(porta: number, caminho: string, metodo = "GET", corpo?: unknown): Promise<unknown> {
  const resp = await fetch(`http://127.0.0.1:${porta}${BASE}${caminho}`, {
    method: metodo,
    headers: corpo === undefined ? {} : { "content-type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

async function principal(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      alvo: { type: "string" },
      porta: { type: "string", default: "3999" },
      host: { type: "string", default: "0.0.0.0" },
      nome: { type: "string" },
      saida: { type: "string" },
      fonte: { type: "string" },
      publico: { type: "string" },
      nota: { type: "string" },
      texto: { type: "string" },
      opcoes: { type: "string" },
      multipla: { type: "boolean", default: false },
      agente: { type: "string" },
      chrome: { type: "string" },
      "sem-csp": { type: "boolean", default: false },
      "sem-capturas": { type: "boolean", default: false },
      "permitir-externo": { type: "boolean", default: false },
      compact: { type: "boolean", default: false },
      forcar: { type: "boolean", default: false },
      ajuda: { type: "boolean", default: false },
    },
  });
  const comando = positionals[0] ?? "servir";
  if (values.ajuda || comando === "ajuda") {
    console.log(ajuda());
    return;
  }
  const porta = Number(values.porta);
  const fonte = values.fonte ?? process.cwd();
  const registro = new RegistroConexoes();
  const salva = await registro.procurarPorFonte(fonte);
  const nome = values.nome ?? salva?.nome ?? basename(process.cwd());
  const saida = values.saida ?? join(pastaBase(), nome);

  if (comando === "saude") {
    console.log(JSON.stringify(await chamarApi(porta, "/saude"), null, 2));
    return;
  }
  if (comando === "fontes") {
    const estado = await estadoDasFontes();
    if (estado.nativa) {
      console.log("Este sistema já traz a San Francisco; o anotador a usa sem instalar nada.");
      return;
    }
    console.log(`pasta:      ${estado.pasta}`);
    console.log(`instaladas: ${estado.instaladas.join(", ") || "nenhuma"}`);
    console.log(`faltando:   ${estado.faltando.join(", ") || "nenhuma"}`);
    if (estado.faltando.length === 0 && !values.forcar) {
      console.log(`\nTudo no lugar (${Math.round((await tamanhoInstalado()) / 1048576)} MB). Use --forcar para reinstalar.`);
      return;
    }
    console.log("\nBaixando de developer.apple.com. Os arquivos ficam só nesta máquina:");
    console.log("a licença da Apple permite instalar e usar, não redistribuir.\n");
    const feito = await instalarFontes({ compact: values.compact, forcar: values.forcar, aoInformar: (m) => console.log("  " + m) });
    const erros = feito.filter((f) => f.erro);
    console.log(`\n${feito.reduce((s, f) => s + f.arquivos, 0)} arquivo(s) em ${estado.pasta}`);
    if (erros.length) {
      console.error(`falhas: ${erros.map((e) => e.familia).join(", ")}`);
      process.exitCode = 1;
    } else if (feito.length) {
      console.log("Recarregue a página do anotador para ver a tipografia nova.");
    }
    return;
  }
  if (comando === "conectar") {
    const alvo = positionals[1];
    if (!alvo) throw new Error("informe a URL do servidor de desenvolvimento (ex.: anotador conectar http://localhost:3000)");
    const corpo: Record<string, unknown> = { alvo, forcar: true };
    if (values.nome) corpo["nome"] = values.nome;
    if (values.fonte) corpo["fonte"] = values.fonte;
    if (values.agente) corpo["agente"] = values.agente;
    console.log(JSON.stringify(await chamarApi(porta, "/conectar", "POST", corpo), null, 2));
    return;
  }
  if (comando === "desconectar") {
    console.log(JSON.stringify(await chamarApi(porta, "/desconectar", "POST", {}), null, 2));
    return;
  }
  if (comando === "pendentes") {
    let lotes: RegistroLote[];
    try {
      lotes = ((await chamarApi(porta, "/lotes?estado=pendente")) as { lotes: RegistroLote[] }).lotes;
    } catch {
      lotes = await new Fila(saida).pendentes();
    }
    if (lotes.length === 0) console.log("nenhum lote pendente");
    for (const l of lotes) console.log(`${l.id}\t${l.recebidoEm}\t${l.quantidade} anotação(ões)\t${l.url}\n  md: ${l.caminhoMd}`);
    return;
  }
  if (comando === "ver") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id do lote");
    let md: string | null;
    try {
      md = String(await chamarApi(porta, `/lotes/${encodeURIComponent(id)}/md`));
    } catch {
      md = await new Fila(saida).lerMarkdown(id);
    }
    console.log(md ?? "lote não encontrado");
    return;
  }
  if (comando === "progresso") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id do lote");
    console.log(JSON.stringify(await chamarApi(porta, `/lotes/${encodeURIComponent(id)}/progresso`, "POST", { nota: values.nota ?? "" })));
    return;
  }
  if (comando === "nota" || comando === "perguntar") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id do lote");
    if (!values.texto) throw new Error("informe --texto");
    const opcoes = (values.opcoes ?? "")
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean);
    const tipo = comando === "nota" ? "nota" : opcoes.length ? "escolha" : "pergunta";
    const corpo: Record<string, unknown> = { autor: "agente", tipo, texto: values.texto };
    if (values.agente) corpo["agente"] = values.agente;
    if (opcoes.length) corpo["opcoes"] = opcoes;
    if (values.multipla) corpo["multipla"] = true;
    console.log(JSON.stringify(await chamarApi(porta, `/lotes/${encodeURIComponent(id)}/mensagens`, "POST", corpo)));
    return;
  }
  if (comando === "conversa") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id do lote");
    const r = (await chamarApi(porta, `/lotes/${encodeURIComponent(id)}/conversa`)) as { ok: boolean; mensagens?: Mensagem[]; abertas?: string[]; erro?: string };
    if (!r.ok) throw new Error(r.erro ?? "falha ao ler a conversa");
    for (const m of r.mensagens ?? []) {
      const quem = m.autor === "agente" ? m.agente ?? "Agente" : "Usuário";
      const extra = m.opcoes?.length ? (m.tipo === "resposta" ? ` → ${m.opcoes.join(", ")}` : ` [${m.opcoes.join(" | ")}]`) : "";
      console.log(`${m.em}\t${quem} (${m.tipo}${m.responde ? ` a ${m.responde.slice(0, 8)}` : ""}) #${m.id.slice(0, 8)}: ${m.texto}${extra}`);
    }
    if (r.abertas?.length) console.log(`\n${r.abertas.length} pergunta(s) aguardando resposta`);
    return;
  }
  if (comando === "processado") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id do lote");
    try {
      console.log(JSON.stringify(await chamarApi(porta, `/lotes/${encodeURIComponent(id)}/processado`, "POST", { nota: values.nota ?? "" })));
    } catch {
      const status = await new Fila(saida).marcarProcessado(id, values.nota);
      console.log(status ? JSON.stringify({ ok: true, status, aviso: "servidor fora do ar: marcado direto no disco" }) : JSON.stringify({ ok: false, erro: "lote não encontrado" }));
    }
    return;
  }
  if (comando !== "servir") throw new Error(`comando desconhecido: ${comando}\n\n${ajuda()}`);

  const chrome = values["sem-capturas"] ? null : (values.chrome ?? encontrarChromium());
  const alvo = values.alvo ?? salva?.alvo ?? null;
  const opcoes: OpcoesServidor = {
    alvo,
    porta,
    host: values.host,
    nome,
    saida: values.saida ?? null,
    removerCsp: values["sem-csp"],
    capturas: !!chrome,
    chrome,
    publico: values.publico ?? null,
    fonte,
    agente: values.agente?.trim() || salva?.agente || "Claude",
    ponte: salva?.ponte && ["claude", "codex", "gemini", "opencode"].includes(salva.ponte.agente) ? { agente: salva.ponte.agente as IdAgente, sessao: salva.ponte.sessao, modelo: salva.ponte.modelo ?? null, esforco: salva.ponte.esforco ?? null } : null,
    permitirExterno: values["permitir-externo"],
  };
  let servidor: ServidorAnotador;
  try {
    servidor = await iniciarServidor(opcoes);
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === "EADDRINUSE") throw new Error(`a porta ${porta} já está em uso — escolha outra com --porta`);
    throw erro;
  }
  const linhas = [
    `anotador-ui ${VERSAO} · ${nome}`,
    servidor.alvo
      ? `  alvo:      ${servidor.alvo}${!values.alvo && salva ? " (última conexão desta pasta; --alvo troca)" : ""}`
      : `  alvo:      nenhum — abra a página de conexão para escolher o app em desenvolvimento`,
    `  conexão:   http://localhost:${servidor.porta}${BASE}/`,
    `  abra:      http://localhost:${servidor.porta}/`,
    ...ipsDaRede().map((ip) => `             http://${ip}:${servidor.porta}/`),
    `  fila:      ${servidor.fila.dir}`,
    `  fonte:     ${opcoes.fonte} (localização dos elementos no código)`,
    `  agente:    ${opcoes.agente}${opcoes.ponte ? ` · ponte automática: ${opcoes.ponte.agente}` : ""}`,
    `  eventos:   ws://127.0.0.1:${servidor.porta}${BASE}/eventos`,
    `  capturas:  ${chrome ? chrome : "desativadas (Chromium não encontrado — defina ANOTADOR_CHROME)"}`,
    `  csp:       ${opcoes.removerCsp ? "removida das respostas" : "preservada (script injetado com o nonce da página)"}`,
  ];
  const fontes = await estadoDasFontes().catch(() => null);
  if (fontes && !fontes.nativa && fontes.faltando.length) {
    linhas.push(`  fontes:    ${fontes.faltando.join(", ")} sem instalar — \`anotador fontes\` deixa a interface na tipografia da Apple`);
  }
  console.log(linhas.join("\n"));
  const encerrar = () => {
    registrar(opcoes, "encerrando");
    setTimeout(() => process.exit(0), 3000).unref();
    servidor.fechar().finally(() => process.exit(0));
  };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((erro: Error) => {
    console.error(erro.message);
    process.exit(1);
  });
}
