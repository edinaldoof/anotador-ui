import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { join } from "node:path";
import { test } from "node:test";
import { criarAlvoFalso, criarProxy, pedir } from "./ajuda.ts";
import { temOpenssl } from "../lib/tls.ts";

test("servidor informa quando há HTTPS e entrega a janela de voz sem expor credenciais", { skip: !await temOpenssl() }, async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { https: true });
  try {
    const saude = JSON.parse((await pedir(proxy.origem + "/__anotador/saude")).corpo);
    assert.equal(saude.https, true);
    const overlay = await pedir(proxy.origem + "/__anotador/overlay.js");
    assert.match(overlay.corpo, /"https":true/);
    assert.ok(!overlay.corpo.includes("reinicie o anotador com --https"));
    const ca = await readFile(join(proxy.saida, "tls", "autoridade.pem"));
    const pagina = await new Promise<{ status: number | undefined; html: string; referrer: string | string[] | undefined }>((resolve, reject) => {
      const req = request(proxy.origem.replace("http:", "https:") + "/__anotador/microfone", { ca }, (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => resolve({ status: res.statusCode, html: Buffer.concat(partes).toString("utf8"), referrer: res.headers["referrer-policy"] }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(pagina.status, 200);
    assert.match(pagina.html, /id="comecar"/);
    assert.match(pagina.html, /id="transcricao"/);
    assert.equal(pagina.referrer, "no-referrer");
    assert.ok(!pagina.html.includes(proxy.servidor.chave));
    assert.deepEqual(await proxy.servidor.fila.listar(), []);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("servidor sem TLS não anuncia janela HTTPS disponível", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { https: false, publico: "https://anotador.example" });
  try {
    assert.equal(JSON.parse((await pedir(proxy.origem + "/__anotador/saude")).corpo).https, false);
    assert.match((await pedir(proxy.origem + "/__anotador/overlay.js")).corpo, /"https":false/);
  } finally { await proxy.fechar(); await alvo.fechar(); }
});

test("o anotador oferece o caminho por localhost, que libera o microfone sem certificado", async () => {
  const alvo = await criarAlvoFalso();
  const proxy = await criarProxy(alvo, { https: false });
  try {
    const saude = JSON.parse((await pedir(proxy.origem + "/__anotador/saude")).corpo) as { tunel: string | null };
    // Numa máquina sem endereço de rede não há de onde encaminhar: o campo vem nulo e
    // a interface cai no aviso antigo em vez de ensinar um comando que não serve.
    if (saude.tunel === null) return;
    assert.match(saude.tunel, new RegExp(`^ssh -N -L ${proxy.porta}:localhost:${proxy.porta} [^@\\s]+@\\d+\\.\\d+\\.\\d+\\.\\d+$`));
    const overlay = await pedir(proxy.origem + "/__anotador/overlay.js");
    assert.ok(overlay.corpo.includes(saude.tunel), "o overlay precisa do comando para oferecê-lo quando o microfone é pedido fora de contexto seguro");
  } finally { await proxy.fechar(); await alvo.fechar(); }
});
