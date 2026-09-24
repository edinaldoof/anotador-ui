// O sistema em uso: o quanto o produto de fato usa o sistema de design que declara.
//
// `lib/design.ts` audita o que o CSS declara; isto olha o outro lado, o código das telas.
// Três medidas do playbook do designsystems.one que um analisador de código consegue
// fazer sem opinião:
//
// - "Tokens, não valores": valor literal espalhado pelo código ("#4f46e5 em 137
//   lugares"), cada um com o token que já existe para ele — ou o aviso de que não há.
// - "A única métrica de adoção que importa: a porcentagem das telas que usa o sistema."
//   Aqui, contando elemento cru (`<button>`) contra o componente do sistema que existe
//   para o mesmo papel (`<Button>`), por tela.
// - O anti-padrão que abre o capítulo dos dez componentes certos: componente construído
//   e que o produto não usa.
//
// Dos fundamentos do mesmo site (cor, tipografia, espaço, movimento), o que o código
// deixa conferir: duração e curva escritas à mão onde o sistema tem token, a escada de
// quatro pesos, entreletra e entrelinha soltas — o mesmo rótulo em caixa-alta com seis
// espaçamentos de letra é um papel escrito de seis jeitos — e animação sem variante para
// quem pediu movimento reduzido.
//
// Ficou de fora o que exige gente, não código: tempo até o primeiro protótipo, NPS do
// time, o processo de RFC. Um analisador que fingisse medir isso seria vaidade.

import { catalogoDeComponentes, nomesConhecidos, type ComponenteDoProjeto } from "./componentes.ts";
import { emMs, emPixels, type CategoriaToken, type SistemaDeDesign } from "./design.ts";
import type { ArquivoFonte } from "./fonte.ts";
import { conferirValor } from "./valores.ts";

export type CategoriaLiteral = "cor" | "espaco" | "texto" | "raio" | "movimento" | "entreletra" | "entrelinha";

export interface LiteralNoCodigo {
  valor: string;
  categoria: CategoriaLiteral;
  usos: number;
  onde: string[];
  /** Token do projeto para o valor, quando há um só que sirva. */
  usar: string | null;
  /** Vários tokens com o mesmo valor e papéis diferentes: a escolha é de papel. */
  papeis: string[];
  /** Medida fora do passo ou da escala declarada. */
  foraDaEscala: boolean;
  proximo: string | null;
  /** Entreletra: quantos usos estão em texto caixa-alta — rótulo, sobretítulo. */
  caixaAlta?: number;
  /** Duração acima dos 500ms do orçamento do playbook, fora de animação em loop. */
  acimaDoOrcamento?: boolean;
}

export interface PesoEmUso { peso: number; usos: number }
export interface MovimentoReduzido {
  /** Um `@media (prefers-reduced-motion: reduce)` com `*` que desliga tudo de uma vez. */
  pisoGlobal: string | null;
  tratadas: number;
  semVariante: number;
  quais: Array<{ nome: string; usos: number }>;
  onde: string[];
}

export interface CoberturaElemento { elemento: string; componente: string; cru: number; doSistema: number }
export interface CoberturaSuperficie { superficie: string; cru: number; doSistema: number }
export interface NucleoPlaybook { componente: string; noProjeto: string | null }

export interface RelatorioUso {
  literais: LiteralNoCodigo[];
  cobertura: CoberturaElemento[];
  porSuperficie: CoberturaSuperficie[];
  semUso: ComponenteDoProjeto[];
  nucleo: NucleoPlaybook[];
  pesos: PesoEmUso[];
  movimentoReduzido: MovimentoReduzido;
  /** Durações que o sistema declara como token, em ms. */
  duracoes: number[];
}

const PRODUTO = /\.(tsx|jsx)$/;
const CODIGO = /\.(tsx|jsx|ts|js|css|scss)$/;
const DE_EXERCICIO = /\.(stories|test|spec)\.[jt]sx?$|(^|\/)(tests?|__tests__|e2e)\//;
/** A pasta dos primitivos é onde o elemento cru mora de propósito: é ali que o sistema é feito. */
const DO_SISTEMA = /(^|\/)ui\//;

// ---------------------------------------------------------------------------
// Valores literais
// ---------------------------------------------------------------------------

// Utilitárias do Tailwind com valor arbitrário, por categoria. Largura, altura e posição
// ficam de fora: dimensão de layout raramente é token, e contá-las só faria barulho.
const ARBITRARIO_MEDIDA = /(?<![\w-])(p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]|text|rounded(?:-[a-z]{1,2})?)-\[(-?[\d.]+(?:px|rem))\]/g;
const ARBITRARIO_COR = /(?<![\w-])(?:bg|text|border(?:-[a-z])?|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|placeholder|caret|accent)-\[(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch)\([^\]]*\))\]/g;
// Em style de JSX e em JS: só o valor entre aspas, que é onde uma cor literal mora.
const COR_EM_TEXTO = /["'`](#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{8}|(?:rgba?|hsla?|oklch)\([^)"'`]*\))["'`]/g;
// Em CSS: declarações comuns, nunca a definição de um token (`--x: …`) — o lookbehind
// impede casar `color:` dentro de `--brand-color:`. Várias por linha: `.a { padding: 12px; font-size: 14px; }`.
const DECLARACAO_CSS = /(?<![\w-])(color|background(?:-color)?|border(?:-[a-z]+)?-color|border|fill|stroke|outline-color|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|font-size|border-radius|transition(?:-duration|-timing-function)?|animation(?:-duration|-timing-function)?|letter-spacing|line-height)\s*:\s*([^;{}]+)/g;
// Tipografia e movimento no Tailwind. `duration-200` só é literal no Tailwind 4, onde
// compila para o número solto; `p-4` passa por `--spacing` e `ease-out`, por `--ease-out`.
const DURACAO_TW = /(?<![\w-])duration-(\d+|\[\d*\.?\d+m?s\])(?![\w-])/g;
const CURVA_TW = /(?<![\w-])ease-\[(cubic-bezier\([^\]]+\))\]/g;
const ENTRELETRA_TW = /(?<![\w-])tracking-\[(-?\d*\.?\d+(?:em|px|rem))\]/g;
const ENTRELINHA_TW = /(?<![\w-])leading-\[(\d*\.?\d+(?:px|rem|em)?)\]/g;
const TEMPO = /(?<![\w.-])(\d*\.?\d+m?s)(?![\w-])/;

type LiteralLido = { valor: string; categoria: CategoriaLiteral; linha: number; laco?: boolean; caixaAlta?: boolean };

function categoriaDaUtilitaria(prefixo: string): CategoriaLiteral {
  if (prefixo === "text") return "texto";
  if (prefixo.startsWith("rounded")) return "raio";
  return "espaco";
}
function categoriaDaPropriedade(prop: string): CategoriaLiteral {
  if (prop === "font-size") return "texto";
  if (prop === "border-radius") return "raio";
  if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) return "espaco";
  if (/^(transition|animation)/.test(prop)) return "movimento";
  if (prop === "letter-spacing") return "entreletra";
  if (prop === "line-height") return "entrelinha";
  return "cor";
}

/** `0.10em` → `0.1em`, `.08em` → `0.08em`: o mesmo valor escrito de dois jeitos é um só. */
function normalizarMedida(v: string): string {
  const m = /^(-?)(\d*\.?\d+)([a-z%]*)$/.exec(v.trim());
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : v.trim();
}

/**
 * Duração, curva ou nada, de um pedaço de `transition`/`animation`. Abaixo de 1ms é
 * desligar, não duração: o `0.01ms` do piso de movimento reduzido é o jeito certo de
 * parar tudo, não um valor escrito à mão.
 */
function movimentoDaDeclaracao(valor: string, linha: number): LiteralLido[] {
  const lidos: LiteralLido[] = [];
  for (const c of valor.matchAll(/cubic-bezier\([^)]*\)/gi)) lidos.push({ valor: c[0].replace(/\s+/g, "").toLowerCase(), categoria: "movimento", linha });
  for (const parte of valor.replace(/cubic-bezier\([^)]*\)/gi, "curva").split(",")) {
    const tempo = TEMPO.exec(parte);
    if (tempo?.[1] && (emMs(tempo[1]) ?? 0) >= 1) lidos.push({ valor: tempo[1], categoria: "movimento", linha, laco: /\binfinite\b/.test(parte) });
  }
  return lidos;
}

function literaisDoArquivo(a: ArquivoFonte, tailwind4: boolean): LiteralLido[] {
  const achados: LiteralLido[] = [];
  const css = /\.(css|scss)$/.test(a.relativo);
  a.linhas.forEach((texto, i) => {
    const t = texto.trim();
    // Definição de token, comentário e import não são uso de valor.
    if (!t || /^--[\w-]+\s*:/.test(t) || /^(\/\/|\/\*|\*|import\s)/.test(t)) return;
    if (css) {
      for (const d of texto.matchAll(DECLARACAO_CSS)) {
        if (!d[1] || !d[2]) continue;
        const cat = categoriaDaPropriedade(d[1]);
        // O que está dentro de var() já é token; só o resto da declaração é literal.
        const valor = d[2].replace(/var\([^)]*\)/g, " ");
        if (cat === "cor") for (const m of valor.matchAll(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/g)) achados.push({ valor: m[0], categoria: "cor", linha: i + 1 });
        else if (cat === "movimento") achados.push(...movimentoDaDeclaracao(valor, i + 1));
        else if (cat === "entreletra") { for (const m of valor.matchAll(/-?\d*\.?\d+(?:em|px|rem)\b/g)) if (Number.parseFloat(m[0])) achados.push({ valor: normalizarMedida(m[0]), categoria: cat, linha: i + 1 }); }
        else if (cat === "entrelinha") { const m = /^\s*(\d*\.?\d+(?:px|rem|em|%)?)\s*(?:!important)?\s*$/.exec(valor); if (m?.[1]) achados.push({ valor: normalizarMedida(m[1]), categoria: cat, linha: i + 1 }); }
        else for (const m of valor.matchAll(/-?[\d.]+(?:px|rem)\b/g)) if (emPixels(m[0])) achados.push({ valor: m[0], categoria: cat, linha: i + 1 });
      }
      return;
    }
    for (const m of texto.matchAll(ARBITRARIO_MEDIDA)) if (m[1] && m[2]) achados.push({ valor: m[2], categoria: categoriaDaUtilitaria(m[1]), linha: i + 1 });
    for (const m of texto.matchAll(ARBITRARIO_COR)) if (m[1]) achados.push({ valor: m[1], categoria: "cor", linha: i + 1 });
    if (/\.(tsx|jsx)$/.test(a.relativo)) for (const m of texto.matchAll(COR_EM_TEXTO)) if (m[1] && !texto.includes("-[" + m[1])) achados.push({ valor: m[1], categoria: "cor", linha: i + 1 });
    for (const m of texto.matchAll(DURACAO_TW)) {
      const bruto = m[1]?.startsWith("[") ? m[1].slice(1, -1) : tailwind4 ? `${m[1]}ms` : null;
      if (bruto && emMs(bruto)) achados.push({ valor: bruto, categoria: "movimento", linha: i + 1 });
    }
    for (const m of texto.matchAll(CURVA_TW)) if (m[1]) achados.push({ valor: m[1].replace(/_/g, "").toLowerCase(), categoria: "movimento", linha: i + 1 });
    // O rótulo em caixa-alta é onde a entreletra costuma escapar: guardar isso diz se os
    // valores diferentes são um papel só.
    const caixaAlta = /(?<![\w-])uppercase(?![\w-])/.test(texto);
    for (const m of texto.matchAll(ENTRELETRA_TW)) if (m[1]) achados.push({ valor: normalizarMedida(m[1]), categoria: "entreletra", linha: i + 1, caixaAlta });
    for (const m of texto.matchAll(ENTRELINHA_TW)) if (m[1]) achados.push({ valor: normalizarMedida(m[1]), categoria: "entrelinha", linha: i + 1 });
  });
  return achados;
}

// Os padrões do Tailwind para entreletra e entrelinha: sem token do projeto, é a escala
// contra a qual um valor solto escapa. `leading-5` é 20px; `leading-relaxed`, 1.625.
const ENTRELETRA_TAILWIND: Array<[number, string]> = [[-0.05, "tracking-tighter"], [-0.025, "tracking-tight"], [0, "tracking-normal"], [0.025, "tracking-wide"], [0.05, "tracking-wider"], [0.1, "tracking-widest"]];
const ENTRELINHA_TAILWIND: Array<[number, string]> = [[1, "leading-none"], [1.25, "leading-tight"], [1.375, "leading-snug"], [1.5, "leading-normal"], [1.625, "leading-relaxed"], [2, "leading-loose"]];

/** Token do projeto (`--tracking-*`, `--leading-*`) ou degrau do Tailwind para entreletra e entrelinha. */
function conferirTipografia(sistema: SistemaDeDesign, valor: string, categoria: "entreletra" | "entrelinha", tailwind: boolean): { usar: string | null; proximo: string | null } {
  const prefixo = categoria === "entreletra" ? /^--(tracking|letter-spacing)/i : /^--(leading|line-height)/i;
  const token = sistema.tokens.find((t) => prefixo.test(t.nome) && normalizarMedida(t.valor) === valor);
  if (token) return { usar: `var(${token.nome})`, proximo: null };
  if (!tailwind) return { usar: null, proximo: null };
  const n = Number.parseFloat(valor), px = /rem$/.test(valor) ? n * 16 : /px$/.test(valor) ? n : NaN;
  if (categoria === "entrelinha" && px % 4 === 0 && px >= 12 && px <= 40) return { usar: `leading-${px / 4}`, proximo: null };
  const escala = categoria === "entreletra" ? (/em$/.test(valor) ? ENTRELETRA_TAILWIND : []) : (/^[\d.]+$/.test(valor) ? ENTRELINHA_TAILWIND : []);
  const exato = escala.find(([v]) => Math.abs(v - n) < 0.0001);
  if (exato) return { usar: exato[1], proximo: null };
  const perto = [...escala].sort((a, b) => Math.abs(a[0] - n) - Math.abs(b[0] - n))[0];
  return { usar: null, proximo: perto ? `${perto[1]} (${perto[0]}${categoria === "entreletra" ? "em" : ""})` : null };
}

// Escala de texto padrão do Tailwind. Projeto que não declara a sua usa esta — é o que
// `text-xs`, `text-sm` resolvem —, então é contra ela que um `text-[11px]` escapa.
const ESCALA_TEXTO_TAILWIND: Array<[number, string]> = [[12, "text-xs"], [14, "text-sm"], [16, "text-base"], [18, "text-lg"], [20, "text-xl"], [24, "text-2xl"], [30, "text-3xl"], [36, "text-4xl"], [48, "text-5xl"], [60, "text-6xl"]];

function usaTailwind(arquivos: ArquivoFonte[]): boolean {
  return arquivos.some((a) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(a.relativo) || /\.(css|scss)$/.test(a.relativo) && a.linhas.some((l) => /@import\s+["']tailwindcss|@tailwind\s/.test(l)));
}
function usaTailwind4(arquivos: ArquivoFonte[]): boolean {
  return arquivos.some((a) => /\.(css|scss)$/.test(a.relativo) && a.linhas.some((l) => /@import\s+["']tailwindcss/.test(l)));
}

function literaisNoCodigo(arquivos: ArquivoFonte[], sistema: SistemaDeDesign): LiteralNoCodigo[] {
  const tailwind = usaTailwind(arquivos), tailwind4 = usaTailwind4(arquivos);
  const grupos = new Map<string, { valor: string; categoria: CategoriaLiteral; onde: string[]; usos: number; caixaAlta: number; foraDeLaco: number }>();
  for (const a of arquivos) {
    if (!CODIGO.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    for (const l of literaisDoArquivo(a, tailwind4)) {
      // `text-[11px]` e `text-[0.6875rem]` são o mesmo tamanho escrito de dois jeitos;
      // `0.2s` e `200ms`, a mesma duração.
      const px = ["cor", "movimento", "entreletra", "entrelinha"].includes(l.categoria) ? null : emPixels(l.valor);
      const ms = l.categoria === "movimento" ? emMs(l.valor) : undefined;
      const normal = px !== null && px !== undefined ? `${Math.round(px * 100) / 100}px` : ms !== undefined ? `${ms}ms` : null;
      const chave = l.categoria + ":" + (normal ?? l.valor.toLowerCase().replace(/\s+/g, ""));
      const g = grupos.get(chave) ?? { valor: normal ?? l.valor, categoria: l.categoria, onde: [], usos: 0, caixaAlta: 0, foraDeLaco: 0 };
      g.usos++;
      if (l.caixaAlta) g.caixaAlta++;
      if (!l.laco) g.foraDeLaco++;
      if (g.onde.length < 3) g.onde.push(`${a.relativo}:${l.linha}`);
      grupos.set(chave, g);
    }
  }
  return [...grupos.values()].map(({ caixaAlta, foraDeLaco, ...g }): LiteralNoCodigo => {
    if (g.categoria === "entreletra" || g.categoria === "entrelinha") {
      const t = conferirTipografia(sistema, g.valor, g.categoria, tailwind);
      return { ...g, usar: t.usar, papeis: [], foraDaEscala: !t.usar, proximo: t.proximo, ...(g.categoria === "entreletra" ? { caixaAlta } : {}) };
    }
    if (g.categoria === "movimento") {
      const r = conferirValor(sistema, g.valor, "movimento");
      const ms = emMs(g.valor);
      const proximos = (r["proximos"] as Array<{ nome: string; ms?: number }> | undefined) ?? [];
      return {
        ...g, usar: typeof r["usar"] === "string" ? r["usar"] : null, papeis: ((r["papeis"] as Array<{ nome: string }> | undefined) ?? []).map((t) => t.nome),
        foraDaEscala: false, proximo: proximos[0] ? `${proximos[0].nome}${proximos[0].ms !== undefined ? ` (${proximos[0].ms}ms)` : ""}` : null,
        // Um spinner de 1s em loop não é transição lenta: o orçamento vale para o que termina.
        acimaDoOrcamento: ms !== undefined && ms > 500 && foraDeLaco > 0,
      };
    }
    const r = conferirValor(sistema, g.valor, g.categoria as CategoriaToken);
    const proximos = (r["proximos"] as Array<{ nome: string }> | undefined) ?? [];
    const temExato = ((r["exatos"] as unknown[] | undefined) ?? []).length > 0;
    let usar = typeof r["usar"] === "string" ? r["usar"] : null;
    let proximo = proximos[0] ? proximos[0].nome : null;
    // Valor que casa com um token declarado está no sistema, mesmo fora do passo: o
    // projeto decidiu que aquele meio-passo existe.
    let foraDaEscala = r["naEscala"] === false && !temExato;
    const px = emPixels(g.valor);
    if (g.categoria === "texto" && !temExato && !sistema.escalaDeTexto.length && tailwind && px !== undefined) {
      const exato = ESCALA_TEXTO_TAILWIND.find(([t]) => Math.abs(t - px) < 0.01);
      if (exato) usar = exato[1];
      else {
        foraDaEscala = true;
        const perto = [...ESCALA_TEXTO_TAILWIND].sort((a, b) => Math.abs(a[0] - px) - Math.abs(b[0] - px))[0];
        if (perto) proximo = `${perto[1]} (${perto[0]}px)`;
      }
    }
    return { ...g, usar, papeis: ((r["papeis"] as Array<{ nome: string }> | undefined) ?? []).map((t) => t.nome), foraDaEscala, proximo };
  }).sort((a, b) => b.usos - a.usos || a.valor.localeCompare(b.valor));
}

// ---------------------------------------------------------------------------
// Cobertura: elemento cru contra o componente do sistema que existe para o papel
// ---------------------------------------------------------------------------

// Um elemento cru só conta contra a cobertura se o sistema tem o equivalente: botão cru
// num projeto sem Button não é falta de adoção, é componente que ainda não existe.
const EQUIVALENTES: Array<{ elemento: string; padrao: RegExp; componentes: string[]; descartar?: RegExp }> = [
  { elemento: "button", padrao: /<button(?=[\s/>]|$)/g, componentes: ["Button"] },
  // input escondido carrega dado de formulário, não é controle: não tem equivalente visual.
  { elemento: "input", padrao: /<input(?=[\s/>]|$)[^>]*/g, componentes: ["Input", "MaskedInput", "PasswordInput", "Checkbox", "FileInput", "PhoneInput", "RadioGroup", "Switch"], descartar: /type\s*=\s*["']hidden["']/ },
  { elemento: "select", padrao: /<select(?=[\s/>]|$)/g, componentes: ["Select", "SelectField", "Combobox"] },
  { elemento: "textarea", padrao: /<textarea(?=[\s/>]|$)/g, componentes: ["Textarea"] },
  { elemento: "table", padrao: /<table(?=[\s/>]|$)/g, componentes: ["Table", "DataTable", "AdaptiveTable"] },
];

/** `app/(portal)/painel/page.tsx` → `painel`; `components/features/projetos/x.tsx` → `projetos`. */
export function superficieDe(relativo: string): string {
  const partes = relativo.replace(/^src\//, "").split("/");
  if (partes[0] === "app") {
    const rota = partes.slice(1, -1).filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("_"));
    return rota[0] ?? "raiz";
  }
  const feature = partes.indexOf("features");
  if (feature >= 0 && partes[feature + 1]) return partes[feature + 1] as string;
  if (partes[0] === "components" && partes[1]) return partes[1];
  return partes[0] ?? "outros";
}

function cobertura(arquivos: ArquivoFonte[], exportados: Set<string>): { cobertura: CoberturaElemento[]; porSuperficie: CoberturaSuperficie[] } {
  const ativos = EQUIVALENTES.map((e) => ({ ...e, doProjeto: e.componentes.filter((c) => exportados.has(c)) })).filter((e) => e.doProjeto.length);
  const total = new Map(ativos.map((e) => [e.elemento, { elemento: e.elemento, componente: e.doProjeto[0] as string, cru: 0, doSistema: 0 }]));
  const superficies = new Map<string, CoberturaSuperficie>();
  for (const a of arquivos) {
    if (!PRODUTO.test(a.relativo) || DE_EXERCICIO.test(a.relativo) || DO_SISTEMA.test(a.relativo)) continue;
    const texto = a.linhas.join("\n");
    const s = superficies.get(superficieDe(a.relativo)) ?? { superficie: superficieDe(a.relativo), cru: 0, doSistema: 0 };
    for (const e of ativos) {
      const t = total.get(e.elemento)!;
      const crus = [...texto.matchAll(e.padrao)].filter((m) => !e.descartar?.test(m[0])).length;
      const doSistema = [...texto.matchAll(new RegExp(`<(${e.doProjeto.join("|")})(?=[\\s/>.]|$)`, "gm"))].length;
      t.cru += crus; t.doSistema += doSistema; s.cru += crus; s.doSistema += doSistema;
    }
    if (s.cru || s.doSistema) superficies.set(s.superficie, s);
  }
  return {
    cobertura: [...total.values()].filter((t) => t.cru || t.doSistema),
    // As telas que mais escapam do sistema primeiro: é onde o trabalho está.
    porSuperficie: [...superficies.values()].filter((s) => s.cru > 0).sort((a, b) => b.cru - a.cru || a.superficie.localeCompare(b.superficie)),
  };
}

// ---------------------------------------------------------------------------
// Núcleo e componentes sem uso
// ---------------------------------------------------------------------------

/** Os dez do playbook, com os nomes que cada papel costuma ter num projeto de verdade. */
const NUCLEO: Array<[string, string[]]> = [
  ["Button", ["Button"]], ["Input", ["Input", "Field"]], ["Select", ["Select", "SelectField", "Combobox"]], ["Card", ["Card"]],
  ["Modal", ["Dialog", "Modal", "AlertDialog", "Sheet"]], ["Toast", ["Toaster", "SystemToaster", "Toast", "Sonner"]],
  ["Tabs", ["Tabs", "TabsList", "Tab"]], ["Table", ["Table", "DataTable", "AdaptiveTable"]], ["Badge", ["Badge"]], ["Tooltip", ["Tooltip"]],
];

// ---------------------------------------------------------------------------
// Tipografia e movimento no código
// ---------------------------------------------------------------------------

const PESOS_NOMEADOS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const PESO_TW = /(?<![\w-])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d{3}\])(?![\w-])/g;
const PESO_CSS = /(?<![\w-])font-weight\s*:\s*(\d{3}|bold|normal)\b/g;

/** Quantas vezes cada peso aparece no código: `font-semibold`, `font-[550]`, `font-weight: 600`. */
function pesosEmUso(arquivos: ArquivoFonte[]): PesoEmUso[] {
  const conta = new Map<number, number>();
  for (const a of arquivos) {
    if (!CODIGO.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    const css = /\.(css|scss)$/.test(a.relativo);
    for (const linha of a.linhas) {
      if (/^\s*(\/\/|\/\*|\*)/.test(linha)) continue;
      for (const m of linha.matchAll(css ? PESO_CSS : PESO_TW)) {
        const bruto = m[1] ?? "";
        const peso = bruto.startsWith("[") ? Number(bruto.slice(1, -1)) : PESOS_NOMEADOS[bruto] ?? (bruto === "bold" ? 700 : Number(bruto));
        if (Number.isFinite(peso) && peso > 0) conta.set(peso, (conta.get(peso) ?? 0) + 1);
      }
    }
  }
  return [...conta.entries()].map(([peso, usos]) => ({ peso, usos })).sort((a, b) => a.peso - b.peso);
}

const ANIMACAO_TW = /(?<![\w-])((?:[\w-]+:)*)animate-(?!none(?![\w-]))([\w-]+|\[[^\]]+\])/g;

/**
 * Animação que segue para quem pediu movimento reduzido. Conta como tratada a que tem
 * `motion-safe:` na frente, a que divide a linha com um `motion-reduce:` e a de CSS em
 * arquivo que tem `@media (prefers-reduced-motion)`. Um piso global — o `*` que zera
 * animação e transição — trata tudo de uma vez, e aí não há o que contar.
 */
function movimentoReduzido(arquivos: ArquivoFonte[]): MovimentoReduzido {
  let pisoGlobal: string | null = null;
  for (const a of arquivos) {
    if (!/\.(css|scss)$/.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    a.linhas.forEach((l, i) => {
      if (pisoGlobal || !/prefers-reduced-motion\s*:\s*reduce/.test(l)) return;
      const bloco = a.linhas.slice(i, i + 12).join("\n");
      if (/(^|[\s,{])\*(::?[\w-]+)?\s*[,{]/m.test(bloco) && /(animation|transition)(-duration)?\s*:/.test(bloco)) pisoGlobal = `${a.relativo}:${i + 1}`;
    });
  }
  const quais = new Map<string, number>();
  const onde: string[] = [];
  let tratadas = 0, semVariante = 0;
  for (const a of arquivos) {
    if (!CODIGO.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    const css = /\.(css|scss)$/.test(a.relativo);
    const cssComMedia = css && a.linhas.some((l) => /prefers-reduced-motion/.test(l));
    a.linhas.forEach((linha, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(linha)) return;
      const achadas: Array<{ nome: string; tratada: boolean }> = [];
      if (css) {
        const m = /(?<![\w-])animation(?:-name)?\s*:\s*([^;{}]+)/.exec(linha);
        if (m?.[1] && !/^\s*(none|initial|inherit|unset)\b/.test(m[1])) achadas.push({ nome: m[1].trim().split(/\s+/)[0] ?? "animation", tratada: cssComMedia });
      } else for (const m of linha.matchAll(ANIMACAO_TW)) achadas.push({ nome: `animate-${m[2]}`, tratada: /motion-safe:/.test(m[1] ?? "") || /(?<![\w-])motion-reduce:/.test(linha) });
      for (const x of achadas) {
        if (x.tratada || pisoGlobal) { tratadas++; continue; }
        semVariante++;
        quais.set(x.nome, (quais.get(x.nome) ?? 0) + 1);
        if (onde.length < 4) onde.push(`${a.relativo}:${i + 1}`);
      }
    });
  }
  return { pisoGlobal, tratadas, semVariante, quais: [...quais.entries()].map(([nome, usos]) => ({ nome, usos })).sort((a, b) => b.usos - a.usos || a.nome.localeCompare(b.nome)), onde };
}

export function analisarUso(arquivos: ArquivoFonte[], sistema: SistemaDeDesign): RelatorioUso {
  const catalogo = catalogoDeComponentes(arquivos);
  const exportados = new Set(catalogo.map((c) => c.nome));
  const conhecidos = nomesConhecidos(arquivos);
  return {
    literais: literaisNoCodigo(arquivos, sistema),
    ...cobertura(arquivos, exportados),
    semUso: catalogo.filter((c) => DO_SISTEMA.test(c.arquivo) && c.usos === 0).sort((a, b) => a.arquivo.localeCompare(b.arquivo)),
    // Do projeto primeiro; importado de biblioteca também serve — é o papel que importa.
    nucleo: NUCLEO.map(([componente, nomes]) => ({ componente, noProjeto: nomes.find((n) => exportados.has(n)) ?? nomes.find((n) => conhecidos.has(n)) ?? null })),
    pesos: pesosEmUso(arquivos),
    movimentoReduzido: movimentoReduzido(arquivos),
    duracoes: sistema.duracoes,
  };
}

function porcento(parte: number, todo: number): string {
  return todo ? Math.round((parte / todo) * 100) + "%" : "—";
}

/** O relatório em linhas de terminal, na ordem em que alguém decidiria o que fazer. */
export function linhasDoUso(r: RelatorioUso): string[] {
  const linhas: string[] = [];
  const presentes = r.nucleo.filter((n) => n.noProjeto);
  const faltam = r.nucleo.filter((n) => !n.noProjeto).map((n) => n.componente);
  linhas.push(`  núcleo do playbook: ${presentes.length} de 10${faltam.length ? ` — falta ${faltam.join(", ")}` : ""}`);
  if (r.cobertura.length) {
    const cru = r.cobertura.reduce((t, c) => t + c.cru, 0), doSistema = r.cobertura.reduce((t, c) => t + c.doSistema, 0);
    linhas.push(`  cobertura: ${porcento(doSistema, cru + doSistema)} dos controles usam o sistema (${doSistema} do sistema, ${cru} crus onde já existe o componente)`);
    for (const c of r.cobertura) linhas.push(`    <${c.elemento}> ${c.cru} cru(s) × ${c.doSistema} do sistema (${porcento(c.doSistema, c.cru + c.doSistema)}) — use ${c.componente}`);
    if (r.porSuperficie.length) linhas.push(`    onde mais escapa: ${r.porSuperficie.slice(0, 5).map((s) => `${s.superficie} (${s.cru} cru${s.cru > 1 ? "s" : ""}, ${porcento(s.doSistema, s.cru + s.doSistema)})`).join(" · ")}`);
  }
  if (r.semUso.length) linhas.push(`  componentes base sem uso no produto: ${r.semUso.map((c) => c.nome).join(", ")}`);
  if (r.pesos.length) {
    const entreDegraus = r.pesos.filter((p) => p.peso % 100 !== 0).map((p) => p.peso);
    const veredito = r.pesos.length > 4 ? `${r.pesos.length} pesos — o playbook fecha a escada em 4 (400, 500, 600, 700)` : entreDegraus.length ? `${entreDegraus.join(" e ")} fica entre dois degraus da escada` : `${r.pesos.length} peso(s), dentro do limite de 4 do playbook`;
    linhas.push(`  pesos em uso: ${r.pesos.map((p) => `${p.peso} ×${p.usos}`).join(" · ")} — ${veredito}`);
  }
  // Entreletra solta em vários valores quase sempre é um papel só — o sobretítulo em
  // caixa-alta — escrito de um jeito em cada tela.
  const letras = r.literais.filter((l) => l.categoria === "entreletra");
  if (letras.length >= 3) {
    const usos = letras.reduce((t, l) => t + l.usos, 0), altas = letras.reduce((t, l) => t + (l.caixaAlta ?? 0), 0);
    linhas.push(`  entreletra: ${letras.length} valores escritos à mão em ${usos} lugares (${letras.map((l) => l.valor).join(", ")})${altas ? `, ${altas} em texto caixa-alta` : ""} — ${altas / usos >= 0.8 ? `é o mesmo papel escrito de ${letras.length} jeitos; um token resolve` : "um token por papel resolve"}`);
  }
  // Movimento: o playbook quer duração e curva como tokens. O que escapa é pouco e some
  // no fim da lista de literais — aqui fica à vista, com o token que já existe.
  const movimento = r.literais.filter((l) => l.categoria === "movimento");
  if (r.duracoes.length || movimento.length) {
    const tokens = r.duracoes.length ? `tokens de ${r.duracoes.join(", ")}ms` : "nenhum token de duração";
    const soltos = movimento.length ? `à mão no código: ${movimento.map((l) => `${l.valor} ×${l.usos}${l.usar ? ` (use ${l.usar})` : l.acimaDoOrcamento ? " (acima de 500ms)" : ""}`).join(", ")}` : "nenhuma duração à mão no código";
    linhas.push(`  movimento: ${tokens}; ${soltos}${!r.duracoes.length && movimento.length ? " — o playbook pede duração e curva como tokens" : ""}`);
  }
  const mr = r.movimentoReduzido;
  if (mr.pisoGlobal) linhas.push(`  movimento reduzido: piso global em ${mr.pisoGlobal} — toda animação para com prefers-reduced-motion`);
  else if (mr.semVariante) linhas.push(`  movimento reduzido: ${mr.semVariante} animação(ões) sem variante (${mr.quais.map((q) => `${q.nome} ×${q.usos}`).join(", ")})${mr.tratadas ? `, ${mr.tratadas} com` : ""} — loop decorativo deveria parar e deslize ou zoom virar opacidade; indicador de carregamento pode ser essencial  [${mr.onde[0]}]`);
  else if (mr.tratadas) linhas.push(`  movimento reduzido: as ${mr.tratadas} animação(ões) têm variante`);
  const total = r.literais.reduce((t, l) => t + l.usos, 0);
  if (!total) { linhas.push("  valores literais no código: nenhum"); return linhas; }
  linhas.push(`  valores literais no código: ${total} em ${r.literais.length} valor(es) distintos`);
  for (const l of r.literais.slice(0, 12)) {
    const conselho = l.usar ? `use ${l.usar}` : l.papeis.length ? `${l.papeis.length} tokens com esse valor — escolha pelo papel` : l.proximo ? `sem token; o mais perto é ${l.proximo}` : "sem token no sistema";
    // Abaixo de 12px o texto deixa de ser legível em tela pequena — a mesma régua da medida da página.
    const miudo = l.categoria === "texto" && (emPixels(l.valor) ?? 99) < 12 ? " · abaixo de 12px" : "";
    const lento = l.acimaDoOrcamento ? " · acima de 500ms" : "";
    linhas.push(`    ${l.valor} (${l.categoria}) ×${l.usos}${l.foraDaEscala ? " · fora da escala" : ""}${miudo}${lento} — ${conselho}  [${l.onde[0]}]`);
  }
  if (r.literais.length > 12) linhas.push(`    … e mais ${r.literais.length - 12} valor(es)`);
  return linhas;
}
