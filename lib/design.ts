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
/** Variável que pertence a uma biblioteca (date picker, fluxograma…), não ao sistema do projeto. */
export function deBiblioteca(nome: string): boolean {
  return DE_BIBLIOTECA.test(nome);
}

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

// ---------------------------------------------------------------------------
// EXPORTAÇÃO NO FORMATO DO W3C (Design Tokens Format Module, estável em 2025.10)
// ---------------------------------------------------------------------------
//
// O que o anotador lê do CSS é a mesma coisa que o Figma, o Style Dictionary e o
// Tokens Studio trocam entre si — só que em outro alfabeto. Emitir nesse formato
// abre o caminho de volta: o que foi medido na página vira arquivo que a ferramenta
// de design lê. Tokens que não cabem no formato saem na lista de ignorados, com o
// motivo; inventar uma forma aproximada seria pior do que deixar de fora.

export interface TokenIgnorado {
  nome: string;
  motivo: string;
}

export interface ExportacaoDtcg {
  documento: Record<string, unknown>;
  ignorados: TokenIgnorado[];
}

/** Grupo de primeiro nível por categoria; o nome do token vira a chave dentro dele. */
const GRUPO_DTCG: Record<CategoriaToken, string> = {
  cor: "cor",
  espaco: "espaco",
  texto: "texto",
  raio: "raio",
  sombra: "sombra",
  fonte: "fonte",
  outro: "outro",
};

const DESCRICAO_GRUPO: Record<string, string> = {
  cor: "Cores declaradas no CSS do projeto",
  espaco: "Medidas de espaçamento",
  texto: "Escala tipográfica",
  raio: "Raios de canto",
  sombra: "Elevações",
  fonte: "Famílias tipográficas",
  outro: "Tokens que não se encaixam nas demais categorias",
};

function chaveDtcg(nome: string): string {
  return nome.replace(/^--/, "").replace(/\./g, "-");
}

/** `16px` → {value:16,unit:"px"}; `1.5rem` → {value:1.5,unit:"rem"}. Outra unidade, nada. */
function dimensaoDtcg(valor: string): { value: number; unit: "px" | "rem" } | null {
  const v = valor.trim();
  // Zero dispensa unidade no CSS e aparece assim em quase toda sombra.
  if (/^-?0(\.0+)?$/.test(v)) return { value: 0, unit: "px" };
  const m = /^(-?[\d.]+)(px|rem)$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return { value: n, unit: m[2] as "px" | "rem" };
}

/** Alpha explícito em cores CSS; o terceiro canal RGB nunca é transparência. */
function alphaDe(valor: string): number {
  const v = valor.trim().toLowerCase();
  if (v === "transparent") return 0;
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(v);
  if (hex?.[1]) {
    const h = hex[1];
    const alpha = h.length === 4 ? h[3]!.repeat(2) : h.slice(6, 8);
    return Math.round((parseInt(alpha, 16) / 255) * 1000) / 1000;
  }
  const funcao = /^(rgba?|hsla?|oklch)\((.*)\)$/.exec(v);
  if (!funcao?.[2]) return 1;
  const partes = funcao[2].split("/");
  const canais = funcao[2].split(",");
  const bruto = (partes.length === 2 ? partes[1] : canais.length === 4 ? canais[3] : undefined)?.trim();
  if (!bruto || !/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?%?$/.test(bruto)) return 1;
  const n = bruto.endsWith("%") ? Number(bruto.slice(0, -1)) / 100 : Number(bruto);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

function corDtcg(valor: string): Record<string, unknown> | null {
  const rgb = paraRgb(valor);
  if (!rgb) return null;
  const hex = "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
  return {
    colorSpace: "srgb",
    components: rgb.map((c) => Math.round((c / 255) * 10000) / 10000),
    alpha: alphaDe(valor),
    hex,
  };
}

/** Divide por vírgulas de topo, ignorando as que estão dentro de parênteses. */
function partesDeTopo(valor: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of valor) {
    if (c === "(") nivel++;
    else if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += c;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/** `0 1px 2px rgba(0,0,0,.1)` → forma estruturada; o que não casar volta nulo. */
function sombraDtcg(valor: string): Record<string, unknown> | null {
  const camadas: Array<Record<string, unknown>> = [];
  for (const parte of partesDeTopo(valor)) {
    if (/^(none|inset)\b/.test(parte)) return null;
    const cor = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))\s*$/.exec(parte);
    if (!cor?.[1]) return null;
    const medidas = parte.slice(0, cor.index).trim().split(/\s+/).filter(Boolean);
    if (medidas.length < 2 || medidas.length > 4) return null;
    const dims = medidas.map(dimensaoDtcg);
    if (dims.some((d) => d === null)) return null;
    const corEstruturada = corDtcg(cor[1]);
    if (!corEstruturada) return null;
    camadas.push({
      offsetX: dims[0],
      offsetY: dims[1],
      blur: dims[2] ?? { value: 0, unit: "px" },
      spread: dims[3] ?? { value: 0, unit: "px" },
      color: corEstruturada,
    });
  }
  if (!camadas.length) return null;
  return (camadas.length === 1 ? camadas[0] : camadas) as Record<string, unknown>;
}

function familiaDtcg(valor: string): string[] {
  return partesDeTopo(valor).map((f) => f.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

/**
 * Traduz o sistema lido do CSS para o formato do W3C. Um token que aponta para outro
 * com `var()` vira referência `{grupo.nome}`, que é como o formato expressa alias —
 * assim a intenção de "esta cor É aquela" sobrevive à exportação.
 */
export function paraDtcg(sistema: SistemaDeDesign): ExportacaoDtcg {
  const ignorados: TokenIgnorado[] = [];
  const caminhoDe = new Map<string, string>();
  for (const t of sistema.tokens) caminhoDe.set(t.nome, `${GRUPO_DTCG[t.categoria]}.${chaveDtcg(t.nome)}`);

  const documento: Record<string, Record<string, unknown>> = {};
  for (const t of sistema.tokens) {
    const grupo = GRUPO_DTCG[t.categoria];
    const bruto = t.valor.trim();
    let tipo: string | null = null;
    let valor: unknown = null;

    const alias = /^var\(\s*(--[\w-]+)/.exec(bruto);
    if (alias?.[1]) {
      // Alias só se sustenta se o alvo também sair no arquivo; apontar para um token
      // ausente geraria referência quebrada na ferramenta que for ler isto.
      const destino = caminhoDe.get(alias[1]);
      if (!destino) {
        ignorados.push({ nome: t.nome, motivo: `aponta para ${alias[1]}, que nenhum arquivo lido declara` });
        continue;
      }
      valor = `{${destino}}`;
    } else if (t.categoria === "fonte" || /^--font-family/i.test(t.nome)) {
      tipo = "fontFamily";
      valor = familiaDtcg(bruto);
    } else if (t.categoria === "sombra") {
      tipo = "shadow";
      valor = sombraDtcg(bruto);
      if (!valor) {
        ignorados.push({ nome: t.nome, motivo: "sombra que o formato não representa sem adivinhação: " + bruto });
        continue;
      }
    } else if (t.rgb || paraRgb(bruto)) {
      tipo = "color";
      valor = corDtcg(bruto);
      if (!valor) {
        ignorados.push({ nome: t.nome, motivo: "cor que não consegui normalizar: " + bruto });
        continue;
      }
    } else if (/^--font-weight/i.test(t.nome) && /^\d{3}$/.test(bruto)) {
      tipo = "fontWeight";
      valor = Number(bruto);
    } else {
      const dim = dimensaoDtcg(bruto);
      if (dim) {
        tipo = "dimension";
        valor = dim;
      } else if (/^-?[\d.]+$/.test(bruto)) {
        tipo = "number";
        valor = Number(bruto);
      } else {
        const medida = /^-?[\d.]+(em|%|vh|vw|ch|ex|pt|cm|mm|in)$/.test(bruto);
        ignorados.push({
          nome: t.nome,
          motivo: medida
            ? `o formato só aceita px e rem em medida; este vale ${bruto}`
            : `valor composto, que o formato não tipa sem adivinhação: ${bruto}`,
        });
        continue;
      }
    }

    documento[grupo] ??= { $description: DESCRICAO_GRUPO[grupo] ?? grupo };
    const entrada: Record<string, unknown> = tipo ? { $type: tipo, $value: valor } : { $value: valor };
    if (t.intencao) entrada["$description"] = t.intencao;
    entrada["$extensions"] = { "dev.anotador": { css: t.nome, origem: `${t.arquivo}:${t.linha}` } };
    documento[grupo]![chaveDtcg(t.nome)] = entrada;
  }

  return { documento: { $schema: "https://tr.designtokens.org/format/", ...documento }, ignorados };
}
