// Servir por HTTPS com certificado próprio.
//
// Existe por uma razão prática: o ditado por voz só funciona em contexto seguro. O
// navegador considera `localhost` seguro e um endereço de rede não, então quem abre o
// anotador do celular perde o microfone. A saída que o próprio navegador sugere é uma
// flag do Chrome que não existe no celular.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { parTls, temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, type AlvoFalso, type ProxySobTeste } from "./ajuda.ts";

const temFerramenta = await temOpenssl();

describe("certificado próprio", { skip: temFerramenta ? false : "openssl não encontrado nesta máquina", timeout: 60_000 }, () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "anotador-tls-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("gera um par utilizável e o reaproveita no reinício", async () => {
    const primeiro = await parTls(dir, ["localhost", "127.0.0.1", "192.168.0.10"]);
    assert.equal(primeiro.novo, true);
    assert.match(primeiro.key, /BEGIN PRIVATE KEY/);
    assert.match(primeiro.cert, /BEGIN CERTIFICATE/);

    // A mesma lista em outra ordem é a mesma lista: reiniciar não pode invalidar o
    // certificado que o navegador já aceitou.
    const segundo = await parTls(dir, ["192.168.0.10", "localhost", "127.0.0.1"]);
    assert.equal(segundo.novo, false);
    assert.equal(segundo.cert, primeiro.cert);
  });

  test("refaz o certificado quando a máquina troca de rede", async () => {
    const antes = await parTls(dir, ["localhost", "127.0.0.1", "192.168.0.10"]);
    const depois = await parTls(dir, ["localhost", "127.0.0.1", "10.0.0.7"]);
    assert.equal(depois.novo, true);
    assert.notEqual(depois.cert, antes.cert, "certificado que não cobre o endereço digitado falha parecendo defeito do anotador");
  });

  test("o certificado cobre cada endereço declarado, com o tipo certo", async () => {
    await parTls(dir, ["localhost", "127.0.0.1", "192.168.0.10"]);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const executar = promisify(execFile);
    const { stdout } = await executar("openssl", ["x509", "-in", join(dir, "certificado.pem"), "-noout", "-text"]);
    assert.match(stdout, /DNS:localhost/);
    assert.match(stdout, /IP Address:127\.0\.0\.1/);
    assert.match(stdout, /IP Address:192\.168\.0\.10/, "endereço numérico precisa entrar como IP, não como DNS, ou o navegador recusa");
    assert.match(stdout, /TLS Web Server Authentication/);
  });

  test("a chave privada não fica legível para outras contas", async () => {
    await parTls(dir, ["localhost"]);
    const { stat } = await import("node:fs/promises");
    const conteudo = await readFile(join(dir, "chave.pem"), "utf8");
    assert.match(conteudo, /BEGIN PRIVATE KEY/);
    const modo = (await stat(join(dir, "chave.pem"))).mode & 0o077;
    assert.equal(modo, 0, "a chave do servidor não pode ser lida por grupo nem por outros");
  });

  test("a autoridade assina o par, sobrevive à troca de rede e guarda a chave só para o dono", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stat } = await import("node:fs/promises");
    const executar = promisify(execFile);

    // Pasta própria: a autoridade nasce uma vez e não é refeita, então reaproveitar a
    // dos outros testes traria o nome que eles escolheram.
    const { mkdtemp } = await import("node:fs/promises");
    const proprio = await mkdtemp(join(tmpdir(), "anotador-tls-ca-"));
    const antes = await parTls(proprio, ["localhost", "127.0.0.1", "192.168.0.10"], "maquina-de-teste");
    assert.match(antes.ca, /BEGIN CERTIFICATE/);
    // O que a pessoa instala é a autoridade, e instalar é trabalho manual em cada
    // aparelho: trocar de rede refaz o certificado do servidor e não pode obrigar
    // ninguém a repetir a instalação.
    const depois = await parTls(proprio, ["localhost", "127.0.0.1", "10.0.0.7"], "maquina-de-teste");
    assert.equal(depois.novo, true, "o certificado do servidor acompanha o endereço");
    assert.equal(depois.ca, antes.ca, "a autoridade instalada nos aparelhos continua a mesma");

    const { stdout: raiz } = await executar("openssl", ["x509", "-in", join(proprio, "autoridade.pem"), "-noout", "-text"]);
    assert.match(raiz, /CA:TRUE/, "sem isto o sistema não a aceita como autoridade");
    assert.match(raiz, /Certificate Sign/);
    assert.match(raiz, /Anotador UI \(maquina-de-teste\)/, "o nome precisa ser reconhecível na lista de autoridades do sistema");

    // A prova que importa: é a autoridade que valida o certificado servido. Sem ela,
    // o navegador continuaria avisando.
    await executar("openssl", ["verify", "-CAfile", join(proprio, "autoridade.pem"), join(proprio, "certificado.pem")]);

    const modo = (await stat(join(proprio, "autoridade-chave.pem"))).mode & 0o077;
    assert.equal(modo, 0, "quem tiver esta chave assina certificado para qualquer sítio de quem a instalou");
  });
});

describe("servidor sob TLS", { skip: temFerramenta ? false : "openssl não encontrado nesta máquina", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { https: true });
  });
  after(async () => {
    await proxy?.fechar();
    await alvo?.fechar();
  });

  test("a API e o app atravessam o túnel cifrado, com o overlay injetado", async () => {
    const origem = proxy.origem.replace("http://", "https://");
    const anterior = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    try {
      const saude = await fetch(origem + "/__anotador/saude");
      assert.equal(saude.status, 200);
      assert.equal(((await saude.json()) as Record<string, unknown>)["ok"], true);

      const pagina = await fetch(origem + "/");
      assert.equal(pagina.status, 200);
      assert.match(await pagina.text(), /__anotador\/overlay\.js/, "o overlay continua sendo injetado sob TLS");
    } finally {
      if (anterior === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
      else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = anterior;
    }
  });
});

describe("a mesma porta atende http e https", { skip: temFerramenta ? false : "openssl não encontrado nesta máquina", timeout: 60_000 }, () => {
  let alvo: AlvoFalso;
  let proxy: ProxySobTeste;

  before(async () => {
    alvo = await criarAlvoFalso();
    proxy = await criarProxy(alvo, { https: true });
  });
  after(async () => {
    await proxy?.fechar();
    await alvo?.fechar();
  });

  // O navegador precisa de TLS para liberar o microfone; o agente na própria máquina
  // abre ws:// em texto claro. Se a porta só falasse TLS, ligar --https deixaria todo
  // agente sem eventos — que foi exatamente o que aconteceu antes deste porteiro.
  test("texto claro continua atendido, e o canal de eventos também", async () => {
    const { pedir, abrirWs } = await import("./ajuda.ts");
    const r = await pedir(proxy.origem + "/__anotador/saude");
    assert.equal(r.status, 200, "pedido http simples na porta cifrada");
    assert.equal(JSON.parse(r.corpo)["ok"], true);

    const cliente = await abrirWs(`ws://127.0.0.1:${proxy.porta}/__anotador/eventos?agente=Teste`);
    try {
      const ola = JSON.parse(await cliente.proximo()) as { tipo: string };
      assert.equal(ola.tipo, "ola", "o agente local recebe eventos sem falar TLS");
    } finally {
      cliente.fechar();
    }
  });

  test("e o mesmo endereço responde cifrado", async () => {
    const anterior = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    try {
      const r = await fetch(proxy.origem.replace("http://", "https://") + "/__anotador/saude");
      assert.equal(r.status, 200, "a mesma porta, agora sob TLS");
    } finally {
      if (anterior === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
      else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = anterior;
    }
  });
});
