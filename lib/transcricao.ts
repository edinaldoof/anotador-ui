// Reconhecimento local de áudio. O navegador envia somente a este servidor;
// o subprocesso usa um modelo já instalado, sem serviços ou downloads remotos.
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_DURACAO_SEGUNDOS = 120;
export const MAX_CORPO_TRANSCRICAO = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 1024;
const RUNTIME = join(homedir(), ".local", "share", "anotador-ui", "voz");
const PYTHON = join(RUNTIME, "venv", "bin", "python");
const MODELO = join(RUNTIME, "modelo");
const SCRIPT = fileURLToPath(new URL("./transcrever.py", import.meta.url));
let trabalhosAtivos = 0;
let aquecimento: Promise<void> | null = null;
export const IDIOMAS_TRANSCRICAO = ["pt", "en", "es", "fr", "de", "it", "ja", "zh", "auto"] as const;
export type IdiomaTranscricao = typeof IDIOMAS_TRANSCRICAO[number];

export class ErroTranscricao extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(message: string, status = 422, codigo = "AUDIO_INVALIDO") { super(message); this.name = "ErroTranscricao"; this.status = status; this.codigo = codigo; }
}
export interface ResultadoTranscricao { texto: string; duracaoSegundos: number; local: true }
export interface CapacidadeTranscricao { disponivel: boolean; local: true; idioma: "pt"; maxAudioBytes: number; maxDuracaoSegundos: number; motivo?: string }
export interface OpcoesTranscricao {
  signal?: AbortSignal;
  /** Dependências locais para testes/instalações; nunca são aceitas no JSON HTTP. */
  python?: string; modelo?: string; script?: string; temporarios?: string; timeoutMs?: number;
  /** Worker persistente reutiliza o modelo entre gravações; desligável em testes. */
  persistente?: boolean;
}

export async function capacidadeTranscricao(opcoes: Pick<OpcoesTranscricao, "python" | "modelo"> = {}): Promise<CapacidadeTranscricao> {
  const base = { local: true as const, idioma: "pt" as const, maxAudioBytes: MAX_AUDIO_BYTES, maxDuracaoSegundos: MAX_DURACAO_SEGUNDOS };
  try {
    await access(opcoes.python ?? PYTHON, constants.X_OK);
    for (const nome of ["config.json", "model.bin", "tokenizer.json"]) {
      const arquivo = await stat(join(opcoes.modelo ?? MODELO, nome));
      if (!arquivo.isFile() || !arquivo.size) throw new Error("modelo incompleto");
    }
    return { ...base, disponivel: true };
  } catch {
    return { ...base, disponivel: false, motivo: "A transcrição local ainda não está instalada neste servidor." };
  }
}

export function validarAudioTranscricao(pedido: unknown): { audio: Buffer; extensao: string; idioma: IdiomaTranscricao } {
  if (!pedido || typeof pedido !== "object" || Array.isArray(pedido)) throw new ErroTranscricao("Envie uma gravação de áudio válida.", 400);
  const o = pedido as { audio?: unknown; mime?: unknown; idioma?: unknown };
  const idioma = o.idioma === undefined ? "pt" : o.idioma;
  if (typeof idioma !== "string" || !IDIOMAS_TRANSCRICAO.includes(idioma as IdiomaTranscricao)) throw new ErroTranscricao("Escolha um idioma de transcrição disponível.", 400, "IDIOMA_INVALIDO");
  if (typeof o.audio !== "string" || typeof o.mime !== "string") throw new ErroTranscricao("A gravação está incompleta.", 400);
  if (o.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) throw new ErroTranscricao("A gravação deve ter até 8 MiB.", 413, "AUDIO_GRANDE");
  if (!o.audio.length || o.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(o.audio)) throw new ErroTranscricao("O conteúdo do áudio é inválido.", 400);
  const tipos: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/x-m4a": "mp4", "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav" };
  const extensao = tipos[o.mime.split(";", 1)[0]?.trim().toLowerCase() ?? ""];
  if (!extensao) throw new ErroTranscricao("Use uma gravação WebM, Ogg, MP4 ou WAV.", 415, "FORMATO_NAO_SUPORTADO");
  const audio = Buffer.from(o.audio, "base64");
  if (!audio.length || audio.length > MAX_AUDIO_BYTES || audio.toString("base64") !== o.audio) throw new ErroTranscricao("O conteúdo do áudio é inválido.", audio.length > MAX_AUDIO_BYTES ? 413 : 400);
  const cabecalho = extensao === "webm" ? audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : extensao === "ogg" ? audio.subarray(0, 4).toString("ascii") === "OggS"
    : extensao === "mp4" ? audio.subarray(4, 8).toString("ascii") === "ftyp"
    : audio.subarray(0, 4).toString("ascii") === "RIFF" && audio.subarray(8, 12).toString("ascii") === "WAVE";
  if (audio.length < 16 || !cabecalho) throw new ErroTranscricao("O arquivo não corresponde ao formato da gravação.");
  return { audio, extensao, idioma: idioma as IdiomaTranscricao };
}

function cancelamento(): ErroTranscricao { return new ErroTranscricao("Transcrição cancelada.", 499, "CANCELADA"); }

function lerResultadoTranscricao(valor: unknown): ResultadoTranscricao {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroTranscricao("A resposta da transcrição é inválida.", 502, "RESPOSTA_INVALIDA");
  const dados = valor as Record<string, unknown>;
  if (dados.erro) {
    const longa = dados.erro === "DURACAO_EXCEDIDA";
    throw new ErroTranscricao(longa ? "Grave até 2 minutos por vez." : "Não consegui ler esta gravação de áudio. Grave novamente.", 422, longa ? "DURACAO_EXCEDIDA" : "AUDIO_INVALIDO");
  }
  if (typeof dados.texto !== "string" || dados.texto.length > 16_000 || typeof dados.duracaoSegundos !== "number" || !Number.isFinite(dados.duracaoSegundos) || dados.duracaoSegundos < 0 || dados.duracaoSegundos > MAX_DURACAO_SEGUNDOS) {
    throw new ErroTranscricao("A resposta da transcrição é inválida.", 502, "RESPOSTA_INVALIDA");
  }
  return { texto: dados.texto.trim(), duracaoSegundos: dados.duracaoSegundos, local: true };
}

const AMBIENTE_WORKER = { PATH: process.env["PATH"], LANG: "C.UTF-8", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", OMP_NUM_THREADS: "8", OPENBLAS_NUM_THREADS: "1", TOKENIZERS_PARALLELISM: "false" };
interface WorkerTranscricao {
  chave: string;
  filho: ReturnType<typeof spawn>;
  ocupado: boolean;
  encerrado: boolean;
  receber: ((valor: unknown) => void) | null;
  falhar: ((erro: ErroTranscricao) => void) | null;
  ocioso?: ReturnType<typeof setTimeout>;
  matar: (erro: ErroTranscricao) => void;
}
const workersTranscricao = new Set<WorkerTranscricao>();
process.once("exit", () => { for (const worker of workersTranscricao) worker.filho.kill("SIGKILL"); });

function referenciasWorker(worker: WorkerTranscricao, ativa: boolean): void {
  if (ativa) worker.filho.ref(); else worker.filho.unref();
  for (const fluxo of [worker.filho.stdin, worker.filho.stdout, worker.filho.stderr]) {
    const socket = fluxo as unknown as { ref?: () => void; unref?: () => void } | null;
    if (ativa) socket?.ref?.(); else socket?.unref?.();
  }
}

function criarWorkerTranscricao(chave: string, opcoes: OpcoesTranscricao): WorkerTranscricao {
  const filho = spawn(opcoes.python ?? PYTHON, [opcoes.script ?? SCRIPT, "--modelo", opcoes.modelo ?? MODELO, "--servir"], {
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: AMBIENTE_WORKER,
  });
  let falha: ErroTranscricao | null = null, buffer = "", bytesErro = 0;
  const worker: WorkerTranscricao = { chave, filho, ocupado: false, encerrado: false, receber: null, falhar: null, matar: (erro) => {
    falha ??= erro;
    worker.encerrado = true;
    clearTimeout(worker.ocioso);
    filho.kill("SIGKILL");
  } };
  workersTranscricao.add(worker);
  filho.stdout?.setEncoding("utf8");
  filho.stdout?.on("data", (parte: string) => {
    buffer += parte;
    if (Buffer.byteLength(buffer) > 128 * 1024) { worker.matar(new ErroTranscricao("A resposta da transcrição excedeu o limite.", 502, "RESPOSTA_INVALIDA")); return; }
    let fim: number;
    while ((fim = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, fim); buffer = buffer.slice(fim + 1);
      try {
        const valor: unknown = JSON.parse(linha);
        if (!worker.receber || worker.encerrado) throw new Error();
        worker.receber(valor);
      } catch { worker.matar(new ErroTranscricao("A resposta da transcrição é inválida.", 502, "RESPOSTA_INVALIDA")); }
    }
  });
  filho.stderr?.on("data", (parte: Buffer) => { bytesErro += parte.length; if (bytesErro > 64 * 1024) worker.matar(new ErroTranscricao("Não foi possível concluir a transcrição.", 502, "FALHA_LOCAL")); });
  filho.on("error", () => { falha ??= new ErroTranscricao("O transcritor local não está disponível.", 503, "INDISPONIVEL"); });
  filho.stdin?.on("error", () => worker.matar(new ErroTranscricao("O transcritor local foi interrompido. Tente novamente.", 503, "INDISPONIVEL")));
  filho.on("close", () => {
    worker.encerrado = true;
    clearTimeout(worker.ocioso);
    workersTranscricao.delete(worker);
    worker.falhar?.(falha ?? new ErroTranscricao("O transcritor local foi interrompido. Tente novamente.", 503, "INDISPONIVEL"));
  });
  return worker;
}

async function executarPersistente(caminho: string, extensao: string, opcoes: OpcoesTranscricao, idioma: IdiomaTranscricao, aquecer = false): Promise<ResultadoTranscricao> {
  if (opcoes.signal?.aborted) throw cancelamento();
  const chave = JSON.stringify([opcoes.python ?? PYTHON, opcoes.script ?? SCRIPT, opcoes.modelo ?? MODELO]);
  let escolhido = Array.from(workersTranscricao).find(w => !w.ocupado && !w.encerrado && w.chave === chave);
  while (!escolhido) {
    if (workersTranscricao.size < 2) { escolhido = criarWorkerTranscricao(chave, opcoes); break; }
    // A troca de modelo não deixa todos os modelos anteriores residentes. Espera
    // o processo sair antes de carregar o próximo e respeita pedidos em curso.
    const antigo = Array.from(workersTranscricao).find(w => !w.ocupado || w.encerrado);
    if (!antigo) throw new ErroTranscricao("O transcritor está ocupado. Tente novamente em instantes.", 429, "OCUPADO");
    referenciasWorker(antigo, true);
    await new Promise<void>((resolve) => {
      antigo.filho.once("close", () => resolve());
      antigo.matar(new ErroTranscricao("Modelo anterior liberado da memória.", 503));
    });
    if (opcoes.signal?.aborted) throw cancelamento();
    escolhido = Array.from(workersTranscricao).find(w => !w.ocupado && !w.encerrado && w.chave === chave);
  }
  const worker = escolhido;
  clearTimeout(worker.ocioso);
  worker.ocupado = true;
  referenciasWorker(worker, true);
  return new Promise((resolve, reject) => {
    const cancelar = () => worker.matar(cancelamento());
    const timeout = setTimeout(() => worker.matar(new ErroTranscricao("A transcrição demorou demais. Tente uma gravação mais curta.", 504, "TEMPO_ESGOTADO")), Math.min(120_000, Math.max(1, opcoes.timeoutMs ?? 120_000)));
    const finalizar = (): void => {
      clearTimeout(timeout); opcoes.signal?.removeEventListener("abort", cancelar);
      worker.receber = null; worker.falhar = null; worker.ocupado = false;
      if (!worker.encerrado) {
        referenciasWorker(worker, false);
        worker.ocioso = setTimeout(() => worker.matar(new ErroTranscricao("Transcritor em repouso.", 503)), 5 * 60_000);
        worker.ocioso.unref();
      }
    };
    worker.falhar = erro => { finalizar(); reject(erro); };
    worker.receber = valor => {
      try { const resultado = lerResultadoTranscricao(valor); finalizar(); resolve(resultado); }
      catch (erro) {
        if (erro instanceof ErroTranscricao && erro.status === 422) { finalizar(); reject(erro); }
        else worker.matar(erro instanceof ErroTranscricao ? erro : new ErroTranscricao("A resposta da transcrição é inválida.", 502, "RESPOSTA_INVALIDA"));
      }
    };
    opcoes.signal?.addEventListener("abort", cancelar, { once: true });
    if (opcoes.signal?.aborted) { cancelar(); return; }
    worker.filho.stdin?.write(JSON.stringify(aquecer ? { aquecer: true } : { audio: caminho, formato: extensao, idioma }) + "\n");
  });
}

/** Prepara o modelo durante a permissão/gravação, sem reter áudio nem bloquear a UI. */
export async function preaquecerTranscricao(): Promise<void> {
  if (aquecimento) return aquecimento;
  if (Array.from(workersTranscricao).some(w => !w.encerrado) || trabalhosAtivos > 0 || !(await capacidadeTranscricao()).disponivel) return;
  if (aquecimento) return aquecimento;
  aquecimento = executarPersistente("", "wav", { timeoutMs: 30000 }, "pt", true).then(() => undefined);
  try { await aquecimento; } finally { aquecimento = null; }
}

async function aguardarAquecimento(signal?: AbortSignal): Promise<void> {
  const pendente = aquecimento;
  if (!pendente) return;
  if (signal?.aborted) throw cancelamento();
  await new Promise<void>((resolve, reject) => {
    const cancelar = () => reject(cancelamento());
    signal?.addEventListener("abort", cancelar, { once: true });
    pendente.then(resolve, reject).finally(() => signal?.removeEventListener("abort", cancelar));
    if (signal?.aborted) cancelar();
  });
}

async function executarPython(caminho: string, extensao: string, opcoes: OpcoesTranscricao, idioma: IdiomaTranscricao): Promise<ResultadoTranscricao> {
  if (opcoes.signal?.aborted) throw cancelamento();
  return new Promise((resolve, reject) => {
    const filho = spawn(opcoes.python ?? PYTHON, [opcoes.script ?? SCRIPT, "--modelo", opcoes.modelo ?? MODELO, "--audio", caminho, "--formato", extensao, "--idioma", idioma], {
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: AMBIENTE_WORKER,
    });
    const partes: Buffer[] = [];
    let bytesSaida = 0, bytesErro = 0, falha: ErroTranscricao | null = null;
    const interromper = (erro: ErroTranscricao) => { falha ??= erro; filho.kill("SIGKILL"); };
    const cancelar = () => interromper(cancelamento());
    const timeout = setTimeout(() => interromper(new ErroTranscricao("A transcrição demorou demais. Tente uma gravação mais curta.", 504, "TEMPO_ESGOTADO")), Math.min(120_000, Math.max(1, opcoes.timeoutMs ?? 120_000)));
    opcoes.signal?.addEventListener("abort", cancelar, { once: true });
    if (opcoes.signal?.aborted) cancelar();
    filho.stdout.on("data", (parte: Buffer) => {
      bytesSaida += parte.length;
      if (bytesSaida > 128 * 1024) interromper(new ErroTranscricao("A resposta da transcrição excedeu o limite.", 502, "RESPOSTA_INVALIDA"));
      else partes.push(parte);
    });
    filho.stderr.on("data", (parte: Buffer) => { bytesErro += parte.length; if (bytesErro > 64 * 1024) interromper(new ErroTranscricao("Não foi possível concluir a transcrição.", 502, "FALHA_LOCAL")); });
    filho.on("error", () => { falha ??= new ErroTranscricao("O transcritor local não está disponível.", 503, "INDISPONIVEL"); });
    filho.on("close", (codigo) => {
      clearTimeout(timeout); opcoes.signal?.removeEventListener("abort", cancelar);
      if (falha) { reject(falha); return; }
      let dados: { texto?: unknown; duracaoSegundos?: unknown; erro?: unknown };
      try { dados = JSON.parse(Buffer.concat(partes).toString("utf8")) as typeof dados; if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new Error(); } catch { reject(new ErroTranscricao("Não foi possível transcrever esta gravação.", 502, "RESPOSTA_INVALIDA")); return; }
      if (codigo !== 0) {
        const longa = dados.erro === "DURACAO_EXCEDIDA";
        reject(new ErroTranscricao(longa ? "Grave até 2 minutos por vez." : "Não consegui ler esta gravação de áudio. Grave novamente.", 422, longa ? "DURACAO_EXCEDIDA" : "AUDIO_INVALIDO")); return;
      }
      if (typeof dados.texto !== "string" || dados.texto.length > 16_000 || typeof dados.duracaoSegundos !== "number" || !Number.isFinite(dados.duracaoSegundos) || dados.duracaoSegundos < 0 || dados.duracaoSegundos > MAX_DURACAO_SEGUNDOS) {
        reject(new ErroTranscricao("A resposta da transcrição é inválida.", 502, "RESPOSTA_INVALIDA")); return;
      }
      resolve({ texto: dados.texto.trim(), duracaoSegundos: dados.duracaoSegundos, local: true });
    });
  });
}

export async function transcreverAudio(pedido: unknown, opcoes: OpcoesTranscricao = {}): Promise<ResultadoTranscricao> {
  if (opcoes.signal?.aborted) throw cancelamento();
  const { audio, extensao, idioma } = validarAudioTranscricao(pedido);
  if (trabalhosAtivos >= 2) { audio.fill(0); throw new ErroTranscricao("O transcritor está ocupado. Tente novamente em instantes.", 429, "OCUPADO"); }
  trabalhosAtivos++;
  let pasta: string | null = null;
  try {
    if (!(await capacidadeTranscricao(opcoes)).disponivel) throw new ErroTranscricao("A transcrição local ainda não está instalada neste servidor.", 503, "INDISPONIVEL");
    if (!opcoes.python && !opcoes.script && !opcoes.modelo) await aguardarAquecimento(opcoes.signal);
    if (opcoes.signal?.aborted) throw cancelamento();
    const base = opcoes.temporarios ?? tmpdir();
    if (opcoes.temporarios) await mkdir(base, { recursive: true, mode: 0o700 });
    pasta = await mkdtemp(join(base, "anotador-voz-"));
    await chmod(pasta, 0o700);
    const caminho = join(pasta, "audio." + extensao);
    await writeFile(caminho, audio, { mode: 0o600, flag: "wx" });
    return await ((opcoes.persistente ?? !(opcoes.python || opcoes.script || opcoes.modelo)) ? executarPersistente : executarPython)(caminho, extensao, opcoes, idioma);
  } finally {
    audio.fill(0);
    try { if (pasta) await rm(pasta, { recursive: true, force: true }); }
    finally { trabalhosAtivos--; }
  }
}
