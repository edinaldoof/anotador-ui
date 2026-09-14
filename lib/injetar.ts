// Reescrita da resposta do app alvo: injeção do overlay respeitando a CSP da página.

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { CABECALHO_CHAVE, COOKIE_SESSAO } from "./acesso.ts";

const HOP_A_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

export function extrairNonce(html: string): string | null {
  const m = /<script\b[^>]*\bnonce=["']([^"']+)["']/i.exec(html) ?? /\bnonce=["']([^"']+)["']/i.exec(html);
  return m?.[1] ?? null;
}

export function ehHtml(cabecalhos: IncomingHttpHeaders): boolean {
  return /text\/html/i.test(String(cabecalhos["content-type"] ?? ""));
}

export function injetarScript(html: string, opcoes: { src: string; nonce: string | null }): string {
  const escaparAtributo = (valor: string) => valor.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nonce = opcoes.nonce ? ` nonce="${escaparAtributo(opcoes.nonce)}"` : "";
  const tag = `<script${nonce} src="${escaparAtributo(opcoes.src)}" defer></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tag + "</head>");
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, tag + "</body>");
  return html + tag;
}

// Location absoluta apontando para o alvo vira a origem pela qual o navegador entrou.
export function reescreverLocation(valor: string, alvo: URL, origemPublica: string): string {
  if (!valor) return valor;
  // Referências como "entrar", "?pagina=2" e "#detalhes" dependem da URL da
  // requisição, que o navegador já conhece; a origem do alvo não é uma base válida.
  if (!/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(valor)) return valor;
  let u: URL;
  try {
    u = new URL(valor, alvo.origin);
  } catch {
    return valor;
  }
  const mesmaPorta = (u.port || portaPadrao(u.protocol)) === (alvo.port || portaPadrao(alvo.protocol));
  const mesmoHost = u.hostname === alvo.hostname || (HOSTS_LOCAIS.has(u.hostname) && HOSTS_LOCAIS.has(alvo.hostname));
  if (mesmoHost && mesmaPorta && u.protocol === alvo.protocol) return origemPublica + u.pathname + u.search + u.hash;
  return valor;
}

function portaPadrao(protocolo: string): string {
  return protocolo === "https:" ? "443" : "80";
}

export interface ContextoProxy {
  alvo: URL;
  origemPublica: string;
}

export function filtrarCabecalhosResposta(
  cabecalhos: IncomingHttpHeaders,
  ctx: ContextoProxy & { removerCsp: boolean; bufferizado: boolean }
): OutgoingHttpHeaders {
  const saida: OutgoingHttpHeaders = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    if (valor === undefined) continue;
    const chave = nome.toLowerCase();
    if (HOP_A_HOP.has(chave)) continue;
    if (ctx.bufferizado && (chave === "content-length" || chave === "content-encoding")) continue;
    if (ctx.removerCsp && (chave === "content-security-policy" || chave === "content-security-policy-report-only")) continue;
    if (chave === "location") {
      saida[nome] = reescreverLocation(String(valor), ctx.alvo, ctx.origemPublica);
      continue;
    }
    saida[nome] = valor;
  }
  return saida;
}

// Cabeçalhos enviados ao alvo: o dev server precisa se enxergar como mesma origem.
export function cabecalhosParaAlvo(cabecalhos: IncomingHttpHeaders, ctx: ContextoProxy): OutgoingHttpHeaders {
  const saida: OutgoingHttpHeaders = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    if (valor === undefined) continue;
    const chave = nome.toLowerCase();
    if (chave === CABECALHO_CHAVE) continue;
    if (chave === "cookie") {
      const cookies = String(valor).split(";").filter((cookie) => cookie.trim().split("=", 1)[0] !== COOKIE_SESSAO).map((cookie) => cookie.trim()).filter(Boolean);
      if (cookies.length) saida[nome] = cookies.join("; ");
      continue;
    }
    if (HOP_A_HOP.has(chave) && chave !== "upgrade" && chave !== "connection") continue;
    if (chave === "accept-encoding") continue;
    if (chave === "host") {
      saida[nome] = ctx.alvo.host;
      continue;
    }
    if (chave === "origin" && String(valor) === ctx.origemPublica) {
      saida[nome] = ctx.alvo.origin;
      continue;
    }
    if (chave === "referer") {
      try {
        const referer = new URL(String(valor));
        if (referer.origin === ctx.origemPublica) {
          saida[nome] = ctx.alvo.origin + referer.pathname + referer.search + referer.hash;
          continue;
        }
      } catch {
        /* cabeçalho inválido: preservar sem reescrever */
      }
    }
    saida[nome] = valor;
  }
  return saida;
}
