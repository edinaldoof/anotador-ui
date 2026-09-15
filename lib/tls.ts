// Certificado próprio, para o navegador tratar a página como contexto seguro.
//
// O ditado por voz, a câmera e boa parte das APIs modernas só funcionam em contexto
// seguro. `localhost` conta como seguro; um IP da rede, não. Quem abre o anotador do
// celular em `http://192.168.0.10:3999` vê o microfone bloqueado, e a saída que o
// próprio navegador sugere — marcar a origem numa flag do Chrome — não existe no
// celular e some a cada atualização do navegador.
//
// HTTPS permite solicitar o microfone nos navegadores compatíveis. O certificado
// é autoassinado e gerado aqui com openssl; o navegador pode pedir aceite na primeira
// visita. A permissão do dispositivo e a disponibilidade do serviço de voz continuam
// sob controle do navegador.

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);

export interface ParTls {
  key: string;
  cert: string;
  /**
   * Certificado da autoridade que assinou este par, no formato que os sistemas
   * importam. É o que a pessoa instala uma vez para o navegador parar de avisar.
   * Só o certificado: a chave da autoridade nunca sai da pasta.
   */
  ca: string;
  /** nomes e endereços que o certificado cobre */
  nomes: string[];
  /** true quando foi gerado agora, para o log dizer o que aconteceu */
  novo: boolean;
  /** true quando a autoridade nasceu agora: quem já a instalou precisa instalar de novo */
  autoridadeNova: boolean;
}

/** Versão 2 marca os pares assinados por uma autoridade própria, e não autoassinados. */
const VERSAO_PAR = 2;

interface Guardado {
  versao?: number;
  nomes: string[];
}

function arquivos(pasta: string) {
  return {
    chave: join(pasta, "chave.pem"),
    certificado: join(pasta, "certificado.pem"),
    manifesto: join(pasta, "nomes.json"),
    autoridadeChave: join(pasta, "autoridade-chave.pem"),
    autoridade: join(pasta, "autoridade.pem"),
  };
}

/** `openssl` existe e responde? Sem ele não há como gerar o par. */
export async function temOpenssl(): Promise<boolean> {
  try {
    await executar("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
}

function configuracao(nomes: string[]): string {
  const dns: string[] = [];
  const ips: string[] = [];
  for (const n of nomes) (/^[\d.]+$|:/.test(n) ? ips : dns).push(n);
  const alt = [
    ...dns.map((d, i) => `DNS.${i + 1} = ${d}`),
    ...ips.map((ip, i) => `IP.${i + 1} = ${ip}`),
  ].join("\n");
  return `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
CN = anotador-ui

[ext]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt

[alt]
${alt}
`;
}

/**
 * A autoridade leva o nome da máquina no assunto porque ela aparece na lista de
 * certificados confiáveis do sistema, ao lado das autoridades do mundo inteiro, e
 * quem for removê-la um dia precisa reconhecê-la ali.
 */
function configuracaoAutoridade(maquina: string): string {
  // Campo de certificado em ASCII puro: acento e travessão saem do openssl como bytes
  // crus, e o nome aparece ilegível bem onde a pessoa precisa reconhecê-lo — a lista
  // de autoridades confiáveis do sistema.
  const nome = maquina.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 48) || "local";
  return `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
O = anotador-ui
CN = Anotador UI (${nome})

[ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`;
}

/**
 * A autoridade local que assina os certificados desta máquina.
 *
 * Sem ela, o certificado é assinado por si mesmo e todo navegador para a pessoa com
 * "sua conexão não é particular" — um aviso que ninguém deveria aprender a atravessar.
 * Com ela, a pessoa importa **um** certificado uma vez, em cada aparelho, e o aviso
 * some para sempre, inclusive no celular, onde não há como encaminhar porta.
 *
 * Em troca, a autoridade é uma chave que assina certificado para qualquer nome. Quem a
 * roubar consegue se passar por qualquer sítio para quem a instalou. Por isso ela
 * nasce só nesta máquina, com permissão para o dono, nunca é servida por HTTP — a rota
 * de download entrega o certificado, jamais a chave — e dura o quanto durar a pasta da
 * fila: apagá-la invalida tudo que ela assinou.
 */
async function autoridadeLocal(pasta: string, maquina: string): Promise<{ cert: string; nova: boolean }> {
  const { autoridade, autoridadeChave } = arquivos(pasta);
  try {
    const cert = await readFile(autoridade, "utf8");
    await readFile(autoridadeChave, "utf8");
    return { cert, nova: false };
  } catch {
    // sem autoridade ainda: cria uma
  }
  await mkdir(pasta, { recursive: true });
  const conf = join(pasta, "autoridade.conf");
  await writeFile(conf, configuracaoAutoridade(maquina), "utf8");
  // Dez anos: a autoridade é instalada à mão em cada aparelho, e refazê-la obriga a
  // repetir a instalação em todos eles. O certificado de servidor é que é curto.
  await executar("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-keyout", autoridadeChave, "-out", autoridade,
    "-days", "3650", "-config", conf,
  ]);
  await chmod(autoridadeChave, 0o600);
  return { cert: await readFile(autoridade, "utf8"), nova: true };
}

/**
 * Devolve o par guardado, ou gera um novo. O certificado é refeito quando a lista de
 * endereços muda — trocar de rede dá outro IP, e um certificado que não cobre o
 * endereço que a pessoa digitou falha de um jeito que parece defeito do anotador.
 *
 * A autoridade sobrevive a essas trocas: ela é o que foi instalado nos aparelhos, e
 * refazê-la a cada mudança de rede obrigaria a reinstalar em todos.
 */
export async function parTls(pasta: string, nomes: string[], maquina = "esta máquina"): Promise<ParTls> {
  const alvo = [...new Set(nomes)].sort();
  const { chave, certificado, manifesto } = arquivos(pasta);
  const ca = await autoridadeLocal(pasta, maquina);

  if (!ca.nova) {
    try {
      const guardado = JSON.parse(await readFile(manifesto, "utf8")) as Guardado;
      if (guardado.versao === VERSAO_PAR && JSON.stringify([...guardado.nomes].sort()) === JSON.stringify(alvo)) {
        const [key, cert] = await Promise.all([readFile(chave, "utf8"), readFile(certificado, "utf8")]);
        return { key, cert, ca: ca.cert, nomes: alvo, novo: false, autoridadeNova: false };
      }
    } catch {
      // sem par guardado, guardado para outros endereços, ou ainda autoassinado: refaz
    }
  }

  await mkdir(pasta, { recursive: true });
  const conf = join(pasta, "openssl.conf");
  const pedido = join(pasta, "pedido.csr");
  await writeFile(conf, configuracao(alvo), "utf8");
  await executar("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", chave, "-out", pedido, "-config", conf]);
  await chmod(chave, 0o600);
  // 397 dias é o teto que os navegadores aceitam para certificado de servidor.
  await executar("openssl", [
    "x509", "-req", "-sha256", "-in", pedido,
    "-CA", arquivos(pasta).autoridade, "-CAkey", arquivos(pasta).autoridadeChave, "-CAcreateserial",
    "-out", certificado, "-days", "397", "-extfile", conf, "-extensions", "ext",
  ]);
  await rm(pedido, { force: true });
  await writeFile(manifesto, JSON.stringify({ versao: VERSAO_PAR, nomes: alvo }, null, 2), "utf8");
  const [key, cert] = await Promise.all([readFile(chave, "utf8"), readFile(certificado, "utf8")]);
  return { key, cert, ca: ca.cert, nomes: alvo, novo: true, autoridadeNova: ca.nova };
}
