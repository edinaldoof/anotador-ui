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
// sessão ou de um navegador autorizado por um convite. O convite abre uma sessão
// HttpOnly: a pessoa não precisa copiar uma chave do terminal nem guardá-la no JS.
//
// O cabeçalho de origem continua sendo exigido no caminho local, e é ele que barra
// falsificação de requisição entre sítios: uma página maliciosa aberta no navegador
// não consegue forjar `Sec-Fetch-Site`, e o cabeçalho da chave é customizado, o que
// obriga o navegador a pedir permissão antes de enviá-lo, permissão que este servidor
// nunca concede. A sessão em cookie também exige a mesma origem, pois o navegador
// envia cookies automaticamente. Estar na rede local não identifica a pessoa.
//
// Ressalva conhecida: atrás de um proxy reverso na mesma máquina (o caso de
// `--publico`), todo pedido chega como local. Não dá para consertar aqui, porque
// `X-Forwarded-For` é escrito pelo cliente; nesse arranjo quem controla o acesso é o
// proxy, e o README diz isso.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const CABECALHO_CHAVE = "x-anotador-chave";
export const COOKIE_SESSAO = "anotador_sessao";
const FORMATO = /^[0-9a-f]{32}$/;
const VIDA_CONVITE_SEGUNDOS = 15 * 60;
const VIDA_SESSAO_SEGUNDOS = 30 * 24 * 60 * 60;
type Proposito = "convite" | "sessao";

/** Tokens têm propósitos separados; um convite nunca funciona como sessão. */
function assinarToken(proposito: Proposito, chave: string, duracao: number): string {
  const dados = Buffer.from(JSON.stringify({
    versao: 1,
    proposito,
    exp: Math.floor(Date.now() / 1000) + duracao,
    nonce: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  const assinatura = createHmac("sha256", chave).update(`anotador-ui/acesso/v1\0${proposito}\0${dados}`).digest("base64url");
  return `${dados}.${assinatura}`;
}

function tokenConfere(token: unknown, chave: string, proposito: Proposito): boolean {
  if (typeof token !== "string" || token.length > 1024) return false;
  const partes = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!partes) return false;
  const dados = partes[1] as string;
  const assinatura = createHmac("sha256", chave).update(`anotador-ui/acesso/v1\0${proposito}\0${dados}`).digest("base64url");
  if (!chaveConfere(partes[2], assinatura)) return false;
  try {
    const conteudo = JSON.parse(Buffer.from(dados, "base64url").toString("utf8")) as Record<string, unknown>;
    return conteudo !== null && conteudo["versao"] === 1 && conteudo["proposito"] === proposito
      && typeof conteudo["exp"] === "number" && Number.isSafeInteger(conteudo["exp"])
      && conteudo["exp"] > Math.floor(Date.now() / 1000)
      && typeof conteudo["nonce"] === "string" && /^[A-Za-z0-9_-]{22}$/.test(conteudo["nonce"]);
  } catch {
    return false;
  }
}

/** Compartilhável por 15 minutos; pode ser usado mais de uma vez nesse prazo. */
export function criarConvite(chave: string): string {
  return assinarToken("convite", chave, VIDA_CONVITE_SEGUNDOS);
}

export function conviteConfere(token: unknown, chave: string): boolean {
  return tokenConfere(token, chave, "convite");
}

export function sessaoConfere(token: unknown, chave: string): boolean {
  return tokenConfere(token, chave, "sessao");
}

/**
 * Só chamar depois de validar uma credencial, convite ou pedido da própria máquina.
 *
 * A sessão sai sem `Secure` porque a mesma porta atende os dois protocolos: o
 * multiplexador entrega o handshake TLS a um servidor e o texto claro a outro, de
 * propósito, para o navegador ter HTTPS e o agente local ter `ws://` sem trocar de
 * porta. `Secure` dividia esse serviço único em duas metades incompatíveis. Quem abria
 * o link de acesso pela página de conexão — que sobe para HTTPS — ficava autorizado só
 * lá, enquanto o overlay, que roda sobre o app alvo servido em HTTP, levava 403 em tudo
 * que muda estado: trocar de agente, avaliar a página, conversar, enviar lote. E não
 * havia conserto pela interface, porque pedir outro link caía na mesma página HTTPS e
 * emitia outra sessão pela metade.
 *
 * O que `Secure` guardaria aqui já viaja em claro de qualquer modo assim que a pessoa
 * usa o endereço HTTP: as anotações, os prints, o overlay e as respostas do agente.
 * Quem consegue ler esse tráfego na rede local não precisa do cookie para nada, e a
 * sessão continua `HttpOnly` (fora do alcance do JS da página) e `SameSite=Strict`
 * (fora do alcance de outro sítio).
 */
export function definirSessaoNavegador(res: ServerResponse, chave: string): void {
  const token = assinarToken("sessao", chave, VIDA_SESSAO_SEGUNDOS);
  const cookie = `${COOKIE_SESSAO}=${token}; Path=/__anotador; HttpOnly; SameSite=Strict; Max-Age=${VIDA_SESSAO_SEGUNDOS}`;
  const atuais = res.getHeader("set-cookie");
  res.setHeader("set-cookie", [...(Array.isArray(atuais) ? atuais : atuais ? [String(atuais)] : []), cookie]);
}

function sessaoDoCookie(headers: Record<string, unknown>): string | null {
  const cookie = headers["cookie"];
  if (typeof cookie !== "string") return null;
  const valores = cookie.split(";").map((parte) => parte.trim()).filter((parte) => parte.startsWith(COOKIE_SESSAO + "="));
  // Cookies repetidos são ambíguos (por exemplo, um Path diferente); recusá-los evita
  // que a interpretação do servidor dependa da ordem escolhida pelo navegador.
  return valores.length === 1 ? (valores[0] as string).slice(COOKIE_SESSAO.length + 1) : null;
}

/** Só o que o sistema operacional resolve para a própria máquina. */
export function daPropriaMaquina(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Igualdade em tempo constante; comprimentos diferentes respondem falso sem comparar. */
export function chaveConfere(dada: unknown, esperada: string): boolean {
  if (typeof dada !== "string" || dada.length !== esperada.length) return false;
  const recebida = Buffer.from(dada, "utf8");
  const correta = Buffer.from(esperada, "utf8");
  return recebida.length === correta.length && timingSafeEqual(recebida, correta);
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
  if (chaveConfere(dada, chave)) return { ok: true };
  const sessao = sessaoDoCookie(pedido.headers);
  if (sessaoConfere(sessao, chave)) {
    return mesmaOrigem(pedido.headers) ? { ok: true } : { ok: false, motivo: "origem-cruzada" };
  }
  if (dada === undefined || dada === "") return { ok: false, motivo: "sem-chave" };
  return { ok: false, motivo: "chave-errada" };
}

export const RECUSAS: Record<Recusa, string> = {
  "origem-cruzada": "este pedido não veio da página de conexão",
  "sem-chave": "este navegador ainda não está conectado; abra um link de acesso compartilhado pelo responsável pelo anotador",
  "chave-errada": "acesso inválido ou expirado; abra um novo link de acesso",
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
