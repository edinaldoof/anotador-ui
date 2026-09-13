// Sistema de design do projeto, lido do CSS: quais tokens existem, o que cada um vale
// e — quando o autor escreveu no comentário ao lado — para que ele serve.
//
// É a metade declarada. A outra metade, o que a página realmente pinta, o overlay mede
// no navegador; cruzar as duas é o que revela valor fora do sistema e token que ninguém usa.

import type { ArquivoFonte } from "./fonte.ts";
import { paraRgb, rgbTexto } from "./fonte.ts";

export type CategoriaToken = "cor" | "espaco" | "texto" | "raio" | "sombra" | "fonte" | "outro";

export interface TokenDesign {
  nome: string;
  categoria: CategoriaToken;
  /** valor como está escrito no CSS */
  valor: string;
  /** o mesmo valor em pixels, quando é medida */
  px?: number;
  /** cor normalizada, quando é cor */
  rgb?: string;
  /** o que o comentário ao lado diz que o token significa */
  intencao?: string;
  arquivo: string;
  linha: number;
}

export interface SistemaDeDesign {
  tokens: TokenDesign[];
  /** passo do espaçamento que a maioria dos tokens respeita, e quem escapa dele */
  espaco: EscalaDeEspaco;
  /** tamanhos de texto declarados, em pixels, em ordem */
  escalaDeTexto: number[];
  /** cor normalizada → tokens que a declaram (duas entradas = cor duplicada) */
  porCor: Record<string, string[]>;
  arquivos: string[];
}

const CATEGORIAS: Array<[RegExp, CategoriaToken]> = [
  [/^--colou?r-|^--.*-(bg|background|foreground|border|text)$/i, "cor"],
  [/^--spacing/i, "espaco"],
  [/^--(text|font-size|leading|tracking)/i, "texto"],
  [/^--radius/i, "raio"],
  [/^--shadow|^--elevation/i, "sombra"],
  [/^--font-/i, "fonte"],
];

function categoriaDe(nome: string, valor: string): CategoriaToken {
  for (const [re, cat] of CATEGORIAS) if (re.test(nome)) return cat;
  if (paraRgb(valor)) return "cor";
  if (/^-?[\d.]+(rem|px|em)$/.test(valor.trim())) return "espaco";
  return "outro";
}

/** `1.5rem` → 24, `44px` → 44. Sem unidade conhecida, indefinido. */
export function emPixels(valor: string, raiz = 16): number | undefined {
  const m = /^(-?[\d.]+)(rem|em|px)$/.exec(valor.trim());
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return m[2] === "px" ? n : n * raiz;
}

export interface EscalaDeEspaco {
  /** passo que a maioria dos tokens respeita */
  base: number | null;
  /** quantos tokens são múltiplos da base */
  dentro: number;
  total: number;
  fora: Array<{ nome: string; px: number }>;
}

// Divisor comum não serve: um único token quebrado derruba a base para 1px e esconde o achado.
// O que interessa é qual passo a maioria respeita, e quem está fora dele.
export function escalaDeEspaco(tokens: Array<{ nome: string; px: number }>): EscalaDeEspaco {
  const validos = tokens.filter((t) => t.px > 0 && Number.isFinite(t.px));
  if (validos.length < 3) return { base: null, dentro: 0, total: validos.length, fora: [] };
  for (const candidata of [8, 4, 2]) {
    const dentro = validos.filter((t) => Math.abs(t.px % candidata) < 0.01);
    if (dentro.length / validos.length >= 0.8) {
      return {
        base: candidata,
        dentro: dentro.length,
        total: validos.length,
        fora: validos.filter((t) => Math.abs(t.px % candidata) >= 0.01).sort((a, b) => a.px - b.px),
      };
    }
  }
  return { base: null, dentro: 0, total: validos.length, fora: [] };
}

export function lerSistemaDeDesign(arquivos: ArquivoFonte[]): SistemaDeDesign {
  const brutos = new Map<string, { valor: string; intencao?: string; arquivo: string; linha: number }>();
  const usados = new Set<string>();
  for (const arquivo of arquivos) {
    if (!/\.(css|scss)$/.test(arquivo.relativo)) continue;
    arquivo.linhas.forEach((linha, i) => {
      const m = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);(?:\s*\/\*\s*(.*?)\s*\*\/)?/.exec(linha);
      if (!m?.[1] || !m[2]) return;
      if (brutos.has(m[1])) return;
      const entrada: { valor: string; intencao?: string; arquivo: string; linha: number } = { valor: m[2].trim(), arquivo: arquivo.relativo, linha: i + 1 };
      // O comentário costuma repetir o valor antes da explicação: "/* 16px — irmãos do mesmo grupo */".
      const comentario = m[3]?.replace(/^-?\s*[\d.]+\s*px\s*[—–-]\s*/i, "").trim();
      if (comentario) entrada.intencao = comentario;
      brutos.set(m[1], entrada);
    });
    for (const linha of arquivo.linhas) {
      for (const uso of linha.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) if (uso[1]) usados.add(uso[1]);
    }
  }

  const tokens: TokenDesign[] = [];
  const porCor: Record<string, string[]> = {};
  for (const [nome, dados] of brutos) {
    let valor = dados.valor;
    const alias = /^var\((--[A-Za-z0-9_-]+)\)$/.exec(valor);
    if (alias?.[1]) valor = brutos.get(alias[1])?.valor ?? valor;
    const categoria = categoriaDe(nome, valor);
    const token: TokenDesign = { nome, categoria, valor: dados.valor, arquivo: dados.arquivo, linha: dados.linha };
    if (dados.intencao) token.intencao = dados.intencao;
    const px = emPixels(valor);
    if (px !== undefined) token.px = Math.round(px * 100) / 100;
    const rgb = paraRgb(valor);
    if (rgb) {
      token.rgb = rgbTexto(rgb);
      (porCor[token.rgb] ??= []).push(nome);
    }
    tokens.push(token);
  }

  const espacos = tokens.filter((t) => t.categoria === "espaco" && t.px !== undefined).map((t) => ({ nome: t.nome, px: t.px as number }));
  const escalaDeTexto = Array.from(new Set(tokens.filter((t) => t.categoria === "texto" && t.px !== undefined).map((t) => t.px as number))).sort((a, b) => a - b);
  return {
    tokens: tokens.sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome)),
    espaco: escalaDeEspaco(espacos),
    escalaDeTexto,
    porCor,
    arquivos: Array.from(new Set(tokens.map((t) => t.arquivo))),
  };
}

/**
 * Tokens que ninguém referencia. Conta `var(--nome)` e, no Tailwind 4, a utilitária derivada
 * (`--color-brand-teal` vira `bg-brand-teal`, `text-brand-teal`…), procurando o sufixo como
 * palavra inteira. Sem essa segunda forma o resultado acusa metade do sistema como morta.
 */
export function tokensSemUso(sistema: SistemaDeDesign, arquivos: ArquivoFonte[]): TokenDesign[] {
  const porVar = new Set<string>();
  const textoDosOutros: string[] = [];
  for (const arquivo of arquivos) {
    const ehCss = /\.(css|scss)$/.test(arquivo.relativo);
    for (const linha of arquivo.linhas) {
      for (const uso of linha.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) if (uso[1]) porVar.add(uso[1]);
      if (!ehCss) textoDosOutros.push(linha);
    }
  }
  const corpo = textoDosOutros.join("\n");
  return sistema.tokens.filter((t) => {
    if (porVar.has(t.nome)) return false;
    const sufixo = t.nome.replace(/^--(color|spacing|text|radius|shadow|font|leading|tracking)-?/, "");
    if (!sufixo || sufixo === t.nome.slice(2)) return !corpo.includes(t.nome);
    return !new RegExp(`[-:\\[\\s"'\`]${sufixo.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}\\b`).test(corpo);
  });
}

/**
 * Cores que repetem o mesmo literal em tokens diferentes. Apontar todo token que compartilha
 * uma cor seria ruído: `--color-text-main: var(--color-brand-ink)` é alias, e alias é o jeito
 * certo de dar nome semântico. Defeito é escrever `#2d2d2d` de novo, porque aí mudar a marca
 * exige achar todas as cópias.
 */
export function coresRepetidas(sistema: SistemaDeDesign): Array<{ rgb: string; tokens: string[] }> {
  const porLiteral = new Map<string, string[]>();
  for (const t of sistema.tokens) {
    if (!t.rgb || /^var\(/.test(t.valor.trim())) continue;
    const lista = porLiteral.get(t.rgb) ?? [];
    lista.push(t.nome);
    porLiteral.set(t.rgb, lista);
  }
  return Array.from(porLiteral.entries())
    .filter(([, nomes]) => nomes.length > 1)
    .map(([rgb, tokens]) => ({ rgb, tokens }))
    .sort((a, b) => b.tokens.length - a.tokens.length);
}

export interface AchadoDesign {
  regra: string;
  gravidade: "alta" | "media" | "baixa";
  alvo: string;
  evidencia: string;
  onde?: string;
}

/** Prefixos de bibliotecas que consomem as próprias variáveis em tempo de execução. */
const DE_BIBLIOTECA = /^--(rdp|xy|rmdp|swiper|toastify|radix|cmdk)-/;

export interface RelatorioDesign {
  sistema: SistemaDeDesign;
  achados: AchadoDesign[];
}

export function analisarSistema(arquivos: ArquivoFonte[]): RelatorioDesign {
  const sistema = lerSistemaDeDesign(arquivos);
  const achados: AchadoDesign[] = [];
  const porNome = new Map(sistema.tokens.map((t) => [t.nome, t]));

  for (const fora of sistema.espaco.fora) {
    const token = porNome.get(fora.nome);
    achados.push({
      regra: "espaçamento fora da escala",
      // Token que explica a exceção no próprio comentário não é descuido.
      gravidade: token?.intencao ? "baixa" : "media",
      alvo: fora.nome,
      evidencia: `${fora.px}px não é múltiplo de ${sistema.espaco.base}px` + (token?.intencao ? ` — declarado como "${token.intencao}"` : ""),
      ...(token ? { onde: `${token.arquivo}:${token.linha}` } : {}),
    });
  }

  for (const c of coresRepetidas(sistema)) {
    const primeiro = porNome.get(c.tokens[0] as string);
    achados.push({
      regra: "cor literal repetida",
      gravidade: c.tokens.length > 3 ? "media" : "baixa",
      alvo: c.rgb,
      evidencia: `${c.tokens.length} tokens escrevem o mesmo valor em vez de apontar para um só: ${c.tokens.join(", ")}`,
      ...(primeiro ? { onde: `${primeiro.arquivo}:${primeiro.linha}` } : {}),
    });
  }

  for (const t of tokensSemUso(sistema, arquivos)) {
    const biblioteca = DE_BIBLIOTECA.test(t.nome);
    achados.push({
      regra: "token sem uso",
      gravidade: "baixa",
      alvo: t.nome,
      evidencia: biblioteca
        ? "nenhum uso no seu código; o prefixo indica variável de biblioteca, que a própria lê em tempo de execução"
        : "declarado e nunca referenciado, nem por var() nem por utilitária",
      onde: `${t.arquivo}:${t.linha}`,
    });
  }

  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || a.regra.localeCompare(b.regra));
  return { sistema, achados };
}
