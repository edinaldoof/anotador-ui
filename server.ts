// anotador-ui — proxy reverso que injeta o overlay de anotação num app em
// desenvolvimento e entrega as anotações ao chat do Claude Code.

import { createServer, request as pedidoHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createServer as createServerTls } from "node:https";
import { createServer as createServerTcp, type Socket } from "node:net";
import { request as pedidoHttps } from "node:https";
import * as modulo from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir, hostname, networkInterfaces, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Writable, type Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Ponte, detectarAgentes, atualizarModelosAntigravity, mensagemDeAbertura, mensagemParaLote, modelosDe, sessoesClaude, sessoesCodex, type IdAgente } from "./lib/agentes.ts";
import { CABECALHO_CHAVE, autorizado, caminhoDaChave, chaveDaSessao, chaveConfere, criarConvite, conviteConfere, daPropriaMaquina, definirSessaoNavegador, mesmaOrigem, motivoDaRecusa } from "./lib/acesso.ts";
import { descobrirComandos, expandirComandoChat, idPeloNome, type OpcoesDescoberta } from "./lib/comandos.ts";
import { ChatAgentes, ErroChat } from "./lib/chat.ts";
import { saidaPublicaAvaliacao } from "./lib/avaliacao-conversa.ts";
import { achadosDaTela, resumoDaTela, type AcessibilidadeTela, type MedidaTela } from "./lib/tela.ts";
import { servirMcpStdio } from "./lib/mcp.ts";
import { analisarUso, linhasDoUso } from "./lib/uso.ts";
import { aliasesDoTsconfig, conferirArquivosDeAgente, gerarSkillDeDesign, lerArquivosDeAgente, prontidaoParaAgentes } from "./lib/arquivos-agente.ts";
import { serializar } from "./lib/persistencia.ts";
import { lerLimitesConta } from "./lib/limites.ts";
import { sessoesExternasChat, ID_SESSAO_NATIVA } from "./lib/chat-sessoes.ts";
import { parTls, temOpenssl } from "./lib/tls.ts";
import { Avaliacoes, gerarDossie, validarParecer, validarPedido } from "./lib/avaliacao.ts";
import { capturarAvaliacao, capturarLote } from "./lib/captura.ts";
import { Navegador, encontrarChromium } from "./lib/cdp.ts";
import { paginaConexao } from "./lib/conexao.ts";
import { scriptIdiomas, injetarIdiomasHtml } from "./lib/idiomas.ts";
import { extrairDesign } from "./lib/extracao.ts";
import { analisarSistema, lerSistemaDeDesign, paraDtcg } from "./lib/design.ts";
import { REGRAS_A_LIGAR, REGRAS_QUE_FICAM_FORA, localizarNorma, type MotorNorma } from "./lib/norma.ts";
import { RegistroConexoes, pastaBase } from "./lib/conexoes.ts";
import { marcaPeloNome } from "./lib/marcas.ts";
import { PORTAS_COMUNS, alvoPermitido, detectarServidores, sondar, type Sondagem } from "./lib/deteccao.ts";
import { estadoDasFontes, instalarFontes, tamanhoInstalado } from "./lib/fontes.ts";
import { Fila, idSeguro, validarLote } from "./lib/fila.ts";
import { ErroAnexo, idAnexoSeguro, normalizarPaginaAnexo } from "./lib/anexos.ts";
import { Continuacoes, ErroContinuacao, hostContinuacao, PAGINA_RETOMADA } from "./lib/continuacao.ts";
import { capacidadeTranscricao, preaquecerTranscricao, transcreverAudio, ErroTranscricao, MAX_CORPO_TRANSCRICAO } from "./lib/transcricao.ts";
import { analisarLote, arquivosProvaveis, contextoDeProduto, intencaoDaRota, lerProjeto, tailwindDoProjeto } from "./lib/fonte.ts";
import { cabecalhosParaAlvo, ehHtml, extrairNonce, filtrarCabecalhosResposta, injetarScript } from "./lib/injetar.ts";
import { Difusor, ehPedidoWs, type InfoOuvinte } from "./lib/ws.ts";

export const BASE = "/__anotador";
const RAIZ = dirname(fileURLToPath(import.meta.url));
const LIMITE_CORPO = 12 * 1024 * 1024;
const ARQUIVOS_OVERLAY = ["engine.ts", "estilos.ts", "controles.ts", "ui.ts", "chat.ts", "auditoria.ts", "design.ts"];

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
  /**
   * Serve por HTTPS com certificado próprio. Necessário para o ditado por voz e outras
   * APIs que o navegador só libera em contexto seguro: `localhost` já conta como
   * seguro, um endereço de rede não.
   */
  https?: boolean;
  /** aceita alvos fora da máquina/rede local */
  permitirExterno?: boolean;
  silencioso?: boolean;
  /**
   * Onde procurar as skills e comandos da conta e dos plugins de cada agente. Sem isso,
   * vale a casa do usuário; os testes apontam para uma pasta vazia, para que a lista
   * não dependa do que a máquina de quem roda a suíte tem instalado.
   */
  descoberta?: OpcoesDescoberta;
}

export interface PedidoConexao {
  alvo: string;
  nome?: string;
  fonte?: string;
  agente?: string;
}

export interface ServidorAnotador {
  porta: number;
  /** chave desta sessão, exigida de quem pede de outra máquina */
  readonly chave: string;
  readonly fila: Fila;
  readonly avaliacoes: Avaliacoes;
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
  const estatisticas = await Promise.all([...caminhos, join(RAIZ, "lib", "idiomas.js")].map((c) => stat(c)));
  const assinatura = JSON.stringify(cfg) + "|" + estatisticas.map((s) => s.mtimeMs).join(",");
  if (cacheOverlay && cacheOverlay.assinatura === assinatura) return cacheOverlay.codigo;
  const fontes = await Promise.all(caminhos.map((c) => readFile(c, "utf8")));
  const js = fontes.map((ts, i) => `// ---- ${ARQUIVOS_OVERLAY[i]} ----\n` + removerTipos(ts, { mode: "strip" })).join("\n");
  const codigo =
    await scriptIdiomas() + "\n" +
    `(() => {\n"use strict";\nif (window.__anotadorCarregado) return;\nwindow.__ANOTADOR_CFG = ${JSON.stringify(cfg)};\n` +
    // O nonce da página chega pela própria tag deste script: quem injeta o overlay já o
    // copiou. Sem isso, um <script> criado depois esbarra no CSP e some sem erro visível.
    `window.__ANOTADOR_NONCE = (document.currentScript && document.currentScript.nonce) || "";\n` +
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

async function coletarResposta(resposta: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  const coletor = new Writable({
    write(pedaco: Buffer, _codificacao, pronto) {
      partes.push(pedaco);
      pronto();
    },
  });
  const codificacao = String(resposta.headers["content-encoding"] ?? "").toLowerCase();
  const descompressor = codificacao === "gzip" ? createGunzip() : codificacao === "deflate" ? createInflate() : codificacao === "br" ? createBrotliDecompress() : null;
  // pipeline propaga também o encerramento prematuro do alvo ao descompressor.
  if (descompressor) await pipeline(resposta, descompressor, coletor);
  else await pipeline(resposta, coletor);
  return Buffer.concat(partes);
}

function urlDoPedido(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? "/", "http://interno");
  } catch {
    return null;
  }
}

function motivoAlvoInvalido(url: URL, permitirExterno?: boolean): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "use uma URL http:// ou https://";
  return permitirExterno ? null : alvoPermitido(url);
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
  // Servindo TLS direto, o socket é quem sabe; atrás de proxy, o cabeçalho.
  const cifrado = Boolean((req.socket as { encrypted?: boolean }).encrypted);
  const proto = String(req.headers["x-forwarded-proto"] ?? (cifrado ? "https" : "http")).split(",")[0]?.trim() || "http";
  return `${proto}://${req.headers.host ?? `localhost:${opcoes.porta}`}`;
}

function enderecoInterno(opcoes: OpcoesServidor, porta: number): string {
  const host = opcoes.host === "0.0.0.0" || opcoes.host === "::" || opcoes.host === "" ? "127.0.0.1" : opcoes.host;
  const autoridade = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${opcoes.https ? "https" : "http"}://${autoridade}:${porta}`;
}

// ---------- proxy ----------
function encaminhar(req: IncomingMessage, res: ServerResponse, alvo: URL, opcoes: OpcoesServidor): void {
  const origemPublica = origemPublicaDe(req, opcoes);
  const ctx = { alvo, origemPublica };
  const pedir = alvo.protocol === "https:" ? pedidoHttps : pedidoHttp;
  const pedido = pedir(
    {
      protocol: alvo.protocol,
      hostname: alvo.hostname.replace(/^\[|\]$/g, ""),
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
        void pipeline(resposta, res).catch(() => undefined);
        return;
      }
      coletarResposta(resposta)
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
          if (!res.headersSent && !res.destroyed) responderTexto(res, 502, paginaErro(alvo, erro.message), "text/html; charset=utf-8");
        });
    }
  );
  pedido.on("error", (erro: NodeJS.ErrnoException) => {
    registrar(opcoes, `alvo indisponível (${erro.code ?? erro.message}) em ${req.method} ${req.url}`);
    if (!res.headersSent && !res.destroyed) responderTexto(res, 502, paginaErro(alvo, erro.code ?? erro.message), "text/html; charset=utf-8");
    else res.destroy();
  });
  req.on("aborted", () => pedido.destroy());
  req.on("error", () => pedido.destroy());
  res.on("close", () => { if (!res.writableFinished) pedido.destroy(); });
  req.pipe(pedido);
}

function tunelarWs(req: IncomingMessage, socket: Duplex, cabeca: Buffer, alvo: URL, opcoes: OpcoesServidor): void {
  const ctx = { alvo, origemPublica: origemPublicaDe(req, opcoes) };
  const pedir = alvo.protocol === "https:" ? pedidoHttps : pedidoHttp;
  const pedido = pedir({
    protocol: alvo.protocol,
    hostname: alvo.hostname.replace(/^\[|\]$/g, ""),
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
    resposta.resume();
    socket.end();
  });
  pedido.on("error", () => socket.destroy());
  socket.on("error", () => pedido.destroy());
  socket.once("close", () => pedido.destroy());
  pedido.end();
}

// ---------- API da fila ----------
interface ContextoApi {
  fila: Fila;
  /** Instantâneos dos prints avulsos, removidos assim que a renderização termina. */
  capturasAvulsas: Map<string, string>;
  continuacoes: Continuacoes;
  /** chave desta sessão; pedido de fora da máquina precisa apresentá-la */
  chave: string;
  avaliacoes: Avaliacoes;
  difusor: Difusor;
  opcoes: OpcoesServidor;
  porta: () => number;
  alvo: () => URL | null;
  conectar: (pedido: PedidoConexao) => Promise<void>;
  desconectar: () => void;
  ponte: Ponte;
  registro: RegistroConexoes | null;
  /**
   * Certificado da autoridade que assina o par TLS desta máquina, quando há TLS.
   * É o que a rota de download entrega para instalar nos aparelhos — só o
   * certificado; a chave da autoridade fica na pasta da fila e não sai dela.
   */
  autoridadeTls: () => string | null;
  /** última sondagem do alvo, para a página de conexão não martelar o app */
  sondagem: { em: number; alvo: string | null; valor: Sondagem | null };
}

// POSTs que mudam a conexão só de quem está na própria página (ou de uma CLI, que não manda Origin).


async function lerJson(req: IncomingMessage, limite = 64 * 1024): Promise<Record<string, unknown>> {
  const bruto = (await lerCorpo(req, limite)).toString("utf8");
  if (!bruto.trim()) return {};
  const valor = JSON.parse(bruto) as unknown;
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
}

async function sessaoDoAgente(agente: string, valor: unknown, fonte: string | null): Promise<string | null> {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !ID_SESSAO_NATIVA.test(valor)) throw new Error("Identificador de sessão inválido.");
  const sessoes = await sessoesExternasChat(fonte);
  if (!sessoes.some((s) => s.agente === agente && s.id === valor)) throw new Error("Esta sessão não pertence ao agente e projeto escolhidos.");
  return valor;
}

function validarCaptura(corpo: Record<string, unknown>): { instantaneo: string; viewport: { largura: number; altura: number; dpr: number; scrollX: number; scrollY: number } } {
  const instantaneo = corpo["instantaneo"];
  if (typeof instantaneo !== "string" || !instantaneo.trim()) throw new Error("envie o instantâneo HTML da página");
  if (Buffer.byteLength(instantaneo) > 8 * 1024 * 1024) throw new Error("instantâneo grande demais (máximo de 8 MB)");
  const pagina = corpo["pagina"] as Record<string, unknown> | null | undefined;
  const viewport = pagina?.["viewport"] as Record<string, unknown> | null | undefined;
  if (!pagina || typeof pagina !== "object" || !viewport || typeof viewport !== "object") throw new Error("envie a página e as dimensões do viewport");
  let url: URL;
  try {
    if (typeof pagina["url"] !== "string") throw new Error();
    url = new URL(pagina["url"]);
  } catch {
    throw new Error("URL da página inválida");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("a URL da página deve usar HTTP ou HTTPS");
  if (typeof pagina["caminho"] !== "string" || !pagina["caminho"].startsWith("/")) throw new Error("caminho da página inválido");
  const largura = viewport["largura"];
  const altura = viewport["altura"];
  const dpr = viewport["dpr"] ?? 1;
  const scrollX = viewport["scrollX"] ?? 0;
  const scrollY = viewport["scrollY"] ?? 0;
  if (typeof largura !== "number" || !Number.isInteger(largura) || largura < 1 || largura > 4096 ||
      typeof altura !== "number" || !Number.isInteger(altura) || altura < 1 || altura > 4096 ||
      typeof dpr !== "number" || !Number.isFinite(dpr) || dpr <= 0 || dpr > 4) {
    throw new Error("viewport inválido: largura e altura entre 1 e 4096, dpr maior que 0 e até 4");
  }
  if (typeof scrollX !== "number" || !Number.isFinite(scrollX) || typeof scrollY !== "number" || !Number.isFinite(scrollY)) {
    throw new Error("posição de rolagem inválida: scrollX e scrollY devem ser números finitos");
  }
  return { instantaneo, viewport: { largura, altura, dpr: Math.min(2, dpr), scrollX, scrollY } };
}

async function renderizarCaptura(url: string, viewport: { largura: number; altura: number; dpr: number; scrollX: number; scrollY: number }, chrome: string, certificadoProprio: boolean): Promise<Buffer> {
  const navegador = await Navegador.abrir({ caminho: chrome, timeoutMs: 10_000 });
  let temporizador: NodeJS.Timeout | undefined;
  try {
    if (certificadoProprio) await navegador.ignorarErrosCertificado();
    const renderizar = async () => {
      const pagina = await navegador.novaPagina();
      await pagina.definirViewport(viewport.largura, viewport.altura, viewport.dpr);
      await pagina.navegar(url, 10_000);
      await Promise.race([
        pagina.avaliar("document.fonts ? document.fonts.ready.then(() => true) : true"),
        pagina.esperar(1000),
      ]);
      await pagina.avaliar(`new Promise((resolver) => {
        window.scrollTo({ left: ${viewport.scrollX}, top: ${viewport.scrollY}, behavior: "instant" });
        requestAnimationFrame(() => requestAnimationFrame(() => resolver(true)));
      })`);
      return pagina.capturar({ alemDoViewport: false });
    };
    return await Promise.race([
      renderizar(),
      new Promise<never>((_resolver, rejeitar) => {
        temporizador = setTimeout(() => rejeitar(new Error("tempo esgotado ao gerar o print")), 20_000);
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
    await navegador.fechar();
  }
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

/**
 * Como alcançar o anotador por `localhost` de outra máquina, encaminhando a porta
 * por SSH.
 *
 * O microfone e a câmera só existem em contexto seguro, e um IP da rede não conta —
 * `http://192.168.0.10:3999` chega ao navegador sem essas APIs. A saída óbvia é
 * HTTPS, mas o certificado é o próprio anotador quem assina, então a primeira visita
 * esbarra na tela de "conexão não é particular". Pedir a alguém que atravesse um
 * aviso de segurança para usar uma ferramenta de desenvolvimento é um mau começo, e
 * ensina o hábito errado.
 *
 * Encaminhar a porta dispensa a conversa toda: a página passa a ser servida em
 * `http://localhost:<porta>`, que todo navegador trata como confiável, e o tráfego
 * ainda vai cifrado pelo SSH. Serve para quem alcança a máquina por SSH — o caso de
 * quem roda o anotador numa VM e anota do computador de trabalho. Para o celular,
 * que não tem SSH, o caminho continua sendo o endereço HTTPS.
 */
function comandoDeTunel(porta: number): string | null {
  const ip = ipsDaRede()[0];
  if (!ip) return null;
  return `ssh -N -L ${porta}:localhost:${porta} ${userInfo().username}@${ip}`;
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

async function extrasDoDossie(fonte: string | null, caminho: string, porta: number, captura: string | null, medidas: MedidaTela[] = [], acessibilidade: AcessibilidadeTela | null = null): Promise<Parameters<typeof gerarDossie>[1]> {
  const base = { porta, captura, sistema: await resumoDoSistema(fonte), tela: resumoDaTela(medidas, achadosDaTela(medidas, acessibilidade), acessibilidade) || null };
  if (!fonte) return base;
  try {
    const arquivos = await lerProjeto(fonte);
    return { ...base, intencao: intencaoDaRota(arquivos, caminho), contexto: contextoDeProduto(arquivos) };
  } catch {
    return base;
  }
}

async function resumoDoSistema(fonte: string | null): Promise<string | null> {
  if (!fonte) return null;
  try {
    const sistema = lerSistemaDeDesign(await lerProjeto(fonte));
    const linhas = [
      `${sistema.tokens.length} tokens declarados em ${sistema.arquivos.join(", ")}.`,
      sistema.espaco.base ? `Passo de espaçamento: ${sistema.espaco.base}px, respeitado por ${sistema.espaco.dentro} de ${sistema.espaco.total} tokens de medida.` : "Sem passo de espaçamento claro.",
    ];
    if (sistema.escalaDeTexto.length) linhas.push(`Escala de texto: ${sistema.escalaDeTexto.join(", ")}px.`);
    const comIntencao = sistema.tokens.filter((t) => t.intencao).slice(0, 12);
    if (comIntencao.length) {
      linhas.push("", "Tokens com intenção declarada — respeite o que o projeto já decidiu:");
      for (const t of comIntencao) linhas.push(`- \`${t.nome}\` (${t.px !== undefined ? t.px + "px" : t.valor}): ${t.intencao}`);
    }
    return linhas.join("\n");
  } catch {
    return null;
  }
}

// ---------- motor de regras normativas (axe-core do projeto anotado) ----------
//
// Procurado uma vez por pasta e lembrado: quem instala uma dependência no meio da
// sessão reinicia o servidor, e quem não tem axe não paga uma varredura por pedido.

let motorNorma: { fonte: string | null; achado: MotorNorma | null } | null = null;

async function norma(fonte: string | null): Promise<MotorNorma | null> {
  if (motorNorma && motorNorma.fonte === fonte) return motorNorma.achado;
  const achado = await localizarNorma(fonte);
  motorNorma = { fonte, achado };
  return achado;
}

async function saude(ctx: ContextoApi): Promise<Record<string, unknown>> {
  const { fila, difusor, opcoes } = ctx;
  const [app, pendentes, conexoes, fontes, motor] = await Promise.all([
    sondagemDoAlvo(ctx),
    fila.pendentes().then((l) => l.length).catch(() => 0),
    ctx.registro ? ctx.registro.listar() : Promise.resolve([]),
    estadoDasFontes().catch(() => null),
    norma(opcoes.fonte).catch(() => null),
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
    https: opcoes.https === true,
    tunel: comandoDeTunel(ctx.porta()),
    norma: motor ? { versao: motor.versao, origem: motor.origem, ligadas: Object.keys(REGRAS_A_LIGAR).length } : null,
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
  const { fila, difusor } = ctx;
  // A preparação pode demorar. Trocar a conexão ou o agente nesse intervalo
  // só vale para os próximos lotes, sem redirecionar o pedido já recebido.
  const opcoes: OpcoesServidor = { ...ctx.opcoes, ponte: ctx.opcoes.ponte ? { ...ctx.opcoes.ponte } : null };
  // Fila.gravar substitui os IDs recebidos pelos metadados do armazenamento.
  const imagens = lote.anotacoes.flatMap((a) => (a.anexos ?? []).map((anexo) => anexo.caminho));
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
  const entregues = opcoes.ponte?.modelo ? 0 : difusor.transmitir({
    tipo: "lote",
    id: lote.id,
    quantidade: lote.anotacoes.length,
    url: lote.pagina.url,
    resumo: resumoLote(lote),
    caminhoMd: fila.caminhoMd(lote.id),
    capturas,
    ...(imagens.length ? { imagens } : {}),
    arquivos,
  }, opcoes.ponte?.agente);
  registrar(
    opcoes,
    `lote ${lote.id}: ${lote.anotacoes.length} anotação(ões) em ${lote.pagina.caminho}${arquivos.length ? ` → ${arquivos.join(", ")}` : ""} — ${entregues} ouvinte(s) avisado(s); md em ${fila.caminhoMd(lote.id)}`
  );
  if (entregues === 0 && opcoes.ponte) {
    const iniciadoEm = new Date().toISOString();
    try {
      await ctx.ponte.iniciar({
        agente: opcoes.ponte.agente,
        sessao: opcoes.ponte.sessao,
        modelo: opcoes.ponte.modelo ?? null,
        esforco: opcoes.ponte.esforco ?? null,
        fonte: opcoes.fonte,
        motivo: `lote ${lote.id.slice(0, 8)} sem ninguém ouvindo`,
        loteId: lote.id,
        aoAtualizar: async (execucao) => {
          await fila.registrarExecucao(lote.id, { id: execucao.id, agente: execucao.agente, modelo: execucao.modelo ?? null, iniciadoEm: execucao.iniciadoEm, terminadoEm: execucao.terminadoEm, codigo: execucao.codigo, ...(execucao.erro ? { erro: execucao.erro } : {}) });
        },
        imagens,
        mensagem: mensagemParaLote({ porta: ctx.porta(), nome: opcoes.nome, alvo: opcoes.alvo, fonte: opcoes.fonte, raizFerramenta: RAIZ }, { id: lote.id, caminhoMd: fila.caminhoMd(lote.id), resumo: resumoLote(lote), imagens }),
      });
    } catch (erro) {
      // Falhas antes do spawn não passam por aoAtualizar. O lote continua
      // recebido/salvo, mas sua conversa precisa mostrar que o agente não abriu.
      await fila.registrarExecucao(lote.id, {
        id: randomUUID(), agente: opcoes.ponte.agente, modelo: opcoes.ponte.modelo ?? null,
        iniciadoEm, terminadoEm: new Date().toISOString(), codigo: -1,
        erro: "Não foi possível iniciar o agente nesta máquina. As anotações continuam salvas. Confira a conexão do agente e tente novamente.",
      });
      registrar(opcoes, `ponte não iniciou: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
}

async function processarAvaliacao(ctx: ContextoApi, pedido: Parameters<typeof gerarDossie>[0], origemPublica: string): Promise<void> {
  const { avaliacoes, difusor } = ctx;
  const opcoes = { ...ctx.opcoes, ponte: ctx.opcoes.ponte ? { ...ctx.opcoes.ponte } : null };
  let captura: string | null = null;
  if (opcoes.capturas && pedido.instantaneo) {
    const caminhoInstantaneo = `${BASE}/avaliacoes/${pedido.id}/instantaneo`;
    const urls = Array.from(new Set([origemPublica + caminhoInstantaneo, enderecoInterno(opcoes, ctx.porta()) + caminhoInstantaneo]));
    const destino = join(ctx.fila.dir, "capturas", `avaliacao-${pedido.id}`, "pagina.png");
    const r = await capturarAvaliacao(destino, pedido.pagina.viewport, { urlsInstantaneo: urls, chrome: opcoes.chrome });
    captura = r.caminho;
    if (r.erro) registrar(opcoes, `captura da avaliação ${pedido.id}: ${r.erro}`);
    if (captura) await avaliacoes.gravar(pedido, gerarDossie(pedido, { ...await extrasDoDossie(opcoes.fonte, pedido.pagina.caminho, ctx.porta(), captura, r.medidas, r.acessibilidade), respostaDireta: !!opcoes.ponte }));
  }
  // Cada avaliação com ponte tem uma execução própria, identificada no chat.
  const entregues = opcoes.ponte ? 0 : difusor.transmitir({
    tipo: "avaliacao",
    id: pedido.id,
    quantidade: pedido.achados.length,
    url: pedido.pagina.url,
    caminhoMd: avaliacoes.caminhoMd(pedido.id),
    resumo: `avaliação de ${pedido.pagina.caminho || pedido.pagina.url}${pedido.foco ? ` · foco: ${pedido.foco}` : ""}`,
  }, idPeloNome(opcoes.agente) ?? undefined);
  registrar(opcoes, `avaliação ${pedido.id} de ${pedido.pagina.caminho}: ${pedido.achados.length} achado(s) medido(s) — ${entregues} ouvinte(s)`);
  if (entregues > 0) await avaliacoes.registrarEstado(pedido.id, { fase: "aguardando", agente: opcoes.ponte?.agente ?? opcoes.agente, atualizadoEm: new Date().toISOString() });
  if (entregues === 0 && opcoes.ponte) {
    try {
      await ctx.ponte.iniciar({
        agente: opcoes.ponte.agente,
        sessao: null,
        saidaEstruturada: true,
        imagens: captura ? [captura] : [],
        modelo: opcoes.ponte.modelo ?? null,
        esforco: opcoes.ponte.esforco ?? null,
        fonte: opcoes.fonte,
        motivo: `avaliação ${pedido.id.slice(0, 8)} sem ninguém ouvindo`,
        aoAtualizar: async (execucao) => {
          await avaliacoes.registrarEstado(pedido.id, {
            fase: !execucao.terminadoEm ? "executando" : execucao.codigo === 0 ? "sem_parecer" : "falhou",
            agente: execucao.agente, atualizadoEm: new Date().toISOString(),
            esforco: opcoes.ponte?.esforco ?? null,
            ...(execucao.erro ? { erro: execucao.erro.replace(/executar o lote/g, "avaliar a página").replace(/As anotações continuam salvas/g, "O pedido de avaliação continua salvo") } : {}),
            execucao: { id: execucao.id, iniciadoEm: execucao.iniciadoEm, terminadoEm: execucao.terminadoEm, codigo: execucao.codigo, modelo: execucao.modelo ?? null, sessao: execucao.sessao, pid: execucao.pid },
          });
          await sincronizarAvaliacaoChat(ctx, pedido.id);
        },
        mensagem: [
          `Um pedido de avaliação de página chegou do anotador-ui (projeto "${opcoes.nome}").`,
          `Leia o dossiê em ${avaliacoes.caminhoMd(pedido.id)} — ele traz o que já foi medido, a estrutura da página, o sistema de design e${captura ? " a captura da tela" : " (sem captura)"}.`,
          "Julgue o que a medição não alcança. A resposta final deve ser somente o objeto JSON de parecer descrito no dossiê (resumo, itens, perguntas). O Anotador recebe a saída diretamente; não faça POST nem grave o resultado em outro arquivo. Esta é uma avaliação: não altere o código do projeto.",
        ].join("\n\n"),
      });
    } catch (erro) {
      registrar(opcoes, `ponte não iniciou para a avaliação: ${erro instanceof Error ? erro.message : String(erro)}`);
      await avaliacoes.registrarEstado(pedido.id, { fase: "falhou", agente: opcoes.ponte.agente, atualizadoEm: new Date().toISOString(), erro: "Não foi possível iniciar o agente para avaliar a página. Verifique a conexão do agente e tente novamente." });
    }
  } else if (!entregues) await avaliacoes.registrarEstado(pedido.id, { fase: "falhou", agente: null, atualizadoEm: new Date().toISOString(), erro: "Nenhum agente está conectado para receber esta avaliação. Escolha um agente no menu do Anotador." });
}

const extracoesAtivas = new WeakSet<ContextoApi>();
const chatsPorContexto = new WeakMap<ContextoApi, { pasta: string; fonte: string | null; servico: ChatAgentes }>();

function chatDoContexto(ctx: ContextoApi): ChatAgentes {
  const atual = chatsPorContexto.get(ctx);
  if (atual?.pasta === ctx.fila.dir && atual.fonte === ctx.opcoes.fonte) return atual.servico;
  const servico = new ChatAgentes(ctx.fila.dir, ctx.opcoes.fonte, { expandir: (texto, agente, fonte) => expandirComandoChat(texto, agente, fonte, ctx.opcoes.descoberta) });
  chatsPorContexto.set(ctx, { pasta: ctx.fila.dir, fonte: ctx.opcoes.fonte, servico });
  return servico;
}

async function sincronizarAvaliacaoChat(ctx: ContextoApi, id: string) {
  return serializar(ctx.avaliacoes.dir + "/chat:" + id, async () => {
    const pedido = await ctx.avaliacoes.ler(id);
    let estado = await ctx.avaliacoes.lerEstado(id);
    const agente = estado?.agente && idPeloNome(estado.agente);
    if (!pedido || !estado || !agente) return null;
    const bruto = estado.execucao ? await ctx.ponte.lerSaidaAvaliacao(estado.execucao.id, agente) : "";
    const saida = saidaPublicaAvaliacao(agente, bruto);
    if (saida.sessao && estado.execucao && estado.execucao.sessao !== saida.sessao) {
      estado.execucao.sessao = saida.sessao;
      await ctx.avaliacoes.registrarEstado(id, estado);
      estado = await ctx.avaliacoes.lerEstado(id) ?? estado;
    }
    // Recupera uma execução interrompida sem iniciar outro agente ao consultar.
    if (estado.execucao?.pid && !estado.execucao.terminadoEm) {
      let vivo = true;
      try { process.kill(estado.execucao.pid, 0); } catch { vivo = false; }
      if (!vivo) {
        estado.fase = saida.parecer ? "sem_parecer" : "falhou";
        estado.execucao.terminadoEm = new Date().toISOString();
        estado.erro = "A execução foi interrompida. As mensagens disponíveis foram preservadas.";
        await ctx.avaliacoes.registrarEstado(id, estado);
      }
    }
    let parecer = await ctx.avaliacoes.lerParecer(id);
    if (!parecer && saida.parecer) {
      parecer = saida.parecer;
      await ctx.avaliacoes.gravarParecer(id, parecer);
      ctx.difusor.transmitir({ tipo: "parecer", id, quantidade: parecer.itens.length, resumo: parecer.resumo });
    }
    if (parecer && (!estado.execucao || estado.execucao.terminadoEm || estado.fase === "falhou" || estado.fase === "sem_parecer") && estado.fase !== "concluida") {
      estado.fase = "concluida"; delete estado.erro;
      estado.atualizadoEm = new Date().toISOString();
      await ctx.avaliacoes.registrarEstado(id, estado);
    }
    return chatDoContexto(ctx).sincronizarAvaliacao(pedido, estado, agente, { ...saida, sessao: saida.sessao ?? estado.execucao?.sessao ?? null, bruto }, parecer);
  });
}

async function atualizarConversaVinculada(ctx: ContextoApi, id: string, agente?: string) {
  const chat = chatDoContexto(ctx);
  const conversa = await chat.obter(id, agente);
  if (conversa.avaliacao?.acompanhando) await sincronizarAvaliacaoChat(ctx, conversa.avaliacao.id);
  return chat.obter(id, agente);
}

function referenciaConversaAvaliacao(conversa: Awaited<ReturnType<typeof sincronizarAvaliacaoChat>>) {
  return conversa ? { id: conversa.id, agente: conversa.agente, modelo: conversa.modelo, sessaoExterna: conversa.sessaoExterna ?? null } : null;
}

async function lerPedidoChat(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const corpo = await lerJson(req);
    if (Array.isArray(corpo)) throw new Error();
    return corpo;
  } catch { throw new ErroChat("Pedido de conversa inválido ou grande demais."); }
}

function destinoDeAcesso(valor: unknown): string {
  if (typeof valor !== "string" || !valor.startsWith("/") || valor.startsWith("//") || /[\\\r\n]/.test(valor)) return BASE + "/";
  const destino = new URL(valor, "http://anotador.local");
  return destino.origin === "http://anotador.local" ? destino.pathname + destino.search + destino.hash : BASE + "/";
}

async function tratarApi(req: IncomingMessage, res: ServerResponse, url: URL, ctx: ContextoApi): Promise<boolean> {
  const { fila, difusor, opcoes } = ctx;
  const caminho = url.pathname.slice(BASE.length) || "/";
  const metodo = req.method ?? "GET";

  if (caminho === "/chat" || caminho.startsWith("/chat/")) {
    res.setHeader("cache-control", "no-store");
    if (!autorizado(req, ctx.chave) || !mesmaOrigem(req.headers)) {
      responderJson(res, 403, { ok: false, erro: "Conecte este navegador ao Anotador para acessar suas conversas." });
      return true;
    }
    try {
      if (caminho === "/chat/limites") {
        if (metodo !== "GET") throw new ErroChat("Método não permitido para consultar os limites da conta.", 405);
        const agente = url.searchParams.get("agente");
        if (!agente || !["claude", "codex", "gemini", "opencode", "antigravity", "cursor"].includes(agente)) throw new ErroChat("Escolha um agente válido.");
        responderJson(res, 200, { ok: true, ...await lerLimitesConta(agente) });
        return true;
      }
      if (caminho === "/chat/comandos" && metodo === "GET") {
        const agente = url.searchParams.get("agente");
        if (!agente || !["claude", "codex", "gemini", "opencode", "antigravity", "cursor"].includes(agente)) throw new ErroChat("Escolha um agente válido.");
        responderJson(res, 200, { ok: true, comandos: await descobrirComandos(agente as IdAgente, opcoes.fonte, opcoes.descoberta) });
        return true;
      }
      const chat = chatDoContexto(ctx);
      if (caminho === "/chat/catalogo" && metodo === "GET") {
        responderJson(res, 200, { ok: true, ...await chat.catalogo() });
      } else if (caminho === "/chat/sessoes" && metodo === "GET") {
        const agente = url.searchParams.get("agente") ?? undefined;
        responderJson(res, 200, { ok: true, sessoes: await chat.listar(agente) });
      } else if (caminho === "/chat/sessoes" && metodo === "POST") {
        const corpo = await lerPedidoChat(req);
        if (typeof corpo["agente"] !== "string") throw new ErroChat("Escolha um agente válido.");
        for (const campo of ["modelo", "esforco", "sessaoExterna"]) {
          if (corpo[campo] !== undefined && corpo[campo] !== null && typeof corpo[campo] !== "string") throw new ErroChat(`O campo ${campo} é inválido.`);
        }
        const conversa = await chat.criar({ agente: corpo["agente"], modelo: corpo["modelo"] as string | null | undefined, esforco: corpo["esforco"] as string | null | undefined, sessaoExterna: corpo["sessaoExterna"] as string | null | undefined });
        responderJson(res, 201, { ok: true, conversa });
      } else {
        const partes = /^\/chat\/sessoes\/([^/]+)(?:\/(mensagens|configuracao))?$/.exec(caminho);
        if (!partes) throw new ErroChat("Caminho de conversa não encontrado.", 404);
        const id = decodeURIComponent(partes[1]!);
        if (!idSeguro(id)) throw new ErroChat("Identificador de conversa inválido.");
        if (!partes[2] && metodo === "GET") {
          const agente = url.searchParams.get("agente") ?? undefined;
          responderJson(res, 200, { ok: true, conversa: await atualizarConversaVinculada(ctx, id, agente) });
        } else if (partes[2] === "mensagens" && metodo === "POST") {
          const corpo = await lerPedidoChat(req);
          if (typeof corpo["texto"] !== "string") throw new ErroChat("Escreva uma mensagem para enviar.");
          if (corpo["agente"] !== undefined && typeof corpo["agente"] !== "string") throw new ErroChat("Escolha um agente válido.");
          await atualizarConversaVinculada(ctx, id, corpo["agente"] as string | undefined);
          responderJson(res, 200, { ok: true, conversa: await chat.enviar(id, corpo["texto"], corpo["agente"] as string | undefined) });
        } else if (partes[2] === "configuracao" && metodo === "POST") {
          const corpo = await lerPedidoChat(req);
          for (const campo of ["modelo", "esforco"]) {
            if (corpo[campo] !== undefined && corpo[campo] !== null && typeof corpo[campo] !== "string") throw new ErroChat(`O campo ${campo} é inválido.`);
          }
          if (corpo["agente"] !== undefined && typeof corpo["agente"] !== "string") throw new ErroChat("Escolha um agente válido.");
          await atualizarConversaVinculada(ctx, id, corpo["agente"] as string | undefined);
          responderJson(res, 200, { ok: true, conversa: await chat.configurar(id, { modelo: corpo["modelo"] as string | null | undefined, esforco: corpo["esforco"] as string | null | undefined }, corpo["agente"] as string | undefined) });
        } else {
          throw new ErroChat("Método não permitido para esta conversa.", 405);
        }
      }
    } catch (erro) {
      const status = erro instanceof ErroChat ? erro.status : erro instanceof SyntaxError || erro instanceof URIError ? 400 : 500;
      responderJson(res, status, { ok: false, erro: erro instanceof Error ? erro.message : "Não foi possível acessar a conversa." });
    }
    return true;
  }

  if (caminho === "/voz/capacidade" || caminho === "/voz/transcrever") {
    res.setHeader("cache-control", "no-store");
    if (!autorizado(req, ctx.chave) || !mesmaOrigem(req.headers)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) || "Este pedido não veio da página do Anotador." });
      return true;
    }
    if (caminho === "/voz/capacidade" && metodo === "GET") {
      const capacidade = await capacidadeTranscricao();
      responderJson(res, 200, { ok: true, ...capacidade });
      if (capacidade.disponivel) void preaquecerTranscricao().catch(() => undefined);
      return true;
    }
    if (caminho !== "/voz/transcrever" || metodo !== "POST") {
      responderJson(res, 405, { ok: false, erro: "Método não permitido para o microfone." });
      return true;
    }
    const abortar = new AbortController();
    const cancelar = (): void => { if (!res.writableEnded) abortar.abort(); };
    res.on("close", cancelar);
    try {
      if (String(req.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new ErroTranscricao("Envie a gravação no formato esperado pelo Anotador.", 400);
      const pedido = await lerJson(req, MAX_CORPO_TRANSCRICAO);
      const resultado = await transcreverAudio(pedido, { signal: abortar.signal });
      if (!res.destroyed) responderJson(res, 200, { ok: true, ...resultado });
    } catch (erro) {
      if (!res.destroyed) responderJson(res, erro instanceof ErroTranscricao ? erro.status : erro instanceof SyntaxError ? 400 : 500, {
        ok: false, erro: erro instanceof ErroTranscricao ? erro.message : erro instanceof SyntaxError ? "Não consegui ler a gravação enviada." : "Não consegui transcrever a gravação. Tente novamente.",
      });
    } finally { res.off("close", cancelar); }
    return true;
  }

  if (caminho === "/voz/continuar" && metodo === "POST") {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    try {
      hostContinuacao(req.headers.host);
      const cifrado = (req.socket as { encrypted?: boolean }).encrypted === true;
      const endereco = new URL(`${cifrado ? "https" : "http"}://${req.headers.host}`);
      const porta = endereco.port || (cifrado ? "443" : "80");
      const corpo = await lerJson(req, 4 * 1024 * 1024 + 65_536);
      // Duas travessias chegam a um contexto seguro, e a diferença está só no endereço
      // de chegada: `localhost`, que o navegador confia sem certificado nenhum quando a
      // porta está encaminhada, ou o endereço HTTPS desta mesma porta. O estado
      // preservado — anotações, prints, rascunho, agente, modelo e sessão do chat — é o
      // mesmo nos dois, porque é o mesmo mecanismo: a origem muda, e com ela o
      // armazenamento do navegador, então o que não atravessar aqui se perde.
      if (corpo["destino"] === "localhost") {
        const host = hostContinuacao(`localhost:${porta}`);
        responderJson(res, 200, { ok: true, url: `http://${host}${BASE}/voz/retomar#${ctx.continuacoes.criar(corpo, host)}` });
        return true;
      }
      if (!opcoes.https) {
        responderJson(res, 503, { ok: false, erro: "O endereço seguro do Anotador ainda não está disponível para liberar o microfone." });
        return true;
      }
      endereco.protocol = "https:";
      endereco.port = porta;
      const host = hostContinuacao(endereco.host);
      const token = ctx.continuacoes.criar(corpo, host);
      responderJson(res, 200, { ok: true, url: `https://${host}${BASE}/voz/retomar#${token}` });
    } catch (erro) {
      responderJson(res, erro instanceof ErroContinuacao ? erro.status : 400, { ok: false, erro: erro instanceof Error ? erro.message : "Não consegui preservar o rascunho para continuar." });
    }
    return true;
  }
  if (caminho === "/voz/retomar" && (metodo === "GET" || metodo === "POST")) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    // Texto claro só é aceito quando a conexão chega pelo laço local, que é como um
    // pedido entra depois de a porta ser encaminhada por SSH: o sshd entrega o pedido
    // aqui de 127.0.0.1, e para o navegador aquilo é `localhost`, contexto seguro. A
    // decisão olha o endereço do socket, e não o cabeçalho Host, que quem chama
    // escreve como quiser — dizer-se localhost não pode bastar para receber uma sessão.
    if ((req.socket as { encrypted?: boolean }).encrypted !== true && !daPropriaMaquina(req.socket.remoteAddress)) {
      responderJson(res, 426, { ok: false, erro: "Abra o endereço HTTPS para continuar com suas anotações e liberar o microfone." });
      return true;
    }
    if (metodo === "GET") {
      res.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
      responderTexto(res, 200, PAGINA_RETOMADA, "text/html; charset=utf-8");
      return true;
    }
    if (!mesmaOrigem(req.headers)) {
      responderJson(res, 403, { ok: false, erro: "Retome o ditado pela página do Anotador." });
      return true;
    }
    try {
      const corpo = await lerJson(req, 4096);
      const estado = ctx.continuacoes.consumir(corpo["token"], hostContinuacao(req.headers.host));
      definirSessaoNavegador(res, ctx.chave);
      responderJson(res, 200, { ok: true, ...estado });
    } catch (erro) {
      responderJson(res, erro instanceof ErroContinuacao ? erro.status : 400, { ok: false, erro: erro instanceof Error ? erro.message : "Não foi possível retomar o ditado." });
    }
    return true;
  }

  if (caminho === "/acesso/sessao" && (metodo === "GET" || metodo === "POST")) {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "Conecte este navegador pelo link de acesso compartilhado por quem iniciou o Anotador." });
      return true;
    }
    // GET confirma o cookie recebido sem emitir credenciais nem renovar a sessão.
    if (metodo === "POST") definirSessaoNavegador(res, ctx.chave);
    responderJson(res, 200, { ok: true });
    return true;
  }
  if (caminho === "/acesso/link" && metodo === "POST") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "Este navegador precisa estar conectado para compartilhar o acesso." });
      return true;
    }
    let corpo: Record<string, unknown>;
    try { corpo = await lerJson(req); }
    catch { responderJson(res, 400, { ok: false, erro: "Pedido de acesso inválido." }); return true; }
    const parametros = new URLSearchParams({ convite: criarConvite(ctx.chave), voltar: destinoDeAcesso(corpo["voltar"]) });
    responderJson(res, 200, { ok: true, caminho: BASE + "/acesso?" + parametros.toString(), expiraEm: new Date(Date.now() + 15 * 60_000).toISOString() });
    return true;
  }
  if (caminho === "/acesso" && metodo === "GET") {
    res.setHeader("referrer-policy", "no-referrer");
    if (!conviteConfere(url.searchParams.get("convite"), ctx.chave)) {
      responderTexto(res, 403, '<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar navegador</title><body style="font:16px system-ui;max-width:540px;margin:10vh auto;padding:24px"><h1>Este link de acesso expirou</h1><p>Peça um novo link a quem compartilhou o Anotador.</p><a href="' + BASE + '/">Voltar à conexão</a></body></html>', "text/html; charset=utf-8");
      return true;
    }
    definirSessaoNavegador(res, ctx.chave);
    res.writeHead(303, { location: destinoDeAcesso(url.searchParams.get("voltar")), "cache-control": "no-store" });
    res.end();
    return true;
  }
  if (caminho === "/" && metodo === "GET") {
    // O menu fica no endereço seguro quando ele existe: é de lá que o microfone é
    // liberado. A sessão emitida aqui vale nos dois protocolos (ver
    // `definirSessaoNavegador`), então subir para HTTPS não deixa o overlay, que roda
    // sobre o app alvo em HTTP, sem acesso.
    if (opcoes.https && !(req.socket as { encrypted?: boolean }).encrypted) {
      const destino = new URL(BASE + "/" + url.search, origemPublicaDe(req, opcoes));
      destino.protocol = "https:";
      res.writeHead(302, { location: destino.href, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end();
      return true;
    }
    if (url.searchParams.has("chave")) {
      res.setHeader("referrer-policy", "no-referrer");
      if (!chaveConfere(url.searchParams.get("chave"), ctx.chave)) {
        responderTexto(res, 403, "Link de acesso inválido. Peça um novo link a quem compartilhou o Anotador.");
        return true;
      }
      definirSessaoNavegador(res, ctx.chave);
      url.searchParams.delete("chave");
      res.writeHead(303, { location: BASE + "/" + url.search, "cache-control": "no-store" });
      res.end();
      return true;
    }
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
  if (caminho === "/autoridade.crt" && metodo === "GET") {
    // Entrega só o certificado da autoridade, nunca a chave que assina com ela. Um
    // certificado é público por natureza: é exatamente o que cada aparelho precisa
    // guardar para reconhecer as assinaturas desta máquina.
    const certificado = ctx.autoridadeTls();
    if (!certificado) {
      responderJson(res, 404, { ok: false, erro: "Este anotador não está servindo HTTPS, então não há autoridade para instalar." });
      return true;
    }
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-disposition", 'attachment; filename="anotador-ui.crt"');
    responderTexto(res, 200, certificado, "application/x-x509-ca-cert");
    return true;
  }
  if (caminho === "/microfone" && metodo === "GET") {
    res.setHeader("referrer-policy", "no-referrer");
    responderTexto(res, 200, await readFile(join(RAIZ, "lib", "microfone.html"), "utf8"), "text/html; charset=utf-8");
    return true;
  }
  if ((caminho === "/extrair" || caminho === "/extrair/") && metodo === "GET") {
    responderTexto(res, 200, await injetarIdiomasHtml(await readFile(join(RAIZ, "lib", "extracao.html"), "utf8")), "text/html; charset=utf-8");
    return true;
  }
  if ((caminho === "/extrair" || caminho === "/extrair/") && metodo === "POST") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    let alvo: URL;
    try {
      const corpo = await lerJson(req);
      const texto = typeof corpo["url"] === "string" ? corpo["url"].trim() : "";
      if (!texto) throw new Error("Informe a URL do site.");
      alvo = new URL(/^[a-z][\w+.-]*:/i.test(texto) ? texto : "https://" + texto);
      if (!["http:", "https:"].includes(alvo.protocol) || alvo.username || alvo.password) throw new Error("Use uma URL HTTP ou HTTPS sem credenciais.");
      if (alvo.href.length > 4000) throw new Error("A URL é longa demais (limite de 4.000 caracteres).");
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : "URL inválida" });
      return true;
    }
    if (extracoesAtivas.has(ctx)) {
      responderJson(res, 409, { ok: false, erro: "Uma extração já está em andamento. Aguarde a conclusão." });
      return true;
    }
    extracoesAtivas.add(ctx);
    try {
      const resultado = await extrairDesign(alvo.href, { chrome: opcoes.chrome ?? encontrarChromium() });
      if (!res.destroyed) responderJson(res, 200, { ok: true, resultado });
    } catch (erro) {
      if (!res.destroyed) responderJson(res, 502, { ok: false, erro: erro instanceof Error ? erro.message : "Não foi possível extrair o design deste site." });
    } finally {
      extracoesAtivas.delete(ctx);
    }
    return true;
  }
  const capturaTemporaria = /^\/captura\/([\w-]+)\/instantaneo$/.exec(caminho);
  if (capturaTemporaria && metodo === "GET") {
    const instantaneo = ctx.capturasAvulsas.get(capturaTemporaria[1] ?? "");
    if (instantaneo === undefined) responderJson(res, 404, { ok: false, erro: "instantâneo indisponível" });
    else {
      res.setHeader("content-security-policy", "script-src 'none'; object-src 'none'");
      responderTexto(res, 200, instantaneo, "text/html; charset=utf-8");
    }
    return true;
  }
  const imagemAnexa = /^\/anexos\/([^/]+)\/imagem$/.exec(caminho);
  if (imagemAnexa && metodo === "GET") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    let id: string;
    try { id = decodeURIComponent(imagemAnexa[1] ?? ""); } catch { id = ""; }
    if (!idAnexoSeguro(id)) {
      responderJson(res, 400, { ok: false, erro: "id do print inválido" });
      return true;
    }
    const png = await fila.anexos.imagem(id);
    if (!png) responderJson(res, 404, { ok: false, erro: "print não encontrado" });
    else {
      res.writeHead(200, { "content-type": "image/png", "content-length": png.length, "cache-control": "no-store", "content-disposition": `inline; filename="${id}.png"`, "x-content-type-options": "nosniff", "x-anotador": VERSAO });
      res.end(png);
    }
    return true;
  }
  if ((caminho === "/captura" || caminho === "/anexos/captura") && metodo === "POST") {
    const anexar = caminho === "/anexos/captura";
    if (anexar && !autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    let pedido;
    let vinculo: { anotacaoId: string; paginaUrl: string } | null = null;
    try {
      const corpo = await lerJson(req, LIMITE_CORPO);
      pedido = validarCaptura(corpo);
      if (anexar) {
        if (!idSeguro(corpo["anotacaoId"])) throw new ErroAnexo("id da anotação inválido para anexar print");
        const pagina = corpo["pagina"] as Record<string, unknown>;
        vinculo = { anotacaoId: corpo["anotacaoId"], paginaUrl: normalizarPaginaAnexo(pagina["url"]) };
      }
    } catch (erro) {
      responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : "pedido de captura inválido" });
      return true;
    }
    const chrome = opcoes.chrome ?? encontrarChromium();
    if (!chrome || !existsSync(chrome)) {
      responderJson(res, 503, { ok: false, erro: "Chromium não encontrado; configure ANOTADOR_CHROME para tirar prints" });
      return true;
    }
    const id = randomUUID();
    ctx.capturasAvulsas.set(id, pedido.instantaneo);
    try {
      // A porta com TLS também atende HTTP local, sem exigir confiar no certificado
      // próprio para abrir o instantâneo temporário no navegador de captura.
      const origem = enderecoInterno({ ...opcoes, https: false }, ctx.porta());
      const png = await renderizarCaptura(`${origem}${BASE}/captura/${id}/instantaneo`, pedido.viewport, chrome, opcoes.https === true);
      if (vinculo) {
        const anexo = await fila.anexos.gravar(png, { ...vinculo, viewport: pedido.viewport });
        if (!res.destroyed) responderJson(res, 201, { ok: true, anexo });
      } else if (!res.destroyed) {
        res.writeHead(200, { "content-type": "image/png", "content-length": png.length, "cache-control": "no-store", "content-disposition": 'attachment; filename="captura.png"', "x-anotador": VERSAO });
        res.end(png);
      }
    } catch (erro) {
      if (!res.destroyed) responderJson(res, 502, { ok: false, erro: erro instanceof Error ? erro.message : "não foi possível gerar o print" });
    } finally {
      ctx.capturasAvulsas.delete(id);
    }
    return true;
  }
  if (caminho === "/avaliacoes" && metodo === "POST") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    let pedido;
    let agenteEsperado: string | undefined;
    let destino: Awaited<ReturnType<ChatAgentes["validarDestino"]>> | undefined;
    try {
      const corpo = JSON.parse((await lerCorpo(req)).toString("utf8"));
      pedido = validarPedido(corpo);
      if (corpo.agenteEsperado !== undefined && typeof corpo.agenteEsperado !== "string") throw new Error("agente esperado inválido");
      agenteEsperado = corpo.agenteEsperado;
      if (corpo.destino !== undefined) {
        const escolha = corpo.destino;
        if (!escolha || typeof escolha !== "object" || Array.isArray(escolha) || typeof escolha.agente !== "string") throw new ErroChat("Escolha um agente válido.");
        destino = await chatDoContexto(ctx).validarDestino({ agente: escolha.agente, modelo: escolha.modelo, esforco: escolha.esforco });
      }
    } catch (erro) {
      responderJson(res, erro instanceof ErroChat ? erro.status : 400, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
      return true;
    }
    const contextoPedido = { ...ctx, opcoes: { ...opcoes, ponte: opcoes.ponte ? { ...opcoes.ponte } : null } };
    if (destino) {
      contextoPedido.opcoes.agente = destino.agente.nome;
      contextoPedido.opcoes.ponte = { agente: destino.agente.id, modelo: destino.modelo, esforco: destino.esforco, sessao: null };
    }
    const agenteDoPedido = contextoPedido.opcoes.ponte?.agente ?? contextoPedido.opcoes.agente;
    if (agenteEsperado !== undefined && (idPeloNome(agenteEsperado) ?? agenteEsperado) !== (idPeloNome(agenteDoPedido) ?? agenteDoPedido)) {
      responderJson(res, 409, { ok: false, erro: "O agente foi alterado em outra aba. Confira o nome atualizado antes de pedir o parecer." });
      return true;
    }
    const dossie = gerarDossie(pedido, { ...await extrasDoDossie(contextoPedido.opcoes.fonte, pedido.pagina.caminho, ctx.porta(), null), respostaDireta: !!contextoPedido.opcoes.ponte });
    await contextoPedido.avaliacoes.gravar(pedido, dossie);
    await contextoPedido.avaliacoes.registrarEstado(pedido.id, { fase: "preparando", agente: agenteDoPedido, atualizadoEm: new Date().toISOString(), esforco: contextoPedido.opcoes.ponte?.esforco ?? null, modelo: contextoPedido.opcoes.ponte?.modelo ?? null });
    const conversa = await sincronizarAvaliacaoChat(contextoPedido, pedido.id);
    responderJson(res, 201, { ok: true, id: pedido.id, agente: contextoPedido.opcoes.agente, caminhoMd: contextoPedido.avaliacoes.caminhoMd(pedido.id), conversa: referenciaConversaAvaliacao(conversa) });
    void processarAvaliacao(contextoPedido, pedido, origemPublicaDe(req, contextoPedido.opcoes)).catch(async (erro: Error) => {
      registrar(contextoPedido.opcoes, `falha ao processar avaliação: ${erro.message}`);
      await contextoPedido.avaliacoes.registrarEstado(pedido.id, { fase: "falhou", agente: contextoPedido.opcoes.ponte?.agente ?? contextoPedido.opcoes.agente, atualizadoEm: new Date().toISOString(), erro: "Não foi possível preparar a avaliação. O pedido continua salvo; tente novamente." }).catch(() => undefined);
    });
    return true;
  }
  if (caminho === "/avaliacoes" && metodo === "GET") {
    responderJson(res, 200, { ok: true, avaliacoes: await ctx.avaliacoes.listar() });
    return true;
  }
  const mAv = /^\/avaliacoes\/([^/]+)(?:\/(md|parecer|instantaneo|resposta))?$/.exec(caminho);
  if (mAv) {
    const id = decodeURIComponent(mAv[1] ?? "");
    const sub = mAv[2];
    if (!idSeguro(id)) {
      responderJson(res, 400, { ok: false, erro: "id inválido" });
      return true;
    }
    if (sub === "md" && metodo === "GET") {
      const md = await ctx.avaliacoes.lerMarkdown(id);
      if (md === null) responderJson(res, 404, { ok: false, erro: "avaliação não encontrada" });
      else responderTexto(res, 200, md, "text/markdown; charset=utf-8");
      return true;
    }
    if (sub === "instantaneo" && metodo === "GET") {
      const html = await ctx.avaliacoes.lerInstantaneo(id);
      if (html === null) responderJson(res, 404, { ok: false, erro: "instantâneo não encontrado" });
      else responderTexto(res, 200, html, "text/html; charset=utf-8");
      return true;
    }
    if (sub === "resposta" && metodo === "POST") {
      const parecer = await ctx.avaliacoes.lerParecer(id);
      if (!parecer) {
        responderJson(res, 404, { ok: false, erro: "ainda não há parecer com perguntas" });
        return true;
      }
      let corpo: Record<string, unknown>;
      try {
        corpo = await lerJson(req);
      } catch {
        responderJson(res, 400, { ok: false, erro: "corpo inválido" });
        return true;
      }
      const indice = Number(corpo["indice"]);
      const resposta = typeof corpo["resposta"] === "string" ? corpo["resposta"].trim().slice(0, 400) : "";
      const pergunta = parecer.perguntas[indice];
      if (!pergunta || !resposta) {
        responderJson(res, 400, { ok: false, erro: "pergunta ou resposta inválida" });
        return true;
      }
      pergunta.resposta = resposta;
      pergunta.respondidaEm = new Date().toISOString();
      await ctx.avaliacoes.gravarParecer(id, parecer);
      difusor.transmitir({ tipo: "mensagem", id, mensagem: { id: `${id}-q${indice}`, lote: id, autor: "usuario", tipo: "resposta", texto: resposta, opcoes: [pergunta.texto], em: pergunta.respondidaEm } });
      registrar(opcoes, `avaliação ${id} · resposta à pergunta ${indice + 1}: ${resposta}`);
      responderJson(res, 200, { ok: true, parecer });
      return true;
    }
    if (sub === "parecer" && metodo === "POST") {
      if (!(await ctx.avaliacoes.ler(id))) {
        responderJson(res, 404, { ok: false, erro: "avaliação não encontrada" });
        return true;
      }
      let parecer;
      try {
        parecer = validarParecer(JSON.parse((await lerCorpo(req, 512 * 1024)).toString("utf8")), opcoes.agente);
      } catch (erro) {
        responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
        return true;
      }
      await ctx.avaliacoes.gravarParecer(id, parecer);
      difusor.transmitir({ tipo: "parecer", id, quantidade: parecer.itens.length, resumo: parecer.resumo });
      registrar(opcoes, `parecer de ${parecer.agente} para a avaliação ${id}: ${parecer.itens.length} item(ns)`);
      responderJson(res, 201, { ok: true, parecer });
      return true;
    }
    if (!sub && metodo === "GET") {
      const pedido = await ctx.avaliacoes.ler(id);
      if (!pedido) responderJson(res, 404, { ok: false, erro: "avaliação não encontrada" });
      else {
        const conversa = await sincronizarAvaliacaoChat(ctx, id);
        responderJson(res, 200, { ok: true, avaliacao: { ...pedido, instantaneo: null }, parecer: await ctx.avaliacoes.lerParecer(id), estado: await ctx.avaliacoes.lerEstado(id), conversa: referenciaConversaAvaliacao(conversa) });
      }
      return true;
    }
  }
  if (caminho === "/norma.js" && metodo === "GET") {
    const motor = await norma(opcoes.fonte);
    if (!motor) {
      responderTexto(res, 404, "// nenhum axe-core no projeto anotado\n", "application/javascript; charset=utf-8");
      return true;
    }
    // Imutável por versão: o arquivo tem 559 KB e não muda enquanto a dependência não muda.
    const codigo = await readFile(motor.caminho, "utf8");
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "content-length": Buffer.byteLength(codigo),
      "x-anotador": VERSAO,
      "x-anotador-norma": motor.versao,
    });
    res.end(codigo);
    return true;
  }
  if (caminho === "/agente/comandos" && metodo === "GET") {
    // Os comandos de barra que o agente entende neste projeto. Quem pergunta é o chat
    // do overlay, para oferecer a mesma lista que a linha de comando ofereceria.
    const pedido = url.searchParams.get("agente");
    const id = (pedido ? idPeloNome(pedido) : null) ?? idPeloNome(opcoes.ponte?.agente ?? opcoes.agente);
    if (!id) {
      responderJson(res, 200, { ok: true, agente: null, comandos: [] });
      return true;
    }
    responderJson(res, 200, { ok: true, agente: id, comandos: await descobrirComandos(id, opcoes.fonte, opcoes.descoberta) });
    return true;
  }
  if (caminho === "/norma" && metodo === "GET") {
    const motor = await norma(opcoes.fonte);
    responderJson(res, 200, {
      ok: true,
      disponivel: motor !== null,
      ...(motor ? { versao: motor.versao, origem: motor.origem } : {}),
      ligadas: REGRAS_A_LIGAR,
      naoLigadas: REGRAS_QUE_FICAM_FORA,
    });
    return true;
  }
  if (caminho === "/design/tokens" && metodo === "GET") {
    if (!opcoes.fonte) {
      responderJson(res, 200, { ok: false, erro: "sem pasta de código-fonte configurada" });
      return true;
    }
    const { documento, ignorados } = paraDtcg(lerSistemaDeDesign(await lerProjeto(opcoes.fonte)));
    responderJson(res, 200, { ok: true, documento, ignorados });
    return true;
  }
  if (caminho === "/design" && metodo === "GET") {
    if (!opcoes.fonte) {
      responderJson(res, 200, { ok: true, sistema: null, achados: [], erro: "sem pasta de código-fonte configurada" });
      return true;
    }
    const relatorio = analisarSistema(await lerProjeto(opcoes.fonte));
    responderJson(res, 200, { ok: true, ...relatorio });
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
    const motivo = motivoAlvoInvalido(alvoUrl, opcoes.permitirExterno);
    if (motivo) {
      responderJson(res, 400, { ok: false, erro: motivo });
      return true;
    }
    responderJson(res, 200, { ok: true, sondagem: await sondar(alvoUrl.origin, 3000) });
    return true;
  }
  if (caminho === "/conectar" && metodo === "POST") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode trocar o alvo: " + motivoDaRecusa(req, ctx.chave) });
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
    const motivo = motivoAlvoInvalido(alvoUrl, opcoes.permitirExterno);
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
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode desconectar: " + motivoDaRecusa(req, ctx.chave) });
      return true;
    }
    ctx.desconectar();
    responderJson(res, 200, { ok: true, saude: await saude(ctx) });
    return true;
  }
  if (caminho === "/agentes" && metodo === "GET") {
    const fonte = opcoes.fonte;
    const [claude, codex] = await Promise.all([sessoesClaude(fonte).catch(() => []), sessoesCodex(fonte).catch(() => []), atualizarModelosAntigravity()]);
    responderJson(res, 200, { ok: true, agentes: detectarAgentes(), sessoes: [...claude, ...codex], ponte: opcoes.ponte ?? null, execucoes: ctx.ponte.execucoes, ouvintes: difusor.ouvintes() });
    return true;
  }
  if (caminho === "/agente/iniciar" && metodo === "POST") {
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode iniciar um agente: " + motivoDaRecusa(req, ctx.chave) });
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
    try {
      const sessao = await sessaoDoAgente(agente, corpo["sessao"], opcoes.fonte);
      if (agente === "antigravity") await atualizarModelosAntigravity();
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
    if (!autorizado(req, ctx.chave)) {
      responderJson(res, 403, { ok: false, erro: "só a própria página de conexão pode mudar a ponte: " + motivoDaRecusa(req, ctx.chave) });
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
      if (agente === "antigravity") await atualizarModelosAntigravity();
      const escolhido = detectarAgentes().find((a) => a.id === agente && a.ponte && a.instalado);
      if (!escolhido) {
        responderJson(res, 400, { ok: false, erro: "agente não instalado ou sem ponte por linha de comando" });
        return true;
      }
      const modelos = modelosDe(agente);
      const modelo = typeof corpo["modelo"] === "string" && modelos.some((m) => m.valor === corpo["modelo"]) ? corpo["modelo"] : null;
      const esforco = typeof corpo["esforco"] === "string" && modelos.find((m) => m.valor === modelo)?.esforcos.includes(corpo["esforco"]) ? corpo["esforco"] : null;
      let sessao: string | null;
      try { sessao = await sessaoDoAgente(agente, corpo["sessao"], opcoes.fonte); }
      catch (erro) { responderJson(res, 400, { ok: false, erro: erro instanceof Error ? erro.message : "Sessão inválida para este agente." }); return true; }
      opcoes.ponte = { agente, sessao, modelo, esforco };
      opcoes.agente = escolhido.nome;
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
  if (caminho === "/agente/atual" && metodo === "GET") {
    responderJson(res, 200, { ok: true, agente: opcoes.agente, marca: marcaPeloNome(opcoes.ponte?.agente ?? opcoes.agente), modelo: rotuloDoModelo(opcoes.ponte) });
    return true;
  }
  if (caminho === "/overlay.js" && metodo === "GET") {
    const codigo = await montarOverlay({
      base: BASE,
      capturas: opcoes.capturas,
      https: opcoes.https === true,
      tunel: comandoDeTunel(ctx.porta()),
      nome: opcoes.nome,
      agente: opcoes.agente,
      marca: marcaPeloNome(opcoes.ponte?.agente ?? opcoes.agente),
      modelo: rotuloDoModelo(opcoes.ponte),
      norma: await norma(opcoes.fonte).then((m) => (m ? { versao: m.versao, ligar: Object.keys(REGRAS_A_LIGAR) } : null)).catch(() => null),
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
    let gravacao: Awaited<ReturnType<Fila["gravar"]>>;
    try {
      let origemHttpMigrada: string | undefined;
      if (opcoes.https && (req.socket as { encrypted?: boolean }).encrypted === true) {
        const origem = new URL("https://" + hostContinuacao(req.headers.host));
        if (Number(origem.port || 443) === ctx.porta()) {
          origem.protocol = "http:";
          origem.port = String(ctx.porta());
          origemHttpMigrada = origem.origin;
        }
      }
      gravacao = await fila.gravar(lote, { origemHttpMigrada });
    }
    catch (erro) {
      if (!(erro instanceof ErroAnexo)) throw erro;
      responderJson(res, 400, { ok: false, erro: erro.message });
      return true;
    }
    const { registro, novo } = gravacao;
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
      if (!["nota", "pergunta", "escolha", "resposta", "passo"].includes(tipo) || (autor === "usuario") !== (tipo === "resposta")) {
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
        if (status.estado === "em_andamento") {
          difusor.transmitir({ tipo: "progresso", id, nota });
          registrar(opcoes, `lote ${id} em andamento: ${nota}`);
          // O progresso também entra na conversa, como passo: a barra mostra só o
          // último, e quem abre o chat quer ver o caminho inteiro até aqui. Repetir a
          // mesma nota não acrescenta linha.
          if (nota) {
            const conversa = await fila.conversa(id);
            const ultimoPasso = [...conversa].reverse().find((m) => m.tipo === "passo");
            if (ultimoPasso?.texto !== nota) {
              const passo = await fila.registrarMensagem({ lote: id, autor: "agente", agente: opcoes.agente, tipo: "passo", texto: nota });
              if (passo) difusor.transmitir({ tipo: "mensagem", id, mensagem: passo });
            }
          }
        }
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
  let avaliacoes = new Avaliacoes(fila.dir);
  let alvoUrl: URL | null = null;
  let portaReal = opcoes.porta;

  const aplicarAlvo = (texto: string | null): void => {
    if (texto === null) {
      alvoUrl = null;
      opcoes.alvo = null;
      return;
    }
    const url = new URL(texto);
    const motivo = motivoAlvoInvalido(url, opcoes.permitirExterno);
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
        avaliacoes = new Avaliacoes(fila.dir);
        ctx.avaliacoes = avaliacoes;
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

  // A chave nasce com a fila e vive ao lado dela; trocar de projeto pela página não a
  // renova, porque quem já estava autorizado continua sendo a mesma pessoa.
  const chave = await chaveDaSessao(caminhoDaChave(fila.dir));
  const ctx: ContextoApi = { fila, capturasAvulsas: new Map(), continuacoes: new Continuacoes(), chave, avaliacoes, difusor, opcoes, porta: () => portaReal, alvo: () => alvoUrl, conectar, desconectar, ponte, registro, autoridadeTls: () => tls?.ca ?? null, sondagem: { em: 0, alvo: null, valor: null } };

  if (opcoes.alvo) {
    const inicial = opcoes.alvo;
    opcoes.alvo = null;
    await conectar({ alvo: inicial });
  }

  // O par TLS cobre localhost e os endereços desta máquina; trocar de rede o refaz.
  //
  // A autoridade que o assina fica na pasta-base, e não na pasta deste projeto: ela é
  // instalada à mão em cada aparelho, e uma por projeto obrigaria a repetir a
  // instalação a cada app anotado, enchendo a lista de autoridades confiáveis de
  // entradas quase iguais. O certificado cobre os mesmos endereços em qualquer
  // projeto, então compartilhá-lo não perde nada. Quem passa `--saida` está isolando
  // aquela instância de propósito, e aí o certificado a acompanha.
  const pastaTls = join(opcoes.saida ?? pastaBase(), "tls");
  const tls = opcoes.https ? await parTls(pastaTls, ["localhost", "127.0.0.1", "::1", ...ipsDaRede()], hostname()) : null;
  if (opcoes.https && !tls) throw new Error("não consegui preparar o certificado");
  const tratar = (req: IncomingMessage, res: ServerResponse) => {
    const url = urlDoPedido(req);
    if (!url) {
      responderJson(res, 400, { ok: false, erro: "URL inválida" });
      return;
    }
    if (url.pathname === BASE || url.pathname.startsWith(BASE + "/")) {
      tratarApi(req, res, url, ctx).catch((erro: Error) => {
        registrar(opcoes, `erro na API ${req.url}: ${erro.message}`);
        if (!res.headersSent) responderJson(res, erro instanceof URIError ? 400 : 500, { ok: false, erro: erro.message });
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
  };
  // Com TLS ligado, a mesma porta atende os dois protocolos. O primeiro byte de uma
  // conexão TLS é 0x16 (handshake); qualquer outro começa um verbo HTTP em texto claro.
  // Isso existe porque o navegador precisa de HTTPS para liberar o microfone, e o
  // agente na própria máquina fala ws:// simples — separar em duas portas obrigaria
  // cada agente a saber qual usar.
  const servidorHttp = createServer(tratar);
  const servidorTls = tls ? createServerTls({ key: tls.key, cert: tls.cert }, tratar) : null;
  const socketsTcp = new Set<Socket>();
  const servidor = servidorTls
    ? createServerTcp((socket: Socket) => {
        socketsTcp.add(socket);
        socket.once("close", () => socketsTcp.delete(socket));
        socket.once("error", () => socket.destroy());
        // `readable` + `read(1)`, e não `data`: ouvir `data` põe o socket em modo
        // fluindo e os bytes do handshake chegam antes de o servidor TLS assumir,
        // que é como a conexão cifrada morria em silêncio.
        const espiar = () => {
          const primeiro = socket.read(1) as Buffer | null;
          if (!primeiro) {
            socket.once("readable", espiar);
            return;
          }
          socket.unshift(primeiro);
          (primeiro[0] === 0x16 ? servidorTls : servidorHttp).emit("connection", socket);
        };
        socket.once("readable", espiar);
      })
    : servidorHttp;

  // Sockets promovidos a WebSocket saem do controle do http.Server: sem isto, fechar() espera por eles para sempre.
  const socketsPromovidos = new Set<Duplex>();
  const aoPromover = (req: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
    socketsPromovidos.add(socket);
    socket.once("close", () => socketsPromovidos.delete(socket));
    socket.on("error", () => socket.destroy());
    const url = urlDoPedido(req);
    if (!url) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
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
  };
  servidorHttp.on("upgrade", aoPromover);
  servidorTls?.on("upgrade", aoPromover);

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
    chave,
    get fila() {
      return ctx.fila;
    },
    get avaliacoes() {
      return ctx.avaliacoes;
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
        // Inclui conexões que ainda não enviaram o primeiro byte do protocolo.
        for (const s of socketsTcp) s.destroy();
        socketsTcp.clear();
        servidorHttp.closeAllConnections();
        servidorTls?.closeAllConnections();
        servidorHttp.close();
        servidorTls?.close();
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
                [--https]  (certificado próprio; permite solicitar microfone e câmera pelo endereço da rede)
  anotador conectar <url> [--porta 3999]        (troca o app de um anotador já no ar)
  anotador desconectar [--porta 3999]
  anotador fontes [--compact] [--forcar]        (instala a San Francisco da Apple nesta máquina)
  anotador design [--fonte dir] [--tudo]        (tokens do projeto, o que foge das próprias regras e o quanto as telas usam o sistema)
  anotador design --tokens > tokens.json        (os mesmos tokens no formato do W3C, que o Figma lê)
  anotador mcp [--fonte dir]                    (o sistema de design como servidor MCP, para qualquer agente consultar)
  anotador agentes [--fonte dir]                (confere se AGENTS.md, CLAUDE.md e skills citam nomes que ainda existem)
  anotador agentes --gerar > SKILL.md           (a skill de design do projeto, gerada do código)
  anotador avaliacoes [--porta 3999]            (pedidos de avaliação de página, com e sem parecer)
  anotador avaliacao <id> [--porta 3999]        (dossiê e, se houver, o parecer do agente)
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
      https: { type: "boolean", default: false },
      compact: { type: "boolean", default: false },
      tudo: { type: "boolean", default: false },
      tokens: { type: "boolean", default: false },
      gerar: { type: "boolean", default: false },
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
  if (comando === "mcp") {
    // Antes de qualquer outra coisa que possa escrever no stdout: ele é do protocolo.
    await servirMcpStdio({ fonte: resolve(fonte), chrome: values.chrome ?? encontrarChromium(), versao: VERSAO });
    return;
  }
  const registro = new RegistroConexoes();
  const salva = await registro.procurarPorFonte(fonte);
  const nome = values.nome ?? salva?.nome ?? basename(process.cwd());
  const saida = values.saida ?? join(pastaBase(), nome);

  if (comando === "saude") {
    console.log(JSON.stringify(await chamarApi(porta, "/saude"), null, 2));
    return;
  }
  if (comando === "avaliacoes") {
    const r = (await chamarApi(porta, "/avaliacoes")) as { avaliacoes?: Array<{ id: string; em: string; url: string; achados: number; temParecer: boolean }> };
    const lista = r.avaliacoes ?? [];
    if (!lista.length) console.log("nenhuma avaliação pedida");
    for (const a of lista) console.log(`${a.id}\t${a.em}\t${a.achados} medido(s)\t${a.temParecer ? "com parecer" : "AGUARDA PARECER"}\t${a.url}`);
    return;
  }
  if (comando === "avaliacao") {
    const id = positionals[1];
    if (!id) throw new Error("informe o id da avaliação");
    console.log(String(await chamarApi(porta, `/avaliacoes/${encodeURIComponent(id)}/md`)));
    const r = (await chamarApi(porta, `/avaliacoes/${encodeURIComponent(id)}`)) as { parecer?: { agente: string; resumo: string; itens: Array<{ titulo: string; categoria: string; gravidade: string; problema: string; sugestao: string }> } };
    if (!r.parecer) {
      console.log("\n(sem parecer ainda)");
      return;
    }
    console.log(`\n=== parecer de ${r.parecer.agente} ===\n${r.parecer.resumo}\n`);
    for (const i of r.parecer.itens) {
      console.log(`[${i.gravidade}] ${i.titulo}  (${i.categoria})`);
      console.log(`    ${i.problema}`);
      console.log(`    → ${i.sugestao}\n`);
    }
    return;
  }
  if (comando === "design") {
    if (values.tokens) {
      // Formato do W3C, que Figma, Style Dictionary e Tokens Studio já leem: o que
      // foi medido no CSS volta para a ferramenta de design sem tradução manual.
      const { documento, ignorados } = paraDtcg(lerSistemaDeDesign(await lerProjeto(fonte)));
      console.log(JSON.stringify(documento, null, 2));
      for (const i of ignorados) console.error(`  fora do arquivo: ${i.nome} — ${i.motivo}`);
      return;
    }
    const { sistema, achados } = analisarSistema(await lerProjeto(fonte));
    const porCategoria = new Map<string, number>();
    for (const t of sistema.tokens) porCategoria.set(t.categoria, (porCategoria.get(t.categoria) ?? 0) + 1);
    console.log(`sistema de design em ${fonte}`);
    console.log(`  ${sistema.tokens.length} tokens em ${sistema.arquivos.length} arquivo(s): ${Array.from(porCategoria).map(([c, n]) => `${n} de ${c}`).join(", ")}`);
    console.log(
      sistema.espaco.base
        ? `  escala de espaço: passo de ${sistema.espaco.base}px, respeitado por ${sistema.espaco.dentro} de ${sistema.espaco.total} tokens`
        : "  escala de espaço: sem passo claro"
    );
    if (sistema.escalaDeTexto.length) console.log(`  escala de texto: ${sistema.escalaDeTexto.join(", ")}px`);
    const mostrar = values.tudo ? achados : achados.filter((a) => a.gravidade !== "baixa");
    console.log(`\n${achados.length} achado(s)${values.tudo ? "" : `, ${mostrar.length} acima de "baixa" (use --tudo para ver todos)`}:`);
    let regraAtual = "";
    for (const a of mostrar) {
      if (a.regra !== regraAtual) {
        regraAtual = a.regra;
        console.log(`\n  ${a.regra}`);
      }
      console.log(`    [${a.gravidade}] ${a.alvo}${a.onde ? `  (${a.onde})` : ""}`);
      console.log(`          ${a.evidencia}`);
    }
    // O outro lado: o quanto as telas usam o que o CSS declara.
    console.log("\no sistema em uso");
    for (const linha of linhasDoUso(analisarUso(await lerProjeto(fonte), sistema))) console.log(linha);
    return;
  }
  if (comando === "agentes") {
    const codigo = await lerProjeto(fonte);
    const sistema = lerSistemaDeDesign(codigo);
    if (values.gerar) {
      const scripts = await readFile(join(fonte, "package.json"), "utf8").then((t) => (JSON.parse(t) as { scripts?: Record<string, string> }).scripts ?? {}).catch(() => ({}));
      process.stdout.write(gerarSkillDeDesign({ nome: values.nome ?? salva?.nome ?? basename(resolve(fonte)), codigo, sistema, aliases: await aliasesDoTsconfig(fonte), scripts, tailwind: !!(await tailwindDoProjeto(fonte)), hoje: new Date().toISOString().slice(0, 10) }));
      return;
    }
    const { arquivos, skillsVazias } = await lerArquivosDeAgente(fonte, codigo);
    const achados = conferirArquivosDeAgente(arquivos, codigo, sistema, skillsVazias);
    const sinais = await prontidaoParaAgentes(fonte, codigo);
    console.log(`prontidão para agentes: ${sinais.filter((s) => s.presente).length}/5 — os sinais do Agent-Ready Index procurados no repositório (equivalente local, não a nota oficial)`);
    for (const s of sinais) console.log(`  ${s.presente ? "✔" : "✘"} ${s.sinal}: ${s.evidencia}${s.comoChegar ? `\n      → ${s.comoChegar}` : ""}`);
    console.log(`\n${arquivos.length} arquivo(s) de agente em ${fonte}${arquivos.length ? ": " + arquivos.map((a) => a.relativo).join(", ") : ""}`);
    if (!achados.length) { console.log("todo nome citado existe no código"); return; }
    console.log(`\n${achados.length} achado(s):`);
    for (const a of achados) console.log(`  [${a.tipo}] ${a.arquivo}${a.linha ? ":" + a.linha : ""}  ${a.nome}${a.sugestao ? `  → talvez ${a.sugestao}` : ""}\n          ${a.evidencia}`);
    // Código de saída diferente de zero: é o que faz o CI barrar o documento desatualizado.
    process.exitCode = 1;
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
    ponte: salva?.ponte && ["claude", "codex", "gemini", "opencode", "antigravity"].includes(salva.ponte.agente) ? { agente: salva.ponte.agente as IdAgente, sessao: salva.ponte.sessao, modelo: salva.ponte.modelo ?? null, esforco: salva.ponte.esforco ?? null } : null,
    permitirExterno: values["permitir-externo"],
    https: values.https,
  };
  let servidor: ServidorAnotador;
  try {
    servidor = await iniciarServidor(opcoes);
  } catch (erro) {
    const codigo = (erro as NodeJS.ErrnoException).code;
    if (codigo === "EADDRINUSE") throw new Error(`a porta ${porta} já está em uso — escolha outra com --porta`);
    throw erro;
  }
  const esquema = values.https ? "https" : "http";
  const linhas = [
    `anotador-ui ${VERSAO} · ${nome}`,
    servidor.alvo
      ? `  alvo:      ${servidor.alvo}${!values.alvo && salva ? " (última conexão desta pasta; --alvo troca)" : ""}`
      : `  alvo:      nenhum — abra a página de conexão para escolher o app em desenvolvimento`,
    `  conexão:   ${esquema}://localhost:${servidor.porta}${BASE}/`,
    `  abra:      ${esquema}://localhost:${servidor.porta}/`,
    ...ipsDaRede().map((ip) => `             ${esquema}://${ip}:${servidor.porta}/`),
    // De outra máquina, conectar e iniciar agente exigem a chave. Quem abre a página
    // por esta URL não precisa digitá-la de novo: ela fica guardada na aba.
    ...(ipsDaRede().length ? [`  de fora:   ${esquema}://${ipsDaRede()[0]}:${servidor.porta}${BASE}/?chave=${servidor.chave}`] : []),
    values.https
      ? "  https:     certificado próprio; confirme na primeira visita para solicitar o microfone, conforme suporte e permissão do navegador"
      : "  https:     desligado; pela rede o navegador bloqueia microfone e câmera (use --https)",
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
