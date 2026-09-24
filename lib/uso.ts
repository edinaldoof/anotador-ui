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
// Ficou de fora o que exige gente, não código: tempo até o primeiro protótipo, NPS do
// time, o processo de RFC. Um analisador que fingisse medir isso seria vaidade.

import { catalogoDeComponentes, nomesConhecidos, type ComponenteDoProjeto } from "./componentes.ts";
import { emPixels, type CategoriaToken, type SistemaDeDesign } from "./design.ts";
import type { ArquivoFonte } from "./fonte.ts";
import { conferirValor } from "./valores.ts";

export interface LiteralNoCodigo {
  valor: string;
  categoria: "cor" | "espaco" | "texto" | "raio";
  usos: number;
  onde: string[];
  /** Token do projeto para o valor, quando há um só que sirva. */
  usar: string | null;
  /** Vários tokens com o mesmo valor e papéis diferentes: a escolha é de papel. */
  papeis: string[];
  /** Medida fora do passo ou da escala declarada. */
  foraDaEscala: boolean;
  proximo: string | null;
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
const DECLARACAO_CSS = /(?<![\w-])(color|background(?:-color)?|border(?:-[a-z]+)?-color|border|fill|stroke|outline-color|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|font-size|border-radius)\s*:\s*([^;{}]+)/g;

function categoriaDaUtilitaria(prefixo: string): LiteralNoCodigo["categoria"] {
  if (prefixo === "text") return "texto";
  if (prefixo.startsWith("rounded")) return "raio";
  return "espaco";
}
function categoriaDaPropriedade(prop: string): LiteralNoCodigo["categoria"] | "cor" {
  if (prop === "font-size") return "texto";
  if (prop === "border-radius") return "raio";
  if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) return "espaco";
  return "cor";
}

function literaisDoArquivo(a: ArquivoFonte): Array<{ valor: string; categoria: LiteralNoCodigo["categoria"]; linha: number }> {
  const achados: Array<{ valor: string; categoria: LiteralNoCodigo["categoria"]; linha: number }> = [];
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
        else for (const m of valor.matchAll(/-?[\d.]+(?:px|rem)\b/g)) if (emPixels(m[0])) achados.push({ valor: m[0], categoria: cat, linha: i + 1 });
      }
      return;
    }
    for (const m of texto.matchAll(ARBITRARIO_MEDIDA)) if (m[1] && m[2]) achados.push({ valor: m[2], categoria: categoriaDaUtilitaria(m[1]), linha: i + 1 });
    for (const m of texto.matchAll(ARBITRARIO_COR)) if (m[1]) achados.push({ valor: m[1], categoria: "cor", linha: i + 1 });
    if (/\.(tsx|jsx)$/.test(a.relativo)) for (const m of texto.matchAll(COR_EM_TEXTO)) if (m[1] && !texto.includes("-[" + m[1])) achados.push({ valor: m[1], categoria: "cor", linha: i + 1 });
  });
  return achados;
}

// Escala de texto padrão do Tailwind. Projeto que não declara a sua usa esta — é o que
// `text-xs`, `text-sm` resolvem —, então é contra ela que um `text-[11px]` escapa.
const ESCALA_TEXTO_TAILWIND: Array<[number, string]> = [[12, "text-xs"], [14, "text-sm"], [16, "text-base"], [18, "text-lg"], [20, "text-xl"], [24, "text-2xl"], [30, "text-3xl"], [36, "text-4xl"], [48, "text-5xl"], [60, "text-6xl"]];

function usaTailwind(arquivos: ArquivoFonte[]): boolean {
  return arquivos.some((a) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(a.relativo) || /\.(css|scss)$/.test(a.relativo) && a.linhas.some((l) => /@import\s+["']tailwindcss|@tailwind\s/.test(l)));
}

function literaisNoCodigo(arquivos: ArquivoFonte[], sistema: SistemaDeDesign): LiteralNoCodigo[] {
  const tailwind = usaTailwind(arquivos);
  const grupos = new Map<string, { valor: string; categoria: LiteralNoCodigo["categoria"]; onde: string[]; usos: number }>();
  for (const a of arquivos) {
    if (!CODIGO.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    for (const l of literaisDoArquivo(a)) {
      // `text-[11px]` e `text-[0.6875rem]` são o mesmo tamanho escrito de dois jeitos.
      const px = l.categoria === "cor" ? null : emPixels(l.valor);
      const chave = l.categoria + ":" + (px !== null && px !== undefined ? px + "px" : l.valor.toLowerCase().replace(/\s+/g, ""));
      const g = grupos.get(chave) ?? { valor: px !== null && px !== undefined ? `${Math.round(px * 100) / 100}px` : l.valor, categoria: l.categoria, onde: [], usos: 0 };
      g.usos++;
      if (g.onde.length < 3) g.onde.push(`${a.relativo}:${l.linha}`);
      grupos.set(chave, g);
    }
  }
  return [...grupos.values()].map((g) => {
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
  const total = r.literais.reduce((t, l) => t + l.usos, 0);
  if (!total) { linhas.push("  valores literais no código: nenhum"); return linhas; }
  linhas.push(`  valores literais no código: ${total} em ${r.literais.length} valor(es) distintos`);
  for (const l of r.literais.slice(0, 12)) {
    const conselho = l.usar ? `use ${l.usar}` : l.papeis.length ? `${l.papeis.length} tokens com esse valor — escolha pelo papel` : l.proximo ? `sem token; o mais perto é ${l.proximo}` : "sem token no sistema";
    // Abaixo de 12px o texto deixa de ser legível em tela pequena — a mesma régua da medida da página.
    const miudo = l.categoria === "texto" && (emPixels(l.valor) ?? 99) < 12 ? " · abaixo de 12px" : "";
    linhas.push(`    ${l.valor} (${l.categoria}) ×${l.usos}${l.foraDaEscala ? " · fora da escala" : ""}${miudo} — ${conselho}  [${l.onde[0]}]`);
  }
  if (r.literais.length > 12) linhas.push(`    … e mais ${r.literais.length - 12} valor(es)`);
  return linhas;
}
