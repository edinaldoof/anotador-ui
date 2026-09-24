import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogoDeComponentes, nomesConhecidos } from "../lib/componentes.ts";
import type { ArquivoFonte } from "../lib/fonte.ts";

const arquivo = (relativo: string, texto: string): ArquivoFonte => ({ relativo, linhas: texto.split("\n") });

// Cada caso aqui é um erro que a comparação com o parser do TypeScript encontrou no
// Pré-Projetos: constante virando componente, reexportação contada em dobro, homônimos
// dividindo os usos errado.
const projeto: ArquivoFonte[] = [
  arquivo("components/features/fluxo/constantes.tsx", "export const NODE_WIDTH = 180;\nexport const DEFAULT = 1;\nexport function Diagrama() { return null; }\n"),
  arquivo("components/ui/button.tsx", "function Button() { return null; }\nfunction buttonVariants() {}\nexport {\n  Button,\n  buttonVariants,\n};\n"),
  arquivo("components/features/fluxo/indice.tsx", 'export { Diagrama } from "./constantes";\n'),
  arquivo("components/features/parametros/section-nav.tsx", "export function SectionNav() { return null; }\n"),
  arquivo("components/features/projetos/section-nav.tsx", "export function SectionNav() { return null; }\n"),
  arquivo("app/parametros/page.tsx", 'import {\n  SectionNav,\n} from "@/components/features/parametros/section-nav";\nimport { Button as Botao } from "@/components/ui/button";\nexport default function Pagina() { return <><SectionNav /><Botao /><Botao\n /></>; }\n'),
  arquivo("components/features/projetos/editor.tsx", 'import { SectionNav } from "./section-nav";\nimport { Diagrama } from "../fluxo/indice";\nexport function Editor() { return <><SectionNav /><SectionNav /><Diagrama /></>; }\n'),
];

test("constante em caixa alta não é componente, e reexportação não é definição", () => {
  const nomes = catalogoDeComponentes(projeto).map((c) => `${c.nome}@${c.arquivo}`).sort();
  assert.deepEqual(nomes, [
    "Button@components/ui/button.tsx",
    "Diagrama@components/features/fluxo/constantes.tsx",
    "Editor@components/features/projetos/editor.tsx",
    "Pagina@app/parametros/page.tsx",
    "SectionNav@components/features/parametros/section-nav.tsx",
    "SectionNav@components/features/projetos/section-nav.tsx",
  ]);
  assert.ok(!nomesConhecidos(projeto).has("NODE"), "NODE_WIDTH não vira o nome NODE");
  assert.ok(!nomesConhecidos(projeto).has("DEFAULT"));
});

test("cada uso vai para o componente que o arquivo importou — com alias, caminho relativo ou reexportação", () => {
  const uso = new Map(catalogoDeComponentes(projeto).map((c) => [`${c.nome}@${c.arquivo}`, c.usos]));
  assert.equal(uso.get("SectionNav@components/features/parametros/section-nav.tsx"), 1, "import com alias @/, em várias linhas");
  assert.equal(uso.get("SectionNav@components/features/projetos/section-nav.tsx"), 2, "import relativo ./section-nav");
  assert.equal(uso.get("Button@components/ui/button.tsx"), 2, "<Botao> é o Button importado com outro nome, inclusive com a tag sozinha na linha");
  assert.equal(uso.get("Diagrama@components/features/fluxo/constantes.tsx"), 1, "importado pela reexportação, conta para onde ele mora");
  const assinatura = catalogoDeComponentes(projeto).find((c) => c.nome === "Button")?.assinatura;
  assert.equal(assinatura, "function Button() { return null; }", "a assinatura é a da definição, não a da lista de export");
});
