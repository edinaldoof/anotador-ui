// Servidor WebSocket mínimo (RFC 6455) para empurrar eventos da fila ao chat.
// Só envia texto; do cliente trata apenas close e ping.

import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function chaveAceite(chave: string): string {
  return createHash("sha1").update(chave + GUID).digest("base64");
}

export function ehPedidoWs(req: IncomingMessage): boolean {
  return (
    /\bupgrade\b/i.test(String(req.headers.connection ?? "")) &&
    String(req.headers.upgrade ?? "").toLowerCase() === "websocket"
  );
}

export function codificarQuadro(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const n = payload.length;
  let cab: Buffer;
  if (n < 126) {
    cab = Buffer.alloc(2);
    cab[1] = n;
  } else if (n < 65536) {
    cab = Buffer.alloc(4);
    cab[1] = 126;
    cab.writeUInt16BE(n, 2);
  } else {
    cab = Buffer.alloc(10);
    cab[1] = 127;
    cab.writeBigUInt64BE(BigInt(n), 2);
  }
  cab[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([cab, payload]);
}

export function codificarTexto(texto: string): Buffer {
  return codificarQuadro(0x1, Buffer.from(texto, "utf8"));
}

export interface QuadroWs {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

export function decodificarQuadros(buf: Buffer): { quadros: QuadroWs[]; resto: Buffer } {
  const quadros: QuadroWs[] = [];
  let pos = 0;
  while (buf.length - pos >= 2) {
    const b0 = buf[pos] ?? 0;
    const b1 = buf[pos + 1] ?? 0;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const mascarado = (b1 & 0x80) !== 0;
    let tamanho = b1 & 0x7f;
    let off = pos + 2;
    if (tamanho === 126) {
      if (buf.length - off < 2) break;
      tamanho = buf.readUInt16BE(off);
      off += 2;
    } else if (tamanho === 127) {
      if (buf.length - off < 8) break;
      const grande = buf.readBigUInt64BE(off);
      if (grande > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("quadro WebSocket grande demais");
      tamanho = Number(grande);
      off += 8;
    }
    let mascara: Buffer | null = null;
    if (mascarado) {
      if (buf.length - off < 4) break;
      mascara = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length - off < tamanho) break;
    const payload = Buffer.from(buf.subarray(off, off + tamanho));
    if (mascara) {
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mascara[i % 4] ?? 0);
    }
    quadros.push({ opcode, payload, fin });
    pos = off + tamanho;
  }
  return { quadros, resto: buf.subarray(pos) };
}

export interface ConexaoWs {
  enviar(texto: string): boolean;
  fechar(codigo?: number): void;
  readonly aberta: boolean;
}

export function aceitarWs(req: IncomingMessage, socket: Duplex, aoFechar?: () => void, aoTexto?: (texto: string) => void): ConexaoWs {
  const chave = String(req.headers["sec-websocket-key"] ?? "");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      chaveAceite(chave) +
      "\r\n\r\n"
  );
  let aberta = true;
  let pendente: Buffer = Buffer.alloc(0);
  const encerrar = () => {
    if (!aberta) return;
    aberta = false;
    socket.destroy();
    aoFechar?.();
  };
  const escrever = (dados: Buffer) => {
    try {
      socket.write(dados);
    } catch {
      encerrar();
    }
  };
  socket.on("data", (dados: Buffer) => {
    pendente = Buffer.concat([pendente, dados]);
    let dec: { quadros: QuadroWs[]; resto: Buffer };
    try {
      dec = decodificarQuadros(pendente);
    } catch {
      encerrar();
      return;
    }
    pendente = Buffer.from(dec.resto);
    for (const q of dec.quadros) {
      if (q.opcode === 0x8) {
        escrever(codificarQuadro(0x8, q.payload.subarray(0, 2)));
        encerrar();
        return;
      }
      if (q.opcode === 0x9) escrever(codificarQuadro(0xa, q.payload));
      if (q.opcode === 0x1 && aoTexto) aoTexto(q.payload.toString("utf8"));
    }
  });
  socket.on("close", encerrar);
  socket.on("error", encerrar);
  socket.on("end", encerrar);
  return {
    get aberta() {
      return aberta;
    },
    enviar(texto) {
      if (!aberta) return false;
      escrever(codificarTexto(texto));
      return aberta;
    },
    fechar(codigo = 1000) {
      if (!aberta) return;
      const p = Buffer.alloc(2);
      p.writeUInt16BE(codigo, 0);
      escrever(codificarQuadro(0x8, p));
      encerrar();
    },
  };
}

/** Quem está ouvindo os eventos: identidade declarada na query string da conexão. */
export interface InfoOuvinte {
  agente: string | null;
  sessao: string | null;
  cwd: string | null;
  rotulo: string | null;
  ip: string | null;
  desde: string;
}

export function infoDoPedido(req: IncomingMessage): InfoOuvinte {
  const url = new URL(req.url ?? "/", "http://interno");
  const campo = (nome: string) => {
    const v = url.searchParams.get(nome)?.trim();
    return v ? v.slice(0, 200) : null;
  };
  return { agente: campo("agente"), sessao: campo("sessao"), cwd: campo("cwd"), rotulo: campo("rotulo"), ip: req.socket.remoteAddress ?? null, desde: new Date().toISOString() };
}

export class Difusor {
  private readonly conexoes = new Map<ConexaoWs, InfoOuvinte>();
  private batimento: NodeJS.Timeout | null = null;

  aceitar(req: IncomingMessage, socket: Duplex, aoTexto?: (texto: string) => void): ConexaoWs {
    let conexao: ConexaoWs | null = null;
    conexao = aceitarWs(
      req,
      socket,
      () => {
        if (conexao) this.conexoes.delete(conexao);
      },
      aoTexto
    );
    this.conexoes.set(conexao, infoDoPedido(req));
    this.garantirBatimento();
    return conexao;
  }

  ouvintes(): InfoOuvinte[] {
    return Array.from(this.conexoes.entries())
      .filter(([c]) => c.aberta)
      .map(([, info]) => ({ ...info }));
  }

  /** Sem agente, avisa todos; com agente, conta apenas entregas a ele. */
  transmitir(evento: EventoAnotador, agente?: string | null): number {
    const texto = JSON.stringify(evento);
    const destinatario = agente?.trim().toLowerCase();
    let entregues = 0;
    for (const [c, info] of Array.from(this.conexoes.entries())) {
      if (destinatario && info.agente?.toLowerCase() !== destinatario) continue;
      if (c.enviar(texto)) entregues++;
      else this.conexoes.delete(c);
    }
    return entregues;
  }

  get tamanho(): number {
    return this.conexoes.size;
  }

  fecharTodas(): void {
    for (const c of Array.from(this.conexoes.keys())) c.fechar(1001);
    this.conexoes.clear();
    if (this.batimento) clearInterval(this.batimento);
    this.batimento = null;
  }

  // Ping periódico mantém proxies intermediários acordados e derruba sockets mortos.
  private garantirBatimento(): void {
    if (this.batimento) return;
    this.batimento = setInterval(() => {
      for (const c of Array.from(this.conexoes.keys())) {
        if (!c.aberta) this.conexoes.delete(c);
      }
    }, 30_000);
    this.batimento.unref();
  }
}
