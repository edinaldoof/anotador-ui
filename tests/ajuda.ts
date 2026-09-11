// Apoio aos testes: alvo HTTP falso, proxy sob teste, cliente WebSocket e esperas.

import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, request as pedidoHttp, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { aceitarWs } from "../lib/ws.ts";
import { iniciarServidor, type OpcoesServidor, type ServidorAnotador } from "../server.ts";

export const NONCE = "abc123";
export const CSP = "default-src 'self'; script-src 'self' 'nonce-abc123'; style-src 'self'; connect-src 'self'; img-src 'self' data:";

const AQUI = dirname(fileURLToPath(import.meta.url));

export interface PedidoVisto {
  url: string;
  headers: Record<string, string>;
}

export interface AlvoFalso {
  porta: number;
  origem: string;
  pedidos: PedidoVisto[];
  fechar(): Promise<void>;
}

export async function criarAlvoFalso(): Promise<AlvoFalso> {
  const modelo = await readFile(join(AQUI, "fixtures", "pagina.html"), "utf8");
  const html = modelo.replace(/__NONCE__/g, NONCE);
  const pedidos: PedidoVisto[] = [];
  const registrarPedido = (req: IncomingMessage) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    pedidos.push({ url: req.url ?? "/", headers });
  };
  const servidor: Server = createServer((req, res) => {
    registrarPedido(req);
    const url = new URL(req.url ?? "/", "http://alvo");
    if (url.pathname === "/" || url.pathname === "/outra") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
      res.end(html);
      return;
    }
    if (url.pathname === "/gzip") {
      const corpo = gzipSync(Buffer.from(html));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip", "content-length": corpo.length });
      res.end(corpo);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/estilo.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(
        ':root{--font-filson:"Filson Teste",Georgia,serif}body{margin:0;font:16px Verdana,sans-serif}.topo{background:#0a6b62;color:#fff;padding:24px}.conteudo{padding:24px}.cartao{border:1px solid #ccc;padding:16px;margin:16px 0}.botao{padding:8px 16px;background:#2563eb;color:#fff;border:0}'
      );
      return;
    }
    if (url.pathname === "/api/dados") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin ?? null, referer: req.headers.referer ?? null }));
      return;
    }
    if (url.pathname === "/redireciona") {
      res.writeHead(302, { location: `http://127.0.0.1:${porta()}/destino?x=1` });
      res.end();
      return;
    }
    if (url.pathname === "/externo") {
      res.writeHead(302, { location: "https://exemplo.org/fora" });
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nada");
  });
  servidor.on("upgrade", (req, socket) => {
    registrarPedido(req);
    let conexao: ReturnType<typeof aceitarWs> | null = null;
    conexao = aceitarWs(req, socket, undefined, (texto) => conexao?.enviar("eco:" + texto));
    conexao.enviar("ola:" + (req.url ?? "/"));
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const porta = () => {
    const end = servidor.address();
    return end && typeof end === "object" ? end.port : 0;
  };
  return {
    porta: porta(),
    origem: `http://127.0.0.1:${porta()}`,
    pedidos,
    fechar: () =>
      new Promise<void>((r) => {
        servidor.closeAllConnections();
        servidor.close(() => r());
      }),
  };
}

export interface ProxySobTeste {
  servidor: ServidorAnotador;
  porta: number;
  origem: string;
  saida: string;
  fechar(): Promise<void>;
}

export async function criarProxy(alvo: AlvoFalso, extra: Partial<OpcoesServidor> = {}): Promise<ProxySobTeste> {
  const saida = await mkdtemp(join(tmpdir(), "anotador-teste-"));
  const servidor = await iniciarServidor({
    alvo: alvo.origem,
    porta: 0,
    host: "127.0.0.1",
    nome: "teste",
    saida,
    removerCsp: false,
    capturas: false,
    chrome: null,
    publico: null,
    fonte: join(AQUI, "fixtures"),
    agente: "Claude",
    registro: null,
    silencioso: true,
    ...extra,
  });
  return {
    servidor,
    porta: servidor.porta,
    origem: `http://127.0.0.1:${servidor.porta}`,
    saida,
    fechar: async () => {
      await servidor.fechar();
      await rm(saida, { recursive: true, force: true });
    },
  };
}

export interface Resposta {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

export function pedir(url: string, opcoes: { metodo?: string; headers?: Record<string, string>; corpo?: string } = {}): Promise<Resposta> {
  return new Promise((resolver, rejeitar) => {
    const u = new URL(url);
    const req = pedidoHttp(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opcoes.metodo ?? "GET", headers: opcoes.headers ?? {} },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
          resolver({ status: res.statusCode ?? 0, headers, corpo: Buffer.concat(partes).toString("utf8") });
        });
      }
    );
    req.on("error", rejeitar);
    if (opcoes.corpo) req.write(opcoes.corpo);
    req.end();
  });
}

interface SocketMinimo {
  send(dados: string): void;
  close(): void;
  addEventListener(tipo: "open" | "message" | "error" | "close", ouvinte: (ev: { data?: unknown }) => void): void;
}

export interface ClienteWs {
  proximo(timeoutMs?: number): Promise<string>;
  enviar(texto: string): void;
  fechar(): void;
}

export function abrirWs(url: string): Promise<ClienteWs> {
  const Construtor = (globalThis as unknown as { WebSocket: new (u: string) => SocketMinimo }).WebSocket;
  return new Promise((resolver, rejeitar) => {
    const ws = new Construtor(url);
    const fila: string[] = [];
    const esperando: Array<(t: string) => void> = [];
    ws.addEventListener("message", (ev) => {
      const texto = String(ev.data);
      const proximo = esperando.shift();
      if (proximo) proximo(texto);
      else fila.push(texto);
    });
    ws.addEventListener("error", () => rejeitar(new Error("falha ao abrir " + url)));
    ws.addEventListener("open", () =>
      resolver({
        proximo: (timeoutMs = 8000) =>
          new Promise<string>((res, rej) => {
            const pronto = fila.shift();
            if (pronto !== undefined) {
              res(pronto);
              return;
            }
            const t = setTimeout(() => rej(new Error("nenhuma mensagem WebSocket a tempo")), timeoutMs);
            esperando.push((texto) => {
              clearTimeout(t);
              res(texto);
            });
          }),
        enviar: (texto) => ws.send(texto),
        fechar: () => ws.close(),
      })
    );
  });
}

export async function esperarAte(condicao: () => boolean | Promise<boolean>, timeoutMs = 8000, intervaloMs = 100, rotulo?: string): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error(`condição não satisfeita em ${timeoutMs}ms${rotulo ? `: ${rotulo}` : ""}`);
}

export function loteDeExemplo(id = "lote-teste-0001"): Lote {
  return {
    id,
    ferramenta: "anotador-ui",
    versao: 1,
    enviadoEm: "2026-09-10T12:00:00.000Z",
    pagina: {
      url: "http://localhost:3999/entrar",
      caminho: "/entrar",
      titulo: "Entrar",
      viewport: { largura: 1280, altura: 800, dpr: 1, scrollX: 0, scrollY: 0 },
      tema: "light",
      userAgent: "teste",
    },
    anotacoes: [
      {
        id: "anot-0001",
        ordem: 1,
        comentario: "Deixar o rótulo maior",
        elemento: {
          seletores: [
            { tipo: "id", valor: "#rotulo", unico: true, pontos: 95 },
            { tipo: "texto", valor: "Acesso institucional", tag: "p", unico: true, pontos: 72 },
          ],
          meta: { tag: "p", attrs: { class: "text-xs uppercase" }, texto: "Acesso institucional", cadeia: [{ tag: "section", classe: "acesso" }], componentes: ["EscolhaDeAcesso", "PaginaEntrar"] },
          framePath: [],
          shadowPath: [],
          rect: { left: 100, top: 200, width: 300, height: 16 },
          rectPagina: { left: 100, top: 200, width: 300, height: 16 },
          computado: { color: "rgb(4, 107, 102)", "font-size": "12px" },
          localizado: true,
        },
        alteracoes: [{ propriedade: "font-size", antes: "12px", depois: "14px" }],
        texto: { antes: "Acesso institucional", depois: "Acesso Institucional" },
        criadaEm: "2026-09-10T11:59:00.000Z",
      },
    ],
    instantaneo: "<!doctype html><html><body><p id='rotulo'>Acesso Institucional</p></body></html>",
  };
}
