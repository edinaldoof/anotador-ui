// Cotas da conta publicadas pelo provedor. Nunca envia prompts nem infere cotas
// a partir do consumo de uma conversa, e nunca renova credenciais de login.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface JanelaLimite {
  id: string; titulo: string; usadoPercentual: number; janelaMinutos: number | null;
  redefineEm: string | null; grupo: string | null;
}
export interface LimitesConta {
  agente: string; disponivel: boolean; atualizadoEm: string | null; origem: string;
  janelas: JanelaLimite[]; plano?: string; desatualizado?: boolean; aviso?: string;
  motivo?: "login_necessario" | "login_expirado" | "sem_permissao" | "indisponivel";
}

const MAX_BYTES = 256 * 1024, CACHE_MS = 60_000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ORIGENS: Record<string, string> = { codex: "Codex · limites da conta", claude: "Claude · limites da conta", antigravity: "Antigravity · /usage" };
type Registro = Record<string, unknown>;
const registro = (v: unknown): Registro | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Registro : null;
const percentual = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const texto = (v: unknown): string | null => typeof v === "string" && v.trim() && v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
const identificador = (v: unknown): string | null => typeof v === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/.test(v) ? v : null;
const minutos = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 525_600 ? v : null;
function instante(v: unknown, unix = false): string | null {
  if (unix ? typeof v !== "number" || !Number.isFinite(v) || v <= 0 : typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = unix ? (v as number) * 1000 : Date.parse(v as string);
  if (!Number.isFinite(ms) || ms < 0 || ms > 253_402_300_799_999) return null;
  return new Date(ms).toISOString();
}
function tituloJanela(duracao: number | null, alternativa: string): string {
  if (duracao === null) return alternativa;
  if (duracao === 10080) return "Semanal";
  if (duracao % 1440 === 0) return `${duracao / 1440} dias`;
  if (duracao % 60 === 0) return `${duracao / 60} horas`;
  return `${duracao} minutos`;
}
class FalhaLimites extends Error {
  readonly motivo: NonNullable<LimitesConta["motivo"]>;
  constructor(mensagem: string, motivo: NonNullable<LimitesConta["motivo"]> = "indisponivel") {
    super(mensagem); this.motivo = motivo;
  }
}
const respostaInvalida = () => new FalhaLimites("O provedor não retornou limites válidos para esta conta.");

/** Recebe apenas o result de account/rateLimits/read; descarta identidade e créditos. */
export function interpretarLimitesCodex(valor: unknown, em = new Date().toISOString()): LimitesConta {
  const raiz = registro(valor);
  if (!raiz) throw respostaInvalida();
  const principal = registro(raiz.rateLimits), porGrupo = registro(raiz.rateLimitsByLimitId);
  const grupos = new Map<string, Registro>();
  if (principal) grupos.set(identificador(principal.limitId) ?? "codex", principal);
  // O mapa é a versão mais específica; a janela principal costuma estar repetida nele.
  for (const [id, bruto] of Object.entries(porGrupo ?? {}).slice(0, 32)) {
    const grupo = registro(bruto);
    if (grupo) grupos.set(identificador(grupo.limitId) ?? identificador(id) ?? `grupo-${grupos.size}`, grupo);
  }
  const janelas: JanelaLimite[] = [];
  let plano: string | null = null;
  for (const [id, grupo] of grupos) {
    plano ??= texto(grupo.planType);
    const nome = texto(grupo.limitName) ?? texto(grupo.normalModelSlug) ?? (id === "codex" ? "Codex" : id);
    for (const chave of ["primary", "secondary"] as const) {
      const janela = registro(grupo[chave]);
      if (!janela || !percentual(janela.usedPercent)) continue;
      const duracao = minutos(janela.windowDurationMins);
      janelas.push({ id: `${id}:${chave}`, titulo: tituloJanela(duracao, chave === "primary" ? "Limite principal" : "Limite adicional"),
        usadoPercentual: janela.usedPercent, janelaMinutos: duracao, redefineEm: instante(janela.resetsAt, true), grupo: nome });
    }
  }
  if (!janelas.length) throw respostaInvalida();
  return { agente: "codex", disponivel: true, atualizadoEm: em, origem: ORIGENS.codex!, janelas, ...(plano ? { plano } : {}) };
}

export function interpretarLimitesClaude(valor: unknown, em = new Date().toISOString()): LimitesConta {
  const raiz = registro(valor);
  if (!raiz) throw respostaInvalida();
  const janelas: JanelaLimite[] = [], modelos = new Set<string>();
  const campos: Array<[string, string, number, string | null]> = [
    ["five_hour", "5 horas", 300, null], ["seven_day", "Semanal", 10080, null],
    ["seven_day_oauth_apps", "Semanal", 10080, "Aplicativos OAuth"],
    ["seven_day_sonnet", "Semanal", 10080, "Sonnet"], ["seven_day_opus", "Semanal", 10080, "Opus"],
    ["seven_day_design", "Semanal", 10080, "Design"], ["seven_day_routines", "Semanal", 10080, "Rotinas"],
  ];
  for (const [id, titulo, duracao, grupo] of campos) {
    const janela = registro(raiz[id]);
    if (!janela || !percentual(janela.utilization)) continue;
    janelas.push({ id, titulo, usadoPercentual: janela.utilization, janelaMinutos: duracao, redefineEm: instante(janela.resets_at), grupo });
    if (grupo) modelos.add(grupo.toLowerCase());
  }
  // Alguns planos publicam as cotas de modelos em limits[] em vez dos campos legados.
  for (const bruto of (Array.isArray(raiz.limits) ? raiz.limits : []).slice(0, 32)) {
    const limite = registro(bruto), modelo = registro(registro(limite?.scope)?.model);
    const nome = texto(modelo?.display_name), slug = nome?.toLowerCase();
    if (limite?.kind !== "weekly_scoped" || limite.group !== "weekly" || !percentual(limite.percent) || !nome || !slug || modelos.has(slug) || /^(all|all models|todos)$/i.test(nome)) continue;
    modelos.add(slug);
    const id = identificador(modelo?.id) ?? slug.replace(/[^a-z0-9-]/g, "-");
    janelas.push({ id: `weekly:${id}`, titulo: "Semanal", usadoPercentual: limite.percent, janelaMinutos: 10080,
      redefineEm: instante(limite.resets_at), grupo: nome });
  }
  if (!janelas.length) throw respostaInvalida();
  return { agente: "claude", disponivel: true, atualizadoEm: em, origem: ORIGENS.claude!, janelas };
}

/** Relatório tabulado do comando nativo `agy --print /usage`, sem inferência. */
export function interpretarLimitesAntigravity(valor: string, em = new Date().toISOString()): LimitesConta {
  const janelas: JanelaLimite[] = [], vistos = new Set<string>();
  for (const linha of valor.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const campos = linha.split("\t");
    if (campos.length !== 4 || janelas.length >= 64) throw respostaInvalida();
    const [brutoGrupo, limite, restante, reset] = campos;
    const grupo = texto(brutoGrupo), duracao = limite === "Weekly Limit Remaining" ? 10080 : limite === "Five Hour Limit Remaining" ? 300 : null;
    if (!grupo || duracao === null || !/^\d{1,3}(?:\.\d+)?%$/.test(restante ?? "")) throw respostaInvalida();
    const disponivel = Number(restante!.slice(0, -1));
    if (!percentual(disponivel)) throw respostaInvalida();
    const chave = grupo + ":" + duracao;
    if (vistos.has(chave)) throw respostaInvalida();
    vistos.add(chave);
    janelas.push({ id: `antigravity:${janelas.length}`, titulo: tituloJanela(duracao, "Janela de uso"),
      usadoPercentual: Math.round((100 - disponivel) * 10000) / 10000, janelaMinutos: duracao, redefineEm: instante(reset), grupo });
  }
  if (!janelas.length) throw respostaInvalida();
  return { agente: "antigravity", disponivel: true, atualizadoEm: em, origem: ORIGENS.antigravity!, janelas };
}

/** Dependências locais para teste. Nunca são aceitas no corpo ou query de uma API. */
export interface OpcoesLeitorLimites {
  agora?: () => number; requisitar?: typeof fetch; pastaClaude?: () => string;
  codex?: string; argumentosCodex?: string[]; timeoutMs?: number;
  antigravity?: string; argumentosAntigravity?: string[]; pastaAntigravity?: () => string;
}

async function consultarAntigravity(opcoes: OpcoesLeitorLimites, timeoutMs: number, agora: () => number): Promise<LimitesConta> {
  // /usage é respondido pelo CLI; jamais usar --disable-slash-commands aqui,
  // nem enviar o texto a uma sessão ou a um modelo de linguagem.
  return new Promise((resolver, rejeitar) => {
    const grupoProprio = process.platform !== "win32";
    const filho = spawn(opcoes.antigravity ?? "agy", [...(opcoes.argumentosAntigravity ?? []), "--print", "/usage", "--print-timeout", `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`],
      { shell: false, windowsHide: true, detached: grupoProprio, cwd: homedir(), stdio: ["ignore", "pipe", "pipe"] });
    let saida = "", bytes = 0, bytesErro = 0, encerrando = false, concluido = false, grupoExtinto = false;
    let falha: FalhaLimites | null = null, resultado: LimitesConta | null = null;
    let matar: ReturnType<typeof setTimeout> | undefined, limpeza: ReturnType<typeof setTimeout> | undefined;
    const sinalizar = (sinal: NodeJS.Signals) => {
      if (grupoProprio && !grupoExtinto && filho.pid && filho.pid > 1) {
        try { process.kill(-filho.pid, sinal); return; }
        catch (erro) { if ((erro as NodeJS.ErrnoException).code === "ESRCH") grupoExtinto = true; }
      }
      if (filho.exitCode === null && filho.signalCode === null) filho.kill(sinal);
    };
    const concluir = () => {
      if (concluido) return; concluido = true;
      clearTimeout(timeout); clearTimeout(matar); clearTimeout(limpeza);
      filho.stdout.destroy(); filho.stderr.destroy();
      if (resultado && !falha) resolver(resultado);
      else rejeitar(falha ?? new FalhaLimites("O Antigravity não informou limites válidos nesta consulta."));
    };
    const terminar = (erro?: FalhaLimites) => {
      if (encerrando) return; encerrando = true; falha = erro ?? null;
      clearTimeout(timeout); sinalizar("SIGTERM");
      matar = setTimeout(() => sinalizar("SIGKILL"), 200);
      limpeza = setTimeout(() => { filho.unref(); concluir(); }, 450);
    };
    const timeout = setTimeout(() => terminar(new FalhaLimites("A consulta dos limites do Antigravity demorou demais. Tente novamente em instantes.")), timeoutMs);
    filho.stdout.setEncoding("utf8");
    filho.stdout.on("data", (parte: string) => {
      if (encerrando) return;
      bytes += Buffer.byteLength(parte);
      if (bytes > MAX_BYTES) { terminar(respostaInvalida()); return; }
      saida += parte;
    });
    filho.stderr.on("data", (parte: Buffer) => { bytesErro += parte.length; if (bytesErro > MAX_BYTES) terminar(respostaInvalida()); });
    filho.on("error", () => terminar(new FalhaLimites("O Antigravity CLI não está disponível para consultar os limites.")));
    filho.on("exit", codigo => {
      if (encerrando) return;
      if (codigo !== 0) { terminar(new FalhaLimites("Não foi possível consultar os limites do Antigravity. Verifique o login no CLI.")); return; }
      // exit pode ocorrer antes de os últimos bytes saírem dos pipes; a análise
      // acontece em close. O prazo ainda recolhe helpers que segurarem os pipes.
    });
    filho.on("close", codigo => {
      if (!encerrando && codigo === 0) {
        try { resultado = interpretarLimitesAntigravity(saida, new Date(agora()).toISOString()); }
        catch { falha = respostaInvalida(); }
      }
      sinalizar("SIGKILL"); concluir();
    });
  });
}

async function credencialClaude(pasta: string): Promise<string> {
  let arquivo;
  try {
    arquivo = await open(join(pasta, ".credentials.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await arquivo.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    try {
      let lidos = 0;
      while (lidos < buffer.length) {
        const leitura = await arquivo.read(buffer, lidos, buffer.length - lidos, lidos);
        if (!leitura.bytesRead) break;
        lidos += leitura.bytesRead;
      }
      if (lidos > MAX_BYTES) throw new Error();
      const dados = registro(JSON.parse(buffer.subarray(0, lidos).toString("utf8")));
      const token = registro(dados?.claudeAiOauth)?.accessToken;
      if (typeof token !== "string" || token.length < 8 || token.length > 16_384 || /[\s\u0000-\u001f\u007f]/.test(token)) throw new Error();
      return token;
    } finally { buffer.fill(0); }
  } catch { throw new FalhaLimites("O login do Claude não está disponível para consultar os limites desta conta.", "login_necessario"); }
  finally { await arquivo?.close(); }
}

async function consultarClaude(pasta: string, requisitar: typeof fetch, timeoutMs: number, agora: () => number): Promise<LimitesConta> {
  const token = await credencialClaude(pasta), controle = new AbortController();
  const timeout = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resposta = await requisitar(CLAUDE_USAGE_URL, { method: "GET", redirect: "error", signal: controle.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "anthropic-beta": "oauth-2025-04-20" } });
    if (!resposta.ok) {
      await resposta.body?.cancel();
      if (resposta.status === 401) throw new FalhaLimites("O login do Claude expirou ou não permite consultar os limites. Conecte sua conta novamente no Claude.", "login_expirado");
      if (resposta.status === 403) throw new FalhaLimites("A conta do Claude não autorizou a consulta dos limites. O login precisa permitir a leitura do perfil.", "sem_permissao");
      if (resposta.status === 429) throw new FalhaLimites("O Claude limitou as consultas de uso. A atualização será tentada novamente em instantes.");
      throw new FalhaLimites("Não foi possível consultar os limites do Claude agora.");
    }
    const tamanho = Number(resposta.headers.get("content-length"));
    if (Number.isFinite(tamanho) && tamanho > MAX_BYTES) { await resposta.body?.cancel(); throw respostaInvalida(); }
    const leitor = resposta.body?.getReader();
    if (!leitor) throw respostaInvalida();
    const partes: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const parte = await leitor.read();
        if (parte.done) break;
        bytes += parte.value.byteLength;
        if (bytes > MAX_BYTES) throw respostaInvalida();
        partes.push(parte.value);
      }
    } catch (erro) { await leitor.cancel().catch(() => {}); throw erro; }
    finally { leitor.releaseLock(); }
    return interpretarLimitesClaude(JSON.parse(Buffer.concat(partes).toString("utf8")), new Date(agora()).toISOString());
  } catch (erro) {
    if (erro instanceof FalhaLimites) throw erro;
    throw new FalhaLimites(controle.signal.aborted ? "A consulta dos limites do Claude demorou demais. Tente novamente em instantes." : "Não foi possível consultar os limites do Claude agora.");
  } finally { clearTimeout(timeout); }
}

async function consultarCodex(opcoes: OpcoesLeitorLimites, timeoutMs: number, agora: () => number): Promise<LimitesConta> {
  return new Promise((resolver, rejeitar) => {
    const grupoProprio = process.platform !== "win32";
    const filho = spawn(opcoes.codex ?? "codex", [...(opcoes.argumentosCodex ?? []), "app-server", "--stdio"], { shell: false, windowsHide: true, detached: grupoProprio, cwd: homedir(), stdio: ["pipe", "pipe", "pipe"] });
    let encerrando = false, concluido = false, grupoExtinto = false, inicializado = false, buffer = "", bytes = 0, bytesErro = 0;
    let resultado: LimitesConta | null = null, erro: FalhaLimites | null = null;
    let matar: ReturnType<typeof setTimeout> | undefined, limpeza: ReturnType<typeof setTimeout> | undefined;
    const sinalizar = (sinal: NodeJS.Signals) => {
      const pid = filho.pid;
      // detached cria um grupo exclusivo, com PGID igual ao PID deste filho.
      // Nunca sinaliza um grupo vindo de configuração, nem repete após ESRCH.
      if (grupoProprio && !grupoExtinto && typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1) {
        try { process.kill(-pid, sinal); return; }
        catch (falha) { if ((falha as NodeJS.ErrnoException).code === "ESRCH") grupoExtinto = true; }
      }
      if (filho.exitCode === null && filho.signalCode === null) filho.kill(sinal);
    };
    const concluir = () => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timeout); clearTimeout(matar); clearTimeout(limpeza);
      filho.stdin.destroy(); filho.stdout.destroy(); filho.stderr.destroy();
      if (resultado && !erro) resolver(resultado);
      else rejeitar(erro ?? new FalhaLimites("O Codex encerrou a consulta sem informar os limites."));
    };
    const terminar = (falha?: FalhaLimites) => {
      if (encerrando) return;
      encerrando = true; erro = falha ?? null; clearTimeout(timeout);
      filho.stdin.end(); sinalizar("SIGTERM");
      matar = setTimeout(() => sinalizar("SIGKILL"), 200);
      // Um helper pode herdar stdout e não pertencer mais ao grupo (ou rodar
      // no Windows). O fechamento dos pipes não pode prender consulta/cache.
      limpeza = setTimeout(() => { filho.unref(); concluir(); }, 450);
    };
    const timeout = setTimeout(() => terminar(new FalhaLimites("A consulta dos limites do Codex demorou demais. Tente novamente em instantes.")), timeoutMs);
    const enviar = (mensagem: unknown) => filho.stdin.write(JSON.stringify(mensagem) + "\n");
    filho.stdout.setEncoding("utf8");
    filho.stdout.on("data", (parte: string) => {
      if (encerrando) return;
      bytes += Buffer.byteLength(parte); buffer += parte;
      if (bytes > MAX_BYTES) { terminar(respostaInvalida()); return; }
      let fim;
      while (!encerrando && (fim = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, fim); buffer = buffer.slice(fim + 1);
        if (!linha.trim()) continue;
        try {
          const mensagem = registro(JSON.parse(linha));
          if (!mensagem) throw respostaInvalida();
          if (mensagem.id === 1 && !inicializado) {
            if (mensagem.error || !Object.hasOwn(mensagem, "result")) throw respostaInvalida();
            inicializado = true;
            enviar({ method: "initialized" });
            enviar({ id: 2, method: "account/rateLimits/read", params: {} });
          } else if (mensagem.id === 2 && inicializado) {
            if (mensagem.error) throw new FalhaLimites("O Codex não disponibilizou limites para este login. Use uma conta ChatGPT conectada ao Codex.");
            resultado = interpretarLimitesCodex(mensagem.result, new Date(agora()).toISOString()); terminar();
          }
        } catch (falha) { terminar(falha instanceof FalhaLimites ? falha : respostaInvalida()); }
      }
    });
    filho.stderr.on("data", (parte: Buffer) => { bytesErro += parte.length; if (bytesErro > MAX_BYTES) terminar(respostaInvalida()); });
    filho.on("error", () => terminar(new FalhaLimites("O Codex CLI não está disponível para consultar os limites.")));
    filho.stdin.on("error", () => terminar(new FalhaLimites("A consulta dos limites do Codex foi interrompida.")));
    filho.on("close", () => {
      if (concluido) return;
      sinalizar("SIGKILL");
      concluir();
    });
    enviar({ id: 1, method: "initialize", params: { clientInfo: { name: "anotador_ui_usage", version: "0.2.0" }, capabilities: {} } });
  });
}

export function criarLeitorLimitesConta(opcoes: OpcoesLeitorLimites = {}): (agente: string) => Promise<LimitesConta> {
  const cache = new Map<string, { consultadoEm: number; credencial: string; valor: LimitesConta }>(), pendentes = new Map<string, Promise<LimitesConta>>();
  const agora = opcoes.agora ?? Date.now;
  const timeout = Math.min(14_000, Math.max(1, opcoes.timeoutMs ?? 12_000));
  return async (agente: string): Promise<LimitesConta> => {
    if (!["claude", "codex", "antigravity"].includes(agente)) return { agente, disponivel: false, atualizadoEm: null, origem: "Não disponível", janelas: [], aviso: "Este agente ainda não fornece uma consulta de limites de conta integrada ao anotador." };
    const pasta = resolve(agente === "antigravity" ? opcoes.pastaAntigravity?.() ?? join(homedir(), ".gemini", "antigravity-cli") : opcoes.pastaClaude?.() ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
    const chave = agente + ":" + (agente !== "codex" ? pasta : process.env.CODEX_HOME ?? "padrão");
    // Um login novo deve ser consultado imediatamente, sem reutilizar cotas
    // de outra conta nem uma falha anterior. Só metadados locais entram na chave.
    const credencial = agente !== "codex" ? await lstat(join(pasta, agente === "claude" ? ".credentials.json" : "antigravity-oauth-token"))
      .then(info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":"))
      .catch(() => "indisponivel") : "";
    const salvo = cache.get(chave), anterior = salvo?.credencial === credencial ? salvo : undefined;
    if (anterior && agora() - anterior.consultadoEm >= 0 && agora() - anterior.consultadoEm < CACHE_MS) return structuredClone(anterior.valor);
    const chavePedido = chave + ":" + credencial;
    let promessa = pendentes.get(chavePedido);
    if (!promessa) {
      promessa = (async () => {
        let valor: LimitesConta;
        try { valor = agente === "claude" ? await consultarClaude(pasta, opcoes.requisitar ?? fetch, timeout, agora) : agente === "antigravity" ? await consultarAntigravity(opcoes, timeout, agora) : await consultarCodex(opcoes, timeout, agora); }
        catch (erro) {
          const aviso = erro instanceof FalhaLimites ? erro.message : "Não foi possível atualizar os limites da conta agora.";
          const motivo = erro instanceof FalhaLimites ? erro.motivo : "indisponivel";
          valor = anterior?.valor.disponivel ? { ...anterior.valor, desatualizado: true, aviso, motivo }
            : { agente, disponivel: false, atualizadoEm: null, origem: ORIGENS[agente]!, janelas: [], aviso, motivo };
        }
        cache.set(chave, { consultadoEm: agora(), credencial, valor });
        return valor;
      })();
      pendentes.set(chavePedido, promessa);
      void promessa.finally(() => { if (pendentes.get(chavePedido) === promessa) pendentes.delete(chavePedido); });
    }
    return structuredClone(await promessa);
  };
}

export const lerLimitesConta = criarLeitorLimitesConta();
