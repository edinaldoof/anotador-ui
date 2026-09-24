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

import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { IdAgente } from "./agentes.ts";

export interface ComandoDeAgente {
  /** o que se digita, sem a barra */
  nome: string;
  descricao: string;
  /** de quem é: do repositório aberto, da conta desta máquina ou de um plugin ligado */
  origem: "projeto" | "usuário" | "plugin" | "nativo";
  /** como está declarado: uma habilidade ou um comando avulso */
  tipo: "skill" | "comando" | "workflow" | "nativo";
  arquivo: string;
  suporte: "chat" | "terminal";
  motivo?: string;
}

/** Raízes injetáveis nos testes, sem alterar o ambiente ou as configurações pessoais. */
export interface OpcoesDescoberta { casa?: string; claudeHome?: string; codexHome?: string }
const LIMITE_ARQUIVO = 512 * 1024;
const nomeSeguro = (nome: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,199}$/u.test(nome) && !nome.includes("..");

interface Lugar {
  dir: string;
  origem: ComandoDeAgente["origem"];
  tipo: "skill" | "comando" | "workflow";
  /** skills são pastas com um arquivo dentro; comandos são arquivos soltos */
  arquivoDaPasta?: string;
  extensao?: string;
  /** plugin usa `plugin:comando`, que é como o CLI os invoca */
  prefixo?: string;
}

function casas(opcoes: OpcoesDescoberta) {
  const casa = opcoes.casa ?? homedir();
  return { casa, claude: opcoes.claudeHome ?? process.env["CLAUDE_CONFIG_DIR"] ?? join(casa, ".claude"), codex: opcoes.codexHome ?? process.env["CODEX_HOME"] ?? join(casa, ".codex") };
}

function lugaresDe(agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta): Lugar[] {
  const { casa, claude, codex } = casas(opcoes);
  const doProjeto = (rel: string): string | null => (fonte ? join(fonte, rel) : null);
  const lista: Array<Lugar | null> = [];
  const par = (relProjeto: string, absUsuario: string, tipo: Lugar["tipo"], extras: Partial<Lugar> = {}) => {
    const p = doProjeto(relProjeto);
    if (p) lista.push({ dir: p, origem: "projeto", tipo, ...extras });
    lista.push({ dir: absUsuario, origem: "usuário", tipo, ...extras });
  };

  if (agente === "claude") {
    par(".claude/skills", join(claude, "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
    par(".claude/commands", join(claude, "commands"), "comando", { extensao: ".md" });
  } else if (agente === "codex") {
    par(".agents/skills", join(casa, ".agents", "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
    par(".codex/skills", join(codex, "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
    lista.push({ dir: join(codex, "skills", ".system"), origem: "usuário", tipo: "skill", arquivoDaPasta: "SKILL.md" });
    par(".codex/prompts", join(codex, "prompts"), "comando", { extensao: ".md" });
  } else if (agente === "gemini") {
    par(".gemini/commands", join(casa, ".gemini", "commands"), "comando", { extensao: ".toml" });
    par(".gemini/skills", join(casa, ".gemini", "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
  } else if (agente === "opencode") {
    par(".opencode/command", join(casa, ".config", "opencode", "command"), "comando", { extensao: ".md" });
    par(".opencode/commands", join(casa, ".config", "opencode", "commands"), "comando", { extensao: ".md" });
    par(".opencode/skills", join(casa, ".config", "opencode", "skills"), "skill", { arquivoDaPasta: "SKILL.md" });
  } else if (agente === "antigravity") {
    // Confirmado nas instruções agy-customizations distribuídas com o CLI e em
    // https://antigravity.google/docs/migration/workflows-to-skills
    for (const raiz of [".agents", ".agent", "_agents", "_agent"]) {
      if (fonte) {
        lista.push({ dir: join(fonte, raiz, "skills"), origem: "projeto", tipo: "skill", arquivoDaPasta: "SKILL.md" });
        lista.push({ dir: join(fonte, raiz, "workflows"), origem: "projeto", tipo: "workflow", extensao: ".md" });
      }
    }
    for (const raiz of [join(casa, ".gemini", "config"), join(casa, ".gemini", "antigravity")]) {
      lista.push({ dir: join(raiz, "skills"), origem: "usuário", tipo: "skill", arquivoDaPasta: "SKILL.md" });
      lista.push({ dir: join(raiz, raiz.endsWith("antigravity") ? "global_workflows" : "workflows"), origem: "usuário", tipo: "workflow", extensao: ".md" });
    }
    // São SKILL.md reais distribuídos com o CLI, não uma lista presumida de
    // comandos interativos. A invocação no chat expande o arquivo encontrado.
    lista.push({ dir: join(casa, ".gemini", "antigravity-cli", "builtin", "skills"), origem: "nativo", tipo: "skill", arquivoDaPasta: "SKILL.md" });
  } else if (agente === "cursor") {
    par(".cursor/commands", join(casa, ".cursor", "commands"), "comando", { extensao: ".md" });
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

async function arquivoTexto(arquivo: string): Promise<{ arquivo: string; texto: string } | null> {
  try {
    const canonico = await realpath(arquivo);
    const info = await stat(canonico);
    if (!info.isFile() || info.size > LIMITE_ARQUIVO) return null;
    return { arquivo: canonico, texto: await readFile(canonico, "utf8") };
  } catch { return null; }
}

async function lerLugar(lugar: Lugar, visitados = new Set<string>(), profundidade = 0, caminhoNome = ""): Promise<ComandoDeAgente[]> {
  if (profundidade > 8) return [];
  const raiz = await realpath(lugar.dir).catch(() => null);
  if (!raiz || visitados.has(raiz)) return [];
  visitados.add(raiz);
  let entradas: string[];
  try {
    entradas = await readdir(lugar.dir);
  } catch {
    return [];
  }
  const achados: ComandoDeAgente[] = [];
  for (const entrada of entradas.sort()) {
    if (entrada.startsWith(".")) continue;
    const caminho = join(raiz, entrada);
    if (lugar.arquivoDaPasta) {
      const lido = await arquivoTexto(join(caminho, lugar.arquivoDaPasta));
      if (!lido) {
        if ((await stat(caminho).catch(() => null))?.isDirectory()) achados.push(...await lerLugar({ ...lugar, dir: caminho }, visitados, profundidade + 1));
        continue;
      }
      const nome = (lugar.prefixo ?? "") + (nomeDeclarado(lido.texto) ?? entrada);
      if (nomeSeguro(nome) && !/^user-invocable:\s*false\s*$/m.test(lido.texto)) achados.push({ nome, descricao: descricaoDe(lido.texto), origem: lugar.origem, tipo: lugar.tipo, arquivo: lido.arquivo, suporte: "chat" });
      continue;
    }
    if ((await stat(caminho).catch(() => null))?.isDirectory()) {
      achados.push(...await lerLugar({ ...lugar, dir: caminho }, visitados, profundidade + 1, caminhoNome + entrada + ":"));
      continue;
    }
    if (lugar.extensao && !entrada.endsWith(lugar.extensao)) continue;
    const lido = await arquivoTexto(caminho);
    if (!lido) continue;
    const nome = (lugar.prefixo ?? "") + caminhoNome + (nomeDeclarado(lido.texto) ?? entrada.slice(0, entrada.length - (lugar.extensao?.length ?? 0)));
    if (!nomeSeguro(nome)) continue;
    achados.push({
      nome,
      descricao: descricaoDe(lido.texto),
      origem: lugar.origem,
      tipo: lugar.tipo,
      arquivo: lido.arquivo,
      suporte: "chat",
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
async function json(arquivo: string): Promise<Record<string, any>> {
  try { const lido = await arquivoTexto(arquivo); const dado = lido ? JSON.parse(lido.texto) : null; return dado && typeof dado === "object" && !Array.isArray(dado) ? dado : {}; }
  catch { return {}; }
}

/** Lê somente flags de plugins do TOML; nunca executa a configuração do usuário. */
async function pluginsCodex(arquivo: string): Promise<Record<string, boolean>> {
  const texto = (await arquivoTexto(arquivo))?.texto ?? "";
  const flags: Record<string, boolean> = {};
  let plugin: string | null = null;
  let secaoPlugins = false;
  for (const linha of texto.split(/\r?\n/)) {
    if (/^\s*\[/.test(linha)) {
      plugin = /^\s*\[\s*plugins\.(?:"([^"]+)"|'([^']+)'|([\w@-]+))\s*\]/.exec(linha)?.slice(1).find(Boolean) ?? null;
      secaoPlugins = /^\s*\[\s*plugins\s*\]/.test(linha);
      continue;
    }
    const ligado = /^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/.exec(linha);
    if (plugin && ligado) flags[plugin] = ligado[1] === "true";
    const inline = secaoPlugins ? /^\s*["']([^"']+)["']\s*=\s*\{\s*enabled\s*=\s*(true|false)\s*\}/.exec(linha) : null;
    if (inline) flags[inline[1]!] = inline[2] === "true";
  }
  return flags;
}

async function versaoPlugin(base: string): Promise<string | null> {
  const versoes = await readdir(base).catch(() => []);
  const datadas = await Promise.all(versoes.map(async (v) => ({ v, info: await stat(join(base, v)).catch(() => null) })));
  const recente = datadas.filter((v) => v.info?.isDirectory()).sort((a, b) => b.info!.mtimeMs - a.info!.mtimeMs)[0];
  return recente ? join(base, recente.v) : null;
}

async function lugaresDePlugins(agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta): Promise<Lugar[]> {
  const { casa, claude, codex } = casas(opcoes);
  let ligados: Record<string, boolean> = {};
  if (agente === "claude") {
    for (const arquivo of [join(claude, "settings.json"), ...(fonte ? [join(fonte, ".claude", "settings.json"), join(fonte, ".claude", "settings.local.json")] : [])]) {
      const cfg = await json(arquivo);
      if (cfg["enabledPlugins"] && typeof cfg["enabledPlugins"] === "object") Object.assign(ligados, cfg["enabledPlugins"]);
    }
  } else if (agente === "codex") {
    ligados = { ...await pluginsCodex(join(codex, "config.toml")), ...(fonte ? await pluginsCodex(join(fonte, ".codex", "config.toml")) : {}) };
  } else if (agente === "antigravity") {
    const lugares: Lugar[] = [];
    const raizes = [...(fonte ? [".agents", ".agent", "_agents", "_agent"].map((p) => join(fonte, p)) : []), join(casa, ".gemini", "config")];
    for (const raiz of raizes) {
      const cfg = await json(join(raiz, "config.json"));
      for (const nome of await readdir(join(raiz, "plugins")).catch(() => [])) {
        if (!nomeSeguro(nome)) continue;
        const pasta = join(raiz, "plugins", nome);
        const manifesto = await json(join(pasta, "plugin.json"));
        if (!Object.keys(manifesto).length) continue;
        const ligado = cfg["plugins"]?.[nome]?.enabled;
        if (ligado === false || ligado !== true && manifesto["disabled"] === true) continue;
        lugares.push({ dir: join(pasta, "skills"), origem: "plugin", tipo: "skill", arquivoDaPasta: "SKILL.md", prefixo: nome + ":" });
      }
    }
    return lugares;
  } else return [];
  const registro = agente === "claude" ? await json(join(claude, "plugins", "installed_plugins.json")) : {};
  const lugares: Lugar[] = [];
  for (const [id, ligado] of Object.entries(ligados)) {
    if (ligado !== true) continue;
    const [plugin, mercado] = id.split("@");
    if (!plugin || !mercado || !nomeSeguro(plugin) || !nomeSeguro(mercado)) continue;
    const base = join(agente === "claude" ? claude : codex, "plugins", "cache", mercado, plugin);
    const instalacoes = registro["plugins"]?.[id];
    const instalada = Array.isArray(instalacoes) ? instalacoes.find((v: any) => v.scope === "project" && v.projectPath === fonte) ?? instalacoes.find((v: any) => v.scope === "user") : null;
    const raiz = typeof instalada?.installPath === "string" ? instalada.installPath as string : await versaoPlugin(base);
    if (!raiz) continue;
    const manifesto = await json(join(raiz, agente === "claude" ? ".claude-plugin" : ".codex-plugin", "plugin.json"));
    const skills = ["./skills", ...(typeof manifesto["skills"] === "string" ? [manifesto["skills"]] : Array.isArray(manifesto["skills"]) ? manifesto["skills"].filter((v: unknown) => typeof v === "string") : [])];
    for (const p of new Set<string>(skills)) {
      const dir = resolve(raiz, p);
      const rel = relative(resolve(raiz), dir);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) continue;
      lugares.push({ dir, origem: "plugin", tipo: "skill", arquivoDaPasta: "SKILL.md", prefixo: plugin + ":" });
    }
    if (agente === "claude") lugares.push({ dir: join(raiz, "commands"), origem: "plugin", tipo: "comando", extensao: ".md", prefixo: plugin + ":" });
  }
  return lugares;
}

/**
 * O que é do repositório aberto vem antes do que é da conta, e o da conta antes do que
 * chega por plugin. Quem abre o menu num projeto procura primeiro o que o projeto
 * declarou; com centenas de skills de plugins em ordem alfabética, as do projeto
 * sumiam no meio da lista.
 */
const ORDEM_ORIGEM: Record<ComandoDeAgente["origem"], number> = { projeto: 0, "usuário": 1, plugin: 2, nativo: 3 };

async function varrerComandos(agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta): Promise<ComandoDeAgente[]> {
  const lugares = [...lugaresDe(agente, fonte, opcoes), ...await lugaresDePlugins(agente, fonte, opcoes)];
  const listas = await Promise.all(lugares.map((lugar) => lerLugar(lugar)));
  const porNome = new Map<string, ComandoDeAgente>();
  for (const c of listas.flat()) {
    const existente = porNome.get(c.nome);
    if (existente) continue;
    porNome.set(c.nome, c);
  }
  return [...porNome.values()].sort((a, b) => ORDEM_ORIGEM[a.origem] - ORDEM_ORIGEM[b.origem] || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Uma varredura vale por alguns segundos. Abrir o menu, filtrar e mandar o comando
 * acontecem em sequência, às vezes em duas abas, e cada pedido refazia a leitura de
 * todas as pastas — com centenas de SKILL.md de plugins, uma centena de milissegundos
 * por vez. Pedidos simultâneos esperam a mesma varredura. Um comando criado agora
 * aparece na lista na próxima; a expansão não espera por ela (ver `expandirComandoChat`).
 */
const VALIDADE_CATALOGO_MS = 5_000;
const catalogos = new Map<string, { em: number; lista: Promise<ComandoDeAgente[]> }>();

function catalogo(agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta, fresco: boolean): Promise<ComandoDeAgente[]> {
  const { casa, claude, codex } = casas(opcoes);
  const chave = JSON.stringify([agente, fonte, casa, claude, codex]);
  const agora = Date.now();
  for (const [k, v] of catalogos) if (agora - v.em > VALIDADE_CATALOGO_MS) catalogos.delete(k);
  const guardado = catalogos.get(chave);
  if (guardado && !fresco) return guardado.lista;
  const entrada = { em: agora, lista: varrerComandos(agente, fonte, opcoes) };
  catalogos.set(chave, entrada);
  entrada.lista.catch(() => { if (catalogos.get(chave) === entrada) catalogos.delete(chave); });
  return entrada.lista;
}

/**
 * Tudo que o agente aceita como `/nome` neste projeto e nesta máquina, o do projeto
 * primeiro. O do projeto também ganha do da conta quando os dois declaram o mesmo
 * nome, que é a ordem de precedência dos próprios CLIs.
 */
export async function descobrirComandos(agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta = {}): Promise<ComandoDeAgente[]> {
  return [...await catalogo(agente, fonte, opcoes, false)];
}

/** Expande somente comandos descobertos no servidor. Nenhum caminho vem do cliente. */
export async function expandirComandoChat(texto: string, agente: IdAgente, fonte: string | null, opcoes: OpcoesDescoberta = {}): Promise<string | null> {
  const pedido = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(texto.trim());
  if (!pedido || !nomeSeguro(pedido[1]!)) return null;
  const achar = async (fresco: boolean) => (await catalogo(agente, fonte, opcoes, fresco)).find((c) => c.nome === pedido[1] && c.suporte === "chat");
  // A lista guardada só serve para achar o arquivo. Se o comando não está nela, ou o
  // arquivo mudou desde a varredura, o disco decide antes de a mensagem seguir crua.
  let comando = await achar(false);
  let lido = comando ? await arquivoTexto(comando.arquivo) : null;
  if (!comando || !lido || lido.arquivo !== comando.arquivo) {
    comando = await achar(true);
    if (!comando) return null;
    lido = await arquivoTexto(comando.arquivo);
    if (!lido || lido.arquivo !== comando.arquivo) throw new Error("O arquivo deste comando mudou ou não está mais disponível. Atualize a lista.");
  }
  const argumentos = pedido[2]?.trim() ?? "";
  let corpo = lido.texto.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "").trim();
  if (comando.arquivo.endsWith(".toml")) {
    const triplo = /^prompt\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/m.exec(lido.texto);
    const simples = /^prompt\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*$/m.exec(lido.texto);
    if (triplo) corpo = triplo[1] ?? triplo[2] ?? "";
    else if (simples?.[1]) { try { corpo = simples[1].startsWith('"') ? JSON.parse(simples[1]) as string : simples[1].slice(1, -1); } catch { corpo = ""; } }
    else corpo = "";
    if (!corpo.trim()) throw new Error("O comando não possui um prompt TOML válido.");
  }
  const palavras = argumentos.match(/"[^"]*"|'[^']*'|\S+/g)?.map((s) => s.replace(/^["']|["']$/g, "")) ?? [];
  corpo = corpo.replace(/\$ARGUMENTS\b|\{\{args\}\}|\$([1-9])\b/g, (marcador, indice: string | undefined) => indice ? palavras[Number(indice) - 1] ?? "" : argumentos);
  const referencia = `O usuário invocou /${comando.nome}${argumentos ? " " + argumentos : ""}.\nArquivo do comando: ${comando.arquivo}\nResolva referências relativas a partir de ${dirname(comando.arquivo)}.`;
  const conteudo = Buffer.byteLength(corpo) <= 60 * 1024 ? `\n\nInstruções do comando:\n${corpo}` : "\n\nLeia o arquivo do comando indicado acima e siga suas instruções.";
  const resultado = referencia + conteudo + (argumentos ? `\n\nArgumentos fornecidos pelo usuário:\n${argumentos}` : "");
  if (Buffer.byteLength(resultado) > 80 * 1024) throw new Error("Os argumentos deste comando são longos demais.");
  return resultado;
}
