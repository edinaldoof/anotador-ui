// Arquivos que os agentes leem antes de mexer na interface — AGENTS.md, CLAUDE.md,
// skills, regras do Cursor e do Copilot —, conferidos e gerados a partir do código.
//
// Duas ideias do pack de agent files do designsystems.one (CC0) que o Anotador está em
// posição rara de cumprir, porque já lê os tokens e os componentes de verdade:
//
// 1. Documento de agente desatualizado é fonte ativa de alucinação. O agente lê o nome
//    no AGENTS.md, usa o nome, e o build quebra — o defeito era o documento. A mudança de
//    processo que o pack mais recomenda é uma checagem de CI que confirme que todo nome
//    citado ali existe. `conferirArquivosDeAgente` é essa checagem.
//
// 2. Documento escrito à mão apodrece; os sistemas que resolveram isso (Mantine,
//    Cloudscape, HeroUI) geram a parte de referência a partir do código. A skill de
//    design gerada aqui é essa parte: catálogo, tokens e os nomes que não existem.
//
// Ficou de fora a regra do pack de que falta de `CLAUDE.md` com `@AGENTS.md` é defeito.
// No Claude Code 2.1.280 o AGENTS.md é carregado sozinho — conferido com contraprova: o
// mesmo texto num NOTAS.md não entra no contexto. A ponte não é erro: o Claude não
// carrega o arquivo duas vezes (medido: +96 tokens por turno, não os ~985 do AGENTS.md
// inteiro) e ela ainda serve a versões antigas. Só não é obrigatória, e não é acusada.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { catalogoDeComponentes, nomesConhecidos, type ComponenteDoProjeto } from "./componentes.ts";
import { deBiblioteca, type CategoriaToken, type SistemaDeDesign, type TokenDesign } from "./design.ts";
import type { ArquivoFonte } from "./fonte.ts";

export interface AchadoArquivoAgente {
  arquivo: string;
  linha: number;
  tipo: "token" | "componente" | "skill" | "tamanho";
  nome: string;
  evidencia: string;
  sugestao?: string;
}

const TAMANHO_MAXIMO = 256 * 1024;
/** Lido em todo turno, para sempre: o pack mira abaixo de 200 linhas. */
const LINHAS_ALVO = 200;

const FIXOS = ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "llms.txt", "public/llms.txt", ".github/copilot-instructions.md"];
const PASTAS: Array<{ pasta: string; skill?: boolean; extensao?: RegExp }> = [
  { pasta: ".claude/skills", skill: true }, { pasta: ".agents/skills", skill: true }, { pasta: ".github/skills", skill: true },
  { pasta: ".claude/rules", extensao: /\.md$/ }, { pasta: ".cursor/rules", extensao: /\.mdc?$/ }, { pasta: ".github/instructions", extensao: /\.md$/ },
];

async function lerTexto(caminho: string): Promise<string[] | null> {
  try {
    const info = await stat(caminho);
    if (!info.isFile() || info.size > TAMANHO_MAXIMO) return null;
    return (await readFile(caminho, "utf8")).split("\n");
  } catch { return null; }
}

/**
 * Os arquivos de agente do projeto. Lidos direto do disco: moram em pastas ocultas e em
 * extensões (.mdc, .txt) que a leitura geral do projeto não percorre.
 */
export async function lerArquivosDeAgente(raiz: string, codigo: ArquivoFonte[] = []): Promise<{ arquivos: ArquivoFonte[]; skillsVazias: string[] }> {
  const achados = new Map<string, ArquivoFonte>();
  const skillsVazias: string[] = [];
  const guardar = async (relativo: string): Promise<boolean> => {
    if (achados.has(relativo)) return true;
    const linhas = await lerTexto(join(raiz, relativo));
    if (linhas) achados.set(relativo, { relativo, linhas });
    return !!linhas;
  };
  for (const f of FIXOS) await guardar(f);
  for (const { pasta, skill, extensao } of PASTAS) {
    let entradas: Array<{ name: string; isDirectory(): boolean }> = [];
    try { entradas = await readdir(join(raiz, pasta), { withFileTypes: true }); } catch { continue; }
    for (const e of entradas.slice(0, 200)) {
      // Pasta de skill sem SKILL.md não é skill: o agente não carrega nada, e quem vê a
      // pasta acha que a skill está ativa.
      if (skill && e.isDirectory()) { if (!await guardar(`${pasta}/${e.name}/SKILL.md`)) skillsVazias.push(`${pasta}/${e.name}`); }
      else if (!skill && extensao?.test(e.name)) await guardar(`${pasta}/${e.name}`);
    }
  }
  // Monorepo: cada pacote pode ter o seu AGENTS.md.
  for (const a of codigo) if (/\/(AGENTS|CLAUDE)\.md$/.test(a.relativo) && !achados.has(a.relativo)) achados.set(a.relativo, a);
  return { arquivos: [...achados.values()].sort((a, b) => a.relativo.localeCompare(b.relativo)), skillsVazias };
}

function distancia(a: string, b: string): number {
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0] ?? 0;
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j] ?? 0;
      linha[j] = Math.min((linha[j] ?? 0) + 1, (linha[j - 1] ?? 0) + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return linha[b.length] ?? 0;
}
function maisParecido(nome: string, candidatos: Iterable<string>, limite: number): string | undefined {
  let melhor: string | undefined, menor = limite + 1;
  for (const c of candidatos) { const d = distancia(nome.toLowerCase(), c.toLowerCase()); if (d < menor) { menor = d; melhor = c; } }
  return melhor;
}

// Onde o documento diz que um nome NÃO existe — "não há Box", tabela de removidos —,
// citá-lo é o objetivo, não o defeito.
const NEGA_TUDO = /n[ãa]o exist|n[ãa]o h[áa]\b|there is no|no longer|removid|removed|deprecat|obsolet|n[ãa]o use|nunca use|do not use|used to exist|antig[oa]s?\b/i;
const NEGA_DEPOIS = /em vez de|ao inv[ée]s de|instead of|no lugar de/i;
const EQUIVALENTES_COMUNS: Record<string, string[]> = {
  Modal: ["Dialog", "AlertDialog", "Sheet"], Drawer: ["Sheet", "Dialog"], Popup: ["Popover", "Dialog"],
  Typography: ["Text", "Heading"], Spinner: ["Loader", "Skeleton"], Loader: ["Spinner", "Skeleton"],
  Snackbar: ["Toaster", "Toast"], Toast: ["Toaster"], Chip: ["Badge", "Tag"], Tag: ["Badge"], Pill: ["Badge"],
  Autocomplete: ["Combobox"], Divider: ["Separator"], Paper: ["Card"], Panel: ["Card"],
};
/** Primitivos de layout que outras bibliotecas têm e que o modelo usa por hábito. */
const LAYOUT_DE_OUTRAS = ["Box", "Stack", "HStack", "VStack", "Flex", "Container", "Grid", "Center"];

/**
 * Nomes citados nos arquivos de agente que o código não tem: token em `var(--x)` que
 * ninguém declara nem usa, componente em `<Nome>` ou `import { Nome }` que ninguém
 * exporta nem importa. Mais as regras de forma das skills e o tamanho do AGENTS.md.
 */
export function conferirArquivosDeAgente(docs: ArquivoFonte[], codigo: ArquivoFonte[], sistema: SistemaDeDesign, skillsVazias: string[] = []): AchadoArquivoAgente[] {
  const tokens = new Set(sistema.tokens.map((t) => t.nome));
  // Variável definida ou lida em qualquer lugar do código também existe: pode ser
  // posta por JavaScript (`style={{ "--progresso": … }}`) em vez de declarada no CSS.
  const tocadas = new Set<string>();
  // Só código e estilo: o próprio AGENTS.md também está na leitura do projeto, e um nome
  // que só existe nele se aprovaria sozinho.
  for (const a of codigo) {
    if (!/\.(tsx|jsx|ts|js|mjs|cjs|css|scss|vue|svelte|astro|html?)$/.test(a.relativo)) continue;
    for (const l of a.linhas) for (const m of l.matchAll(/(--[A-Za-z0-9_-]+)\s*["']?\s*[:,)]/g)) if (m[1]) tocadas.add(m[1]);
  }
  const conhecidos = nomesConhecidos(codigo);
  const exportados = catalogoDeComponentes(codigo).map((c) => c.nome);
  const achados: AchadoArquivoAgente[] = skillsVazias.map((pasta) => ({ arquivo: pasta, linha: 0, tipo: "skill" as const, nome: pasta.split("/").pop() ?? pasta, evidencia: "pasta de skill sem SKILL.md: o agente não carrega nada daqui, embora a pasta sugira uma skill ativa" }));

  for (const doc of docs) {
    const eSkill = /(^|\/)SKILL\.md$/.test(doc.relativo);
    if (/(^|\/)(AGENTS|CLAUDE)\.md$/.test(doc.relativo) && doc.linhas.length > LINHAS_ALVO) {
      achados.push({ arquivo: doc.relativo, linha: 1, tipo: "tamanho", nome: doc.relativo, evidencia: `${doc.linhas.length} linhas — este arquivo entra no contexto em todo turno; referência longa e procedimento de vários passos rendem mais numa skill, que só carrega quando é usada` });
    }
    let emComentario = false, emFrontmatter = eSkill && doc.linhas[0]?.trim() === "---", secaoNegada = false, tabelaNegada = false;
    doc.linhas.forEach((original, i) => {
      const n = i + 1;
      if (emFrontmatter) {
        if (i > 0 && original.trim() === "---") { emFrontmatter = false; return; }
        if (i > 0 && /[<>]/.test(original)) achados.push({ arquivo: doc.relativo, linha: n, tipo: "skill", nome: "frontmatter", evidencia: "sinal de < ou > no frontmatter: o padrão de Agent Skills avisa que ele pode injetar instrução no prompt de sistema" });
        const nome = /^name:\s*(.+)$/.exec(original.trim())?.[1]?.trim().replace(/^["']|["']$/g, "");
        const pasta = doc.relativo.split("/").at(-2);
        if (nome && pasta && nome !== pasta) achados.push({ arquivo: doc.relativo, linha: n, tipo: "skill", nome, evidencia: `o name "${nome}" precisa ser igual ao nome da pasta, "${pasta}"` });
        const descricao = /^description:\s*(.+)$/.exec(original.trim())?.[1];
        if (descricao && descricao.length > 1024) achados.push({ arquivo: doc.relativo, linha: n, tipo: "skill", nome: "description", evidencia: `${descricao.length} caracteres; o limite do padrão é 1024` });
        return;
      }
      // Comentário HTML é nota para quem escreve o documento, não instrução ao agente.
      let linha = original;
      if (emComentario) { const fim = linha.indexOf("-->"); if (fim < 0) return; linha = linha.slice(fim + 3); emComentario = false; }
      linha = linha.replace(/<!--.*?-->/g, "");
      const abre = linha.indexOf("<!--");
      if (abre >= 0) { linha = linha.slice(0, abre); emComentario = true; }

      if (/^\s*#{1,6}\s/.test(linha)) { secaoNegada = NEGA_TUDO.test(linha); tabelaNegada = false; return; }
      const eTabela = /^\s*\|/.test(linha);
      if (eTabela && !/^\s*\|/.test(doc.linhas[i - 1] ?? "")) tabelaNegada = NEGA_TUDO.test(linha);
      if (!eTabela) tabelaNegada = false;
      if (secaoNegada || tabelaNegada || NEGA_TUDO.test(linha)) return;
      const corte = linha.search(NEGA_DEPOIS);
      const valido = corte >= 0 ? linha.slice(0, corte) : linha;

      for (const m of valido.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)) {
        const nome = m[1] as string;
        if (tokens.has(nome) || tocadas.has(nome)) continue;
        const sugestao = maisParecido(nome, [...tokens].filter((t) => !deBiblioteca(t)), 4);
        achados.push({ arquivo: doc.relativo, linha: n, tipo: "token", nome, evidencia: "nenhum CSS do projeto declara este token e nenhum código o usa", ...(sugestao ? { sugestao } : {}) });
      }
      const citados = new Set<string>();
      for (const m of valido.matchAll(/<([A-Z][a-z][A-Za-z0-9]*)(?=[\s/>.]|$)/g)) if (m[1]) citados.add(m[1]);
      // Identificador sozinho entre crases — `PageShell`, `SelectField` — é nome de código
      // citado para o agente usar, e precisa existir tanto quanto um <PageShell>.
      for (const m of valido.matchAll(/`([A-Z][a-z][A-Za-z0-9]*)`/g)) if (m[1]) citados.add(m[1]);
      for (const m of valido.matchAll(/import\s*\{([^}]*)\}/g)) for (const parte of (m[1] ?? "").split(",")) {
        const nome = parte.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
        if (/^[A-Z][a-z][A-Za-z0-9]*$/.test(nome)) citados.add(nome);
      }
      for (const nome of citados) {
        if (conhecidos.has(nome)) continue;
        const equivalente = (EQUIVALENTES_COMUNS[nome] ?? []).find((e) => conhecidos.has(e)) ?? maisParecido(nome, exportados, 2);
        achados.push({ arquivo: doc.relativo, linha: n, tipo: "componente", nome, evidencia: "o código não exporta nem importa nada com este nome", ...(equivalente ? { sugestao: equivalente } : {}) });
      }
    });
  }
  return achados;
}

// ---------------------------------------------------------------------------
// Geração da skill de design
// ---------------------------------------------------------------------------

export interface AliasImportacao { prefixo: string; pasta: string }

/** `"@/*": ["./*"]` do tsconfig vira `{ prefixo: "@/", pasta: "" }`. Só curinga no fim. */
export async function aliasesDoTsconfig(raiz: string): Promise<AliasImportacao[]> {
  let texto: string;
  try { texto = await readFile(join(raiz, "tsconfig.json"), "utf8"); } catch { return []; }
  // tsconfig é JSONC: comentário e vírgula sobrando são permitidos.
  const limpo = texto.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, s: string | undefined) => s ?? "").replace(/,\s*([}\]])/g, "$1");
  let paths: Record<string, string[]> = {};
  try { paths = (JSON.parse(limpo) as { compilerOptions?: { paths?: Record<string, string[]> } }).compilerOptions?.paths ?? {}; } catch { return []; }
  const aliases: AliasImportacao[] = [];
  for (const [chave, destinos] of Object.entries(paths)) {
    const destino = destinos[0];
    if (!chave.endsWith("/*") || !destino?.endsWith("/*") || destino.slice(0, -2).includes("*")) continue;
    aliases.push({ prefixo: chave.slice(0, -1), pasta: destino.slice(0, -1).replace(/^\.\//, "") });
  }
  return aliases.sort((a, b) => b.pasta.length - a.pasta.length);
}

function caminhoDeImport(arquivo: string, aliases: AliasImportacao[]): string {
  const semExtensao = arquivo.replace(/\.(tsx|jsx|ts|js)$/, "").replace(/\/index$/, "");
  const alias = aliases.find((a) => semExtensao.startsWith(a.pasta));
  return alias ? alias.prefixo + semExtensao.slice(alias.pasta.length) : semExtensao;
}

export interface OpcoesSkill {
  nome: string;
  codigo: ArquivoFonte[];
  sistema: SistemaDeDesign;
  aliases: AliasImportacao[];
  scripts: Record<string, string>;
  tailwind: boolean;
  hoje: string;
}

/**
 * Quantas vezes cada token aparece no código: em `var(--x)` e na utilitária que o
 * Tailwind v4 deriva dele (`--color-action-primary` vira `bg-action-primary`,
 * `text-action-primary`…). Conta o nome sem o prefixo do namespace do tema.
 */
export function usosDeTokens(tokens: TokenDesign[], codigo: ArquivoFonte[]): Map<string, number> {
  const chave = (nome: string) => nome.replace(/^--(?:color|spacing|radius|text|font|shadow|leading|tracking|inset|breakpoint)-/, "").replace(/^--/, "");
  const porChave = new Map<string, string[]>();
  for (const t of tokens) { const k = chave(t.nome); if (k.length >= 3) porChave.set(k, [...(porChave.get(k) ?? []), t.nome]); }
  const usos = new Map<string, number>();
  if (!porChave.size) return usos;
  const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Precedido de hífen: vale para `var(--color-x)`, `bg-x`, `text-x`, `border-x`. Nomes
  // mais longos primeiro, para `surface-card-border` não contar como `surface-card`.
  const padrao = new RegExp(`(?<=-)(${[...porChave.keys()].sort((a, b) => b.length - a.length).map(escapar).join("|")})(?![A-Za-z0-9_-])`, "g");
  for (const a of codigo) {
    if (!/\.(tsx|jsx|ts|js|css|scss|mdx)$/.test(a.relativo) || /\.(stories|test|spec)\./.test(a.relativo)) continue;
    for (const linha of a.linhas) {
      // A própria declaração `--x: valor;` não é uso.
      if (/^\s*--[A-Za-z0-9_-]+\s*:/.test(linha)) continue;
      for (const m of linha.matchAll(padrao)) for (const nome of porChave.get(m[1] ?? "") ?? []) usos.set(nome, (usos.get(nome) ?? 0) + 1);
    }
  }
  return usos;
}

const ORDEM_CATEGORIAS: CategoriaToken[] = ["cor", "espaco", "texto", "raio", "sombra", "fonte", "outro"];
const TITULO_CATEGORIA: Record<CategoriaToken, string> = { cor: "Cor", espaco: "Espaçamento", texto: "Texto", raio: "Raio", sombra: "Sombra", fonte: "Fonte", outro: "Outros" };

function celula(texto: string): string {
  return texto.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/**
 * A skill `design-system` do projeto, pronta para `.claude/skills/design-system/SKILL.md`.
 * Referência longa mora em skill, não no AGENTS.md: só nome e descrição ficam no contexto
 * até a skill ser usada. Tudo aqui sai do código — nada é escrito à mão.
 */
export function gerarSkillDeDesign(o: OpcoesSkill): string {
  const nome = o.nome.replace(/[<>{}]/g, "").trim() || "projeto";
  const catalogo = catalogoDeComponentes(o.codigo);
  const conhecidos = nomesConhecidos(o.codigo);
  const primitivos = catalogo.filter((c) => /(^|\/)ui\//.test(c.arquivo));
  const outros = catalogo.filter((c) => !/(^|\/)ui\//.test(c.arquivo) && c.usos >= 5).sort((a, b) => b.usos - a.usos).slice(0, 25);

  const linhas: string[] = [
    "---",
    "name: design-system",
    `description: Componentes, tokens e regras de interface do ${nome}, gerados do código pelo Anotador. Use ao criar ou alterar UI, ao escolher um componente, ao resolver o nome de um token ou antes de escrever uma cor, espaçamento, raio ou tamanho de texto literal.`,
    "---",
    "",
    `<!-- Gerado pelo Anotador em ${o.hoje} a partir do código. Não edite à mão: rode \`anotador agentes --gerar\` de novo, e confira com \`anotador agentes\`. -->`,
    "",
    `# Sistema de design — ${nome}`,
    "",
    "## Antes de escrever UI",
    "",
    "1. **Componente que não está nesta lista não existe.** Procure antes de criar; se o servidor MCP do Anotador estiver ligado, `buscar_componente` responde com os usos de cada um. Na dúvida, pergunte.",
    "2. **Nada de cor, espaçamento, raio ou tamanho de texto literal.** Use os tokens abaixo — `conferir_valor` diz qual token corresponde a um valor. Um hex solto parece certo no tema claro e erra no escuro e no próximo rebrand.",
    "3. **Depois de mexer em layout, meça.** `medir_pagina` abre a tela em 390, 768 e 1280px e aponta rolagem horizontal, vazamento e alvo de toque pequeno.",
    "",
  ];

  if (primitivos.length) {
    const porArquivo = new Map<string, ComponenteDoProjeto[]>();
    for (const c of primitivos) porArquivo.set(c.arquivo, [...(porArquivo.get(c.arquivo) ?? []), c]);
    const grupos = [...porArquivo.entries()].map(([arquivo, cs]) => ({ arquivo, cs, usos: cs.reduce((t, c) => t + c.usos, 0) })).sort((a, b) => b.usos - a.usos || a.arquivo.localeCompare(b.arquivo));
    linhas.push("## Componentes base", "", "Os primitivos do projeto, do mais usado para o menos usado.", "", "| Importar de | Componentes | Usos |", "|---|---|---|");
    for (const g of grupos) {
      linhas.push(`| \`${caminhoDeImport(g.arquivo, o.aliases)}\` | ${g.cs.sort((a, b) => b.usos - a.usos || a.nome.localeCompare(b.nome)).map((c) => "`" + c.nome + "`" + (c.padrao ? " (default)" : "")).join(", ")} | ${g.usos} |`);
    }
    linhas.push("");
  }
  if (outros.length) {
    linhas.push("## Componentes compartilhados", "", "Fora da pasta de primitivos, usados em cinco lugares ou mais.", "", "| Componente | Importar de | Usos |", "|---|---|---|");
    for (const c of outros) linhas.push(`| \`${c.nome}\` | \`${caminhoDeImport(c.arquivo, o.aliases)}\` | ${c.usos} |`);
    linhas.push("");
  }

  // Nomear a alucinação funciona melhor que uma regra genérica: o modelo reconhece o
  // padrão. Só entra o que o projeto de fato não tem, com o que usar no lugar.
  // O substituto precisa ser componente do projeto. `Text` importado de uma biblioteca
  // de ícones existe para o compilador, mas mandar usá-lo no lugar de Typography seria
  // trocar uma alucinação por outra.
  const doProjeto = new Set(catalogo.map((c) => c.nome));
  const naoExistem: string[] = [];
  for (const [comum, equivalentes] of Object.entries(EQUIVALENTES_COMUNS)) {
    if (conhecidos.has(comum)) continue;
    const usar = equivalentes.find((e) => doProjeto.has(e));
    if (usar) naoExistem.push(`- Não existe \`${comum}\`: use \`${usar}\`.`);
  }
  const layout = LAYOUT_DE_OUTRAS.filter((n) => !conhecidos.has(n));
  if (layout.length && o.tailwind) naoExistem.push(`- Não existem ${layout.map((n) => "`" + n + "`").join(", ")}: são de outras bibliotecas. Use um elemento HTML com as utilitárias do Tailwind.`);
  if (naoExistem.length) linhas.push("## O que não existe neste projeto", "", ...naoExistem, "");

  const tokens = o.sistema.tokens.filter((t) => !deBiblioteca(t.nome));
  if (tokens.length) {
    linhas.push("## Tokens", "");
    const fatos: string[] = [];
    if (o.sistema.espaco.base) fatos.push(`passo de espaçamento de ${o.sistema.espaco.base}px`);
    if (o.sistema.escalaDeTexto.length) fatos.push(`escala de texto ${o.sistema.escalaDeTexto.join(", ")}px`);
    linhas.push(`Primeiro os que o autor explicou no comentário, depois os mais usados no código; o número entre colchetes é quantas vezes cada um aparece. Escolha pelo papel do elemento, não pelo valor: dois tokens com a mesma cor podem ter papéis diferentes.${fatos.length ? " O projeto tem " + fatos.join(" e ") + "." : ""}`, "");
    const usos = usosDeTokens(tokens, o.codigo);
    const ordem = (a: TokenDesign, b: TokenDesign) => Number(!a.intencao) - Number(!b.intencao) || (usos.get(b.nome) ?? 0) - (usos.get(a.nome) ?? 0) || a.nome.localeCompare(b.nome);
    for (const categoria of ORDEM_CATEGORIAS) {
      const daCategoria = tokens.filter((t) => t.categoria === categoria).sort(ordem);
      if (!daCategoria.length) continue;
      linhas.push(`### ${TITULO_CATEGORIA[categoria]}`, "");
      for (const t of daCategoria.slice(0, 60)) linhas.push(`- \`var(${t.nome})\` [${usos.get(t.nome) ?? 0}] — \`${celula(t.valor)}\`${t.intencao ? " — " + celula(t.intencao) : ""}`);
      if (daCategoria.length > 60) linhas.push(`- … e mais ${daCategoria.length - 60}: \`listar_tokens\` traz todos.`);
      linhas.push("");
    }
  }

  const verificar = ["typecheck", "lint"].filter((s) => o.scripts[s]).map((s) => `\`npm run ${s}\``);
  linhas.push("## Verificação", "");
  if (verificar.length) linhas.push(`Depois de gerar UI, rode ${verificar.join(" e ")} e corrija o que falhar. Não diga que terminou antes de passarem.`, "");
  linhas.push("Se algum arquivo de agente citar um componente ou token, `anotador agentes` confere se o nome ainda existe no código.");
  return linhas.join("\n") + "\n";
}
