// Página de conexão: HTML estático servido em /__anotador/ — o restante é a API do servidor.

import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injetarIdiomasHtml } from "./idiomas.ts";

const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), "conexao.html");
let cache: { mtime: number; html: string } | null = null;

async function traduzivel(html: string): Promise<string> {
  const catalogo = await readFile(new URL("./conexao-idiomas.js", import.meta.url), "utf8");
  return injetarIdiomasHtml(html.replace(/<script>/i, "<script>" + catalogo.replace(/<\/script/gi, "<\\/script") + "</script>\n<script>"));
}

export async function paginaConexao(): Promise<string> {
  const { mtimeMs } = await stat(ARQUIVO);
  if (cache && cache.mtime === mtimeMs) return traduzivel(cache.html);
  const html = await readFile(ARQUIVO, "utf8");
  cache = { mtime: mtimeMs, html };
  return traduzivel(html);
}
