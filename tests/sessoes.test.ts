import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import {
  CABECALHO_CHAVE,
  COOKIE_SESSAO,
  avaliarAcesso,
  autorizado,
  conviteConfere,
  criarConvite,
  definirSessaoNavegador,
  motivoDaRecusa,
  sessaoConfere,
} from "../lib/acesso.ts";

const CHAVE = "0123456789abcdef0123456789abcdef";

function pedido(cifrado = false): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: "192.168.3.20" });
  Object.assign(socket, { encrypted: cifrado });
  return new IncomingMessage(socket);
}

function emitirSessao(cifrado = false): { cookie: string; token: string } {
  const req = pedido(cifrado);
  const res = new ServerResponse(req);
  definirSessaoNavegador(res, CHAVE);
  const cookie = (res.getHeader("set-cookie") as string[])[0] as string;
  const token = cookie.split(";")[0]?.slice(COOKIE_SESSAO.length + 1) as string;
  return { cookie, token };
}

test("convite tem propósito próprio e expira em quinze minutos", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 14) });
  const convite = criarConvite(CHAVE);
  assert.ok(conviteConfere(convite, CHAVE));
  assert.ok(conviteConfere(convite, CHAVE), "reutilizável até expirar");
  assert.notEqual(criarConvite(CHAVE), convite, "cada link recebe um nonce");
  assert.equal(sessaoConfere(convite, CHAVE), false, "link não é cookie de sessão");
  assert.equal(conviteConfere(convite, "outra-chave"), false);
  t.mock.timers.tick(15 * 60 * 1000 - 1000);
  assert.ok(conviteConfere(convite, CHAVE));
  t.mock.timers.tick(1000);
  assert.equal(conviteConfere(convite, CHAVE), false);
});

test("sessão HttpOnly dura trinta dias e não contém a chave raiz", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 14) });
  const { cookie, token } = emitirSessao();
  assert.match(cookie, /^anotador_sessao=/);
  assert.match(cookie, /; Path=\/__anotador(?:;|$)/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; SameSite=Strict(?:;|$)/);
  assert.match(cookie, /; Max-Age=2592000(?:;|$)/);
  assert.ok(!cookie.includes(CHAVE));
  assert.ok(!Buffer.from(token.split(".")[0] as string, "base64url").toString().includes(CHAVE));
  assert.ok(sessaoConfere(token, CHAVE));
  assert.equal(conviteConfere(token, CHAVE), false, "sessão não vira convite");
  assert.equal(sessaoConfere(token, "outra-chave"), false, "renovar a chave invalida sessões anteriores");
  t.mock.timers.tick(30 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(sessaoConfere(token, CHAVE));
  t.mock.timers.tick(1000);
  assert.equal(sessaoConfere(token, CHAVE), false);
  assert.deepEqual(avaliarAcesso({ ip: "192.168.3.20", headers: { cookie: `${COOKIE_SESSAO}=${token}` } }, CHAVE), { ok: false, motivo: "sem-chave" });
});

test("a sessão vale nos dois protocolos da mesma porta, preservando outros cookies da resposta", () => {
  // A mesma porta atende TLS e texto claro. Marcar Secure autorizava só metade do
  // serviço: o menu, que sobe para HTTPS, ficava conectado, e o overlay sobre o app
  // alvo em HTTP levava 403 ao trocar de agente, avaliar a página ou conversar.
  assert.doesNotMatch(emitirSessao(false).cookie, /; Secure(?:;|$)/);
  assert.doesNotMatch(emitirSessao(true).cookie, /; Secure(?:;|$)/, "sessão emitida em HTTPS também serve o overlay em HTTP");
  const req = pedido();
  const res = new ServerResponse(req);
  res.setHeader("set-cookie", "outro=valor; HttpOnly");
  definirSessaoNavegador(res, CHAVE);
  const cookies = res.getHeader("set-cookie") as string[];
  assert.equal(cookies[0], "outro=valor; HttpOnly");
  assert.match(cookies[1] as string, /; HttpOnly(?:;|$)/, "continua fora do alcance do JS da página");
  assert.match(cookies[1] as string, /; SameSite=Strict(?:;|$)/, "continua fora do alcance de outro sítio");
});

test("cookie válido autoriza navegador remoto sem chave e exige mesma origem", () => {
  const { token } = emitirSessao();
  const req = pedido();
  req.headers = { cookie: `preferencia=escuro; ${COOKIE_SESSAO}=${token}`, "sec-fetch-site": "same-origin", host: "192.168.3.19:3999", origin: "http://192.168.3.19:3999" };
  assert.ok(autorizado(req, CHAVE));
  assert.equal(motivoDaRecusa(req, CHAVE), "");
  req.headers["sec-fetch-site"] = "cross-site";
  assert.equal(autorizado(req, CHAVE), false);
  assert.match(motivoDaRecusa(req, CHAVE), /não veio da página/);
  delete req.headers["sec-fetch-site"];
  req.headers.origin = "http://malicioso.example";
  assert.equal(autorizado(req, CHAVE), false, "origem explícita diferente recusa mesmo com sessão válida");
  // O CLI continua usando o cabeçalho explícito, que o navegador de outro sítio não
  // consegue enviar sem um preflight permitido pelo servidor.
  req.headers[CABECALHO_CHAVE] = CHAVE;
  assert.ok(autorizado(req, CHAVE));
});

test("tokens alterados, formatos inválidos e cookies ambíguos não autorizam", () => {
  const { token } = emitirSessao();
  const [dados, assinatura] = token.split(".") as [string, string];
  const alterado = JSON.parse(Buffer.from(dados, "base64url").toString()) as { exp: number };
  alterado.exp += 86400;
  const falsificado = `${Buffer.from(JSON.stringify(alterado)).toString("base64url")}.${assinatura}`;
  const assinaturaFalsa = `${dados}.${assinatura[0] === "A" ? "B" : "A"}${assinatura.slice(1)}`;
  for (const recebido of [undefined, null, "", [], token + ".extra", "x".repeat(1025), falsificado, assinaturaFalsa]) {
    assert.equal(sessaoConfere(recebido, CHAVE), false, String(recebido));
  }
  for (const cookie of [
    `${COOKIE_SESSAO}=${falsificado}`,
    `${COOKIE_SESSAO}=${criarConvite(CHAVE)}`,
    `${COOKIE_SESSAO}=${token}; ${COOKIE_SESSAO}=${token}`,
    `${COOKIE_SESSAO}_outro=${token}`,
  ]) {
    assert.deepEqual(avaliarAcesso({ ip: "192.168.3.20", headers: { cookie, "sec-fetch-site": "same-origin" } }, CHAVE), { ok: false, motivo: "sem-chave" });
  }
});
