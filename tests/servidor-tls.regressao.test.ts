import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { test } from "node:test";
import { temOpenssl } from "../lib/tls.ts";
import { criarAlvoFalso, criarProxy, type ProxySobTeste } from "./ajuda.ts";

const temFerramenta = await temOpenssl();

test("servidor TLS fecha mesmo com conexão TCP que ainda não enviou o primeiro byte", {
  skip: temFerramenta ? false : "openssl não encontrado nesta máquina",
  timeout: 10_000,
}, async () => {
  const alvo = await criarAlvoFalso();
  let proxy: ProxySobTeste | undefined;
  let socket: Socket | undefined;
  let fechamento: Promise<void> | undefined;
  let temporizador: NodeJS.Timeout | undefined;
  try {
    proxy = await criarProxy(alvo, { https: true });
    socket = connect(proxy.porta, "127.0.0.1");
    socket.on("error", () => undefined);
    await once(socket, "connect");
    // Sem enviar dados, o socket ainda não foi entregue ao servidor HTTP nem TLS.
    fechamento = proxy.servidor.fechar();
    await Promise.race([
      fechamento,
      new Promise<never>((_resolver, rejeitar) => {
        temporizador = setTimeout(() => rejeitar(new Error("fechar() ficou aguardando uma conexão TCP ociosa")), 1000);
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
    // Também libera a conexão na versão defeituosa, para a regressão falhar sem
    // deixar o processo de testes preso no fechamento do servidor.
    socket?.destroy();
    await fechamento;
    await proxy?.fechar();
    await alvo.fechar();
  }
});
