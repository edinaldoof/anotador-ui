// Prints do lote: renderiza o instantâneo (DOM com edições e pins) no Chromium
// headless e recorta cada elemento anotado. Falha nunca derruba o lote.

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Navegador } from "./cdp.ts";
import type { Fila } from "./fila.ts";

export interface OpcoesCaptura {
  /** endereços do instantâneo, do preferido (mesma origem da página) ao interno */
  urlsInstantaneo: string[];
  chrome?: string | null;
  timeoutMs?: number;
}

const MARGEM = 24;

export async function capturarLote(fila: Fila, lote: Lote, opcoes: OpcoesCaptura): Promise<CapturaLote> {
  if (!lote.instantaneo) return { anotacoes: {}, erro: "lote sem instantâneo" };
  const limite = new Promise<CapturaLote>((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error("tempo esgotado na captura")), opcoes.timeoutMs ?? 30_000).unref()
  );
  try {
    return await Promise.race([capturar(fila, lote, opcoes), limite]);
  } catch (erro) {
    return { anotacoes: {}, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

async function capturar(fila: Fila, lote: Lote, opcoes: OpcoesCaptura): Promise<CapturaLote> {
  const navegador = await Navegador.abrir({ caminho: opcoes.chrome ?? null });
  try {
    const pagina = await navegador.novaPagina();
    const vp = lote.pagina.viewport;
    await pagina.definirViewport(vp.largura || 1280, vp.altura || 800, Math.min(2, vp.dpr || 1));
    let ultimoErro: unknown = new Error("nenhum endereço de instantâneo");
    let navegou = false;
    for (const url of opcoes.urlsInstantaneo) {
      try {
        await pagina.navegar(url, 15_000);
        navegou = true;
        break;
      } catch (erro) {
        ultimoErro = erro;
      }
    }
    if (!navegou) throw ultimoErro;
    await pagina.avaliar("document.fonts ? document.fonts.ready.then(() => true) : true");
    await pagina.esperar(300);
    const dir = fila.dirCapturasLote(lote.id);
    await mkdir(dir, { recursive: true });
    const saida: CapturaLote = { anotacoes: {} };
    const caminhoPagina = join(dir, "pagina.png");
    await writeFile(caminhoPagina, await pagina.capturar({ paginaInteira: true }));
    saida.pagina = relative(fila.dir, caminhoPagina);
    for (const a of lote.anotacoes) {
      const r = a.elemento.rectPagina;
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const clip: Rect = {
        left: Math.max(0, r.left - MARGEM),
        top: Math.max(0, r.top - MARGEM),
        width: r.width + MARGEM * 2,
        height: r.height + MARGEM * 2,
      };
      const caminho = join(dir, `anotacao-${a.ordem}.png`);
      await writeFile(caminho, await pagina.capturar({ clip }));
      saida.anotacoes[a.id] = relative(fila.dir, caminho);
    }
    if (pagina.erros.length) saida.erro = "página renderizou com avisos: " + pagina.erros.slice(0, 3).join(" | ");
    await pagina.fechar();
    return saida;
  } finally {
    await navegador.fechar();
  }
}

/** Print da página inteira para a avaliação; falha vira só um aviso, nunca derruba o pedido. */
export async function capturarAvaliacao(
  destino: string,
  viewport: { largura: number; altura: number; dpr: number },
  opcoes: OpcoesCaptura
): Promise<{ caminho: string | null; erro?: string }> {
  const tentar = async (): Promise<{ caminho: string | null; erro?: string }> => {
    const navegador = await Navegador.abrir({ caminho: opcoes.chrome ?? null });
    try {
      const pagina = await navegador.novaPagina();
      await pagina.definirViewport(viewport.largura || 1280, viewport.altura || 800, Math.min(2, viewport.dpr || 1));
      let navegou = false;
      let ultimoErro: unknown = new Error("nenhum endereço de instantâneo");
      for (const url of opcoes.urlsInstantaneo) {
        try {
          await pagina.navegar(url, 15_000);
          navegou = true;
          break;
        } catch (erro) {
          ultimoErro = erro;
        }
      }
      if (!navegou) throw ultimoErro;
      await pagina.esperar(700);
      await mkdir(join(destino, ".."), { recursive: true }).catch(() => undefined);
      await mkdir(destino.replace(/\/[^/]+$/, ""), { recursive: true });
      await writeFile(destino, await pagina.capturar({ paginaInteira: true }));
      return { caminho: destino };
    } finally {
      await navegador.fechar();
    }
  };
  const limite = new Promise<{ caminho: string | null; erro?: string }>((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error("tempo esgotado na captura")), opcoes.timeoutMs ?? 30_000).unref()
  );
  try {
    return await Promise.race([tentar(), limite]);
  } catch (erro) {
    return { caminho: null, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
