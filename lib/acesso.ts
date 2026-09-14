// Quem pode mandar o anotador mudar de estado.
//
// As rotas que trocam o app conectado, desligam a ponte e iniciam um agente por linha
// de comando eram protegidas só por cabeçalho de origem. Cabeçalho não autentica
// ninguém: quem controla o cliente escreve `Origin` e `Sec-Fetch-Site` como quiser, e
// o servidor escuta em 0.0.0.0 por padrão para o celular alcançar a página. Na prática,
// qualquer máquina da rede podia iniciar um agente com um prompt de 4000 caracteres e
// acesso de escrita ao repositório.
//
// A regra agora tem duas portas. Pedido da própria máquina passa, porque quem já está
// na máquina não precisa do anotador para nada. Pedido de fora precisa da chave da
// sessão, que só aparece na URL impressa no terminal.
//
// O cabeçalho de origem continua sendo exigido no caminho local, e é ele que barra
// falsificação de requisição entre sítios: uma página maliciosa aberta no navegador
// não consegue forjar `Sec-Fetch-Site`, e o cabeçalho da chave é customizado, o que
// obriga o navegador a pedir permissão antes de enviá-lo, permissão que este servidor
// nunca concede.
//
// Ressalva conhecida: atrás de um proxy reverso na mesma máquina (o caso de
// `--publico`), todo pedido chega como local. Não dá para consertar aqui, porque
// `X-Forwarded-For` é escrito pelo cliente; nesse arranjo quem controla o acesso é o
// proxy, e o README diz isso.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IncomingMessage } from "node:http";

export const CABECALHO_CHAVE = "x-anotador-chave";
const FORMATO = /^[0-9a-f]{32}$/;

/** Só o que o sistema operacional resolve para a própria máquina. */
export function daPropriaMaquina(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Igualdade em tempo constante; comprimentos diferentes respondem falso sem comparar. */
export function chaveConfere(dada: unknown, esperada: string): boolean {
  if (typeof dada !== "string" || dada.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(dada, "utf8"), Buffer.from(esperada, "utf8"));
}

/**
 * A origem do pedido, do jeito que o navegador a declara. Vale para decidir se um
 * pedido local veio da própria página do anotador ou de outra aberta ao lado.
 */
export function mesmaOrigem(headers: Record<string, unknown>): boolean {
  const site = String(headers["sec-fetch-site"] ?? "");
  if (site) return site === "same-origin" || site === "none";
  const origem = headers["origin"];
  if (!origem) return true;
  try {
    return new URL(String(origem)).host === String(headers["host"] ?? "");
  } catch {
    return false;
  }
}

export interface PedidoAvaliado {
  ip: string | undefined;
  headers: Record<string, unknown>;
}

/** Por que um pedido foi recusado, para a resposta poder dizer o que fazer. */
export type Recusa = "origem-cruzada" | "sem-chave" | "chave-errada";

export function avaliarAcesso(pedido: PedidoAvaliado, chave: string): { ok: true } | { ok: false; motivo: Recusa } {
  if (daPropriaMaquina(pedido.ip)) {
    return mesmaOrigem(pedido.headers) ? { ok: true } : { ok: false, motivo: "origem-cruzada" };
  }
  const dada = pedido.headers[CABECALHO_CHAVE];
  if (dada === undefined || dada === "") return { ok: false, motivo: "sem-chave" };
  return chaveConfere(dada, chave) ? { ok: true } : { ok: false, motivo: "chave-errada" };
}

export const RECUSAS: Record<Recusa, string> = {
  "origem-cruzada": "este pedido não veio da página de conexão",
  "sem-chave": "de fora desta máquina, use a URL com a chave que o anotador imprimiu ao iniciar",
  "chave-errada": "chave inválida; a URL com a chave certa está na saída do anotador",
};

export function autorizado(req: IncomingMessage, chave: string): boolean {
  return avaliarAcesso({ ip: req.socket.remoteAddress, headers: req.headers as Record<string, unknown> }, chave).ok;
}

export function motivoDaRecusa(req: IncomingMessage, chave: string): string {
  const r = avaliarAcesso({ ip: req.socket.remoteAddress, headers: req.headers as Record<string, unknown> }, chave);
  return r.ok ? "" : RECUSAS[r.motivo];
}

/**
 * A chave vive no disco, ao lado da fila, para sobreviver a um reinício: quem deixou a
 * página aberta no celular não precisa buscar uma chave nova toda vez que o servidor
 * sobe. Arquivo só para o dono; conteúdo ilegível recomeça do zero em vez de recusar
 * o serviço inteiro.
 */
export async function chaveDaSessao(caminho: string): Promise<string> {
  try {
    const lida = (await readFile(caminho, "utf8")).trim();
    if (FORMATO.test(lida)) return lida;
  } catch {
    // sem arquivo ainda, ou ilegível: gera uma
  }
  const nova = randomBytes(16).toString("hex");
  try {
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, nova + "\n", "utf8");
    await chmod(caminho, 0o600);
  } catch {
    // sem disco a chave vale só enquanto o processo viver, que ainda é melhor que nada
  }
  return nova;
}

export function caminhoDaChave(pastaDaFila: string): string {
  return join(pastaDaFila, "chave");
}
