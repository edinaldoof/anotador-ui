// Análise do código-fonte do projeto: onde cada elemento anotado provavelmente
// está e como traduzir a alteração de CSS computado para o idioma do projeto
// (classes Tailwind e tokens de tema), para o Claude aplicar sem adivinhar.

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";

const IGNORAR_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "output",
  "outputs",
  "coverage",
  ".turbo",
  ".cache",
  ".vercel",
  ".claude",
  ".idea",
  ".vscode",
  ".playwright",
  ".pnpm-store",
  ".yarn",
  "storybook-static",
  "test-results",
  "playwright-report",
  "__snapshots__",
  "artifacts",
  "reports",
  "backups",
  "backup",
  "tmp",
  "temp",
  "logs",
  "log",
  "vendor",
]);
const EXTENSOES = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".html", ".htm", ".css", ".scss", ".mdx", ".md", ".json"]);
const EXTENSOES_CODIGO = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".css", ".scss"];
const TAMANHO_MAX = 300 * 1024;
const LIMITE_ARQUIVOS = 8000;
const LOTE_LEITURA = 48;
const TTL_CACHE = 60_000;

export interface ArquivoFonte {
  relativo: string;
  linhas: string[];
}

const cacheProjetos = new Map<string, { em: number; arquivos: ArquivoFonte[] }>();

function ignorarArquivo(nome: string): boolean {
  if (!EXTENSOES.has(extname(nome))) return true;
  return /(^|\.)lock(\.json)?$|^package-lock\.json$|^pnpm-lock|\.min\.(js|css)$|\.map$/.test(nome);
}

export async function lerProjeto(raiz: string): Promise<ArquivoFonte[]> {
  const cache = cacheProjetos.get(raiz);
  if (cache && Date.now() - cache.em < TTL_CACHE) return cache.arquivos;
  const caminhos: string[] = [];
  const pilha = [raiz];
  while (pilha.length && caminhos.length < LIMITE_ARQUIVOS) {
    const dir = pilha.pop();
    if (!dir) break;
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      if (entrada.isDirectory()) {
        if (!IGNORAR_DIRS.has(entrada.name)) pilha.push(join(dir, entrada.name));
      } else if (entrada.isFile() && !ignorarArquivo(entrada.name)) {
        caminhos.push(join(dir, entrada.name));
      }
    }
  }
  const arquivos: ArquivoFonte[] = [];
  for (let i = 0; i < caminhos.length; i += LOTE_LEITURA) {
    const lidos = await Promise.all(
      caminhos.slice(i, i + LOTE_LEITURA).map(async (caminho): Promise<ArquivoFonte | null> => {
        try {
          const info = await stat(caminho);
          if (info.size > TAMANHO_MAX) return null;
          return { relativo: relative(raiz, caminho).split(sep).join("/"), linhas: (await readFile(caminho, "utf8")).split("\n") };
        } catch {
          return null;
        }
      })
    );
    for (const a of lidos) if (a) arquivos.push(a);
  }
  arquivos.sort((a, b) => a.relativo.localeCompare(b.relativo));
  cacheProjetos.set(raiz, { em: Date.now(), arquivos });
  return arquivos;
}

// ---------- rota → arquivos ----------
export interface ContextoRota {
  caminho: string;
  entradas: Set<string>;
  alcance: Set<string>;
}

const RE_PAGE = /(^|\/)app\/((?:[^/]+\/)*)page\.(tsx|jsx|ts|js|mdx)$/;
const RE_LAYOUT = /(^|\/)app\/((?:[^/]+\/)*)layout\.(tsx|jsx|ts|js)$/;
const RE_PAGES = /(^|\/)pages\/(.+)\.(tsx|jsx|ts|js|mdx)$/;

function segmentosDeRota(caminho: string): string[] {
  return caminho
    .split("?")[0]!
    .split("#")[0]!
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

// Segmentos de pasta do App Router sem grupos `(x)` e rotas paralelas `@x`.
function segmentosDePasta(pasta: string): string[] {
  return pasta
    .split("/")
    .filter(Boolean)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
}

function casaRota(pasta: string[], rota: string[]): boolean {
  for (let i = 0; i < pasta.length; i++) {
    const seg = pasta[i] ?? "";
    if (/^\[\.\.\..*\]$/.test(seg) || /^\[\[\.\.\..*\]\]$/.test(seg)) return true;
    if (i >= rota.length) return false;
    if (seg.startsWith("[") && seg.endsWith("]")) continue;
    if (seg !== rota[i]) return false;
  }
  return pasta.length === rota.length;
}

function resolverImport(spec: string, arquivo: string, baseAlias: string, existentes: Set<string>): string | null {
  let alvo: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) alvo = posix.normalize(posix.join(posix.dirname(arquivo), spec));
  else if (spec.startsWith("@/") || spec.startsWith("~/")) alvo = posix.join(baseAlias, spec.slice(2));
  else if (/^(src|app|components|lib|features|pages|styles|hooks|utils)\//.test(spec)) alvo = posix.join(baseAlias, spec);
  else return null;
  const candidatos = [alvo, ...EXTENSOES_CODIGO.map((e) => alvo + e), ...EXTENSOES_CODIGO.map((e) => posix.join(alvo ?? "", "index" + e))];
  if (alvo.startsWith(baseAlias) && baseAlias) {
    const semBase = alvo.slice(baseAlias.length);
    candidatos.push(...EXTENSOES_CODIGO.map((e) => posix.join(baseAlias, "src", semBase + e)));
  }
  return candidatos.find((c) => existentes.has(c)) ?? null;
}

const RE_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g;

export function arquivosDaRota(arquivos: ArquivoFonte[], caminho: string): ContextoRota | null {
  const rota = segmentosDeRota(caminho);
  const entradas = new Set<string>();
  for (const a of arquivos) {
    const page = RE_PAGE.exec(a.relativo);
    if (page && casaRota(segmentosDePasta(page[2] ?? ""), rota)) entradas.add(a.relativo);
    const pages = RE_PAGES.exec(a.relativo);
    if (pages?.[2]) {
      const partes = pages[2].replace(/\/index$/, "").split("/").filter((s) => s !== "index");
      if (!pages[2].startsWith("_") && !pages[2].startsWith("api/") && casaRota(partes, rota)) entradas.add(a.relativo);
    }
  }
  if (!entradas.size) return null;
  for (const a of arquivos) {
    const layout = RE_LAYOUT.exec(a.relativo);
    if (!layout) continue;
    const pastaLayout = segmentosDePasta(layout[2] ?? "");
    const prefixoApp = a.relativo.slice(0, a.relativo.indexOf("app/", Math.max(0, layout.index)));
    const cobre = Array.from(entradas).some((e) => e.startsWith(prefixoApp) && casaRota(pastaLayout, rota.slice(0, pastaLayout.length)));
    if (cobre && pastaLayout.length <= rota.length) entradas.add(a.relativo);
  }
  const existentes = new Set(arquivos.map((a) => a.relativo));
  const porNome = new Map(arquivos.map((a) => [a.relativo, a] as const));
  const alcance = new Set<string>();
  const fila: Array<{ arquivo: string; profundidade: number }> = Array.from(entradas).map((arquivo) => ({ arquivo, profundidade: 0 }));
  while (fila.length && alcance.size < 600) {
    const { arquivo, profundidade } = fila.shift()!;
    const conteudo = porNome.get(arquivo);
    if (!conteudo || profundidade > 6) continue;
    const idx = arquivo.search(/(^|\/)(app|pages)\//);
    const baseAlias = idx <= 0 ? "" : arquivo.slice(0, idx + 1);
    for (const linha of conteudo.linhas) {
      if (!/import|require|from/.test(linha)) continue;
      for (const m of linha.matchAll(RE_IMPORT)) {
        const destino = resolverImport(m[1] ?? "", arquivo, baseAlias, existentes);
        if (destino && !entradas.has(destino) && !alcance.has(destino)) {
          alcance.add(destino);
          fila.push({ arquivo: destino, profundidade: profundidade + 1 });
        }
      }
    }
  }
  return { caminho, entradas, alcance };
}

// ---------- localização ----------
interface Criterio {
  nome: string;
  pontos: number;
  testar: (linha: string) => boolean;
}

export interface AlvoBusca {
  id?: string;
  testid?: string;
  classes: string[];
  texto: string;
  componentes: string[];
}

const CLASSE_LIMITE = /[A-Za-z0-9_\-\[\]().:/%#!]/;

function contemClasse(linha: string, token: string): boolean {
  let pos = linha.indexOf(token);
  while (pos !== -1) {
    const antes = pos > 0 ? linha[pos - 1] ?? "" : "";
    const depois = linha[pos + token.length] ?? "";
    if (!CLASSE_LIMITE.test(antes) && !CLASSE_LIMITE.test(depois)) return true;
    pos = linha.indexOf(token, pos + 1);
  }
  return false;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function criteriosDe(alvo: AlvoBusca): Criterio[] {
  const criterios: Criterio[] = [];
  for (const [nome, valor] of [
    ["data-testid", alvo.testid],
    ["id", alvo.id],
  ] as Array<[string, string | undefined]>) {
    if (valor && valor.length >= 2) criterios.push({ nome, pontos: 100, testar: (l) => l.includes(`"${valor}"`) || l.includes(`'${valor}'`) || l.includes("`" + valor + "`") });
  }
  const classes = alvo.classes.filter((c) => c.length >= 2);
  if (classes.length) {
    const completa = classes.join(" ");
    criterios.push({ nome: "classes completas", pontos: 95, testar: (l) => l.includes(completa) });
    if (classes.length >= 3) {
      const minimo = Math.max(3, Math.ceil(classes.length * 0.6));
      criterios.push({
        nome: "classes",
        pontos: 60,
        testar: (l) => {
          let quantas = 0;
          for (const c of classes) if (contemClasse(l, c)) quantas++;
          return quantas >= minimo;
        },
      });
    }
  }
  const texto = alvo.texto.trim();
  if (texto.length >= 4 && texto.length <= 120) criterios.push({ nome: "texto", pontos: 80, testar: (l) => l.includes(texto) });
  for (const nome of alvo.componentes.slice(0, 3)) {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(nome)) continue;
    const re = new RegExp(`(function|const|let|class|interface)\\s+${escaparRegex(nome)}\\b|\\b${escaparRegex(nome)}\\s*=\\s*(\\(|React\\.|forwardRef|memo)|export\\s+default\\s+${escaparRegex(nome)}\\b`);
    criterios.push({ nome: `componente ${nome}`, pontos: 70, testar: (l) => re.test(l) });
  }
  return criterios;
}

export function localizar(arquivos: ArquivoFonte[], alvo: AlvoBusca, limite = 6, contexto: ContextoRota | null = null): Localizacao[] {
  const criterios = criteriosDe(alvo);
  if (!criterios.length) return [];
  const achados: Localizacao[] = [];
  const arquivosDeComponente = new Set<string>();
  for (const arquivo of arquivos) {
    for (let i = 0; i < arquivo.linhas.length; i++) {
      const linha = arquivo.linhas[i] ?? "";
      if (linha.length > 2000 || !linha.trim()) continue;
      const casados = criterios.filter((c) => c.testar(linha));
      if (!casados.length) continue;
      if (casados.some((c) => c.nome.startsWith("componente"))) arquivosDeComponente.add(arquivo.relativo);
      const melhor = Math.max(...casados.map((c) => c.pontos));
      const achado: Localizacao = {
        arquivo: arquivo.relativo,
        linha: i + 1,
        trecho: linha.trim().slice(0, 160),
        criterios: casados.map((c) => c.nome),
        pontos: Math.min(100, melhor + (casados.length - 1) * 5),
      };
      if (contexto && (contexto.entradas.has(arquivo.relativo) || contexto.alcance.has(arquivo.relativo))) achado.rota = true;
      achados.push(achado);
    }
  }
  for (const a of achados) {
    if (arquivosDeComponente.has(a.arquivo) && !a.criterios.every((c) => c.startsWith("componente"))) a.pontos = Math.min(100, a.pontos + 10);
  }
  achados.sort((a, b) => Number(!!b.rota) - Number(!!a.rota) || b.pontos - a.pontos || a.arquivo.localeCompare(b.arquivo) || a.linha - b.linha);
  const porArquivo = new Map<string, number>();
  const saida: Localizacao[] = [];
  for (const a of achados) {
    const n = porArquivo.get(a.arquivo) ?? 0;
    if (n >= 2) continue;
    porArquivo.set(a.arquivo, n + 1);
    saida.push(a);
    if (saida.length >= limite) break;
  }
  return saida;
}

// ---------- cores ----------
export type Rgb = [number, number, number];

function canal(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function gama(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function oklchParaRgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [canal(gama(r) * 255), canal(gama(g) * 255), canal(gama(bl) * 255)];
}

function hslParaRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [canal((r + m) * 255), canal((g + m) * 255), canal((b + m) * 255)];
}

function numeroOuPercentual(v: string, base: number): number {
  const t = v.trim();
  if (t.endsWith("%")) return (parseFloat(t) / 100) * base;
  return parseFloat(t);
}

export function paraRgb(valor: string): Rgb | null {
  const v = valor.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(v);
  if (rgb) return [canal(numeroOuPercentual(rgb[1] ?? "0", 255)), canal(numeroOuPercentual(rgb[2] ?? "0", 255)), canal(numeroOuPercentual(rgb[3] ?? "0", 255))];
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(v);
  if (hsl) return hslParaRgb(parseFloat(hsl[1] ?? "0"), parseFloat(hsl[2] ?? "0") / 100, parseFloat(hsl[3] ?? "0") / 100);
  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?/.exec(v);
  if (oklch) {
    const L = numeroOuPercentual(oklch[1] ?? "0", 1);
    const C = numeroOuPercentual(oklch[2] ?? "0", 0.4);
    return oklchParaRgb(L, C, parseFloat(oklch[3] ?? "0"));
  }
  const nomeadas: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0], transparent: [0, 0, 0] };
  return nomeadas[v] ?? null;
}

export function rgbTexto(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

export function rgbHex(rgb: Rgb): string {
  return "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("");
}

// Tokens de cor do projeto: `--nome: valor` em arquivos de estilo, com um nível de alias.
export function lerTokensCss(arquivos: ArquivoFonte[]): Map<string, string[]> {
  const brutos = new Map<string, string>();
  for (const arquivo of arquivos) {
    if (!/\.(css|scss)$/.test(arquivo.relativo)) continue;
    for (const linha of arquivo.linhas) {
      const m = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/.exec(linha);
      if (m?.[1] && m[2] && !brutos.has(m[1])) brutos.set(m[1], m[2].trim());
    }
  }
  const tokens = new Map<string, string[]>();
  for (const [nome, valorBruto] of brutos) {
    let valor = valorBruto;
    const alias = /^var\((--[A-Za-z0-9_-]+)\)$/.exec(valor);
    if (alias?.[1]) valor = brutos.get(alias[1]) ?? valor;
    const rgb = paraRgb(valor);
    if (!rgb) continue;
    const chave = rgbTexto(rgb);
    const lista = tokens.get(chave) ?? [];
    lista.push(nome);
    tokens.set(chave, lista);
  }
  return tokens;
}

export async function tailwindDoProjeto(raiz: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(raiz, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const versao = pkg.dependencies?.["tailwindcss"] ?? pkg.devDependencies?.["tailwindcss"];
    if (!versao) return null;
    const m = /(\d+)/.exec(versao);
    return m?.[1] ?? "?";
  } catch {
    return null;
  }
}

// ---------- tradução para Tailwind ----------
const TAMANHOS_FONTE: Array<[number, string]> = [
  [12, "xs"],
  [14, "sm"],
  [16, "base"],
  [18, "lg"],
  [20, "xl"],
  [24, "2xl"],
  [30, "3xl"],
  [36, "4xl"],
  [48, "5xl"],
  [60, "6xl"],
  [72, "7xl"],
  [96, "8xl"],
  [128, "9xl"],
];
const PESOS: Record<string, string> = { "100": "thin", "200": "extralight", "300": "light", "400": "normal", "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold", "900": "black" };
const ESPACOS = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);
const RAIOS_V4: Array<[number, string]> = [
  [2, "rounded-xs"],
  [4, "rounded-sm"],
  [6, "rounded-md"],
  [8, "rounded-lg"],
  [12, "rounded-xl"],
  [16, "rounded-2xl"],
  [24, "rounded-3xl"],
  [32, "rounded-4xl"],
];
const RAIOS_V3: Array<[number, string]> = [
  [2, "rounded-sm"],
  [4, "rounded"],
  [6, "rounded-md"],
  [8, "rounded-lg"],
  [12, "rounded-xl"],
  [16, "rounded-2xl"],
  [24, "rounded-3xl"],
];
const PREFIXO_LADO: Record<string, string> = {
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "margin-top": "mt",
  "margin-right": "mr",
  "margin-bottom": "mb",
  "margin-left": "ml",
  gap: "gap",
  width: "w",
  height: "h",
};
const RE_COR_TEXTO = /^text-(?!(xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$)(?!\[\d)[\w\-[\]()#%./]+$/;
const GOVERNA: Record<string, RegExp> = {
  color: RE_COR_TEXTO,
  "background-color": /^bg-(?!(cover|contain|auto|fixed|local|scroll|repeat|no-repeat|clip-|origin-|none|gradient|linear|radial|conic))[\w\-[\]()#%./]+$/,
  "font-size": /^text-(xs|sm|base|lg|xl|\dxl|\[[\d.]+(px|rem|em)\])$/,
  "font-weight": /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/,
  "font-family": /^font-(?!(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$)[\w-]+$/,
  "line-height": /^leading-/,
  "letter-spacing": /^tracking-/,
  "text-align": /^text-(left|center|right|justify|start|end)$/,
  "border-radius": /^rounded(-|$)/,
  "border-width": /^border(-\d+|-\[[\d.]+px\])?$|^border-(x|y|t|r|b|l)(-\d+)?$/,
  "border-color": /^border-(?!(solid|dashed|dotted|double|none|hidden|\d+|x|y|t|r|b|l)(-|$))[\w\-[\]()#%./]+$/,
  "border-style": /^border-(solid|dashed|dotted|double|none|hidden)$/,
  width: /^w-/,
  height: /^h-/,
  opacity: /^opacity-/,
  "padding-top": /^(p|py|pt)-/,
  "padding-right": /^(p|px|pr)-/,
  "padding-bottom": /^(p|py|pb)-/,
  "padding-left": /^(p|px|pl)-/,
  "margin-top": /^-?(m|my|mt)-/,
  "margin-right": /^-?(m|mx|mr)-/,
  "margin-bottom": /^-?(m|my|mb)-/,
  "margin-left": /^-?(m|mx|ml)-/,
  gap: /^gap-/,
  display: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table)$/,
  position: /^(static|relative|absolute|fixed|sticky)$/,
};

function classeQueGoverna(classes: string[], propriedade: string): string | null {
  const re = GOVERNA[propriedade];
  if (!re) return null;
  const candidatas = classes.filter((c) => re.test(c.replace(/^[a-z-]+:/g, "")));
  return candidatas.length ? candidatas[candidatas.length - 1] ?? null : null;
}

function px(valor: string): number | null {
  const m = /^(-?[\d.]+)px$/.exec(valor.trim());
  return m?.[1] ? parseFloat(m[1]) : null;
}

function utilitarioDeCor(prefixo: string, valor: string, tokens: Map<string, string[]>, tailwind: string): { sugestao: string; observacao?: string } {
  const rgb = paraRgb(valor);
  if (!rgb) return { sugestao: `${prefixo}-[${valor}]`, observacao: "valor não reconhecido como cor" };
  const nomes = tokens.get(rgbTexto(rgb)) ?? [];
  const deTema = nomes.find((n) => n.startsWith("--color-"));
  if (deTema) return { sugestao: `${prefixo}-${deTema.slice("--color-".length)}`, observacao: `token do tema ${deTema}` };
  const qualquer = nomes[0];
  if (qualquer) return { sugestao: Number(tailwind) >= 4 ? `${prefixo}-(${qualquer})` : `${prefixo}-[var(${qualquer})]`, observacao: `token ${qualquer}` };
  return { sugestao: `${prefixo}-[${rgbHex(rgb)}]`, observacao: "sem token equivalente no projeto — prefira criar um a usar a cor literal" };
}

function utilitarioDeEspaco(prefixo: string, valor: string): string {
  const n = px(valor);
  if (n === null) return `${prefixo}-[${valor}]`;
  const passos = n / 4;
  if (ESPACOS.has(passos)) return `${prefixo}-${passos}`;
  if (n === 1) return `${prefixo}-px`;
  return `${prefixo}-[${n}px]`;
}

export function sugerir(anotacao: Anotacao, tokens: Map<string, string[]>, tailwind: string | null): SugestaoAplicacao[] {
  const classes = (anotacao.elemento.meta.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
  return anotacao.alteracoes.map((alt) => {
    const base: SugestaoAplicacao = { propriedade: alt.propriedade, antes: alt.antes, depois: alt.depois, classeAtual: classeQueGoverna(classes, alt.propriedade), sugestao: null };
    if (!tailwind) {
      base.sugestao = `${alt.propriedade}: ${alt.depois};`;
      base.observacao = "projeto sem Tailwind: aplicar no CSS do componente";
      return base;
    }
    const p = alt.propriedade;
    const v = alt.depois.trim();
    if (p === "color" || p === "background-color" || p === "border-color") {
      const prefixo = p === "color" ? "text" : p === "background-color" ? "bg" : "border";
      const r = utilitarioDeCor(prefixo, v, tokens, tailwind);
      base.sugestao = r.sugestao;
      if (r.observacao) base.observacao = r.observacao;
    } else if (p === "font-size") {
      const n = px(v);
      const nome = n !== null ? TAMANHOS_FONTE.find(([tam]) => tam === n)?.[1] : undefined;
      base.sugestao = nome ? `text-${nome}` : `text-[${v}]`;
    } else if (p === "font-weight") {
      const peso = PESOS[v];
      base.sugestao = peso ? `font-${peso}` : `font-[${v}]`;
    } else if (p === "line-height") {
      const n = px(v);
      base.sugestao = n !== null ? `leading-[${n}px]` : `leading-[${v}]`;
    } else if (p === "letter-spacing") {
      base.sugestao = `tracking-[${v}]`;
    } else if (p === "text-align") {
      base.sugestao = `text-${v}`;
    } else if (p === "opacity") {
      base.sugestao = `opacity-${Math.round(parseFloat(v) * 100)}`;
    } else if (p === "border-radius") {
      const n = px(v);
      const tabela = Number(tailwind) >= 4 ? RAIOS_V4 : RAIOS_V3;
      const nome = n !== null ? tabela.find(([tam]) => tam === n)?.[1] : undefined;
      base.sugestao = n !== null && n >= 9999 ? "rounded-full" : nome ?? `rounded-[${v}]`;
    } else if (p === "border-width") {
      const n = px(v);
      base.sugestao = n === 1 ? "border" : n !== null && [0, 2, 4, 8].includes(n) ? `border-${n}` : `border-[${v}]`;
    } else if (p === "border-style") {
      base.sugestao = `border-${v}`;
    } else if (p === "font-family") {
      const varr = /var\((--font-([\w-]+))\)/.exec(v);
      base.sugestao = varr?.[2] ? `font-${varr[2]}` : `font-[${v}]`;
      if (!varr) base.observacao = "confira a família registrada no tema";
    } else if (p === "display") {
      base.sugestao = v === "none" ? "hidden" : v;
    } else if (p === "position") {
      base.sugestao = v;
    } else if (PREFIXO_LADO[p]) {
      base.sugestao = utilitarioDeEspaco(PREFIXO_LADO[p] ?? p, v);
    } else {
      base.sugestao = `[${p}:${v.replace(/\s+/g, "_")}]`;
    }
    return base;
  });
}

// ---------- análise do lote ----------
function alvoDe(meta: MetaElemento): AlvoBusca {
  return {
    id: meta.attrs["id"],
    testid: meta.attrs["data-testid"] ?? meta.attrs["data-test-id"] ?? meta.attrs["data-test"],
    classes: (meta.attrs["class"] ?? "").split(/\s+/).filter(Boolean),
    texto: meta.texto,
    componentes: meta.componentes,
  };
}

export async function analisarLote(raiz: string, lote: Lote): Promise<AnaliseLote> {
  const arquivos = await lerProjeto(raiz);
  const tokens = lerTokensCss(arquivos);
  const tailwind = await tailwindDoProjeto(raiz);
  const contexto = arquivosDaRota(arquivos, lote.pagina.caminho || "/");
  const anotacoes: Record<string, AnaliseAnotacao> = {};
  for (const a of lote.anotacoes) {
    let localizacoes = localizar(arquivos, alvoDe(a.elemento.meta), 6, contexto);
    if (!localizacoes.length && a.elemento.interno) localizacoes = localizar(arquivos, alvoDe(a.elemento.interno.meta), 6, contexto);
    const analise: AnaliseAnotacao = { localizacoes, sugestoes: sugerir(a, tokens, tailwind) };
    if (a.texto && a.texto.antes.trim().length >= 3) {
      analise.texto = { de: a.texto.antes, para: a.texto.depois, localizacoes: localizar(arquivos, { classes: [], texto: a.texto.antes, componentes: [] }, 4, contexto) };
    }
    anotacoes[a.id] = analise;
  }
  const saida: AnaliseLote = { raiz, arquivosVarridos: arquivos.length, tailwind, anotacoes };
  if (contexto) saida.rota = { caminho: contexto.caminho, entradas: Array.from(contexto.entradas).sort(), alcance: contexto.alcance.size };
  return saida;
}

export function arquivosProvaveis(analise: AnaliseLote, limite = 3): string[] {
  const pontos = new Map<string, { pontos: number; rota: boolean }>();
  for (const a of Object.values(analise.anotacoes)) {
    for (const l of a.localizacoes) {
      const atual = pontos.get(l.arquivo);
      pontos.set(l.arquivo, { pontos: Math.max(atual?.pontos ?? 0, l.pontos), rota: (atual?.rota ?? false) || !!l.rota });
    }
  }
  return Array.from(pontos.entries())
    .sort((x, y) => Number(y[1].rota) - Number(x[1].rota) || y[1].pontos - x[1].pontos || x[0].localeCompare(y[0]))
    .slice(0, limite)
    .map(([arquivo]) => arquivo);
}
