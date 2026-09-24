// Prints do lote: renderiza o instantâneo (DOM com edições e pins) no Chromium
// headless e recorta cada elemento anotado. Falha nunca derruba o lote.

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Navegador, type Pagina } from "./cdp.ts";
import type { Fila } from "./fila.ts";
import { LARGURAS_PADRAO, SCRIPT_CONTRASTE, SCRIPT_MEDIDA, SCRIPT_MOVIMENTO, SCRIPT_TEMA_ESCURO, type AcessibilidadeTela, type MedidaTela } from "./tela.ts";

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
): Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[]; acessibilidade: AcessibilidadeTela | null }> {
  const medidas: MedidaTela[] = [];
  let acessibilidade: AcessibilidadeTela | null = null;
  const tentar = async (): Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[]; acessibilidade: AcessibilidadeTela | null }> => {
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
      const larguras = opcoes.larguras ?? LARGURAS_PADRAO;
      medidas.push(...await medirLarguras(pagina, larguras, viewport.altura || 800));
      // Por último: forçar tema e movimento muda a página, e nada depois disso deve medi-la.
      if (larguras.length) acessibilidade = await medirAcessibilidade(pagina, Math.max(...larguras), viewport.altura || 800);
      return { caminho: destino, medidas, acessibilidade };
    } finally {
      await navegador.fechar();
    }
  };
  const limite = new Promise<{ caminho: string | null; erro?: string; medidas: MedidaTela[]; acessibilidade: AcessibilidadeTela | null }>((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error("tempo esgotado na captura")), opcoes.timeoutMs ?? 45_000).unref()
  );
  try {
    return await Promise.race([tentar(), limite]);
  } catch (erro) {
    return { caminho: null, erro: erro instanceof Error ? erro.message : String(erro), medidas, acessibilidade };
  }
}

// Uma largura que falhe não leva as outras junto: uma medida a menos é menos grave
// que nenhuma, e quem lê o resultado vê quais larguras vieram.
async function medirLarguras(pagina: Pagina, larguras: readonly number[], altura: number): Promise<MedidaTela[]> {
  const medidas: MedidaTela[] = [];
  for (const largura of larguras) {
    try {
      await pagina.definirViewport(largura, altura, 1);
      await pagina.esperar(250);
      medidas.push(await pagina.avaliar<MedidaTela>(SCRIPT_MEDIDA));
    } catch { /* segue para a próxima largura */ }
  }
  return medidas;
}

interface ResultadoContraste { fundo: string; total: number; pior: number | null; exemplos: string[]; semMain: boolean }

/**
 * Contraste nos dois temas, região principal e movimento reduzido — o que o overlay não
 * vê, porque mede só o tema e as preferências de quem está olhando a página.
 */
async function medirAcessibilidade(pagina: Pagina, largura: number, altura: number): Promise<AcessibilidadeTela | null> {
  try {
    await pagina.definirViewport(largura, altura, 1);
    await pagina.emularPreferencias({ tema: "light", movimentoReduzido: false });
    await pagina.esperar(200);
    const claro = await pagina.avaliar<ResultadoContraste>(SCRIPT_CONTRASTE);
    await pagina.emularPreferencias({ tema: "dark", movimentoReduzido: true });
    await pagina.avaliar(SCRIPT_TEMA_ESCURO);
    await pagina.esperar(400);
    const escuro = await pagina.avaliar<ResultadoContraste>(SCRIPT_CONTRASTE);
    const movimento = await pagina.avaliar<{ total: number; exemplos: string[] }>(SCRIPT_MOVIMENTO);
    const tema = (t: "claro" | "escuro", r: ResultadoContraste, detectado: boolean) => ({ tema: t, detectado, total: r.total, pior: r.pior, exemplos: r.exemplos });
    return { largura, temas: [tema("claro", claro, true), tema("escuro", escuro, escuro.fundo !== claro.fundo)], semMain: claro.semMain, movimento };
  } catch { return null; }
}

/** Abre a URL num Chromium temporário e mede o que a página faz em cada largura. */
export interface MedidaDeUrl {
  medidas: MedidaTela[];
  acessibilidade: AcessibilidadeTela | null;
  /** Onde o navegador terminou. Pode não ser a URL pedida. */
  urlMedida: string;
  redirecionada: boolean;
  /** A página final tem campo de senha: quase sempre, a tela de login de uma rota protegida. */
  pareceLogin: boolean;
}

/** Mesma página para quem lê: ignora barra final e âncora. */
function mesmaPagina(a: string, b: string): boolean {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "") && x.search === y.search;
  } catch { return a === b; }
}

export async function medirUrl(url: string, opcoes: { chrome?: string | null; larguras?: readonly number[]; timeoutMs?: number } = {}): Promise<MedidaDeUrl> {
  let alvo: URL;
  try { alvo = new URL(url); } catch { throw new Error("Informe uma URL HTTP ou HTTPS válida."); }
  if (!/^https?:$/.test(alvo.protocol)) throw new Error("A medida aceita somente URLs HTTP ou HTTPS.");
  if (alvo.username || alvo.password) throw new Error("A URL não pode conter usuário ou senha.");
  const larguras = (opcoes.larguras?.length ? opcoes.larguras : LARGURAS_PADRAO).filter((l) => Number.isInteger(l) && l >= 240 && l <= 3840).slice(0, 6);
  if (!larguras.length) throw new Error("As larguras devem ser inteiros entre 240 e 3840 px.");
  const tentar = async (): Promise<MedidaDeUrl> => {
    const navegador = await Navegador.abrir({ caminho: opcoes.chrome ?? null });
    try {
      const pagina = await navegador.novaPagina();
      await pagina.definirViewport(larguras[0] ?? 1280, 800, 1);
      await pagina.navegar(alvo.href, 20_000);
      await pagina.esperar(700);
      // O navegador daqui não tem a sessão de ninguém: rota protegida manda para o login,
      // e medir o login achando que é o painel é o erro que ninguém percebe. Registra
      // onde a navegação terminou antes de medir qualquer coisa.
      const urlMedida = await pagina.avaliar<string>("location.href");
      const pareceLogin = await pagina.avaliar<boolean>(`!!document.querySelector('input[type="password"]')`);
      const medidas = await medirLarguras(pagina, larguras, 800);
      return { medidas, acessibilidade: await medirAcessibilidade(pagina, Math.max(...larguras), 800), urlMedida, redirecionada: !mesmaPagina(urlMedida, alvo.href), pareceLogin };
    } finally {
      await navegador.fechar();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error("tempo esgotado ao medir a página")), opcoes.timeoutMs ?? 45_000); });
  try { return await Promise.race([tentar(), limite]); }
  finally { if (timer) clearTimeout(timer); }
}
