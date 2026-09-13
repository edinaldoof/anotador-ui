// Agentes de código na máquina: quais estão instalados, que sessões existem para o projeto
// e como "iniciar a conversa" — a ponte que chama o agente pela linha de comando quando
// nenhuma sessão está ouvindo os eventos.

import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { marcaDe } from "./marcas.ts";

export type IdAgente = "claude" | "codex" | "gemini" | "antigravity" | "cursor" | "opencode";

export interface AgenteConhecido {
  id: IdAgente;
  nome: string;
  binario: string;
  /** como o agente recebe as anotações */
  como: string;
  /** tem comando não interativo que a ponte consegue chamar */
  ponte: boolean;
  /** lista sessões (Claude Code e Codex) */
  sessoes: boolean;
}

export const AGENTES: AgenteConhecido[] = [
  { id: "claude", nome: "Claude Code", binario: "claude", como: "Numa sessão aberta, digite /anotar: ela passa a ouvir os eventos. Sem sessão ouvindo, a ponte chama `claude -p` (na sessão escolhida ou numa nova).", ponte: true, sessoes: true },
  { id: "codex", nome: "Codex CLI", binario: "codex", como: "A ponte chama `codex exec` (ou `codex exec resume <sessão>`) a cada lote. Numa sessão interativa, peça para ler lotes/<id>.md e usar a API.", ponte: true, sessoes: true },
  { id: "gemini", nome: "Gemini CLI", binario: "gemini", como: "A ponte chama `gemini -p` a cada lote.", ponte: true, sessoes: false },
  { id: "opencode", nome: "OpenCode", binario: "opencode", como: "A ponte chama `opencode run` a cada lote.", ponte: true, sessoes: false },
  { id: "antigravity", nome: "Antigravity", binario: "antigravity", como: "IDE sem linha de comando para agentes: abra a pasta do projeto e peça ao agente para ler lotes/<id>.md (ou ouvir ws://…/__anotador/eventos) e usar a API REST.", ponte: false, sessoes: false },
  { id: "cursor", nome: "Cursor", binario: "cursor", como: "Abra a pasta do projeto e peça ao agente para ler lotes/<id>.md e usar a API REST.", ponte: false, sessoes: false },
];

export interface AgenteDetectado extends AgenteConhecido {
  instalado: boolean;
  caminho: string | null;
  /** SVG da marca do provedor, para a interface */
  marca: string;
  /** modelos que dá para escolher, quando o agente permite */
  modelos: ModeloAgente[];
}

export interface ModeloAgente {
  valor: string;
  titulo: string;
  descricao?: string;
  /** níveis de raciocínio aceitos por este modelo */
  esforcos: string[];
  esforcoPadrao?: string;
  padrao?: boolean;
}

// O Claude Code aceita apelido ou nome completo em --model, e --effort de low a max.
const MODELOS_CLAUDE: ModeloAgente[] = [
  { valor: "fable", titulo: "Fable 5.1", descricao: "O mais capaz para trabalho difícil", esforcos: ["low", "medium", "high", "xhigh", "max"], esforcoPadrao: "high" },
  { valor: "opus", titulo: "Opus 5", descricao: "Forte e rápido no dia a dia", esforcos: ["low", "medium", "high", "xhigh", "max"], esforcoPadrao: "high", padrao: true },
  { valor: "sonnet", titulo: "Sonnet 5", descricao: "Equilibra custo e capacidade", esforcos: ["low", "medium", "high", "xhigh", "max"], esforcoPadrao: "medium" },
  { valor: "haiku", titulo: "Haiku 4.5", descricao: "Barato para tarefas simples", esforcos: ["low", "medium", "high"], esforcoPadrao: "medium" },
];

interface ModeloCodex {
  slug?: string;
  display_name?: string;
  description?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort?: string }>;
  visibility?: string;
}

let cacheModelosCodex: { em: number; lista: ModeloAgente[] } | null = null;

// O Codex guarda em ~/.codex/models_cache.json o que a conta do usuário pode usar.
function modelosCodex(): ModeloAgente[] {
  if (cacheModelosCodex && Date.now() - cacheModelosCodex.em < 60_000) return cacheModelosCodex.lista;
  let lista: ModeloAgente[] = [];
  try {
    const bruto = JSON.parse(readFileSync(join(pastaCodex(), "models_cache.json"), "utf8")) as { models?: ModeloCodex[] };
    lista = (bruto.models ?? [])
      .filter((m) => m.slug && m.visibility !== "hidden")
      .slice(0, 12)
      .map((m) => {
        const modelo: ModeloAgente = {
          valor: String(m.slug),
          titulo: m.display_name ?? String(m.slug),
          esforcos: (m.supported_reasoning_levels ?? []).map((n) => String(n.effort)).filter(Boolean),
        };
        if (m.description) modelo.descricao = m.description;
        if (m.default_reasoning_level) modelo.esforcoPadrao = m.default_reasoning_level;
        return modelo;
      });
    const padrao = /^model\s*=\s*"([^"]+)"/m.exec(readFileSync(join(pastaCodex(), "config.toml"), "utf8"))?.[1];
    for (const m of lista) if (m.valor === padrao) m.padrao = true;
  } catch {
    lista = [];
  }
  cacheModelosCodex = { em: Date.now(), lista };
  return lista;
}

export function modelosDe(id: IdAgente): ModeloAgente[] {
  if (id === "claude") return MODELOS_CLAUDE;
  if (id === "codex") return modelosCodex();
  return [];
}

function procurarNoPath(binario: string): string | null {
  const pastas = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const extensoes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const pasta of pastas) {
    for (const ext of extensoes) {
      const caminho = join(pasta, binario + ext);
      if (existsSync(caminho)) return caminho;
    }
  }
  return null;
}

let cacheAgentes: { em: number; lista: AgenteDetectado[] } | null = null;

export function detectarAgentes(): AgenteDetectado[] {
  if (cacheAgentes && Date.now() - cacheAgentes.em < 20_000) return cacheAgentes.lista;
  const lista = AGENTES.map((a) => {
    const caminho = procurarNoPath(a.binario);
    return { ...a, instalado: caminho !== null, caminho, marca: marcaDe(a.id), modelos: caminho ? modelosDe(a.id) : [] };
  });
  cacheAgentes = { em: Date.now(), lista };
  return lista;
}

// ---------- sessões ----------
export interface SessaoAgente {
  agente: "claude" | "codex";
  id: string;
  /** nome curto que o próprio agente deu (Claude Code) */
  nome: string | null;
  /** primeira mensagem do usuário, resumida */
  titulo: string | null;
  cwd: string | null;
  /** processo vivo agora */
  ativa: boolean;
  pid: number | null;
  /** de onde foi aberta: claude-desktop, cli, Codex Desktop… */
  origem: string | null;
  /** última atividade (ISO) */
  em: string;
}

export function pastaClaude(): string {
  return process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
}

export function pastaCodex(): string {
  return process.env["CODEX_HOME"] || join(homedir(), ".codex");
}

/** `/opt/preprojetos` → `-opt-preprojetos`, como o Claude Code nomeia a pasta do projeto. */
export function slugProjetoClaude(fonte: string): string {
  return resolve(fonte).replace(/[^a-zA-Z0-9-]/g, "-");
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

function mesmaPasta(a: string | null | undefined, b: string | null): boolean {
  if (!b) return true;
  if (!a) return false;
  return resolve(a) === resolve(b);
}

async function lerInicio(caminho: string, bytes = 96 * 1024): Promise<string> {
  const fd = await open(caminho, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fd.close();
  }
}

function resumirTitulo(texto: string): string | null {
  const t = texto.replace(/\s+/g, " ").trim();
  if (!t || t.startsWith("<")) return null;
  return t.length > 90 ? t.slice(0, 89) + "…" : t;
}

// Primeira mensagem do usuário num transcript JSONL do Claude Code.
function tituloClaude(inicio: string): string | null {
  for (const linha of inicio.split("\n")) {
    if (!linha.includes('"type":"user"')) continue;
    try {
      const o = JSON.parse(linha) as { type?: string; message?: { content?: unknown } };
      if (o.type !== "user") continue;
      const c = o.message?.content;
      if (typeof c === "string") {
        const t = resumirTitulo(c);
        if (t) return t;
      } else if (Array.isArray(c)) {
        for (const parte of c as Array<{ type?: string; text?: string }>) {
          if (parte.type === "text" && parte.text) {
            const t = resumirTitulo(parte.text);
            if (t) return t;
          }
        }
      }
    } catch {
      /* linha cortada no limite de leitura */
    }
  }
  return null;
}

interface SessaoViva {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind?: string;
  entrypoint?: string;
  name?: string;
}

export async function sessoesVivasClaude(fonte: string | null): Promise<SessaoViva[]> {
  const pasta = join(pastaClaude(), "sessions");
  let nomes: string[] = [];
  try {
    nomes = (await readdir(pasta)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const vivas: SessaoViva[] = [];
  for (const nome of nomes) {
    try {
      const s = JSON.parse(await readFile(join(pasta, nome), "utf8")) as Partial<SessaoViva>;
      if (typeof s.pid !== "number" || typeof s.sessionId !== "string" || typeof s.cwd !== "string") continue;
      if (!processoVivo(s.pid) || !mesmaPasta(s.cwd, fonte)) continue;
      vivas.push({ pid: s.pid, sessionId: s.sessionId, cwd: s.cwd, startedAt: s.startedAt ?? 0, kind: s.kind, entrypoint: s.entrypoint, name: s.name });
    } catch {
      /* arquivo sendo escrito */
    }
  }
  return vivas;
}

export async function sessoesClaude(fonte: string | null, limite = 8): Promise<SessaoAgente[]> {
  const vivas = await sessoesVivasClaude(fonte);
  const porId = new Map<string, SessaoAgente>();
  for (const v of vivas) {
    porId.set(v.sessionId, {
      agente: "claude",
      id: v.sessionId,
      nome: v.name ?? null,
      titulo: null,
      cwd: v.cwd,
      ativa: true,
      pid: v.pid,
      origem: v.entrypoint ?? v.kind ?? null,
      em: new Date(v.startedAt || Date.now()).toISOString(),
    });
  }
  if (fonte) {
    const pasta = join(pastaClaude(), "projects", slugProjetoClaude(fonte));
    let arquivos: Array<{ id: string; caminho: string; mtime: number }> = [];
    try {
      const nomes = (await readdir(pasta)).filter((n) => n.endsWith(".jsonl"));
      arquivos = await Promise.all(nomes.map(async (n) => ({ id: n.slice(0, -6), caminho: join(pasta, n), mtime: (await stat(join(pasta, n))).mtimeMs })));
    } catch {
      arquivos = [];
    }
    arquivos.sort((a, b) => b.mtime - a.mtime);
    for (const a of arquivos.slice(0, limite)) {
      let titulo: string | null = null;
      try {
        titulo = tituloClaude(await lerInicio(a.caminho));
      } catch {
        titulo = null;
      }
      const viva = porId.get(a.id);
      if (viva) {
        viva.titulo = titulo;
        viva.em = new Date(Math.max(a.mtime, new Date(viva.em).getTime())).toISOString();
      } else {
        porId.set(a.id, { agente: "claude", id: a.id, nome: null, titulo, cwd: fonte, ativa: false, pid: null, origem: null, em: new Date(a.mtime).toISOString() });
      }
    }
  }
  return Array.from(porId.values()).sort((a, b) => Number(b.ativa) - Number(a.ativa) || b.em.localeCompare(a.em));
}

async function listarRollouts(raiz: string, limite: number): Promise<string[]> {
  // sessions/AAAA/MM/DD/rollout-<data>-<id>.jsonl — os nomes ordenam por data.
  const saida: string[] = [];
  let anos: string[] = [];
  try {
    anos = (await readdir(raiz)).filter((a) => /^\d{4}$/.test(a)).sort().reverse();
  } catch {
    return [];
  }
  for (const ano of anos) {
    const meses = (await readdir(join(raiz, ano)).catch(() => [] as string[])).sort().reverse();
    for (const mes of meses) {
      const dias = (await readdir(join(raiz, ano, mes)).catch(() => [] as string[])).sort().reverse();
      for (const dia of dias) {
        const arquivos = (await readdir(join(raiz, ano, mes, dia)).catch(() => [] as string[]))
          .filter((n) => n.startsWith("rollout-") && n.endsWith(".jsonl"))
          .sort()
          .reverse();
        for (const n of arquivos) {
          saida.push(join(raiz, ano, mes, dia, n));
          if (saida.length >= limite) return saida;
        }
      }
    }
  }
  return saida;
}

export async function sessoesCodex(fonte: string | null, limite = 10): Promise<SessaoAgente[]> {
  const arquivos = await listarRollouts(join(pastaCodex(), "sessions"), 400);
  const saida: SessaoAgente[] = [];
  for (const caminho of arquivos) {
    if (saida.length >= limite) break;
    let inicio: string;
    try {
      inicio = await lerInicio(caminho, 64 * 1024);
    } catch {
      continue;
    }
    const primeira = inicio.split("\n")[0] ?? "";
    let meta: { payload?: { id?: string; cwd?: string; originator?: string; thread_source?: string; source?: unknown; timestamp?: string } };
    try {
      meta = JSON.parse(primeira) as typeof meta;
    } catch {
      continue;
    }
    const p = meta.payload;
    if (!p?.id || p.thread_source === "subagent") continue;
    if (!mesmaPasta(p.cwd, fonte)) continue;
    let titulo: string | null = null;
    const m = /"role":"user"[^\n]*?"text":"((?:[^"\\]|\\.){1,200})/.exec(inicio);
    if (m?.[1]) titulo = resumirTitulo(m[1].replace(/\\n/g, " ").replace(/\\"/g, '"'));
    saida.push({ agente: "codex", id: p.id, nome: null, titulo, cwd: p.cwd ?? null, ativa: false, pid: null, origem: p.originator ?? null, em: p.timestamp ?? new Date((await stat(caminho)).mtimeMs).toISOString() });
  }
  return saida;
}

// ---------- ponte: chamar o agente pela linha de comando ----------
export interface Execucao {
  id: string;
  agente: IdAgente;
  sessao: string | null;
  modelo?: string | null;
  comando: string[];
  pid: number | null;
  iniciadoEm: string;
  terminadoEm: string | null;
  codigo: number | null;
  /** arquivo com stdout+stderr do agente */
  log: string;
  motivo: string;
}

export interface PedidoPonte {
  agente: IdAgente;
  sessao: string | null;
  fonte: string | null;
  mensagem: string;
  motivo: string;
  modelo?: string | null;
  esforco?: string | null;
}

export interface EscolhaModelo {
  modelo?: string | null;
  esforco?: string | null;
}

export function comandoDaPonte(agente: IdAgente, sessao: string | null, mensagem: string, escolha: EscolhaModelo = {}): string[] | null {
  const modelo = escolha.modelo?.trim() || null;
  const esforco = escolha.esforco?.trim() || null;
  switch (agente) {
    case "claude":
      return [
        "claude",
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash(anotador *) Bash(node *anotador*) Read Edit Write Grep Glob",
        ...(modelo ? ["--model", modelo] : []),
        ...(esforco ? ["--effort", esforco] : []),
        ...(sessao ? ["--resume", sessao] : []),
        mensagem,
      ];
    case "codex": {
      // O nível de raciocínio do Codex entra como override de configuração, não como flag própria.
      const ajustes = esforco ? ["-c", `model_reasoning_effort="${esforco}"`] : [];
      const comModelo = modelo ? ["-m", modelo] : [];
      return sessao
        ? ["codex", "exec", ...comModelo, ...ajustes, "resume", sessao, mensagem]
        : ["codex", "exec", "--full-auto", ...comModelo, ...ajustes, mensagem];
    }
    case "gemini":
      return ["gemini", ...(modelo ? ["-m", modelo] : []), "-p", mensagem, "--yolo"];
    case "opencode":
      return ["opencode", "run", ...(modelo ? ["-m", modelo] : []), mensagem];
    default:
      return null;
  }
}

export class Ponte {
  pasta: string;
  readonly execucoes: Execucao[] = [];
  private readonly registrar: (m: string) => void;

  constructor(pasta: string, registrar: (m: string) => void) {
    this.pasta = pasta;
    this.registrar = registrar;
  }

  get emAndamento(): Execucao[] {
    return this.execucoes.filter((e) => e.terminadoEm === null);
  }

  async iniciar(pedido: PedidoPonte): Promise<Execucao> {
    const comando = comandoDaPonte(pedido.agente, pedido.sessao, pedido.mensagem, { modelo: pedido.modelo ?? null, esforco: pedido.esforco ?? null });
    if (!comando) throw new Error(`o agente ${pedido.agente} não tem ponte por linha de comando`);
    const [binario, ...args] = comando;
    if (!binario || !procurarNoPath(binario)) throw new Error(`${binario ?? pedido.agente} não está instalado (não encontrado no PATH)`);
    await mkdir(this.pasta, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + pedido.agente;
    const log = join(this.pasta, `${id}.log`);
    const fd = openSync(log, "a");
    // Um agente iniciado de dentro de outro herda marcas de ambiente que o fazem recusar rodar aninhado.
    const env = { ...process.env };
    for (const chave of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX)/.test(chave)) delete env[chave];
    const filho = spawn(binario, args, { cwd: pedido.fonte ?? process.cwd(), env, detached: true, stdio: ["ignore", fd, fd] });
    const execucao: Execucao = { id, agente: pedido.agente, sessao: pedido.sessao, modelo: pedido.modelo ?? null, comando, pid: filho.pid ?? null, iniciadoEm: new Date().toISOString(), terminadoEm: null, codigo: null, log, motivo: pedido.motivo };
    this.execucoes.unshift(execucao);
    if (this.execucoes.length > 30) this.execucoes.length = 30;
    filho.on("exit", (codigo) => {
      execucao.terminadoEm = new Date().toISOString();
      execucao.codigo = codigo;
      this.registrar(`ponte ${pedido.agente}${pedido.sessao ? ` (sessão ${pedido.sessao.slice(0, 8)})` : ""} terminou com código ${codigo ?? "?"} — log em ${log}`);
    });
    filho.on("error", (erro) => {
      execucao.terminadoEm = new Date().toISOString();
      execucao.codigo = -1;
      this.registrar(`ponte ${pedido.agente} falhou: ${erro.message}`);
    });
    filho.unref();
    this.registrar(`ponte ${pedido.agente}${pedido.sessao ? ` (sessão ${pedido.sessao.slice(0, 8)})` : ""} iniciada (pid ${filho.pid ?? "?"}) — ${pedido.motivo}`);
    return execucao;
  }

  async lerLog(id: string, maxBytes = 64 * 1024): Promise<string | null> {
    const e = this.execucoes.find((x) => x.id === id);
    if (!e) return null;
    try {
      const tamanho = (await stat(e.log)).size;
      const fd = await open(e.log, "r");
      try {
        const inicio = Math.max(0, tamanho - maxBytes);
        const buf = Buffer.alloc(tamanho - inicio);
        await fd.read(buf, 0, buf.length, inicio);
        return buf.toString("utf8");
      } finally {
        await fd.close();
      }
    } catch {
      return "";
    }
  }
}

export interface ContextoMensagem {
  porta: number;
  nome: string;
  alvo: string | null;
  fonte: string | null;
  raizFerramenta: string;
}

/** Texto que a ponte entrega ao agente para um lote específico. */
export function mensagemParaLote(ctx: ContextoMensagem, lote: { id: string; caminhoMd: string; resumo: string }): string {
  const cli = `anotador (ou: node ${ctx.raizFerramenta}/bin/anotador.mjs)`;
  return [
    `Chegou um lote do anotador-ui (anotações visuais feitas na interface do app "${ctx.nome}"${ctx.alvo ? ` em ${ctx.alvo}` : ""}).`,
    `Lote ${lote.id}: ${lote.resumo}`,
    `Leia o Markdown em ${lote.caminhoMd} (ou GET http://127.0.0.1:${ctx.porta}/__anotador/lotes/${lote.id}/md). Ele traz, por anotação, o comentário, "Onde está no código" (arquivo:linha) e "como aplicar" (classe atual → sugestão).`,
    `Aplique as mudanças no código-fonte${ctx.fonte ? ` em ${ctx.fonte}` : ""}. Anotação num elemento repetido vale para o componente inteiro, não só para a instância clicada. Use a linguagem do projeto (tokens/utilitárias), não valores literais.`,
    `Comunique-se pela interface com a CLI ${cli}, porta ${ctx.porta}: \`progresso ${lote.id} --porta ${ctx.porta} --nota "…"\` a cada marco; \`nota ${lote.id} --texto "…"\` para explicar; \`perguntar ${lote.id} --texto "…" --opcoes "A|B"\` quando algo for ambíguo (a resposta aparece em GET /__anotador/lotes/${lote.id}/conversa); e, ao terminar e verificar (lint/typecheck), \`processado ${lote.id} --porta ${ctx.porta} --nota "o que mudou"\`.`,
    `Se decidir não aplicar algo, marque como processado mesmo assim, com a nota explicando o motivo.`,
  ].join("\n\n");
}

/** Texto para começar a conversa sem lote específico: drenar pendentes e ficar pronto. */
export function mensagemDeAbertura(ctx: ContextoMensagem, pendentes: number): string {
  const cli = `anotador (ou: node ${ctx.raizFerramenta}/bin/anotador.mjs)`;
  return [
    `Você foi conectado ao anotador-ui do projeto "${ctx.nome}"${ctx.alvo ? ` (app em ${ctx.alvo})` : ""}: anotações visuais feitas na interface chegam como lotes em Markdown e devem virar mudanças no código-fonte${ctx.fonte ? ` em ${ctx.fonte}` : ""}.`,
    pendentes > 0
      ? `Há ${pendentes} lote(s) pendente(s). Liste com \`${cli} pendentes --porta ${ctx.porta}\`, leia cada Markdown (\`ver <id>\`), aplique seguindo "Onde está no código" e "como aplicar" (família, não instância; tokens do projeto, não literais), publique \`progresso\`/\`nota\`/\`perguntar\` e feche com \`processado <id> --porta ${ctx.porta} --nota "…"\`.`
      : `Não há lotes pendentes agora. Confirme em uma frase que está pronto; novos lotes chegarão por esta mesma ponte.`,
  ].join("\n\n");
}
