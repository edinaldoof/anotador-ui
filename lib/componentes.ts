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
const DEFINICAO = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/;
const LISTA_EXPORTADA = /^\s*export\s*\{([^}]*)\}/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

function definicoes(a: ArquivoFonte): Array<{ nome: string; linha: number; assinatura: string; padrao?: boolean }> {
  const achadas: Array<{ nome: string; linha: number; assinatura: string; padrao?: boolean }> = [];
  a.linhas.forEach((texto, i) => {
    const direta = DEFINICAO.exec(texto)?.[1];
    if (direta) { achadas.push({ nome: direta, linha: i + 1, assinatura: texto.trim().slice(0, 200), ...(/^\s*export\s+default\b/.test(texto) ? { padrao: true } : {}) }); return; }
    // `function Button() {…}` lá em cima e `export { Button }` no fim: o padrão do
    // shadcn. A assinatura útil é a da definição, não a da linha que exporta.
    const lista = LISTA_EXPORTADA.exec(texto)?.[1];
    if (!lista) return;
    for (const parte of lista.split(",")) {
      const nome = parte.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (!PASCAL.test(nome)) continue;
      const origem = parte.trim().split(/\s+as\s+/)[0]?.trim() ?? nome;
      const def = a.linhas.findIndex((l) => new RegExp(`^\\s*(?:async\\s+)?(?:function|const|class)\\s+${origem.replace(/[$]/g, "\\$&")}\\b`).test(l));
      achadas.push({ nome, linha: (def >= 0 ? def : i) + 1, assinatura: (a.linhas[def >= 0 ? def : i] ?? texto).trim().slice(0, 200) });
    }
  });
  return achadas;
}

/** Todos os componentes exportados em .tsx/.jsx, com quantas vezes o produto usa cada um. */
export function catalogoDeComponentes(arquivos: ArquivoFonte[]): ComponenteDoProjeto[] {
  const porNome = new Map<string, ComponenteDoProjeto>();
  for (const a of arquivos) {
    if (!JSX.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    for (const d of definicoes(a)) if (!porNome.has(d.nome)) porNome.set(d.nome, { ...d, arquivo: a.relativo, usos: 0 });
  }
  if (!porNome.size) return [];
  // Fim de linha também é uso: JSX de várias linhas abre `<Combobox` sozinho e põe as
  // props embaixo. E `<Menu.Item>` é uso de Menu.
  const padrao = new RegExp("<(" + [...porNome.keys()].join("|") + ")(?=[\\s/>.]|$)", "g");
  for (const a of arquivos) {
    if (!JSX.test(a.relativo) || DE_EXERCICIO.test(a.relativo)) continue;
    for (const linha of a.linhas) for (const uso of linha.matchAll(padrao)) { const c = uso[1] && porNome.get(uso[1]); if (c) c.usos++; }
  }
  return [...porNome.values()];
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
