// Os componentes que o projeto de fato tem — e quanto cada um é usado.
//
// O erro de agente que mais se repete em UI não é código quebrado, é vocabulário
// errado: criar um <Modal> onde o projeto usa <Dialog> quarenta vezes, ou importar um
// <Box> que só existe em outra biblioteca. Isto responde com o que está exportado no
// código, não com o que alguém lembrou de documentar.

import type { ArquivoFonte } from "./fonte.ts";

export interface ComponenteDoProjeto { nome: string; arquivo: string; linha: number; assinatura: string; usos: number; padrao?: boolean }

const JSX = /\.(tsx|jsx)$/;
/** História de Storybook e teste existem para exercitar o componente, não são o produto. */
const DE_EXERCICIO = /\.(stories|test|spec)\.[jt]sx?$/;
// O identificador inteiro, com sublinhado: `NODE_WIDTH` não pode virar o componente "NODE".
const DEFINICAO = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_$]*)/;
/** PascalCase de componente: tem minúscula e não tem sublinhado. Constante em caixa alta não é. */
const PASCAL = /^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/;

function definicoes(a: ArquivoFonte): Array<{ nome: string; linha: number; assinatura: string; padrao?: boolean }> {
  const achadas: Array<{ nome: string; linha: number; assinatura: string; padrao?: boolean }> = [];
  a.linhas.forEach((texto, i) => {
    const direta = DEFINICAO.exec(texto)?.[1];
    if (direta && PASCAL.test(direta)) achadas.push({ nome: direta, linha: i + 1, assinatura: texto.trim().slice(0, 200), ...(/^\s*export\s+default\b/.test(texto) ? { padrao: true } : {}) });
  });
  // `function Button() {…}` lá em cima e `export { Button }` no fim: o padrão do shadcn,
  // às vezes com a lista em várias linhas. A assinatura útil é a da definição. Já
  // `export { X } from "./outro"` é reexportação: o componente mora no outro arquivo, e
  // contá-lo aqui criava uma segunda entrada — que depois aparecia como "sem uso".
  const texto = a.linhas.join("\n");
  for (const m of texto.matchAll(/(?:^|\n)[ \t]*export\s*(type\s+)?\{([^}]*)\}(\s*from\s*["'][^"']+["'])?/g)) {
    if (m[1] || m[3]) continue;
    const linhaDoExport = texto.slice(0, (m.index ?? 0) + 1).split("\n").length;
    for (const parte of (m[2] ?? "").split(",")) {
      const [origem = "", publico] = parte.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x.trim());
      const nome = publico || origem;
      if (!PASCAL.test(nome) || achadas.some((d) => d.nome === nome)) continue;
      const def = a.linhas.findIndex((l) => new RegExp(`^\\s*(?:async\\s+)?(?:function|const|class)\\s+${origem.replace(/[$]/g, "\\$&")}\\b`).test(l));
      achadas.push({ nome, linha: def >= 0 ? def + 1 : linhaDoExport, assinatura: (a.linhas[def >= 0 ? def : linhaDoExport - 1] ?? "").trim().slice(0, 200) });
    }
  }
  return achadas;
}

/** `import { Button as Botao } from "@/components/ui/button"` → Botao ↦ { nome: Button, origem }. */
function importacoesDe(a: ArquivoFonte): Map<string, { nome: string; origem: string }> {
  const mapa = new Map<string, { nome: string; origem: string }>();
  const texto = a.linhas.join("\n");
  for (const m of texto.matchAll(/import\s+(?:type\s+)?([A-Z][A-Za-z0-9]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g)) {
    const origem = m[3] ?? "";
    if (m[1]) mapa.set(m[1], { nome: m[1], origem });
    for (const parte of (m[2] ?? "").split(",")) {
      const [importado, local] = parte.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x.trim());
      if (importado) mapa.set(local || importado, { nome: importado, origem });
    }
  }
  return mapa;
}

/**
 * Qual das definições com o mesmo nome o import aponta. Compara os segmentos finais do
 * caminho — `@/components/features/x/section-nav` casa com
 * `components/features/x/section-nav.tsx` sem precisar ler o tsconfig —, e o import
 * relativo é resolvido a partir da pasta de quem importa.
 */
function pelaOrigem(candidatos: ComponenteDoProjeto[], origem: string, quemImporta: string): ComponenteDoProjeto | undefined {
  const semExtensao = (c: string) => c.replace(/\.(tsx|jsx|ts|js)$/, "").replace(/\/index$/, "");
  let alvo = origem;
  if (origem.startsWith(".")) {
    const partes = quemImporta.split("/").slice(0, -1);
    for (const seg of origem.split("/")) { if (seg === "..") partes.pop(); else if (seg !== ".") partes.push(seg); }
    alvo = partes.join("/");
  }
  const segmentos = alvo.replace(/^[@~]\//, "").split("/").filter(Boolean);
  let melhor: ComponenteDoProjeto | undefined, pontos = -1;
  for (const c of candidatos) {
    const doArquivo = semExtensao(c.arquivo).split("/");
    let iguais = 0;
    while (iguais < segmentos.length && iguais < doArquivo.length && segmentos[segmentos.length - 1 - iguais] === doArquivo[doArquivo.length - 1 - iguais]) iguais++;
    if (iguais > pontos) { pontos = iguais; melhor = c; }
  }
  return melhor;
}

/**
 * Todos os componentes exportados em .tsx/.jsx, com quantas vezes o produto usa cada um.
 * Dois `SectionNav` em arquivos diferentes são dois componentes: cada uso vai para o que
 * o arquivo de fato importou — antes, tudo ia para o primeiro que aparecesse.
 */
export function catalogoDeComponentes(arquivos: ArquivoFonte[]): ComponenteDoProjeto[] {
  const catalogo: ComponenteDoProjeto[] = [];
  const porNome = new Map<string, ComponenteDoProjeto[]>();
  for (const a of arquivos) {
    if (!JSX.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    const vistos = new Set<string>();
    for (const d of definicoes(a)) {
      if (vistos.has(d.nome)) continue;
      vistos.add(d.nome);
      const c: ComponenteDoProjeto = { ...d, arquivo: a.relativo, usos: 0 };
      catalogo.push(c);
      porNome.set(d.nome, [...(porNome.get(d.nome) ?? []), c]);
    }
  }
  if (!catalogo.length) return [];
  for (const a of arquivos) {
    if (!JSX.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    const importacoes = importacoesDe(a);
    // Fim de linha também é uso: JSX de várias linhas abre `<Combobox` sozinho e põe as
    // props embaixo. E `<Menu.Item>` é uso de Menu. Alias de import conta para o original.
    for (const linha of a.linhas) for (const uso of linha.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>.]|$)/g)) {
      const local = uso[1] ?? "";
      const importado = importacoes.get(local);
      const candidatos = porNome.get(importado?.nome ?? local);
      if (!candidatos) continue;
      const alvo = candidatos.length === 1 ? candidatos[0]
        : !importado ? candidatos.find((c) => c.arquivo === a.relativo) ?? candidatos[0]
        : pelaOrigem(candidatos, importado.origem, a.relativo);
      if (alvo) alvo.usos++;
    }
  }
  return catalogo;
}

/** Componentes cujo nome ou pasta casam com a consulta; nome que casa vem antes de pasta que casa. */
export function buscarComponente(arquivos: ArquivoFonte[], consulta: string, limite = 10): ComponenteDoProjeto[] {
  const q = consulta.trim().toLowerCase();
  if (!q) return [];
  return catalogoDeComponentes(arquivos)
    .filter((c) => c.nome.toLowerCase().includes(q) || c.arquivo.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.nome.toLowerCase().includes(q)) - Number(!b.nome.toLowerCase().includes(q)) || b.usos - a.usos || a.nome.localeCompare(b.nome))
    .slice(0, limite);
}

/**
 * Nomes em PascalCase que existem para o código: exportados pelo projeto ou importados
 * de qualquer lugar — um `<Tooltip>` que vem do Radix existe, mesmo sem ser do projeto.
 */
export function nomesConhecidos(arquivos: ArquivoFonte[]): Set<string> {
  const nomes = new Set<string>();
  for (const a of arquivos) {
    if (!/\.(tsx|jsx|ts|js|mjs)$/.test(a.relativo)) continue;
    for (const d of definicoes(a)) nomes.add(d.nome);
    // Tipo exportado também é nome que um documento pode citar com razão: `ButtonProps`.
    for (const linha of a.linhas) { const t = /^\s*export\s+(?:declare\s+)?(?:type|interface|enum|abstract\s+class)\s+([A-Z][A-Za-z0-9]*)/.exec(linha)?.[1]; if (t) nomes.add(t); }
    const texto = a.linhas.join("\n");
    for (const m of texto.matchAll(/import\s+(?:type\s+)?([A-Z][A-Za-z0-9]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s/g)) {
      if (m[1]) nomes.add(m[1]);
      for (const parte of (m[2] ?? "").split(",")) {
        const nome = parte.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim() ?? "";
        if (PASCAL.test(nome)) nomes.add(nome);
      }
    }
  }
  return nomes;
}
