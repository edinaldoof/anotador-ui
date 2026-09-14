// Importação somente de sessões já descobertas para a pasta atual, sem aceitar
// caminhos do navegador nem trazer blocos de ferramentas para o histórico.
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { pastaClaude, pastaCodex, sessoesClaude, sessoesCodex, slugProjetoClaude, type SessaoAgente } from "./agentes.ts";
import { extrairMetricasChat, type ObservacaoMetricasChat } from "./chat-metricas.ts";

export interface MensagemImportada { autor: "usuario" | "agente"; texto: string; em: string }
export interface OpcoesImportacaoSessao {
  raizClaude?: string; raizCodex?: string; raizAntigravity?: string; raizProc?: string;
  listar?: typeof sessoesExternasChat;
}
export interface OpcoesListagemSessoes extends Pick<OpcoesImportacaoSessao, "raizClaude" | "raizCodex" | "raizAntigravity" | "raizProc"> {
  listarClaude?: typeof sessoesClaude; listarCodex?: typeof sessoesCodex;
}
export const ID_SESSAO_NATIVA = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function sessoesExternasChat(fonte: string | null, opcoes: OpcoesListagemSessoes = {}): Promise<SessaoAgente[]> {
  if (!fonte) return [];
  const listas = await Promise.allSettled([(opcoes.listarClaude ?? sessoesClaude)(fonte, 100), (opcoes.listarCodex ?? sessoesCodex)(fonte, 100)]);
  const candidatas = listas.flatMap((r) => r.status === "fulfilled" ? r.value : []).filter((s) =>
    ["claude", "codex"].includes(s.agente) && ID_SESSAO_NATIVA.test(s.id) && s.cwd && resolve(s.cwd) === resolve(fonte));
  const saida = new Map<string, SessaoAgente>();
  // A pasta derivada do projeto pode colidir no Claude. Valida a origem antes de
  // mostrar sequer o título, e descarta links que apontem para outro transcript.
  let codex: Map<string, string> | undefined;
  for (const sessao of candidatas) {
    try {
      const raiz = await raizDoAgente(sessao.agente, opcoes);
      if (sessao.agente === "claude") await conferirClaude(join(raiz, "projects", slugProjetoClaude(fonte), sessao.id + ".jsonl"), raiz, sessao.id, fonte);
      else {
        codex ??= await arquivosCodex(raiz, fonte);
        if (!codex.has(sessao.id)) continue;
      }
      saida.set(sessao.agente + ":" + sessao.id, sessao);
    } catch { /* origem não confirmada: não expõe dados de outra sessão */ }
  }
  for (const sessao of await sessoesAntigravityChat(fonte, opcoes)) saida.set(sessao.agente + ":" + sessao.id, sessao);
  return [...saida.values()].sort((a, b) => Number(b.ativa) - Number(a.ativa) || b.em.localeCompare(a.em));
}

async function arquivoRegular(caminho: string, raiz: string) {
  const info = await lstat(caminho);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(caminho) !== caminho || !caminho.startsWith(raiz + sep)) throw new Error("arquivo de sessão inválido");
  return info;
}

/** Só metadados relacionais; não interpreta os payloads protobuf do Antigravity. */
async function conferirAntigravity(raiz: string, id: string): Promise<number> {
  const caminho = join(raiz, "conversations", id + ".db");
  const antes = await arquivoRegular(caminho, raiz);
  let atividade = antes.mtimeMs;
  for (const sufixo of ["-wal", "-shm"]) {
    try {
      const info = await arquivoRegular(caminho + sufixo, raiz);
      if (sufixo === "-wal") atividade = Math.max(atividade, info.mtimeMs);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
    }
  }
  // Import dinâmico permite continuar com os demais agentes caso este Node não
  // ofereça SQLite. readOnly impede gravações no banco original do CLI.
  const { DatabaseSync } = await import("node:sqlite");
  const banco = new DatabaseSync(caminho, { readOnly: true });
  try {
    const tabela = banco.prepare("SELECT type FROM sqlite_master WHERE name = 'trajectory_meta'").get();
    if (tabela?.["type"] !== "table") throw new Error("metadados da sessão inválidos");
    const linhas = banco.prepare("SELECT cascade_id FROM trajectory_meta LIMIT 2").all();
    if (linhas.length !== 1 || linhas[0]?.["cascade_id"] !== id) throw new Error("histórico pertence a outra sessão");
    const depois = await arquivoRegular(caminho, raiz);
    if (antes.ino !== depois.ino || antes.dev !== depois.dev) throw new Error("arquivo de sessão alterado durante a leitura");
  } finally { banco.close(); }
  return atividade;
}

async function lerProcLimitado(caminho: string, limite: number): Promise<string> {
  const fd = await open(caminho, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(limite);
    const { bytesRead } = await fd.read(buffer, 0, limite, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await fd.close(); }
}

async function processoAntigravity(raiz: string, id: string, raizProc: string): Promise<number | null> {
  try {
    const info = await arquivoRegular(join(raiz, "presence", id + ".lock"), raiz);
    const dispositivo = BigInt(info.dev);
    const major = ((dispositivo >> 8n) & 0xfffn) | ((dispositivo >> 32n) & ~0xfffn);
    const minor = (dispositivo & 0xffn) | ((dispositivo >> 12n) & ~0xffn);
    for (const linha of (await lerProcLimitado(join(raizProc, "locks"), 1024 * 1024)).split("\n")) {
      if (linha.includes("->")) continue; // aguardando uma trava não é mantê-la
      const m = /^\d+:\s+\S+\s+\S+\s+\S+\s+(\d+)\s+([a-f0-9]+):([a-f0-9]+):(\d+)\b/i.exec(linha);
      if (!m || BigInt("0x" + m[2]) !== major || BigInt("0x" + m[3]) !== minor || m[4] !== String(info.ino)) continue;
      const pid = Number(m[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0) continue;
      const comando = (await lerProcLimitado(join(raizProc, String(pid), "cmdline"), 4096)).split("\0")[0] ?? "";
      if (basename(comando) === "agy") return pid;
    }
  } catch { /* ausência de prova não implica que o processo está ativo */ }
  return null;
}

export async function sessoesAntigravityChat(fonte: string | null, opcoes: Pick<OpcoesImportacaoSessao, "raizAntigravity" | "raizProc"> = {}): Promise<SessaoAgente[]> {
  if (!fonte) return [];
  let raiz: string;
  try { raiz = await realpath(opcoes.raizAntigravity ?? join(homedir(), ".gemini", "antigravity-cli")); } catch { return []; }
  const projeto = resolve(fonte);
  const candidatas = new Map<string, { titulo: string | null; em: number }>();
  const projetos = new Map<string, Set<string>>();
  const associar = (id: string, pasta: string) => {
    if (!projetos.has(id)) projetos.set(id, new Set());
    projetos.get(id)!.add(resolve(pasta));
  };
  try {
    const trecho = await lerTrechoLimitado(join(raiz, "cache", "last_conversations.json"), raiz, false);
    if (!trecho.parcial) {
      const mapa: unknown = JSON.parse(trecho.texto);
      if (mapa && typeof mapa === "object" && !Array.isArray(mapa)) for (const [pasta, id] of Object.entries(mapa)) {
        if (!pasta.startsWith(sep) || typeof id !== "string" || !ID_SESSAO_NATIVA.test(id)) continue;
        associar(id, pasta);
        if (resolve(pasta) === projeto) candidatas.set(id, { titulo: null, em: 0 });
      }
    }
  } catch { /* cache ainda não criado ou não íntegro */ }
  try {
    for (const linha of (await lerLimitado(join(raiz, "history.jsonl"), raiz, true)).split("\n")) {
      let o: { workspace?: unknown; conversationId?: unknown; timestamp?: unknown; display?: unknown; type?: unknown };
      try { o = JSON.parse(linha) as typeof o; } catch { continue; }
      if (typeof o.workspace !== "string" || !o.workspace.startsWith(sep) || typeof o.conversationId !== "string" || !ID_SESSAO_NATIVA.test(o.conversationId)) continue;
      associar(o.conversationId, o.workspace);
      if (resolve(o.workspace) !== projeto) continue;
      const anterior = candidatas.get(o.conversationId);
      const titulo = typeof o.display === "string" && o.type !== "slash_command" ? o.display.replace(/\s+/g, " ").trim().slice(0, 90) : "";
      const em = typeof o.timestamp === "number" && Number.isFinite(o.timestamp) && o.timestamp > 0 && o.timestamp <= 8.64e15 ? o.timestamp : 0;
      candidatas.set(o.conversationId, { titulo: anterior?.titulo || titulo || null, em: Math.max(anterior?.em ?? 0, em) });
    }
  } catch { /* o modo print pode não escrever history.jsonl */ }
  const saida: SessaoAgente[] = [];
  for (const [id, dados] of [...candidatas].sort((a, b) => b[1].em - a[1].em).slice(0, 100)) {
    if (projetos.get(id)?.size !== 1) continue;
    try {
      const em = Math.max(dados.em, await conferirAntigravity(raiz, id));
      const pid = await processoAntigravity(raiz, id, opcoes.raizProc ?? "/proc");
      saida.push({ agente: "antigravity", id, nome: null, titulo: dados.titulo, cwd: projeto, ativa: pid !== null, pid,
        em: new Date(em).toISOString(), origem: "Antigravity CLI", historicoDisponivel: false, descobertaParcial: true,
        ...(pid === null ? { estadoAtividade: "desconhecido" as const } : {}) });
    } catch { /* arquivo opaco/inconsistente: não inventa uma sessão retomável */ }
  }
  return saida;
}

async function lerLimitado(caminho: string, raiz: string, fim: boolean): Promise<string> {
  return (await lerTrechoLimitado(caminho, raiz, fim)).texto;
}

async function lerTrechoLimitado(caminho: string, raiz: string, fim: boolean): Promise<{ texto: string; parcial: boolean }> {
  const canonico = await realpath(caminho);
  const antes = await lstat(caminho);
  if (canonico !== caminho || !canonico.startsWith(raiz + sep) || !antes.isFile() || antes.isSymbolicLink()) throw new Error("arquivo de sessão inválido");
  const fd = await open(caminho, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.ino !== antes.ino || info.dev !== antes.dev) throw new Error("arquivo de sessão inválido");
    const tamanho = Math.min(info.size, fim ? 2 * 1024 * 1024 : 64 * 1024);
    const inicio = fim ? info.size - tamanho : 0;
    const buffer = Buffer.alloc(tamanho);
    const { bytesRead } = await fd.read(buffer, 0, tamanho, inicio);
    const texto = buffer.subarray(0, bytesRead).toString("utf8");
    return { texto: inicio > 0 ? texto.slice(texto.indexOf("\n") + 1) : texto, parcial: tamanho < info.size };
  } finally { await fd.close(); }
}

function subagenteCodex(payload: { thread_source?: unknown; source?: unknown }): boolean {
  return payload.thread_source === "subagent" || payload.source === "subagent"
    || !!(payload.source && typeof payload.source === "object" && "subagent" in payload.source);
}

async function arquivosCodex(raiz: string, fonte: string): Promise<Map<string, string>> {
  const arquivos = new Map<string, string>();
  let vistos = 0;
  const pastas = async (dir: string, formato: RegExp): Promise<string[]> => (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.isSymbolicLink() && formato.test(d.name)).map((d) => d.name).sort().reverse();
  for (const ano of await pastas(raiz, /^\d{4}$/)) for (const mes of await pastas(join(raiz, ano), /^\d{2}$/)) {
    for (const dia of await pastas(join(raiz, ano, mes), /^\d{2}$/)) {
      const dir = join(raiz, ano, mes, dia);
      const nomes = (await readdir(dir)).filter((n) => n.startsWith("rollout-") && n.endsWith(".jsonl")).sort().reverse();
      for (const nome of nomes) {
        if (++vistos > 400) return arquivos;
        const caminho = join(dir, nome);
        try {
          const linha = (await lerLimitado(caminho, raiz, false)).split("\n")[0] ?? "";
          const o = JSON.parse(linha) as { type?: string; payload?: { id?: string; cwd?: string; thread_source?: string; source?: unknown } };
          if (o.type === "session_meta" && o.payload?.id && ID_SESSAO_NATIVA.test(o.payload.id) && o.payload.cwd && resolve(o.payload.cwd) === resolve(fonte) && !subagenteCodex(o.payload) && !arquivos.has(o.payload.id)) arquivos.set(o.payload.id, caminho);
        } catch { /* arquivo parcial ou fora da raiz descoberta */ }
      }
    }
  }
  return arquivos;
}

async function raizDoAgente(agente: string, opcoes: Pick<OpcoesImportacaoSessao, "raizClaude" | "raizCodex">): Promise<string> {
  return realpath(agente === "claude" ? opcoes.raizClaude ?? pastaClaude() : join(opcoes.raizCodex ?? pastaCodex(), "sessions"));
}

async function conferirClaude(caminho: string, raiz: string, id: string, fonte: string): Promise<void> {
  let pertence = false;
  for (const linha of (await lerLimitado(caminho, raiz, false)).split("\n")) {
    let o: { cwd?: unknown; sessionId?: unknown; isSidechain?: unknown };
    try { o = JSON.parse(linha) as typeof o; } catch { continue; }
    if (o.isSidechain === true || (typeof o.sessionId === "string" && o.sessionId !== id)) throw new Error("histórico pertence a outra sessão");
    if (typeof o.cwd === "string") {
      if (resolve(o.cwd) !== resolve(fonte)) throw new Error("histórico pertence a outro projeto");
      pertence = true;
    }
  }
  if (!pertence) throw new Error("histórico pertence a outro projeto ou não informa a pasta original");
}

async function localizarHistorico(agente: string, id: string, fonte: string, opcoes: OpcoesImportacaoSessao): Promise<{ caminho: string; raiz: string }> {
  const raiz = await raizDoAgente(agente, opcoes);
  const caminho = agente === "claude" ? join(raiz, "projects", slugProjetoClaude(fonte), id + ".jsonl") : (await arquivosCodex(raiz, fonte)).get(id);
  if (!caminho) throw new Error("histórico da sessão não encontrado");
  if (agente === "claude") await conferirClaude(caminho, raiz, id, fonte);
  return { caminho, raiz };
}

/** Somente os contadores do transcript do mesmo agente/projeto chegam ao chat. */
export async function lerMetricasSessaoChat(agente: string, id: string, fonte: string | null, opcoes: OpcoesImportacaoSessao = {}): Promise<ObservacaoMetricasChat | null> {
  if (!fonte || !ID_SESSAO_NATIVA.test(id) || !["claude", "codex"].includes(agente)) return null;
  try {
    const { caminho, raiz } = await localizarHistorico(agente, id, fonte, opcoes);
    const { texto, parcial } = await lerTrechoLimitado(caminho, raiz, true);
    return extrairMetricasChat(agente, texto, { origem: "transcript", parcial, em: new Date().toISOString() });
  } catch { return null; }
}

function textoMensagem(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo.slice(0, 16_000);
  if (!Array.isArray(conteudo)) return "";
  return conteudo.flatMap((p: unknown) => {
    if (!p || typeof p !== "object") return [];
    const parte = p as { type?: string; text?: unknown };
    return ["text", "input_text", "output_text"].includes(parte.type ?? "") && typeof parte.text === "string" ? [parte.text] : [];
  }).join("\n").slice(0, 16_000);
}

export async function importarSessaoChat(agente: string, id: string, fonte: string | null, opcoes: OpcoesImportacaoSessao = {}): Promise<{ sessao: SessaoAgente; mensagens: MensagemImportada[] }> {
  if (!fonte || !ID_SESSAO_NATIVA.test(id) || !["claude", "codex", "antigravity"].includes(agente)) throw new Error("sessão externa inválida para este projeto");
  const sessao = (await (opcoes.listar ?? sessoesExternasChat)(fonte)).find((s) => s.agente === agente && s.id === id && s.cwd && resolve(s.cwd) === resolve(fonte));
  if (!sessao) throw new Error("sessão externa não encontrada neste projeto");
  if (agente === "antigravity") {
    // Revalida a associação do cache do CLI mesmo quando o chamador forneceu uma
    // listagem própria. O navegador não recebe mensagens reconstruídas de blobs.
    const propria = (await sessoesAntigravityChat(fonte, opcoes)).find((s) => s.id === id);
    if (!propria) throw new Error("sessão Antigravity não confirmada neste projeto");
    return { sessao: propria, mensagens: [] };
  }
  const { caminho, raiz } = await localizarHistorico(agente, id, fonte, opcoes);
  const mensagens: MensagemImportada[] = [];
  for (const linha of (await lerLimitado(caminho, raiz, true)).split("\n")) {
    try {
      const o = JSON.parse(linha) as Record<string, unknown>;
      if (o["isSidechain"] === true || o["parent_tool_use_id"]) continue;
      const p = (agente === "claude" ? o["message"] : o["payload"]) as { role?: string; type?: string; content?: unknown; phase?: string; channel?: string } | undefined;
      if (!p || (agente === "codex" && (o["type"] !== "response_item" || p.type !== "message"))) continue;
      if (["analysis", "reasoning"].includes(p.phase ?? "") || ["analysis", "reasoning"].includes(p.channel ?? "")) continue;
      const papel = agente === "claude" ? o["type"] : p.role;
      if (papel !== "user" && papel !== "assistant") continue;
      const texto = textoMensagem(p.content).trim();
      if (!texto) continue;
      const timestamp = typeof o["timestamp"] === "string" && Number.isFinite(Date.parse(o["timestamp"])) ? o["timestamp"] : sessao.em;
      mensagens.push({ autor: papel === "user" ? "usuario" : "agente", texto, em: timestamp });
      if (mensagens.length > 100) mensagens.shift();
    } catch { /* linhas incompletas e eventos internos não são mensagens */ }
  }
  return { sessao, mensagens };
}
