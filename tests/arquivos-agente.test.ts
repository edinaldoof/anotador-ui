import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { aliasesDoTsconfig, conferirArquivosDeAgente, gerarSkillDeDesign, lerArquivosDeAgente, usosDeTokens } from "../lib/arquivos-agente.ts";
import { catalogoDeComponentes } from "../lib/componentes.ts";
import { lerSistemaDeDesign } from "../lib/design.ts";
import { lerProjeto } from "../lib/fonte.ts";

const RAIZ = new URL("..", import.meta.url).pathname;

async function escrever(pasta: string, relativo: string, texto: string): Promise<void> {
  await mkdir(join(pasta, relativo, ".."), { recursive: true });
  await writeFile(join(pasta, relativo), texto);
}

// Um app Next pequeno: Dialog e Popover do projeto, um Text que só existe importado de
// uma biblioteca de ícones, tokens com e sem intenção, e o uso em JSX multilinha.
async function criarProjeto(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-agentes-"));
  await escrever(pasta, "tsconfig.json", '{\n  // JSONC, como o Next gera\n  "compilerOptions": {\n    "paths": { "@/*": ["./*"], "@pacotes/*": ["./packages/*/src"], },\n  },\n}\n');
  await escrever(pasta, "package.json", JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "eslint ." }, dependencies: { tailwindcss: "^4.0.0" } }));
  await escrever(pasta, "app/globals.css", [
    '@import "tailwindcss";',
    "@theme {",
    "  --color-action-primary: #046b66;",
    "  --color-brand-teal: #046b66; /* campo institucional; nunca em botão */",
    "  --color-surface-card: #fafafa;",
    "  --spacing-rhythm: 16px;",
    "}",
  ].join("\n"));
  await escrever(pasta, "components/ui/dialog.tsx", "export function Dialog() { return null; }\nexport function DialogContent() { return null; }\nexport type DialogProps = { open: boolean };\n");
  await escrever(pasta, "components/ui/popover.tsx", "function Popover() { return null; }\nexport { Popover };\n");
  await escrever(pasta, "components/ui/dialog.stories.tsx", "export const Historia = () => <Dialog />;\n");
  await escrever(pasta, "app/page.tsx", [
    'import { Text } from "lucide-react";',
    'import { Dialog, DialogContent } from "@/components/ui/dialog";',
    'import { Popover } from "@/components/ui/popover";',
    "export default function Page() {",
    "  return (",
    "    <Dialog",
    '      open',
    "    >",
    '      <DialogContent className="bg-action-primary p-rhythm" />',
    "      <Popover />",
    "      <Text />",
    "    </Dialog>",
    "  );",
    "}",
  ].join("\n"));
  return pasta;
}

describe("arquivos de agente conferidos contra o código", () => {
  let pasta = "";
  before(async () => { pasta = await criarProjeto(); });
  after(async () => { await rm(pasta, { recursive: true, force: true }); });

  test("nome citado que o código não tem é achado, com o parecido que existe", async () => {
    await escrever(pasta, "AGENTS.md", [
      "# Regras",
      "Botões usam `var(--color-action-primary)` e o espaço `var(--spacing-rythm)`.",
      "Para confirmar, abra um <Dialogo> ou use `PopOver`.",
      '```tsx\nimport { Dialog, DialogContent, DialogProps } from "@/components/ui/dialog";\n```',
      "Ícones vêm do lucide: <Text />.",
      "<!-- nota para quem escreve: <Esquecido> não deve ser conferido -->",
      "Use <Dialog> em vez de <Modal>.",
      "## Componentes que não existem",
      "- <Box>, <Stack>",
      "## Voltando às regras",
      "| Removido | Use |",
      "|---|---|",
      "| <Antigo> | <Dialog> |",
    ].join("\n"));
    const codigo = await lerProjeto(pasta);
    const { arquivos, skillsVazias } = await lerArquivosDeAgente(pasta, codigo);
    const achados = conferirArquivosDeAgente(arquivos, codigo, lerSistemaDeDesign(codigo), skillsVazias);
    assert.deepEqual(achados.map((a) => [a.tipo, a.nome, a.linha, a.sugestao]), [
      ["token", "--spacing-rythm", 2, "--spacing-rhythm"],
      ["componente", "Dialogo", 3, "Dialog"],
      ["componente", "PopOver", 3, "Popover"],
    ]);
    // O resto é de propósito: tipo exportado, componente de biblioteca, comentário,
    // o lado errado de "em vez de", seção e tabela que listam o que não existe.
  });

  test("skill sem SKILL.md, frontmatter fora do padrão e AGENTS.md comprido demais", async () => {
    const outra = await mkdtemp(join(tmpdir(), "anotador-agentes-forma-"));
    try {
      await mkdir(join(outra, ".claude", "skills", "vazia"), { recursive: true });
      await escrever(outra, ".agents/skills/ui/SKILL.md", "---\nname: interface\ndescription: Use para <qualquer> tela.\n---\n# UI\n");
      await escrever(outra, "AGENTS.md", Array.from({ length: 230 }, (_, i) => `linha ${i}`).join("\n"));
      const { arquivos, skillsVazias } = await lerArquivosDeAgente(outra);
      assert.deepEqual(skillsVazias, [".claude/skills/vazia"]);
      const achados = conferirArquivosDeAgente(arquivos, [], lerSistemaDeDesign([]), skillsVazias);
      assert.deepEqual(achados.map((a) => [a.tipo, a.arquivo, a.nome]), [
        ["skill", ".claude/skills/vazia", "vazia"],
        ["skill", ".agents/skills/ui/SKILL.md", "interface"],
        ["skill", ".agents/skills/ui/SKILL.md", "frontmatter"],
        ["tamanho", "AGENTS.md", "AGENTS.md"],
      ]);
    } finally { await rm(outra, { recursive: true, force: true }); }
  });

  test("CLI: documento desatualizado sai com código 1, que é o que barra o CI", async () => {
    const rodar = () => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(RAIZ, "server.ts"), "agentes", "--fonte", pasta], { encoding: "utf8" });
    await escrever(pasta, "AGENTS.md", "Use `Dialogo`.\n");
    const ruim = rodar();
    assert.equal(ruim.status, 1, ruim.stderr);
    assert.match(ruim.stdout, /\[componente\] AGENTS\.md:1 {2}Dialogo {2}→ talvez Dialog/);
    await escrever(pasta, "AGENTS.md", "Use `Dialog`.\n");
    const bom = rodar();
    assert.equal(bom.status, 0, bom.stderr);
    assert.match(bom.stdout, /todo nome citado existe no código/);
  });
});

describe("skill de design gerada do código", () => {
  let pasta = "";
  before(async () => { pasta = await criarProjeto(); });
  after(async () => { await rm(pasta, { recursive: true, force: true }); });

  test("alias do tsconfig com comentário e vírgula sobrando; curinga no meio fica de fora", async () => {
    assert.deepEqual(await aliasesDoTsconfig(pasta), [{ prefixo: "@/", pasta: "" }]);
  });

  test("uso em JSX de várias linhas conta, e história de Storybook não", async () => {
    const catalogo = catalogoDeComponentes(await lerProjeto(pasta));
    // A página também é um export em PascalCase: entra no catálogo, com zero usos, e fica
    // de fora da skill pelo corte de cinco usos.
    assert.deepEqual(catalogo.map((c) => [c.nome, c.usos]).sort(), [["Dialog", 1], ["DialogContent", 1], ["Page", 0], ["Popover", 1]]);
  });

  test("tokens contam pelo var() e pela utilitária do Tailwind", async () => {
    const codigo = await lerProjeto(pasta);
    const usos = usosDeTokens(lerSistemaDeDesign(codigo).tokens, codigo);
    assert.equal(usos.get("--color-action-primary"), 1, "bg-action-primary");
    assert.equal(usos.get("--spacing-rhythm"), 1, "p-rhythm");
    assert.equal(usos.get("--color-brand-teal") ?? 0, 0);
  });

  test("a skill sai com frontmatter válido, imports reais e só substitutos que o projeto tem", async () => {
    const codigo = await lerProjeto(pasta);
    const skill = gerarSkillDeDesign({ nome: "App <Teste>", codigo, sistema: lerSistemaDeDesign(codigo), aliases: await aliasesDoTsconfig(pasta), scripts: { typecheck: "tsc", lint: "eslint ." }, tailwind: true, hoje: "2026-09-23" });
    const [, frontmatter = ""] = skill.split("---");
    assert.match(frontmatter, /^\nname: design-system\n/);
    assert.doesNotMatch(frontmatter, /[<>]/, "sinal de < ou > no frontmatter pode injetar instrução");
    assert.ok((/description: (.*)/.exec(frontmatter)?.[1] ?? "").length <= 1024);
    assert.match(skill, /\| `@\/components\/ui\/dialog` \| `Dialog`, `DialogContent` \| 2 \|/);
    assert.match(skill, /Não existe `Modal`: use `Dialog`\./);
    assert.match(skill, /Não existe `Popup`: use `Popover`\./);
    // Text existe, mas importado do lucide: não é componente do projeto e não vira
    // substituto de Typography.
    assert.doesNotMatch(skill, /Typography/);
    assert.match(skill, /Não existem `Box`, `Stack`.*utilitárias do Tailwind/);
    // O token explicado vem antes, mesmo sem uso; depois os mais usados.
    const cor = skill.slice(skill.indexOf("### Cor"));
    assert.ok(cor.indexOf("--color-brand-teal") < cor.indexOf("--color-action-primary"));
    assert.match(skill, /`var\(--color-brand-teal\)` \[0\] — `#046b66` — campo institucional; nunca em botão/);
    assert.match(skill, /rode `npm run typecheck` e `npm run lint`/);
    // O conferidor aceita o que o gerador produz: a skill não pode nascer desatualizada.
    await escrever(pasta, ".claude/skills/design-system/SKILL.md", skill);
    const { arquivos, skillsVazias } = await lerArquivosDeAgente(pasta, codigo);
    assert.deepEqual(conferirArquivosDeAgente(arquivos, codigo, lerSistemaDeDesign(codigo), skillsVazias), []);
  });
});
