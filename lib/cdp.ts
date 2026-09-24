// Cliente mínimo do Chrome DevTools Protocol sobre o WebSocket nativo do Node.
// Usado pelas capturas de tela do servidor e pelos testes ponta a ponta.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export function encontrarChromium(): string | null {
  const env = process.env["ANOTADOR_CHROME"];
  if (env && existsSync(env)) return env;
  const candidatos: string[] = [];
  const playwright = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(playwright)) {
    const pastas = readdirSync(playwright)
      .filter((n) => n.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const pasta of pastas) {
      candidatos.push(
        join(playwright, pasta, "chrome-linux64", "chrome"),
        join(playwright, pasta, "chrome-linux", "chrome"),
        join(playwright, pasta, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")
      );
    }
  }
  candidatos.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  );
  return candidatos.find((c) => existsSync(c)) ?? null;
}

interface Mensagem {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { message: string; code?: number };
}

type Ouvinte = (params: Record<string, unknown>, sessionId?: string) => void;

interface SocketMinimo {
  send(dados: string): void;
  close(): void;
  addEventListener(tipo: "open" | "message" | "error" | "close", ouvinte: (ev: { data?: unknown }) => void): void;
}

type ConstrutorSocket = new (url: string) => SocketMinimo;

function conectar(url: string): Promise<SocketMinimo> {
  const Construtor = (globalThis as unknown as { WebSocket?: ConstrutorSocket }).WebSocket;
  if (!Construtor) return Promise.reject(new Error("WebSocket nativo indisponível neste Node"));
  return new Promise((resolver, rejeitar) => {
    const ws = new Construtor(url);
    ws.addEventListener("open", () => resolver(ws));
    ws.addEventListener("error", () => rejeitar(new Error("falha ao conectar ao DevTools em " + url)));
  });
}

class Canal {
  private proximoId = 1;
  private readonly pendentes = new Map<number, { resolver: (r: Record<string, unknown>) => void; rejeitar: (e: Error) => void }>();
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();

  private readonly ws: SocketMinimo;

  constructor(ws: SocketMinimo) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => this.receber(String(ev.data)));
    ws.addEventListener("close", () => {
      for (const p of this.pendentes.values()) p.rejeitar(new Error("conexão DevTools encerrada"));
      this.pendentes.clear();
    });
  }

  enviar(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.proximoId++;
    const msg: Mensagem = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      this.ws.send(JSON.stringify(msg));
    });
  }

  em(method: string, ouvinte: Ouvinte): () => void {
    let conjunto = this.ouvintes.get(method);
    if (!conjunto) {
      conjunto = new Set();
      this.ouvintes.set(method, conjunto);
    }
    conjunto.add(ouvinte);
    return () => conjunto?.delete(ouvinte);
  }

  fechar(): void {
    this.ws.close();
  }

  private receber(texto: string): void {
    let msg: Mensagem;
    try {
      msg = JSON.parse(texto) as Mensagem;
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.pendentes.get(msg.id);
      if (!p) return;
      this.pendentes.delete(msg.id);
      if (msg.error) p.rejeitar(new Error(msg.error.message));
      else p.resolver(msg.result ?? {});
      return;
    }
    if (msg.method) {
      for (const o of this.ouvintes.get(msg.method) ?? []) o(msg.params ?? {}, msg.sessionId);
    }
  }
}

export interface OpcoesNavegador {
  caminho?: string | null;
  timeoutMs?: number;
  mostrarBarrasRolagem?: boolean;
}

const TECLAS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
};

/** bits de `modifiers` do CDP */
export const MODIFICADORES = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export class Pagina {
  readonly erros: string[] = [];
  private carregou: Promise<void> | null = null;
  private resolverCarga: (() => void) | null = null;

  private readonly canal: Canal;
  readonly sessionId: string;
  private readonly targetId: string;

  constructor(canal: Canal, sessionId: string, targetId: string) {
    this.canal = canal;
    this.sessionId = sessionId;
    this.targetId = targetId;
    canal.em("Page.loadEventFired", (_p, sid) => {
      if (sid === sessionId) this.resolverCarga?.();
    });
    canal.em("Runtime.exceptionThrown", (p, sid) => {
      if (sid !== sessionId) return;
      const det = (p["exceptionDetails"] ?? {}) as Record<string, unknown>;
      const exc = (det["exception"] ?? {}) as Record<string, unknown>;
      this.erros.push("exceção: " + String(exc["description"] ?? det["text"] ?? "desconhecida"));
    });
    canal.em("Log.entryAdded", (p, sid) => {
      if (sid !== sessionId) return;
      const entrada = (p["entry"] ?? {}) as Record<string, unknown>;
      if (entrada["level"] === "error") this.erros.push(String(entrada["source"] ?? "log") + ": " + String(entrada["text"] ?? "") + (entrada["url"] ? ` (${String(entrada["url"])})` : ""));
    });
    canal.em("Runtime.consoleAPICalled", (p, sid) => {
      if (sid !== sessionId || p["type"] !== "error") return;
      const args = (p["args"] ?? []) as Array<Record<string, unknown>>;
      this.erros.push("console.error: " + args.map((a) => String(a["value"] ?? a["description"] ?? "")).join(" "));
    });
  }

  async preparar(): Promise<void> {
    await this.canal.enviar("Page.enable", {}, this.sessionId);
    await this.canal.enviar("Runtime.enable", {}, this.sessionId);
    await this.canal.enviar("Log.enable", {}, this.sessionId);
    await this.canal.enviar("Emulation.setFocusEmulationEnabled", { enabled: true }, this.sessionId);
  }

  async definirViewport(largura: number, altura: number, dpr = 1): Promise<void> {
    await this.canal.enviar(
      "Emulation.setDeviceMetricsOverride",
      { width: Math.round(largura), height: Math.round(altura), deviceScaleFactor: dpr, mobile: false },
      this.sessionId
    );
  }

  async navegar(url: string, timeoutMs = 20_000): Promise<void> {
    this.carregou = new Promise((r) => (this.resolverCarga = r));
    const resposta = await this.canal.enviar("Page.navigate", { url }, this.sessionId);
    if (resposta["errorText"]) throw new Error("navegação falhou: " + String(resposta["errorText"]));
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.carregou, new Promise<void>((_, rej) => {
        temporizador = setTimeout(() => rej(new Error("tempo esgotado carregando " + url)), timeoutMs);
      })]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  async avaliar<T = unknown>(expressao: string): Promise<T> {
    const r = await this.canal.enviar("Runtime.evaluate", { expression: expressao, awaitPromise: true, returnByValue: true }, this.sessionId);
    const det = r["exceptionDetails"] as Record<string, unknown> | undefined;
    if (det) {
      const exc = (det["exception"] ?? {}) as Record<string, unknown>;
      throw new Error("avaliação falhou: " + String(exc["description"] ?? det["text"] ?? "erro"));
    }
    const res = (r["result"] ?? {}) as Record<string, unknown>;
    return res["value"] as T;
  }

  /** força prefers-color-scheme, para conferir os dois temas de uma página */
  async emularTema(tema: "light" | "dark"): Promise<void> {
    await this.canal.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: tema }] }, this.sessionId);
  }

  /** Várias preferências de mídia de uma vez: cada chamada substitui a anterior inteira. */
  async emularPreferencias(p: { tema?: "light" | "dark"; movimentoReduzido?: boolean }): Promise<void> {
    const features = [
      ...(p.tema ? [{ name: "prefers-color-scheme", value: p.tema }] : []),
      ...(p.movimentoReduzido === undefined ? [] : [{ name: "prefers-reduced-motion", value: p.movimentoReduzido ? "reduce" : "no-preference" }]),
    ];
    await this.canal.enviar("Emulation.setEmulatedMedia", { features }, this.sessionId);
  }

  async esperar(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async esperarPor(expressao: string, timeoutMs = 10_000, intervaloMs = 100): Promise<void> {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      if (await this.avaliar<boolean>(`!!(${expressao})`)) return;
      await this.esperar(intervaloMs);
    }
    throw new Error("condição não satisfeita a tempo: " + expressao);
  }

  async mover(x: number, y: number, modificadores = 0): Promise<void> {
    await this.canal.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: modificadores }, this.sessionId);
  }

  async clicar(x: number, y: number, opcoes: { alt?: boolean } = {}): Promise<void> {
    const modifiers = opcoes.alt ? 1 : 0;
    await this.mover(x, y, modifiers);
    await this.canal.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers }, this.sessionId);
    await this.canal.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers }, this.sessionId);
  }

  async arrastar(de: { x: number; y: number }, para: { x: number; y: number }, passos = 8): Promise<void> {
    await this.mover(de.x, de.y);
    await this.canal.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: de.x, y: de.y, button: "left", buttons: 1, clickCount: 1 }, this.sessionId);
    for (let i = 1; i <= passos; i++) {
      const x = de.x + ((para.x - de.x) * i) / passos;
      const y = de.y + ((para.y - de.y) * i) / passos;
      await this.canal.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }, this.sessionId);
    }
    await this.canal.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: para.x, y: para.y, button: "left", buttons: 0, clickCount: 1 }, this.sessionId);
  }

  async digitar(texto: string): Promise<void> {
    await this.canal.enviar("Input.insertText", { text: texto }, this.sessionId);
  }

  async pressionar(tecla: keyof typeof TECLAS | string, modificadores = 0): Promise<void> {
    const t = TECLAS[tecla] ?? { code: tecla, keyCode: 0 };
    const base = { key: tecla, code: t.code, windowsVirtualKeyCode: t.keyCode, nativeVirtualKeyCode: t.keyCode, modifiers: modificadores };
    await this.canal.enviar("Input.dispatchKeyEvent", { type: t.text ? "keyDown" : "rawKeyDown", ...base, ...(t.text ? { text: t.text } : {}) }, this.sessionId);
    await this.canal.enviar("Input.dispatchKeyEvent", { type: "keyUp", ...base }, this.sessionId);
  }

  // Origem negativa no clip faz o Chrome descartar a posição e capturar a partir de (0,0) — medido; por isso o grampo.
  async capturar(opcoes: { clip?: Rect; paginaInteira?: boolean; alemDoViewport?: boolean } = {}): Promise<Buffer> {
    const params: Record<string, unknown> = { format: "png", captureBeyondViewport: opcoes.alemDoViewport ?? true };
    if (opcoes.clip) {
      const x = Math.max(0, opcoes.clip.left);
      const y = Math.max(0, opcoes.clip.top);
      const width = Math.max(1, opcoes.clip.width - (x - opcoes.clip.left));
      const height = Math.max(1, opcoes.clip.height - (y - opcoes.clip.top));
      params["clip"] = { x, y, width, height, scale: 1 };
    } else if (opcoes.paginaInteira) {
      const metricas = await this.canal.enviar("Page.getLayoutMetrics", {}, this.sessionId);
      const tamanho = (metricas["cssContentSize"] ?? metricas["contentSize"] ?? {}) as Record<string, number>;
      params["clip"] = { x: 0, y: 0, width: Math.max(1, tamanho["width"] ?? 1), height: Math.min(16_000, Math.max(1, tamanho["height"] ?? 1)), scale: 1 };
    }
    const r = await this.canal.enviar("Page.captureScreenshot", params, this.sessionId);
    return Buffer.from(String(r["data"] ?? ""), "base64");
  }

  async fechar(): Promise<void> {
    try {
      await this.canal.enviar("Target.closeTarget", { targetId: this.targetId });
    } catch {
      /* alvo já encerrado */
    }
  }
}

export class Navegador {
  private readonly processo: ChildProcess;
  private readonly canal: Canal;
  private readonly perfil: string;

  private constructor(processo: ChildProcess, canal: Canal, perfil: string) {
    this.processo = processo;
    this.canal = canal;
    this.perfil = perfil;
  }

  static async abrir(opcoes: OpcoesNavegador = {}): Promise<Navegador> {
    const caminho = opcoes.caminho ?? encontrarChromium();
    if (!caminho) throw new Error("Chromium não encontrado — defina ANOTADOR_CHROME com o caminho do executável");
    const perfil = await mkdtemp(join(tmpdir(), "anotador-chrome-"));
    const processo = spawn(
      caminho,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${perfil}`,
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        ...(opcoes.mostrarBarrasRolagem ? [] : ["--hide-scrollbars"]),
        "--window-size=1400,900",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    // Se o processo Node morrer com o navegador aberto, o Chromium não pode ficar órfão.
    const aoSair = () => {
      if (processo.exitCode === null) processo.kill("SIGKILL");
      try {
        rmSync(perfil, { recursive: true, force: true });
      } catch {
        /* perfil já removido */
      }
    };
    process.once("exit", aoSair);
    processo.once("exit", () => process.off("exit", aoSair));
    const abortar = async (motivo: string): Promise<never> => {
      process.off("exit", aoSair);
      processo.kill("SIGKILL");
      await rm(perfil, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(motivo);
    };
    let urlDevTools: string;
    try {
      urlDevTools = await new Promise<string>((resolver, rejeitar) => {
        let acumulado = "";
        const temporizador = setTimeout(() => rejeitar(new Error("Chromium não anunciou o DevTools a tempo")), opcoes.timeoutMs ?? 30_000);
        processo.stderr?.on("data", (d: Buffer) => {
          acumulado += d.toString();
          const m = /DevTools listening on (ws:\/\/\S+)/.exec(acumulado);
          if (m?.[1]) {
            clearTimeout(temporizador);
            resolver(m[1]);
          }
        });
        processo.on("exit", (codigo) => {
          clearTimeout(temporizador);
          rejeitar(new Error("Chromium encerrou com código " + codigo));
        });
        processo.on("error", (erro) => {
          clearTimeout(temporizador);
          rejeitar(new Error("não foi possível iniciar o Chromium: " + erro.message));
        });
      });
    } catch (erro) {
      return abortar(erro instanceof Error ? erro.message : String(erro));
    }
    let ws: SocketMinimo;
    try {
      ws = await conectar(urlDevTools);
    } catch (erro) {
      return abortar(erro instanceof Error ? erro.message : String(erro));
    }
    return new Navegador(processo, new Canal(ws), perfil);
  }

  async novaPagina(): Promise<Pagina> {
    const criado = await this.canal.enviar("Target.createTarget", { url: "about:blank" });
    const targetId = String(criado["targetId"]);
    const anexado = await this.canal.enviar("Target.attachToTarget", { targetId, flatten: true });
    const pagina = new Pagina(this.canal, String(anexado["sessionId"]), targetId);
    await pagina.preparar();
    return pagina;
  }

  /** Só afeta esta instância temporária, para renderizar apps com certificado próprio. */
  async ignorarErrosCertificado(): Promise<void> {
    await this.canal.enviar("Security.setIgnoreCertificateErrors", { ignore: true });
  }

  async fechar(): Promise<void> {
    try {
      this.canal.fechar();
    } catch {
      /* já fechado */
    }
    this.processo.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    if (this.processo.exitCode === null) this.processo.kill("SIGKILL");
    await rm(this.perfil, { recursive: true, force: true }).catch(() => undefined);
  }
}
