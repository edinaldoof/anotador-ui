// Prints do lote: renderiza o instantâneo (DOM com edições e pins) no Chromium
// headless e recorta cada elemento anotado. Falha nunca derruba o lote.

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Navegador } from "./cdp.ts";
import type { Fila } from "./fila.ts";
import { LARGURAS_PADRAO, SCRIPT_MEDIDA, type MedidaTela } from "./tela.ts";

export interface OpcoesCaptura {
  /** Larguras extras a medir na avaliação. Vazio desliga a medida. */
  larguras?: readonly number[];
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
      const margem = a.area ? 0 : MARGEM;
      const clip: Rect = {
        left: Math.max(0, r.left - margem),
        top: Math.max(0, r.top - margem),
        width: r.width + margem * 2,
        height: r.height + margem * 2,
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

/**
 * Print da página inteira para a avaliação e, no mesmo navegador já navegado, a medida
 * do que ela faz em outras larguras. Falha vira só um aviso, nunca derruba o pedido.
 */
export async function capturarAvaliacao(
  destino: string,
  viewport: { largura: number; altura: number; dpr: number },
  opcoes: OpcoesCaptura
): Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[] }> {
  const medidas: MedidaTela[] = [];
  const tentar = async (): Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[] }> => {
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
      // Depois do print, e no mesmo navegador: reaproveita a navegação que já custou.
      // Uma largura que falhe não leva as outras junto nem invalida a captura.
      for (const largura of opcoes.larguras ?? LARGURAS_PADRAO) {
        try {
          await pagina.definirViewport(largura, viewport.altura || 800, 1);
          await pagina.esperar(250);
          medidas.push(await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA));
        } catch { /* uma largura sem medida é menos grave que uma avaliação sem dossiê */ }
      }
      return { caminho: destino, medidas };
    } finally {
      await navegador.fechar();
    }
  };
  const limite = new Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[] }>((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error("tempo esgotado na captura")), opcoes.timeoutMs ?? 45_000).unref()
  );
  try {
    return await Promise.race([tentar(), limite]);
  } catch (erro) {
    return { caminho: null, erro: erro instanceof Error ? erro.message : String(erro), medidas };
  }
}
