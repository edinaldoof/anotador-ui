// Os comandos de barra que o agente conectado entende.
//
// Cada CLI de agente guarda os comandos personalizados em pastas próprias, umas do
// projeto e outras do usuário. O anotador varre essas pastas e oferece o que achou no
// chat do overlay, do jeito que a linha de comando ofereceria: digitou `/`, viu a
// lista, escolheu.
//
// Só entra aqui o que existe no disco. Comandos embutidos de cada CLI ficam de fora de
// propósito: `/compact` e `/clear` valem para a sessão do terminal, não para uma
// mensagem que chega pelo anotador, e oferecê-los seria prometer um efeito que não
// acontece.

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IdAgente } from "./agentes.ts";

export interface ComandoDeAgente {
  /** o que se digita, sem a barra */
  nome: string;
  descricao: string;
  /** de quem é: do repositório aberto, da conta desta máquina ou de um plugin ligado */
  origem: "projeto" | "usuário" | "plugin";
  /** como está declarado: uma habilidade ou um comando avulso */
  tipo: "skill" | "comando";
  arquivo: string;
}

interface Lugar {
  dir: string;
  origem: ComandoDeAgente["origem"];
  tipo: "skill" | "comando";
  /** skills são pastas com um arquivo dentro; comandos são arquivos soltos */
  arquivoDaPasta?: string;
  extensao?: string;
  /** plugin usa `plugin:comando`, que é como o CLI os invoca */
  prefixo?: string;
}

function lugaresDe(agente: IdAgente, fonte: string | null): Lugar[] {
  const casa = homedir();
  const doProjeto = (rel: string): string | null => (fonte ? join(fonte, rel) : null);
  const lista: Array<Lugar | null> = [];
  const par = (relProjeto: string, absUsuario: string, tipo: Lugar["tipo"], extras: Partial<Lugar> = {}) => {
    const p = doProjeto(relProjeto);
    if (p) lista.push({ dir: p, origem: "projeto", tipo, ...extras });
    lista.push({ dir: absUsuario, origem: "usuário", tipo, ...extras });
  };

  if (agente === "claude") {
    par(".claude/skills", join(casa, ".claude", "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
    par(".claude/commands", join(casa, ".claude", "commands"), "comando", { extensao: ".md" });
  } else if (agente === "codex") {
    par(".codex/prompts", join(casa, ".codex", "prompts"), "comando", { extensao: ".md" });
  } else if (agente === "gemini") {
    par(".gemini/commands", join(casa, ".gemini", "commands"), "comando", { extensao: ".toml" });
  } else if (agente === "opencode") {
    par(".opencode/command", join(casa, ".config", "opencode", "command"), "comando", { extensao: ".md" });
  }
  return lista.filter((l): l is Lugar => l !== null);
}

/** `description:` do frontmatter, ou a primeira linha que não seja título. */
function descricaoDe(texto: string): string {
  const frente = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (frente?.[1]) {
    const d = /^description:\s*(.+)$/m.exec(frente[1]);
    if (d?.[1]) return d[1].trim().replace(/^["']|["']$/g, "");
  }
  const toml = /^description\s*=\s*"([^"]+)"/m.exec(texto);
  if (toml?.[1]) return toml[1];
  for (const linha of texto.split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#") || l.startsWith("---")) continue;
    return l;
  }
  return "";
}

function nomeDeclarado(texto: string): string | null {
  const frente = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  const n = frente?.[1] ? /^name:\s*(.+)$/m.exec(frente[1]) : null;
  return n?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

async function lerLugar(lugar: Lugar): Promise<ComandoDeAgente[]> {
  let entradas: string[];
  try {
    entradas = await readdir(lugar.dir);
  } catch {
    return [];
  }
  const achados: ComandoDeAgente[] = [];
  for (const entrada of entradas.sort()) {
    if (entrada.startsWith(".")) continue;
    const caminho = join(lugar.dir, entrada);
    if (lugar.arquivoDaPasta) {
      const arquivo = join(caminho, lugar.arquivoDaPasta);
      const info = await stat(arquivo).catch(() => null);
      if (!info?.isFile()) continue;
      const texto = await readFile(arquivo, "utf8").catch(() => "");
      achados.push({ nome: (lugar.prefixo ?? "") + (nomeDeclarado(texto) ?? entrada), descricao: descricaoDe(texto), origem: lugar.origem, tipo: lugar.tipo, arquivo });
      continue;
    }
    if (lugar.extensao && !entrada.endsWith(lugar.extensao)) continue;
    const info = await stat(caminho).catch(() => null);
    if (!info?.isFile()) continue;
    const texto = await readFile(caminho, "utf8").catch(() => "");
    achados.push({
      nome: (lugar.prefixo ?? "") + (nomeDeclarado(texto) ?? entrada.slice(0, entrada.length - (lugar.extensao?.length ?? 0))),
      descricao: descricaoDe(texto),
      origem: lugar.origem,
      tipo: lugar.tipo,
      arquivo: caminho,
    });
  }
  return achados;
}

/** "Claude Code" → "claude". O rótulo do agente é livre; o id é o que dirige a busca. */
export function idPeloNome(nome: string): IdAgente | null {
  const n = nome.toLowerCase();
  if (n.includes("claude")) return "claude";
  if (n.includes("codex") || n.includes("gpt") || n.includes("openai")) return "codex";
  if (n.includes("gemini")) return "gemini";
  if (n.includes("opencode")) return "opencode";
  if (n.includes("antigravity")) return "antigravity";
  if (n.includes("cursor")) return "cursor";
  return null;
}

/**
 * Plugins ligados do Claude Code. Quais estão ligados está em `settings.json`; onde
 * cada um mora, no cache, que guarda mais de uma versão do mesmo plugin lado a lado —
 * vale a pasta modificada por último, que é a que a versão instalada escreveu.
 */
async function lugaresDePlugins(): Promise<Lugar[]> {
  const casa = homedir();
  let ligados: string[];
  try {
    const cfg = JSON.parse(await readFile(join(casa, ".claude", "settings.json"), "utf8")) as { enabledPlugins?: Record<string, boolean> };
    ligados = Object.entries(cfg.enabledPlugins ?? {}).filter(([, ligado]) => ligado).map(([id]) => id);
  } catch {
    return [];
  }
  const lugares: Lugar[] = [];
  for (const id of ligados) {
    const [plugin, mercado] = id.split("@");
    if (!plugin || !mercado) continue;
    const base = join(casa, ".claude", "plugins", "cache", mercado, plugin);
    let versoes: string[];
    try {
      versoes = await readdir(base);
    } catch {
      continue;
    }
    const datadas = await Promise.all(
      versoes.map(async (v) => ({ v, em: (await stat(join(base, v)).catch(() => null))?.mtimeMs ?? 0 }))
    );
    const recente = datadas.sort((a, b) => b.em - a.em)[0];
    if (!recente) continue;
    const raiz = join(base, recente.v);
    lugares.push({ dir: join(raiz, "skills"), origem: "plugin", tipo: "skill", arquivoDaPasta: "SKILL.md", prefixo: plugin + ":" });
    lugares.push({ dir: join(raiz, "commands"), origem: "plugin", tipo: "comando", extensao: ".md", prefixo: plugin + ":" });
  }
  return lugares;
}

/**
 * Tudo que o agente aceita como `/nome` neste projeto e nesta máquina. O do projeto
 * ganha do da conta quando os dois declaram o mesmo nome, que é a ordem de precedência
 * dos próprios CLIs.
 */
export async function descobrirComandos(agente: IdAgente, fonte: string | null): Promise<ComandoDeAgente[]> {
  const lugares = [...lugaresDe(agente, fonte), ...(agente === "claude" ? await lugaresDePlugins() : [])];
  const listas = await Promise.all(lugares.map(lerLugar));
  const porNome = new Map<string, ComandoDeAgente>();
  for (const c of listas.flat()) {
    const existente = porNome.get(c.nome);
    if (existente && existente.origem === "projeto") continue;
    porNome.set(c.nome, c);
  }
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
