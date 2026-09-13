// Instalação da San Francisco (Apple) na máquina de quem usa o anotador.
//
// Os arquivos nunca entram no repositório: a licença da Apple permite instalar e usar,
// não redistribuir. O que este módulo faz é o mesmo que a pessoa faria à mão — baixar
// de developer.apple.com e extrair a cadeia dmg → pkg → Payload — só que sem o trabalho.

import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const rodar = promisify(execFile);

export const FAMILIAS = [
  { id: "SF-Pro", familia: "SF Pro", descricao: "interface (Text e Display)", padrao: true },
  { id: "SF-Mono", familia: "SF Mono", descricao: "código e seletores", padrao: true },
  { id: "SF-Compact", familia: "SF Compact", descricao: "telas estreitas (watchOS)", padrao: false },
] as const;

const CDN = "https://devimages-cdn.apple.com/design/resources/download";

export interface EstadoFontes {
  plataforma: NodeJS.Platform;
  /** o sistema já traz a San Francisco (Apple) e nada precisa ser feito */
  nativa: boolean;
  pasta: string;
  instaladas: string[];
  faltando: string[];
  /** ferramentas exigidas pela extração que não estão no PATH */
  faltamFerramentas: string[];
}

function noPath(binario: string): string | null {
  for (const pasta of (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    const caminho = join(pasta, binario);
    if (existsSync(caminho)) return caminho;
  }
  return null;
}

export function pastaDasFontes(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Fonts");
  return join(homedir(), ".local", "share", "fonts", "apple-sf");
}

async function familiasConhecidas(): Promise<string[]> {
  // fc-list é a fonte da verdade no Linux; no macOS a San Francisco é do próprio sistema.
  if (!noPath("fc-list")) return [];
  try {
    const { stdout } = await rodar("fc-list", [":", "family"], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split("\n");
  } catch {
    return [];
  }
}

export async function estadoDasFontes(): Promise<EstadoFontes> {
  const plataforma = platform();
  const nativa = plataforma === "darwin";
  const linhas = nativa ? [] : await familiasConhecidas();
  const instaladas: string[] = [];
  const faltando: string[] = [];
  for (const f of FAMILIAS) {
    const tem = nativa || linhas.some((l) => l.includes(f.familia));
    (tem ? instaladas : faltando).push(f.familia);
  }
  const faltamFerramentas = nativa ? [] : ["7z", "cpio"].filter((b) => !noPath(b));
  return { plataforma, nativa, pasta: pastaDasFontes(), instaladas, faltando, faltamFerramentas };
}

async function baixar(url: string, destino: string, aoAndar?: (bytes: number, total: number) => void): Promise<void> {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok || !resp.body) throw new Error(`${url} respondeu HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length") ?? 0);
  let lidos = 0;
  const corpo = Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0]);
  corpo.on("data", (p: Buffer) => {
    lidos += p.length;
    aoAndar?.(lidos, total);
  });
  await pipeline(corpo, createWriteStream(destino));
}

async function acharArquivo(raiz: string, casa: (nome: string) => boolean): Promise<string | null> {
  const pendentes = [raiz];
  while (pendentes.length) {
    const atual = pendentes.pop() as string;
    let entradas;
    try {
      entradas = await readdir(atual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const caminho = join(atual, e.name);
      if (e.isDirectory()) pendentes.push(caminho);
      else if (casa(e.name)) return caminho;
    }
  }
  return null;
}

async function todosOsArquivos(raiz: string, casa: (nome: string) => boolean): Promise<string[]> {
  const achados: string[] = [];
  const pendentes = [raiz];
  while (pendentes.length) {
    const atual = pendentes.pop() as string;
    let entradas;
    try {
      entradas = await readdir(atual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      const caminho = join(atual, e.name);
      if (e.isDirectory()) pendentes.push(caminho);
      else if (casa(e.name)) achados.push(caminho);
    }
  }
  return achados;
}

export interface ResultadoInstalacao {
  familia: string;
  arquivos: number;
  erro?: string;
}

export interface OpcoesInstalacao {
  /** inclui a SF Compact, que só serve a telas de relógio */
  compact?: boolean;
  /** reinstala mesmo que a família já esteja presente */
  forcar?: boolean;
  aoInformar?: (mensagem: string) => void;
}

export async function instalarFontes(opcoes: OpcoesInstalacao = {}): Promise<ResultadoInstalacao[]> {
  const informar = opcoes.aoInformar ?? (() => undefined);
  const estado = await estadoDasFontes();
  if (estado.nativa) {
    informar("macOS já traz a San Francisco; nada a instalar.");
    return [];
  }
  if (estado.faltamFerramentas.length) {
    throw new Error(
      `faltam ferramentas para extrair os arquivos da Apple: ${estado.faltamFerramentas.join(", ")}. ` +
        "No Debian e Ubuntu: sudo apt install p7zip-full cpio"
    );
  }
  const escolhidas = FAMILIAS.filter((f) => (f.padrao || opcoes.compact) && (opcoes.forcar || estado.faltando.includes(f.familia)));
  if (!escolhidas.length) {
    informar("As famílias pedidas já estão instaladas (use --forcar para refazer).");
    return [];
  }
  const destino = pastaDasFontes();
  await mkdir(destino, { recursive: true });
  const trabalho = await mkdtemp(join(tmpdir(), "anotador-fontes-"));
  const resultados: ResultadoInstalacao[] = [];
  try {
    for (const f of escolhidas) {
      try {
        const dmg = join(trabalho, `${f.id}.dmg`);
        let ultimo = -1;
        informar(`${f.familia}: baixando…`);
        await baixar(`${CDN}/${f.id}.dmg`, dmg, (lidos, total) => {
          if (!total) return;
          const passo = Math.floor((lidos / total) * 4);
          if (passo > ultimo) {
            ultimo = passo;
            if (passo < 4) informar(`${f.familia}: ${Math.round((lidos / total) * 100)}% de ${Math.round(total / 1048576)} MB`);
          }
        });
        const pasta = join(trabalho, f.id);
        await mkdir(join(pasta, "pkg"), { recursive: true });
        await mkdir(join(pasta, "fontes"), { recursive: true });
        // O dmg guarda um instalador .pkg; o .pkg guarda um Payload em cpio.
        await rodar("7z", ["e", dmg, `-o${pasta}`, "*.pkg", "-r", "-y"], { maxBuffer: 16 * 1024 * 1024 });
        const pkg = await acharArquivo(pasta, (n) => n.endsWith(".pkg"));
        if (!pkg) throw new Error("nenhum instalador .pkg dentro do dmg");
        await rodar("7z", ["x", pkg, `-o${join(pasta, "pkg")}`, "-y"], { maxBuffer: 16 * 1024 * 1024 });
        const payload = await acharArquivo(join(pasta, "pkg"), (n) => n.startsWith("Payload"));
        if (!payload) throw new Error("nenhum Payload dentro do .pkg");
        await rodar("sh", ["-c", `cd ${JSON.stringify(join(pasta, "fontes"))} && cpio -idm < ${JSON.stringify(payload)}`], { maxBuffer: 16 * 1024 * 1024 });
        const arquivos = await todosOsArquivos(join(pasta, "fontes"), (n) => /\.(otf|ttf)$/i.test(n));
        if (!arquivos.length) throw new Error("nenhum arquivo de fonte no Payload");
        await rodar("sh", ["-c", `cp -f ${arquivos.map((a) => JSON.stringify(a)).join(" ")} ${JSON.stringify(destino)}/`], { maxBuffer: 8 * 1024 * 1024 });
        resultados.push({ familia: f.familia, arquivos: arquivos.length });
        informar(`${f.familia}: ${arquivos.length} arquivo(s) instalados`);
      } catch (erro) {
        const msg = erro instanceof Error ? erro.message : String(erro);
        resultados.push({ familia: f.familia, arquivos: 0, erro: msg });
        informar(`${f.familia}: falhou — ${msg}`);
      }
    }
    if (noPath("fc-cache")) await rodar("fc-cache", ["-f", destino]).catch(() => undefined);
  } finally {
    await rm(trabalho, { recursive: true, force: true }).catch(() => undefined);
  }
  return resultados;
}

export async function tamanhoInstalado(): Promise<number> {
  const destino = pastaDasFontes();
  const arquivos = await todosOsArquivos(destino, (n) => /\.(otf|ttf)$/i.test(n)).catch(() => []);
  let total = 0;
  for (const a of arquivos) total += (await stat(a).catch(() => ({ size: 0 }))).size;
  return total;
}
