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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);

export interface ParTls {
  key: string;
  cert: string;
  /** nomes e endereços que o certificado cobre */
  nomes: string[];
  /** true quando foi gerado agora, para o log dizer o que aconteceu */
  novo: boolean;
}

interface Guardado {
  nomes: string[];
}

function arquivos(pasta: string) {
  return {
    chave: join(pasta, "chave.pem"),
    certificado: join(pasta, "certificado.pem"),
    manifesto: join(pasta, "nomes.json"),
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
 * Devolve o par guardado, ou gera um novo. O certificado é refeito quando a lista de
 * endereços muda — trocar de rede dá outro IP, e um certificado que não cobre o
 * endereço que a pessoa digitou falha de um jeito que parece defeito do anotador.
 */
export async function parTls(pasta: string, nomes: string[]): Promise<ParTls> {
  const alvo = [...new Set(nomes)].sort();
  const { chave, certificado, manifesto } = arquivos(pasta);

  try {
    const guardado = JSON.parse(await readFile(manifesto, "utf8")) as Guardado;
    if (JSON.stringify([...guardado.nomes].sort()) === JSON.stringify(alvo)) {
      const [key, cert] = await Promise.all([readFile(chave, "utf8"), readFile(certificado, "utf8")]);
      return { key, cert, nomes: alvo, novo: false };
    }
  } catch {
    // sem par guardado, ou guardado para outros endereços: gera
  }

  await mkdir(pasta, { recursive: true });
  const conf = join(pasta, "openssl.conf");
  await writeFile(conf, configuracao(alvo), "utf8");
  // 397 dias é o teto que os navegadores aceitam para certificado de servidor.
  await executar("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", chave, "-out", certificado,
    "-days", "397", "-config", conf,
  ]);
  await writeFile(manifesto, JSON.stringify({ nomes: alvo }, null, 2), "utf8");
  const [key, cert] = await Promise.all([readFile(chave, "utf8"), readFile(certificado, "utf8")]);
  return { key, cert, nomes: alvo, novo: true };
}
