// Conversas privadas por projeto. Criar/importar nunca executa um agente; somente
// enviar inicia um processo e uma falha nunca provoca reenvio automático.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { atualizarModelosAntigravity, detectarAgentes, type AgenteDetectado, type IdAgente, type SessaoAgente } from "./agentes.ts";
import { importarSessaoChat, lerMetricasSessaoChat, sessoesExternasChat, ID_SESSAO_NATIVA } from "./chat-sessoes.ts";
import { aplicarMetricasChat, extrairMetricasChat, invalidarContextoMetricasChat, type MetricasChat, type ObservacaoMetricasChat } from "./chat-metricas.ts";
import { expandirComandoChat } from "./comandos.ts";
import { serializar } from "./persistencia.ts";
import type { EstadoExecucaoAvaliacao, PedidoAvaliacao, Parecer } from "./avaliacao.ts";
import { idConversaAvaliacao, parecerDaResposta, textoDoParecer } from "./avaliacao-conversa.ts";

export interface MensagemChat { id: string; autor: "usuario" | "agente" | "sistema"; texto: string; em: string }
export interface ConversaChat {
  id: string; agente: IdAgente; modelo: string | null; esforco: string | null; titulo: string;
  criadaEm: string; atualizadaEm: string; ocupada: boolean; mensagens: MensagemChat[];
  erro?: string; sessaoExterna?: string;
  somenteLeitura?: boolean; motivoSomenteLeitura?: string;
  avisoHistorico?: string;
  metricas?: MetricasChat;
  contextoInvalidadoEm?: string;
  metricasDesde?: string;
  avaliacao?: { id: string; url: string; acompanhando: boolean; emAndamento: boolean };
}
export type ResumoChat = Omit<ConversaChat, "mensagens">;
export interface PedidoChat { agente: string; modelo?: string | null; esforco?: string | null; sessaoExterna?: string | null }
export interface ComandoChat { binario: string; args: string[]; cwd: string; stdin?: string }
export interface ResultadoExecucaoChat { codigo: number | null; stdout: string; stderr: string }
export interface DependenciasChat {
  detectar?: () => AgenteDetectado[] | Promise<AgenteDetectado[]>;
  executar?: (comando: ComandoChat) => Promise<ResultadoExecucaoChat>;
  sessoes?: typeof sessoesExternasChat;
  importar?: typeof importarSessaoChat;
  expandir?: (texto: string, agente: IdAgente, fonte: string | null) => Promise<string | null>;
  metricas?: typeof lerMetricasSessaoChat;
}
export class ErroChat extends Error {
  readonly status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; }
}

const LIMITE_TEXTO = 16_000;
const LIMITE_RESPOSTA = 64_000;
const LIMITE_MENSAGENS = 200;
// 200 mensagens de até 64 mil caracteres Unicode, mais metadados/JSON.
const LIMITE_ARQUIVO = 48 * 1024 * 1024;
const emExecucao = new Map<string, symbol>();
const AGENTES_CHAT = new Set(["claude", "codex", "gemini", "opencode", "antigravity", "cursor"]);
function validarAgenteEsperado(agente: string | undefined): void {
  if (agente !== undefined && (typeof agente !== "string" || !AGENTES_CHAT.has(agente))) throw new ErroChat("Escolha um agente válido.");
}
function conferirDono(conversa: ConversaChat, agente?: string): void {
  validarAgenteEsperado(agente);
  if (agente !== undefined && conversa.agente !== agente) throw new ErroChat("Esta sessão pertence a outro agente. Abra as sessões do agente correspondente.", 409);
}
const copiar = <T>(valor: T): T => structuredClone(valor);
const assinaturaMetricas = (metricas?: MetricasChat): string => JSON.stringify(metricas ? { ...metricas, atualizadoEm: null } : null);
const mensagem = (autor: MensagemChat["autor"], texto: string): MensagemChat => {
  const limite = autor === "agente" ? LIMITE_RESPOSTA : LIMITE_TEXTO;
  const aviso = "\n\n[Resposta truncada no limite de 64.000 caracteres.]";
  const exibido = autor === "agente" && texto.length > limite ? texto.slice(0, limite - aviso.length) + aviso : texto.slice(0, limite);
  return { id: randomUUID(), autor, texto: Buffer.from(exibido, "utf8").toString("utf8"), em: new Date().toISOString() };
};
const limparTexto = (texto: string): string => texto.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
const textoDoParecerSeJson = (texto: string, agente: string): string => {
  const parecer = parecerDaResposta(texto, agente);
  return parecer ? textoDoParecer(parecer) : texto;
};

async function executarCli(comando: ComandoChat): Promise<ResultadoExecucaoChat> {
  return new Promise((resolver, rejeitar) => {
    const env = { ...process.env };
    for (const chave of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX)/.test(chave)) delete env[chave];
    const filho = spawn(comando.binario, comando.args, { cwd: comando.cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, falha: Error | null = null;
    let forcar: ReturnType<typeof setTimeout> | undefined;
    const interromper = (erro: Error) => {
      if (falha) return;
      falha = erro; filho.kill("SIGTERM");
      forcar = setTimeout(() => filho.kill("SIGKILL"), 3000); forcar.unref();
    };
    const prazo = setTimeout(() => interromper(new ErroChat("O agente excedeu o tempo de resposta. A mensagem foi preservada.", 503)), 15 * 60_000);
    prazo.unref();
    filho.stdout.setEncoding("utf8"); filho.stderr.setEncoding("utf8");
    filho.stdout.on("data", (parte: string) => {
      bytes += Buffer.byteLength(parte);
      if (bytes > 2 * 1024 * 1024) interromper(new ErroChat("A saída do agente excedeu o limite. A mensagem foi preservada.", 503));
      else stdout += parte;
    });
    filho.stderr.on("data", (parte: string) => { stderr = (stderr + parte).slice(-32_000); });
    filho.on("error", () => { falha = new ErroChat("Não foi possível iniciar o CLI do agente. Verifique a instalação.", 503); });
    filho.on("close", (codigo) => {
      clearTimeout(prazo); if (forcar) clearTimeout(forcar);
      if (falha) rejeitar(falha); else resolver({ codigo, stdout, stderr });
    });
    filho.stdin.on("error", () => { /* CLI que encerrou antes de ler a entrada */ });
    filho.stdin.end(comando.stdin ?? "");
  });
}

function promptComHistorico(conversa: ConversaChat, ultimoTexto?: string): string {
  const partes: Array<{ autor: string; texto: string }> = [];
  let bytes = 0;
  for (const [indice, original] of conversa.mensagens.slice().reverse().entries()) {
    const m = indice === 0 && ultimoTexto !== undefined ? { ...original, texto: ultimoTexto } : original;
    if (m.autor === "sistema") continue;
    const tamanho = Buffer.byteLength(m.texto);
    if (partes.length && bytes + tamanho > 64 * 1024) break;
    partes.unshift({ autor: m.autor, texto: m.texto }); bytes += tamanho;
  }
  return "Continue esta conversa sobre o projeto atual. Responda à última mensagem do usuário; as anteriores são histórico, não novos pedidos.\n" + JSON.stringify(partes);
}

function comandoChat(agente: AgenteDetectado, conversa: ConversaChat, cwd: string, expansao?: string): ComandoChat {
  const modelo = conversa.modelo ? ["--model", conversa.modelo] : [];
  const esforco = conversa.esforco ? ["--effort", conversa.esforco] : [];
  const texto = expansao ?? conversa.mensagens.at(-1)?.texto ?? "";
  const sessao = conversa.sessaoExterna;
  let args: string[];
  let stdin: string | undefined;
  // Flags conferidas no --help local de Claude, Codex exec/resume e agy.
  switch (agente.id) {
    case "claude": args = ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--permission-prompts", "none", ...modelo, ...esforco,
      ...(sessao ? ["--resume", sessao] : ["--session-id", conversa.id]), "--", texto]; break;
    case "codex": {
      const ajustes = conversa.esforco ? ["-c", `model_reasoning_effort="${conversa.esforco}"`] : [];
      args = ["exec", "--sandbox", "workspace-write", ...modelo, ...ajustes, ...(sessao ? ["resume", sessao] : []), "--json", "--", "-"];
      stdin = texto; break;
    }
    case "antigravity": args = ["--mode", "accept-edits", "--disable-slash-commands", "--output-format", "json", ...modelo, ...esforco,
      ...(sessao ? ["--conversation", sessao] : []), "-p", sessao ? texto : promptComHistorico(conversa, expansao)]; break;
    // Formatos documentados em geminicli.com/docs/cli/headless e opencode.ai/docs/cli.
    // Sem ID nativo confirmado, o histórico local limitado mantém a continuidade.
    case "gemini": args = [...modelo, "--output-format", "json", "-p", promptComHistorico(conversa, expansao)]; break;
    case "opencode": args = ["run", "--format", "json", ...modelo, "--", promptComHistorico(conversa, expansao)]; break;
    default: throw new ErroChat("Este agente não oferece chat por linha de comando.", 503);
  }
  return { binario: agente.caminho!, args, cwd, ...(stdin === undefined ? {} : { stdin }) };
}

function interpretarSaida(agente: IdAgente, stdout: string): { texto: string; sessao?: string; falhou: boolean } {
  let objetos: Array<Record<string, unknown>> = [];
  try { const o: unknown = JSON.parse(stdout); if (o && typeof o === "object" && !Array.isArray(o)) objetos = [o as Record<string, unknown>]; }
  catch { for (const linha of stdout.split("\n")) try { const o: unknown = JSON.parse(linha); if (o && typeof o === "object" && !Array.isArray(o)) objetos.push(o as Record<string, unknown>); } catch { /* logs não são respostas */ } }
  const partes: string[] = [];
  let sessao: string | undefined, falhou = false;
  for (const o of objetos) {
    const id = o["session_id"] ?? o["sessionId"] ?? o["conversation_id"] ?? o["conversationId"] ?? o["thread_id"];
    if (typeof id === "string" && (/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id))) sessao = id;
    if (o["is_error"] === true || o["type"] === "turn.failed" || o["type"] === "error" || o["error"]) falhou = true;
    if (agente === "codex") {
      const item = o["item"] as { type?: string; text?: unknown } | undefined;
      if (o["type"] === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") partes.push(item.text);
    } else if (agente === "opencode") {
      const parte = o["part"] as { text?: unknown } | undefined;
      if (o["type"] === "text" && typeof parte?.text === "string") partes.push(parte.text);
    } else {
      const resposta = o["result"] ?? o["response"];
      if (typeof resposta === "string" && !o["is_error"] && !o["error"]) partes.push(resposta);
    }
  }
  if (["claude", "codex"].includes(agente) && sessao && !ID_SESSAO_NATIVA.test(sessao)) sessao = undefined;
  return { texto: limparTexto(partes.join("\n\n")), sessao, falhou };
}

export class ChatAgentes {
  readonly dir: string;
  readonly fonte: string | null;
  private readonly dependencias: DependenciasChat;
  private cacheSessoes: { em: number; lista: SessaoAgente[] } | null = null;
  private cacheMetricas = new Map<string, { em: number; valor: ObservacaoMetricasChat | null }>();
  constructor(pasta: string, fonte: string | null, dependencias: DependenciasChat = {}) {
    this.fonte = fonte ? resolve(fonte) : null;
    const projeto = createHash("sha256").update(this.fonte ?? resolve(process.cwd())).digest("hex").slice(0, 24);
    this.dir = resolve(pasta, "chats", projeto);
    this.dependencias = dependencias;
  }
  private async preparar(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ErroChat("Pasta do histórico inválida.", 503);
  }
  private caminho(id: string): string {
    if (typeof id !== "string" || !ID_SESSAO_NATIVA.test(id)) throw new ErroChat("Sessão inválida.", 400);
    return join(this.dir, id + ".json");
  }
  private async salvar(conversa: ConversaChat): Promise<void> {
    const caminho = this.caminho(conversa.id), temporario = caminho + "." + randomUUID() + ".tmp";
    conversa.mensagens = conversa.mensagens.slice(-LIMITE_MENSAGENS);
    try { await writeFile(temporario, JSON.stringify(conversa), { flag: "wx", mode: 0o600 }); await rename(temporario, caminho); }
    finally { await rm(temporario, { force: true }); }
  }
  private async ler(id: string): Promise<ConversaChat> {
    const caminho = this.caminho(id);
    try {
      const info = await lstat(caminho);
      if (!info.isFile() || info.isSymbolicLink() || info.size > LIMITE_ARQUIVO) throw new Error();
      const c = JSON.parse(await readFile(caminho, "utf8")) as ConversaChat;
      if (c.id !== id || !Array.isArray(c.mensagens) || c.mensagens.length > LIMITE_MENSAGENS || !AGENTES_CHAT.has(c.agente) ||
          c.mensagens.some((m) => !m || !["usuario", "agente", "sistema"].includes(m.autor) || typeof m.texto !== "string" || m.texto.length > (m.autor === "agente" ? LIMITE_RESPOSTA : LIMITE_TEXTO))) throw new Error();
      if (c.ocupada && !emExecucao.has(caminho)) {
        c.ocupada = false; c.erro = "A execução foi interrompida. O histórico foi preservado; nenhum pedido foi reenviado.";
        c.atualizadaEm = new Date().toISOString(); await this.salvar(c);
      }
      return c;
    } catch (erro) { if (erro instanceof ErroChat) throw erro; throw new ErroChat("Conversa não encontrada neste projeto.", 404); }
  }
  async catalogo() {
    if (!this.dependencias.detectar) await atualizarModelosAntigravity();
    const agentes = (await (this.dependencias.detectar?.() ?? detectarAgentes())).filter((a) => a.instalado && a.ponte && a.caminho);
    const sessoesExternas = await this.externas();
    return { agentes, sessoesExternas };
  }
  async listar(agente?: string): Promise<ResumoChat[]> {
    validarAgenteEsperado(agente);
    await this.preparar();
    const nomes = (await readdir(this.dir)).filter((n) => n.endsWith(".json") && ID_SESSAO_NATIVA.test(n.slice(0, -5))).slice(0, 200);
    const lista: ResumoChat[] = [];
    for (const nome of nomes) try {
      const id = nome.slice(0, -5);
      const c = await serializar(this.caminho(id), () => this.ler(id));
      if (agente !== undefined && c.agente !== agente) continue;
      const { mensagens: _, ...resumo } = await this.indicarSomenteLeitura(c); lista.push(resumo);
    } catch { /* arquivo incompleto/estranho não é sessão */ }
    return lista.filter((s) => agente === undefined || s.agente === agente).sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm));
  }
  async obter(id: string, agente?: string): Promise<ConversaChat> {
    validarAgenteEsperado(agente);
    await this.preparar();
    return serializar(this.caminho(id), async () => {
      const conversa = await this.ler(id); conferirDono(conversa, agente);
      const antes = assinaturaMetricas(conversa.metricas);
      await this.atualizarMetricasNativas(conversa);
      if (!conversa.ocupada && assinaturaMetricas(conversa.metricas) !== antes) await this.salvar(conversa);
      return this.indicarSomenteLeitura(conversa);
    });
  }
  private async atualizarMetricasNativas(conversa: ConversaChat, forcar = false, desde?: string): Promise<void> {
    if (!conversa.sessaoExterna) return;
    const chave = conversa.agente + ":" + conversa.sessaoExterna;
    let item = this.cacheMetricas.get(chave);
    if (forcar || !item || Date.now() - item.em > 2000) {
      const valor = await (this.dependencias.metricas ?? lerMetricasSessaoChat)(conversa.agente, conversa.sessaoExterna, this.fonte).catch(() => null);
      item = { em: Date.now(), valor }; this.cacheMetricas.set(chave, item);
      if (this.cacheMetricas.size > 200) this.cacheMetricas.delete(this.cacheMetricas.keys().next().value!);
    }
    if (!item.valor) return;
    const observacao = copiar(item.valor);
    const emContexto = observacao.contexto?.atualizadoEm;
    // Um transcript ainda no turno anterior não substitui a medição final nova.
    const minimo = desde ?? conversa.metricasDesde;
    if (minimo && (!emContexto || Date.parse(emContexto) < Date.parse(minimo))) return;
    if (conversa.contextoInvalidadoEm && (!emContexto || Date.parse(emContexto) < Date.parse(conversa.contextoInvalidadoEm))) observacao.contexto = null;
    conversa.metricas = aplicarMetricasChat(conversa.metricas, observacao, "nativa:" + chave);
  }
  private async externas(forcar = false): Promise<SessaoAgente[]> {
    if (!forcar && this.cacheSessoes && Date.now() - this.cacheSessoes.em < 1000) return this.cacheSessoes.lista;
    const lista = await (this.dependencias.sessoes ?? sessoesExternasChat)(this.fonte);
    this.cacheSessoes = { em: Date.now(), lista }; return lista;
  }
  private async indicarSomenteLeitura(conversa: ConversaChat): Promise<ConversaChat> {
    const c = copiar(conversa);
    delete c.somenteLeitura; delete c.motivoSomenteLeitura;
    if (c.avaliacao?.acompanhando && c.avaliacao.emAndamento) {
      c.somenteLeitura = true;
      c.motivoSomenteLeitura = "Avaliação em andamento. Você pode acompanhar as mensagens aqui e conversar ao terminar.";
    } else if (c.sessaoExterna && !c.ocupada && (await this.externas()).some((s) => s.agente === c.agente && s.id === c.sessaoExterna && s.ativa)) {
      c.somenteLeitura = true;
      c.motivoSomenteLeitura = "Esta sessão está ativa no CLI. Encerre a execução original para continuar pelo chat.";
    }
    return c;
  }
  /** Espelha a execução existente. Abrir/consultar esta conversa nunca inicia outro agente. */
  async sincronizarAvaliacao(pedido: PedidoAvaliacao, estado: EstadoExecucaoAvaliacao, agente: IdAgente, saida: { sessao: string | null; mensagens: string[]; bruto?: string }, parecer: Parecer | null): Promise<ConversaChat> {
    validarAgenteEsperado(agente);
    await this.preparar();
    const id = idConversaAvaliacao(pedido.id);
    return serializar(this.caminho(id), async () => {
      let conversa = await this.ler(id).catch((erro) => { if (erro instanceof ErroChat && erro.status === 404) return null; throw erro; });
      if (conversa) {
        conferirDono(conversa, agente);
        if (conversa.avaliacao?.id !== pedido.id) throw new ErroChat("Conversa não corresponde a esta avaliação.", 409);
        if (!conversa.avaliacao.acompanhando) return this.indicarSomenteLeitura(conversa);
      }
      const emAndamento = ["preparando", "aguardando", "executando"].includes(estado.fase);
      conversa ??= { id, agente, modelo: estado.execucao?.modelo ?? estado.modelo ?? null, esforco: estado.esforco ?? null,
        titulo: "Avaliação · " + (pedido.pagina.caminho || "/").slice(0, 75), criadaEm: pedido.em, atualizadaEm: pedido.em, ocupada: false, mensagens: [] };
      const anterior = JSON.stringify(conversa);
      conversa.avaliacao = { id: pedido.id, url: pedido.pagina.url, acompanhando: true, emAndamento };
      conversa.modelo = estado.execucao?.modelo ?? conversa.modelo;
      const textos = [...saida.mensagens];
      if (saida.sessao && ID_SESSAO_NATIVA.test(saida.sessao)) {
        // O leitor revalida o agente, o projeto e a sessão antes de importar.
        const nativa = !textos.length ? await (this.dependencias.importar ?? importarSessaoChat)(agente, saida.sessao, this.fonte).catch(() => null) : null;
        if (nativa && nativa.sessao.agente === agente && nativa.sessao.id === saida.sessao && nativa.sessao.cwd && resolve(nativa.sessao.cwd) === resolve(this.fonte ?? process.cwd())) {
          conversa.sessaoExterna = saida.sessao;
          if (!textos.length) for (const m of nativa.mensagens) if (m.autor === "agente" && Date.parse(m.em) >= Date.parse(pedido.em)) textos.push(m.texto);
        } else if (saida.sessao === estado.execucao?.sessao) {
          // ID emitido pela própria execução; a transcrição pode ainda estar sendo criada.
          conversa.sessaoExterna = saida.sessao;
        }
      }
      if (parecer) {
        const texto = textoDoParecer(parecer);
        if (!textos.includes(texto)) textos.push(texto);
      }
      const novaMensagem = (autor: MensagemChat["autor"], texto: string, indice: number): MensagemChat => ({ ...mensagem(autor, texto),
        id: createHash("sha256").update(id + ":" + indice + ":" + texto).digest("hex").slice(0, 32), em: estado.atualizadoEm });
      // Se o log momentaneamente não estiver disponível, preserva as mensagens anteriores.
      if (textos.length || !conversa.mensagens.length) conversa.mensagens = [novaMensagem("usuario", `Avaliar a página ${pedido.pagina.url}${pedido.foco ? "\n\nFoco: " + pedido.foco : ""}`, 0),
        ...textos.slice(-100).map((texto, i) => novaMensagem("agente", textoDoParecerSeJson(texto, agente), i + 1))];
      delete conversa.erro;
      if (estado.fase === "falhou") conversa.erro = estado.erro ?? "O agente não concluiu a avaliação.";
      else if (estado.fase === "sem_parecer" && !parecer) conversa.erro = "A execução terminou sem um parecer estruturado. As mensagens disponíveis foram preservadas.";
      if (saida.bruto) {
        const observacao = extrairMetricasChat(agente, saida.bruto, { origem: "execucao", modelo: conversa.modelo, em: estado.atualizadoEm });
        if (observacao) conversa.metricas = aplicarMetricasChat(conversa.metricas, observacao, "avaliacao:" + pedido.id);
      }
      await this.atualizarMetricasNativas(conversa);
      if (JSON.stringify(conversa) !== anterior) { conversa.atualizadaEm = estado.atualizadoEm; await this.salvar(conversa); }
      return this.indicarSomenteLeitura(conversa);
    });
  }
  async configurar(id: string, pedido: { modelo?: string | null; esforco?: string | null }, agenteEsperado?: string): Promise<ConversaChat> {
    if (!pedido || typeof pedido !== "object") throw new ErroChat("Configuração inválida.");
    await this.preparar();
    return serializar(this.caminho(id), async () => {
      const conversa = await this.ler(id);
      conferirDono(conversa, agenteEsperado);
      if (conversa.ocupada || conversa.avaliacao?.acompanhando && conversa.avaliacao.emAndamento || emExecucao.has(this.caminho(id))) throw new ErroChat("Aguarde a resposta antes de trocar o modelo.", 409);
      const escolha = await this.agente({ agente: conversa.agente, modelo: pedido.modelo === undefined ? conversa.modelo : pedido.modelo, esforco: pedido.esforco === undefined ? conversa.esforco : pedido.esforco });
      if (conversa.modelo !== escolha.modelo) {
        conversa.metricas = invalidarContextoMetricasChat(conversa.metricas, escolha.modelo);
        conversa.contextoInvalidadoEm = new Date().toISOString();
      }
      conversa.modelo = escolha.modelo; conversa.esforco = escolha.esforco;
      if (conversa.avaliacao) conversa.avaliacao.acompanhando = false;
      conversa.atualizadaEm = new Date().toISOString();
      await this.salvar(conversa); return this.indicarSomenteLeitura(conversa);
    });
  }
  private async agente(pedido: PedidoChat): Promise<{ agente: AgenteDetectado; modelo: string | null; esforco: string | null }> {
    if (!this.dependencias.detectar && pedido.agente === "antigravity") await atualizarModelosAntigravity();
    const agente = (await (this.dependencias.detectar?.() ?? detectarAgentes())).find((a) => a.id === pedido.agente && a.instalado && a.ponte);
    if (!agente?.caminho || !isAbsolute(agente.caminho)) throw new ErroChat("Agente não instalado ou sem suporte a chat.", 503);
    try { await access(agente.caminho, constants.X_OK); if (!(await stat(agente.caminho)).isFile()) throw new Error(); }
    catch { throw new ErroChat("O executável do agente não está disponível.", 503); }
    if (pedido.modelo != null && typeof pedido.modelo !== "string" || pedido.esforco != null && typeof pedido.esforco !== "string") throw new ErroChat("Modelo ou raciocínio inválido.");
    const modelo = pedido.modelo?.trim() || null;
    const escolhido = agente.modelos.find((m) => m.valor === modelo) ?? (modelo === null ? agente.modelos.find((m) => m.padrao) : undefined);
    if (modelo && !escolhido) throw new ErroChat("Modelo não disponível para este agente.");
    const esforco = pedido.esforco?.trim() || null;
    if (esforco && !escolhido?.esforcos.includes(esforco)) throw new ErroChat("Raciocínio não disponível para este modelo.");
    return { agente, modelo, esforco };
  }
  async criar(pedido: PedidoChat): Promise<ConversaChat> {
    if (!pedido || typeof pedido !== "object" || typeof pedido.agente !== "string") throw new ErroChat("Escolha um agente.");
    const escolha = await this.agente(pedido);
    const idExterno = pedido.sessaoExterna || null;
    if (idExterno && (typeof idExterno !== "string" || !ID_SESSAO_NATIVA.test(idExterno) || !["claude", "codex", "antigravity"].includes(pedido.agente))) throw new ErroChat("Sessão externa inválida.");
    await this.preparar();
    return serializar(this.dir, async () => {
      const existentes = await this.listar();
      const existente = idExterno && existentes.find((s) => s.agente === pedido.agente && s.sessaoExterna === idExterno);
      if (existente) return this.obter(existente.id);
      if (existentes.length >= 200) throw new ErroChat("Limite de conversas deste projeto atingido.", 409);
      let importada: Awaited<ReturnType<typeof importarSessaoChat>> | undefined;
      if (idExterno) try { importada = await (this.dependencias.importar ?? importarSessaoChat)(pedido.agente, idExterno, this.fonte); }
      catch { throw new ErroChat("Histórico externo não encontrado neste projeto.", 404); }
      if (importada && (importada.sessao.agente !== escolha.agente.id || importada.sessao.id !== idExterno || !importada.sessao.cwd || resolve(importada.sessao.cwd) !== resolve(this.fonte ?? process.cwd()))) throw new ErroChat("A sessão importada não pertence a este agente e projeto.", 409);
      const agora = new Date().toISOString();
      const conversa: ConversaChat = {
        id: randomUUID(), agente: escolha.agente.id, modelo: escolha.modelo, esforco: escolha.esforco,
        titulo: importada?.sessao.nome || importada?.sessao.titulo || "Nova conversa", criadaEm: agora, atualizadaEm: agora, ocupada: false,
        mensagens: importada?.mensagens.map((m) => ({ id: randomUUID(), ...m })) ?? [], ...(idExterno ? { sessaoExterna: idExterno } : {}),
        ...(importada?.sessao.historicoDisponivel === false ? { avisoHistorico: "O histórico anterior permanece no Antigravity. As novas mensagens aparecem aqui." } : {}),
      };
      await this.atualizarMetricasNativas(conversa, true);
      await this.salvar(conversa); return this.indicarSomenteLeitura(conversa);
    });
  }
  async enviar(id: string, texto: string, agenteEsperado?: string): Promise<ConversaChat> {
    if (typeof texto !== "string" || !texto.trim() || texto.length > LIMITE_TEXTO) throw new ErroChat("Escreva uma mensagem de até 16.000 caracteres.");
    await this.preparar();
    const caminho = this.caminho(id);
    return serializar(caminho, async () => {
      const conversa = await this.ler(id);
      conferirDono(conversa, agenteEsperado);
      if (conversa.ocupada || conversa.avaliacao?.acompanhando && conversa.avaliacao.emAndamento || emExecucao.has(caminho)) throw new ErroChat("Aguarde a resposta atual antes de enviar outra mensagem.", 409);
      const { agente } = await this.agente(conversa);
      if (conversa.sessaoExterna && ["claude", "codex", "antigravity"].includes(conversa.agente)) {
        const externas = await this.externas(true);
        if (externas.some((s) => s.id === conversa.sessaoExterna && s.agente === conversa.agente && s.ativa)) throw new ErroChat("Esta sessão está ativa no CLI. Encerre a execução original antes de continuar pelo chat.", 409);
      }
      const cwd = this.fonte ?? process.cwd();
      if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new ErroChat("A pasta do projeto não está disponível.", 503);
      let expansao: string | null = null;
      if (texto.trim().startsWith("/")) try { expansao = await (this.dependencias.expandir ?? expandirComandoChat)(texto.trim(), conversa.agente, this.fonte); }
      catch (erro) { throw new ErroChat(erro instanceof Error ? erro.message : "Não foi possível ler o comando selecionado."); }
      if (!expansao && /^\/(?:chat:)?compact(?:\s|$)/i.test(texto.trim())) throw new ErroChat("Abra o monitor de contexto para consultar a orientação de compactação desta sessão. /compact não será enviado como uma mensagem comum.");
      if (expansao && Buffer.byteLength(expansao) > 80 * 1024) throw new ErroChat("O comando expandido excedeu o limite de tamanho.");
      conversa.mensagens.push(mensagem("usuario", texto.trim()));
      if (conversa.avaliacao) conversa.avaliacao.acompanhando = false;
      if (conversa.titulo === "Nova conversa") conversa.titulo = texto.trim().replace(/\s+/g, " ").slice(0, 90);
      conversa.ocupada = true; conversa.atualizadaEm = new Date().toISOString(); delete conversa.erro;
      const token = Symbol(id); emExecucao.set(caminho, token);
      try { await this.salvar(conversa); }
      catch (erro) { emExecucao.delete(caminho); throw erro; }
      const resposta = copiar(conversa);
      void this.processar(conversa, comandoChat(agente, conversa, cwd, expansao ?? undefined), token);
      return resposta;
    });
  }
  private async processar(conversa: ConversaChat, comando: ComandoChat, token: symbol): Promise<void> {
    const caminho = this.caminho(conversa.id);
    const inicio = conversa.atualizadaEm;
    const idExecucao = conversa.mensagens.at(-1)!.id;
    try {
      const execucao = await (this.dependencias.executar ?? executarCli)(comando);
      const saida = interpretarSaida(conversa.agente, execucao.stdout);
      if (saida.sessao && ["claude", "codex", "antigravity"].includes(conversa.agente)) conversa.sessaoExterna = saida.sessao;
      const observacao = extrairMetricasChat(conversa.agente, execucao.stdout, { origem: "execucao", modelo: conversa.modelo, em: new Date().toISOString() });
      if (observacao) {
        conversa.metricas = aplicarMetricasChat(conversa.metricas, observacao, idExecucao);
        conversa.metricasDesde = inicio;
      }
      await this.atualizarMetricasNativas(conversa, true, inicio);
      if (execucao.codigo !== 0 || saida.falhou) throw new ErroChat("O agente não concluiu a resposta. Verifique o login e as permissões no CLI; a mensagem foi preservada.", 503);
      if (!saida.texto) throw new ErroChat("O CLI não retornou uma resposta de texto compatível. A mensagem foi preservada.", 503);
      conversa.mensagens.push(mensagem("agente", saida.texto));
    } catch (erro) {
      conversa.erro = erro instanceof ErroChat ? erro.message : "Não foi possível obter a resposta do agente. A mensagem foi preservada.";
      conversa.mensagens.push(mensagem("sistema", conversa.erro));
    } finally {
      conversa.ocupada = false; conversa.atualizadaEm = new Date().toISOString();
      try { await serializar(caminho, async () => { if (emExecucao.get(caminho) === token) await this.salvar(conversa); }); }
      catch { /* obter() recupera a execução interrompida sem reenviá-la */ }
      if (emExecucao.get(caminho) === token) emExecucao.delete(caminho);
    }
  }
}
