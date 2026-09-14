// Prints escolhidos pelo usuário. O navegador só referencia o UUID; caminhos,
// dimensões e vínculos são recuperados deste armazenamento antes do envio.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ANOTACAO_RE = /^[A-Za-z0-9_-]{8,64}$/;
const LIMITE_PNG = 32 * 1024 * 1024;
const ASSINATURA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const LIMITE_ANEXOS_ANOTACAO = 3;

export class ErroAnexo extends Error {}

export interface ContextoVinculoAnexo {
  /** Origem HTTP autorizada pelo servidor para uma requisição na mesma porta TLS.
   * Não deve ser preenchida a partir do lote ou dos metadados enviados pelo cliente. */
  origemHttpMigrada?: string;
}

export function idAnexoSeguro(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export function normalizarPaginaAnexo(valor: unknown): string {
  try {
    if (typeof valor !== "string" || valor.length > 2000) throw new Error();
    const url = new URL(valor);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new ErroAnexo("URL da página do print inválida"); }
}

function mesmaPaginaAnexo(capturada: string, atual: string, contexto: ContextoVinculoAnexo): boolean {
  if (capturada === atual) return true;
  if (!contexto.origemHttpMigrada) return false;
  try {
    const permitida = new URL(normalizarPaginaAnexo(contexto.origemHttpMigrada));
    if (permitida.protocol !== "http:" || permitida.pathname !== "/" || permitida.search || permitida.hash) return false;
    const origem = new URL(capturada);
    const destino = new URL(atual);
    // Host sem porta explícita não basta: http://host e https://host usam portas
    // diferentes. Só a troca de protocolo no mesmo listener preserva o vínculo.
    return origem.protocol === "http:" && destino.protocol === "https:" && origem.origin === permitida.origin &&
      origem.hostname === destino.hostname && (origem.port || "80") === (destino.port || "443") &&
      origem.pathname === destino.pathname && origem.search === destino.search && origem.hash === destino.hash;
  } catch { return false; }
}

function dimensoesPng(png: Buffer): { largura: number; altura: number } {
  if (png.length < 33 || png.length > LIMITE_PNG || !png.subarray(0, 8).equals(ASSINATURA_PNG) || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new ErroAnexo("imagem PNG inválida ou maior que 32 MB");
  }
  const largura = png.readUInt32BE(16);
  const altura = png.readUInt32BE(20);
  if (!largura || !altura || largura > 8192 || altura > 8192) throw new ErroAnexo("dimensões do PNG inválidas");
  return { largura, altura };
}

function viewportValido(v: unknown): v is ViewportLote {
  if (!v || typeof v !== "object") return false;
  const p = v as ViewportLote;
  return Number.isInteger(p.largura) && p.largura > 0 && p.largura <= 4096 && Number.isInteger(p.altura) && p.altura > 0 && p.altura <= 4096 &&
    typeof p.dpr === "number" && Number.isFinite(p.dpr) && p.dpr > 0 && p.dpr <= 2 &&
    typeof p.scrollX === "number" && Number.isFinite(p.scrollX) && typeof p.scrollY === "number" && Number.isFinite(p.scrollY);
}

/** Apenas o processo servidor cria estes arquivos; nenhuma API aceita caminhos. */
export class Anexos {
  readonly dir: string;
  constructor(dirFila: string) { this.dir = resolve(dirFila, "anexos"); }

  private async raiz(): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    return realpath(this.dir);
  }

  async gravar(png: Buffer, vinculo: { anotacaoId: string; paginaUrl: string; viewport: ViewportLote }): Promise<AnexoImagem> {
    if (!ANOTACAO_RE.test(vinculo.anotacaoId)) throw new ErroAnexo("id da anotação inválido para anexar print");
    if (!viewportValido(vinculo.viewport)) throw new ErroAnexo("viewport do print inválido");
    const paginaUrl = normalizarPaginaAnexo(vinculo.paginaUrl);
    const dimensoes = dimensoesPng(png);
    const raiz = await this.raiz();
    const id = randomUUID();
    const destino = join(raiz, id);
    const temporario = join(raiz, "." + id + ".tmp");
    const anexo: AnexoImagem = {
      id, anotacaoId: vinculo.anotacaoId, paginaUrl, capturadoEm: new Date().toISOString(), ...dimensoes,
      viewport: { ...vinculo.viewport }, caminho: join(destino, "imagem.png"),
    };
    await mkdir(temporario);
    try {
      await writeFile(join(temporario, "imagem.png"), png, { flag: "wx", mode: 0o600 });
      await writeFile(join(temporario, "anexo.json"), JSON.stringify(anexo, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temporario, destino);
    } finally { await rm(temporario, { recursive: true, force: true }); }
    return anexo;
  }

  private async carregar(id: string): Promise<{ anexo: AnexoImagem; png: Buffer } | null> {
    if (!idAnexoSeguro(id)) throw new ErroAnexo("id do print inválido");
    try {
      const raiz = await this.raiz();
      const dir = join(raiz, id);
      const caminho = join(dir, "imagem.png");
      const metadados = join(dir, "anexo.json");
      const [pasta, imagem, json] = await Promise.all([lstat(dir), lstat(caminho), lstat(metadados)]);
      if (!pasta.isDirectory() || pasta.isSymbolicLink() || !imagem.isFile() || imagem.isSymbolicLink() || !json.isFile() || json.isSymbolicLink() ||
          imagem.size > LIMITE_PNG || json.size > 16_384 || await realpath(caminho) !== caminho || await realpath(metadados) !== metadados) return null;
      const [png, bruto] = await Promise.all([readFile(caminho), readFile(metadados, "utf8")]);
      const dados = JSON.parse(bruto) as AnexoImagem;
      const dimensoes = dimensoesPng(png);
      if (dados.id !== id || typeof dados.anotacaoId !== "string" || !ANOTACAO_RE.test(dados.anotacaoId) || !viewportValido(dados.viewport) ||
          typeof dados.capturadoEm !== "string" || !Number.isFinite(Date.parse(dados.capturadoEm))) return null;
      // Recompõe o caminho e as dimensões, mesmo se o JSON em disco foi alterado.
      const anexo: AnexoImagem = {
        id, anotacaoId: dados.anotacaoId, paginaUrl: normalizarPaginaAnexo(dados.paginaUrl), capturadoEm: dados.capturadoEm,
        ...dimensoes, viewport: { ...dados.viewport }, caminho,
      };
      return { anexo, png };
    } catch { return null; }
  }

  async ler(id: string): Promise<AnexoImagem | null> { return (await this.carregar(id))?.anexo ?? null; }
  async imagem(id: string): Promise<Buffer | null> { return (await this.carregar(id))?.png ?? null; }

  async resolver(referencias: unknown, anotacaoId: string, paginaUrl: string, contexto: ContextoVinculoAnexo = {}): Promise<AnexoImagem[]> {
    if (!Array.isArray(referencias) || referencias.length > LIMITE_ANEXOS_ANOTACAO) throw new ErroAnexo("cada anotação aceita no máximo 3 prints");
    if (!referencias.length) return [];
    const pagina = normalizarPaginaAnexo(paginaUrl);
    const vistos = new Set<string>();
    const resolvidos: AnexoImagem[] = [];
    for (const referencia of referencias) {
      const id: unknown = referencia && typeof referencia === "object" ? referencia.id : null;
      if (!idAnexoSeguro(id) || vistos.has(id)) throw new ErroAnexo("id do print inválido ou repetido");
      vistos.add(id);
      const anexo = await this.ler(id);
      if (!anexo) throw new ErroAnexo("print não encontrado; tire a captura novamente");
      if (anexo.anotacaoId !== anotacaoId || !mesmaPaginaAnexo(anexo.paginaUrl, pagina, contexto)) throw new ErroAnexo("o print pertence a outra anotação ou página");
      resolvidos.push(anexo);
    }
    return resolvidos;
  }
}
