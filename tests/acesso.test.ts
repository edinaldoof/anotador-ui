// Quem pode mandar o anotador trocar de app, desligar a ponte e iniciar um agente.
//
// Cada caso aqui existe porque a versão anterior o deixava passar: bastava um pedido
// sem cabeçalho de origem, de qualquer máquina da rede, para iniciar um agente de
// código com um prompt escolhido por quem mandou o pedido.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASE } from "../server.ts";
import {
  CABECALHO_CHAVE,
  avaliarAcesso,
  caminhoDaChave,
  chaveConfere,
  chaveDaSessao,
  daPropriaMaquina,
  mesmaOrigem,
} from "../lib/acesso.ts";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";

const CHAVE = "0123456789abcdef0123456789abcdef";

test("a própria máquina é só o laço local, em qualquer das três grafias", () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(daPropriaMaquina(ip), true, ip);
  for (const ip of ["192.168.3.19", "10.200.1.1", "::ffff:192.168.3.19", "", undefined]) {
    assert.equal(daPropriaMaquina(ip), false, String(ip));
  }
});

test("a chave só confere igual a si mesma", () => {
  assert.equal(chaveConfere(CHAVE, CHAVE), true);
  assert.equal(chaveConfere(CHAVE.slice(0, 31) + "0", CHAVE), false, "um dígito diferente já recusa");
  assert.equal(chaveConfere(CHAVE.slice(0, 31), CHAVE), false, "comprimento diferente recusa sem comparar");
  assert.equal(chaveConfere("", CHAVE), false);
  assert.equal(chaveConfere(undefined, CHAVE), false);
  assert.equal(chaveConfere(["igual"], CHAVE), false, "cabeçalho repetido chega como lista e não vale chave");
});

test("de fora da máquina, sem a chave não passa — com ela, passa", () => {
  const deFora = (headers: Record<string, unknown> = {}) => avaliarAcesso({ ip: "192.168.3.19", headers }, CHAVE);

  // Este é o pedido que a versão anterior aceitava: nenhum cabeçalho, vindo da rede.
  assert.deepEqual(deFora(), { ok: false, motivo: "sem-chave" });
  // E este é o mesmo pedido fingindo ser a página, que cabeçalho nenhum desmente.
  assert.deepEqual(
    deFora({ "sec-fetch-site": "same-origin", origin: "http://192.168.3.19:3999", host: "192.168.3.19:3999" }),
    { ok: false, motivo: "sem-chave" },
    "origem declarada pelo próprio cliente não autentica ninguém"
  );
  assert.deepEqual(deFora({ [CABECALHO_CHAVE]: "0".repeat(32) }), { ok: false, motivo: "chave-errada" });
  assert.deepEqual(deFora({ [CABECALHO_CHAVE]: CHAVE }), { ok: true });
});

test("na própria máquina a origem ainda manda, porque é ela que barra pedido de outro sítio", () => {
  const local = (headers: Record<string, unknown>) => avaliarAcesso({ ip: "127.0.0.1", headers }, CHAVE);
  assert.deepEqual(local({ "sec-fetch-site": "same-origin" }), { ok: true });
  assert.deepEqual(local({}), { ok: true }, "a linha de comando chama sem cabeçalho de navegador");
  assert.deepEqual(local({ "sec-fetch-site": "cross-site" }), { ok: false, motivo: "origem-cruzada" });
  assert.deepEqual(
    local({ origin: "http://malicioso.example", host: "127.0.0.1:3999" }),
    { ok: false, motivo: "origem-cruzada" },
    "página aberta ao lado no mesmo computador não fala pelo anotador"
  );
});

test("mesmaOrigem compara host, não o endereço inteiro", () => {
  assert.equal(mesmaOrigem({ origin: "http://127.0.0.1:3999", host: "127.0.0.1:3999" }), true);
  assert.equal(mesmaOrigem({ origin: "http://127.0.0.1:4000", host: "127.0.0.1:3999" }), false);
  assert.equal(mesmaOrigem({ origin: "isto não é uma URL", host: "127.0.0.1:3999" }), false);
});

test("a chave sobrevive ao reinício, e um arquivo estragado não derruba o serviço", async () => {
  const dir = await mkdtemp(join(tmpdir(), "anotador-chave-"));
  try {
    const caminho = caminhoDaChave(dir);
    const primeira = await chaveDaSessao(caminho);
    assert.match(primeira, /^[0-9a-f]{32}$/);
    assert.equal(await chaveDaSessao(caminho), primeira, "reiniciar não invalida a página que ficou aberta");

    const modo = (await stat(caminho)).mode & 0o777;
    assert.equal(modo, 0o600, `a chave não pode ser legível por outras contas da máquina (modo ${modo.toString(8)})`);

    await writeFile(caminho, "isto não é uma chave\n", "utf8");
    const nova = await chaveDaSessao(caminho);
    assert.match(nova, /^[0-9a-f]{32}$/);
    assert.notEqual(nova, primeira);
    assert.equal((await readFile(caminho, "utf8")).trim(), nova, "a chave nova é gravada por cima da estragada");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("as rotas que mudam estado recusam quem não se identifica, e dizem o que fazer", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    // O teste chega por 127.0.0.1, então a recusa aqui é a da origem cruzada; o caso da
    // rede sem chave está provado acima, na decisão pura.
    const rotas = ["/conectar", "/desconectar", "/agente/iniciar", "/agente/ponte"];
    for (const rota of rotas) {
      const r = await pedir(`${proxy.origem}${BASE}${rota}`, {
        metodo: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        corpo: "{}",
      });
      assert.equal(r.status, 403, `${rota} aceitou um pedido de outro sítio`);
      assert.match(JSON.parse(r.corpo).erro, /não veio da página de conexão/, rota);
    }

    // E a mesma rota, sem o cabeçalho hostil, continua funcionando para a linha de comando.
    const local = await pedir(`${proxy.origem}${BASE}/desconectar`, { metodo: "POST", headers: { "content-type": "application/json" }, corpo: "{}" });
    assert.equal(local.status, 200);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

test("a chave não vaza pela saúde nem pela página de conexão", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo);
  try {
    const chave = proxy.servidor.chave;
    assert.match(chave, /^[0-9a-f]{32}$/);
    assert.ok(!(await pedir(`${proxy.origem}${BASE}/saude`)).corpo.includes(chave), "a saúde é pública e não pode carregar a chave");
    assert.ok(!(await pedir(`${proxy.origem}${BASE}/`)).corpo.includes(chave), "a página é servida a qualquer um da rede; a chave vem pela URL, não no corpo");
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});

/** Um endereço IPv4 desta máquina que não seja o laço local, se houver. */
function ipDeRede(): string | null {
  for (const lista of Object.values(networkInterfaces())) {
    for (const nic of lista ?? []) {
      if (nic.family === "IPv4" && !nic.internal) return nic.address;
    }
  }
  return null;
}

// A prova que importa: o pedido que a versão anterior aceitava, feito de verdade, por
// um endereço que não é o laço local. Sem esta, o teste acima só mede uma função pura.
test("um pedido de outro endereço é barrado, e a chave o deixa passar", { skip: ipDeRede() ? false : "sem interface de rede nesta máquina" }, async () => {
  const ip = ipDeRede() as string;
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { host: ip });
  const origem = `http://${ip}:${proxy.porta}`;
  try {
    const iniciar = (headers: Record<string, string> = {}) =>
      pedir(`${origem}${BASE}/agente/iniciar`, {
        metodo: "POST",
        headers: { "content-type": "application/json", ...headers },
        corpo: JSON.stringify({ agente: "claude", mensagem: "faça o que eu mandar no repositório inteiro" }),
      });

    const cru = await iniciar();
    assert.equal(cru.status, 403, "pedido sem cabeçalho nenhum, de outra máquina, não inicia agente");
    assert.match(JSON.parse(cru.corpo).erro, /chave que o anotador imprimiu/);

    const fingindo = await iniciar({ "sec-fetch-site": "same-origin", origin: origem, host: `${ip}:${proxy.porta}` });
    assert.equal(fingindo.status, 403, "declarar-se a própria página não basta: os cabeçalhos são do cliente");

    const errada = await iniciar({ [CABECALHO_CHAVE]: "f".repeat(32) });
    assert.equal(errada.status, 403);

    // Com a chave certa o pedido passa da porta; o que vem depois é a validação do
    // agente, que nesta máquina de teste pode nem existir — e é justamente por isso
    // que basta provar que a resposta deixou de ser 403.
    const certa = await iniciar({ [CABECALHO_CHAVE]: proxy.servidor.chave });
    assert.notEqual(certa.status, 403, `com a chave a porta abre (respondeu ${certa.status}: ${certa.corpo.slice(0, 120)})`);
  } finally {
    await proxy.fechar();
    await alvo.fechar();
  }
});
