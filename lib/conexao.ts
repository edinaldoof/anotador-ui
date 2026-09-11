// Página de conexão: HTML estático servido em /__anotador/ — o restante é a API do servidor.

import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), "conexao.html");
let cache: { mtime: number; html: string } | null = null;

export async function paginaConexao(): Promise<string> {
  const { mtimeMs } = await stat(ARQUIVO);
  if (cache && cache.mtime === mtimeMs) return cache.html;
  const html = await readFile(ARQUIVO, "utf8");
  cache = { mtime: mtimeMs, html };
  return html;
}
