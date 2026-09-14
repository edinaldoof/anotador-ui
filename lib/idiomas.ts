import { readFile, stat } from "node:fs/promises";

const ARQUIVO = new URL("./idiomas.js", import.meta.url);
let cache: { mtime: number; codigo: string } | null = null;

/** Runtime local, compartilhado por páginas e pelo overlay, sem CDN. */
export async function scriptIdiomas(): Promise<string> {
  const { mtimeMs } = await stat(ARQUIVO);
  if (!cache || cache.mtime !== mtimeMs) cache = { mtime: mtimeMs, codigo: await readFile(ARQUIVO, "utf8") };
  return cache.codigo;
}

/** Executa antes do código da página, mantendo CSP e conteúdo local. */
export async function injetarIdiomasHtml(html: string): Promise<string> {
  const script = '<script data-anotador-idiomas>' + (await scriptIdiomas()).replace(/<\/script/gi, "<\\/script") + '</script>';
  const inicio = html.search(/<script(?:\s|>)/i);
  return inicio < 0 ? html.replace(/<\/head>/i, script + '</head>') : html.slice(0, inicio) + script + html.slice(inicio);
}
