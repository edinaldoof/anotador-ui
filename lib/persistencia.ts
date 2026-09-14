import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const operacoes = new Map<string, Promise<void>>();

/** Serializa alterações no mesmo recurso, inclusive entre instâncias no processo. */
export async function serializar<T>(caminho: string, alterar: () => Promise<T>): Promise<T> {
  const chave = resolve(caminho);
  const anterior = operacoes.get(chave) ?? Promise.resolve();
  const atual = anterior.then(alterar);
  const concluida = atual.then(() => {}, () => {});
  operacoes.set(chave, concluida);
  try {
    return await atual;
  } finally {
    if (operacoes.get(chave) === concluida) operacoes.delete(chave);
  }
}

/** Publica o conteúdo completo de uma vez, sem expor JSON/Markdown truncado. */
export async function gravarAtomico(caminho: string, conteudo: string): Promise<void> {
  const temporario = `${caminho}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporario, conteudo, { flag: "wx" });
    await rename(temporario, caminho);
  } finally {
    await rm(temporario, { force: true });
  }
}
