// Motor de regras normativas emprestado do projeto anotado.
//
// O anotador não tem dependências e não vai ter: o axe-core que ele usa é o que já
// existe no `node_modules` do projeto que está sendo anotado. Qualquer projeto Next
// com o lint padrão o traz por transitividade (eslint-config-next → eslint-plugin-jsx-a11y
// → axe-core), e onde ele não existir a aba simplesmente não aparece.
//
// A régua própria do anotador mede geometria: alinhamento, vãos, altura de controles,
// transbordo. Nenhum motor de acessibilidade mede isso. O axe mede o oposto: semântica,
// ARIA, landmarks, tabelas. As duas se somam e nenhuma substitui a outra — medido na
// página de defeitos, onde a régua pegou 12 de 12 e o axe pegou 4, trazendo em troca
// duas faltas de landmark que a régua não enxerga.

import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface MotorNorma {
  /** caminho absoluto do axe.min.js encontrado */
  caminho: string;
  versao: string;
  /** de onde veio, para explicar na interface */
  origem: string;
}

/**
 * Regras normativas e vigentes que o axe entrega desligadas. Quem chama `axe.run()`
 * de fábrica nunca as vê e recebe um verde que não mediu o que diz medir.
 * As chaves são os critérios de sucesso que cada uma cobre.
 */
export const REGRAS_A_LIGAR: Record<string, string> = {
  "aria-roledescription": "WCAG 2.0 A, 4.1.2 — nome, função, valor",
  "audio-caption": "WCAG 2.0 A, 1.2.1 — alternativa para áudio",
  "css-orientation-lock": "WCAG 2.1 AA, 1.3.4 — não travar a orientação da tela",
  "label-content-name-mismatch": "WCAG 2.1 A, 2.5.3 — rótulo visível dentro do nome acessível",
  "p-as-heading": "WCAG 2.0 A, 1.3.1 — parágrafo em negrito fingindo de título",
  "table-fake-caption": "WCAG 2.0 A, 1.3.1 — legenda de tabela feita com célula",
  "td-has-header": "WCAG 2.0 A, 1.3.1 — célula de dado sem cabeçalho",
  "target-size": "WCAG 2.2 AA, 2.5.8 — alvo de toque de 24px",
};

/**
 * As que continuam desligadas, e por quê. Ligar tudo o que está desligado encheria o
 * painel de ruído e faria o usuário parar de ler — que é o único jeito de uma régua
 * morrer de vez.
 */
export const REGRAS_QUE_FICAM_FORA: Record<string, string> = {
  "color-contrast-enhanced": "nível AAA, acima do que o projeto se comprometeu a cumprir",
  "identical-links-same-purpose": "nível AAA, e acende em navegação legítima com links repetidos",
  "meta-refresh-no-exceptions": "nível AAA; a versão normativa do mesmo critério já está ligada",
  "duplicate-id": "critério 4.1.1 foi removido da WCAG 2.2 por não descrever barreira real",
  "duplicate-id-active": "mesmo motivo do anterior: o critério 4.1.1 saiu da norma",
  "focus-order-semantics": "experimental, sem critério normativo por trás",
  "hidden-content": "experimental; só avisa que existe conteúdo oculto que ele não mediu",
  "landmark-complementary-is-top-level": "boa prática sem critério normativo",
};

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

async function versaoEm(pasta: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(pasta, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "desconhecida";
  } catch {
    return "desconhecida";
  }
}

/**
 * Procura o axe-core na árvore do projeto anotado. Tenta primeiro a resolução normal
 * de módulos, que cobre npm e yarn; o gestor pnpm esconde dependência transitiva fora
 * do topo, então há um segundo caminho direto para a pasta virtual dele.
 */
export async function localizarNorma(raizProjeto: string | null): Promise<MotorNorma | null> {
  if (!raizProjeto) return null;

  try {
    const exigir = createRequire(join(raizProjeto, "package.json"));
    const pkg = exigir.resolve("axe-core/package.json");
    const pasta = dirname(pkg);
    const arquivo = join(pasta, "axe.min.js");
    if (await existe(arquivo)) {
      return { caminho: arquivo, versao: await versaoEm(pasta), origem: "node_modules do projeto" };
    }
  } catch {
    // segue para a busca direta
  }

  const diretos = [join(raizProjeto, "node_modules", "axe-core")];
  try {
    const { readdir } = await import("node:fs/promises");
    const virtuais = await readdir(join(raizProjeto, "node_modules", ".pnpm")).catch(() => [] as string[]);
    for (const nome of virtuais) {
      if (nome.startsWith("axe-core@")) diretos.push(join(raizProjeto, "node_modules", ".pnpm", nome, "node_modules", "axe-core"));
    }
  } catch {
    // sem .pnpm, nada a fazer
  }

  for (const pasta of diretos) {
    const arquivo = join(pasta, "axe.min.js");
    if (await existe(arquivo)) {
      return { caminho: arquivo, versao: await versaoEm(pasta), origem: pasta.includes(".pnpm") ? "store do pnpm" : "node_modules do projeto" };
    }
  }
  return null;
}
