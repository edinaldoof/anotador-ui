// Registro das conexões feitas (app alvo × pasta do projeto), para reconectar sem perguntar de novo.

import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gravarAtomico, serializar } from "./persistencia.ts";

export interface Conexao {
  alvo: string;
  nome: string;
  /** raiz do código-fonte; chave da conexão */
  fonte: string | null;
  agente: string;
  /** agente chamado pela ponte quando ninguém está ouvindo */
  ponte?: { agente: string; sessao: string | null; modelo?: string | null; esforco?: string | null } | null;
  usadoEm: string;
}

const LIMITE = 20;

/** Pasta-base dos dados do anotador: filas, capturas e o registro de conexões. */
export function pastaBase(): string {
  return process.env["ANOTADOR_HOME"] || join(homedir(), ".claude", "anotacoes");
}

export class RegistroConexoes {
  readonly arquivo: string;

  constructor(arquivo = join(pastaBase(), "conexoes.json")) {
    this.arquivo = arquivo;
  }

  async listar(): Promise<Conexao[]> {
    try {
      const bruto = JSON.parse(await readFile(this.arquivo, "utf8")) as { conexoes?: unknown };
      if (!Array.isArray(bruto.conexoes)) return [];
      return bruto.conexoes.filter(valida).sort((a, b) => b.usadoEm.localeCompare(a.usadoEm));
    } catch {
      return [];
    }
  }

  async procurarPorFonte(fonte: string): Promise<Conexao | null> {
    const chave = resolve(fonte);
    return (await this.listar()).find((c) => c.fonte && resolve(c.fonte) === chave) ?? null;
  }

  /** Grava (ou atualiza) a conexão; a mais recente fica em primeiro e o registro não passa de 20 entradas. */
  async registrar(entrada: Omit<Conexao, "usadoEm">): Promise<Conexao> {
    return serializar(this.arquivo, async () => {
      const nova: Conexao = { ...entrada, fonte: entrada.fonte ? resolve(entrada.fonte) : null, usadoEm: new Date().toISOString() };
      const restantes = (await this.listar()).filter((c) => !(c.alvo === nova.alvo && (c.fonte ?? "") === (nova.fonte ?? "")));
      const conexoes = [nova, ...restantes].slice(0, LIMITE);
      await mkdir(dirname(this.arquivo), { recursive: true });
      await gravarAtomico(this.arquivo, JSON.stringify({ conexoes }, null, 2) + "\n");
      return nova;
    });
  }

  async esquecer(alvo: string, fonte: string | null): Promise<void> {
    return serializar(this.arquivo, async () => {
      const conexoes = (await this.listar()).filter((c) => !(c.alvo === alvo && (c.fonte ?? "") === (fonte ? resolve(fonte) : "")));
      await mkdir(dirname(this.arquivo), { recursive: true });
      await gravarAtomico(this.arquivo, JSON.stringify({ conexoes }, null, 2) + "\n");
    });
  }
}

function valida(c: unknown): c is Conexao {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return typeof o["alvo"] === "string" && typeof o["nome"] === "string" && typeof o["agente"] === "string" && typeof o["usadoEm"] === "string" && (o["fonte"] === null || typeof o["fonte"] === "string");
}
