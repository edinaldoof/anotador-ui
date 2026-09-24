import assert from "node:assert/strict";
import { test } from "node:test";
import { lerSistemaDeDesign } from "../lib/design.ts";
import type { ArquivoFonte } from "../lib/fonte.ts";
import { analisarUso, linhasDoUso, superficieDe } from "../lib/uso.ts";

const arquivo = (relativo: string, texto: string): ArquivoFonte => ({ relativo, linhas: texto.split("\n") });

// Um app pequeno com cada armadilha do playbook: texto de 11px fora de qualquer escala,
// a cor da marca escrita à mão onde dois tokens têm o mesmo valor, um botão cru ao lado
// do Button do sistema, e um subcomponente que ninguém usa.
const projeto: ArquivoFonte[] = [
  arquivo("app/globals.css", [
    '@import "tailwindcss";',
    "@theme {",
    "  --color-action-primary: #046b66;",
    "  --color-brand-teal: #046b66; /* marca; nunca em botão */",
    "  --spacing-tight: 8px;",
    "  --spacing-stack: 16px;",
    "  --spacing-section: 24px;",
    "  --spacing-page: 32px;",
    "}",
    ".aviso { padding: 12px; font-size: 14px; }",
    ".cartao { padding: var(--spacing-stack); }",
  ].join("\n")),
  arquivo("components/ui/button.tsx", "export function Button() { return <button />; }\n"),
  arquivo("components/ui/card.tsx", "export function Card() { return null; }\nexport function CardFooter() { return null; }\n"),
  arquivo("components/ui/select.tsx", "export function NativeSelect() { return <select />; }\n"),
  arquivo("app/(portal)/painel/page.tsx", [
    'import { Button } from "@/components/ui/button";',
    'import { Card } from "@/components/ui/card";',
    "export default function Painel() {",
    "  return (",
    '    <Card>',
    '      <p className="text-[11px] text-[0.6875rem]">prazo</p>',
    '      <span className="bg-[#046b66]">novo</span>',
    '      <form><input type="hidden" name="id" /><input name="busca" /></form>',
    "      <Button>Salvar</Button>",
    "      <Button",
    "        type=\"submit\"",
    "      >Enviar</Button>",
    '      <button onClick={() => {}}>×</button>',
    "    </Card>",
    "  );",
    "}",
  ].join("\n")),
  arquivo("app/(portal)/painel/page.stories.tsx", "export const Historia = () => <button>demo</button>;\n"),
];

test("literais no código: cada valor com o token que existe — ou o aviso de que a escolha é de papel", () => {
  const r = analisarUso(projeto, lerSistemaDeDesign(projeto));
  const por = (valor: string, categoria: string) => r.literais.find((l) => l.valor === valor && l.categoria === categoria);

  // `text-[11px]` e `text-[0.6875rem]` são o mesmo tamanho, escrito de dois jeitos.
  const onze = por("11px", "texto");
  assert.equal(onze?.usos, 2);
  assert.equal(onze?.foraDaEscala, true);
  assert.equal(onze?.proximo, "text-xs (12px)", "sem escala declarada, o Tailwind é a escala");
  assert.equal(por("14px", "texto")?.usar, "text-sm");

  // Dois tokens crus com a mesma cor: recomendar um seria escolher o papel pelo valor.
  const cor = por("#046b66", "cor");
  assert.equal(cor?.usar, null);
  assert.deepEqual(cor?.papeis.sort(), ["--color-action-primary", "--color-brand-teal"]);

  const doze = por("12px", "espaco");
  assert.equal(doze?.foraDaEscala, true, "12px não é múltiplo do passo de 8px");
  assert.ok(!r.literais.some((l) => l.valor === "16px"), "var(--spacing-stack) não é literal");
  assert.ok(!r.literais.some((l) => l.onde.some((o) => o.includes(".stories."))), "história de Storybook não conta");
});

test("cobertura: elemento cru só pesa contra o sistema quando o sistema tem o equivalente", () => {
  const r = analisarUso(projeto, lerSistemaDeDesign(projeto));
  // Button existe: o <button> da página conta. Input não existe: o <input> não é falta
  // de adoção, é componente que ainda não foi feito. O hidden nunca conta. E o <select>
  // dentro de components/ui é o próprio sistema sendo construído.
  assert.deepEqual(r.cobertura, [{ elemento: "button", componente: "Button", cru: 1, doSistema: 2 }]);
  assert.deepEqual(r.porSuperficie, [{ superficie: "painel", cru: 1, doSistema: 2 }]);
  assert.deepEqual(r.semUso.map((c) => c.nome), ["CardFooter", "NativeSelect"]);
  assert.deepEqual(r.nucleo.filter((n) => n.noProjeto).map((n) => n.componente), ["Button", "Card"]);

  const texto = linhasDoUso(r).join("\n");
  assert.match(texto, /núcleo do playbook: 2 de 10 — falta Input, Select, Modal, Toast, Tabs, Table, Badge, Tooltip/);
  assert.match(texto, /cobertura: 67% dos controles usam o sistema/);
  assert.match(texto, /11px \(texto\) ×2 · fora da escala · abaixo de 12px — sem token; o mais perto é text-xs \(12px\)/);
});

test("a tela de cada arquivo, como alguém do time a chamaria", () => {
  assert.equal(superficieDe("app/(portal)/painel/page.tsx"), "painel");
  assert.equal(superficieDe("app/(auth)/entrar/_partes/form.tsx"), "entrar");
  assert.equal(superficieDe("app/page.tsx"), "raiz");
  assert.equal(superficieDe("src/components/features/projetos/lista.tsx"), "projetos");
  assert.equal(superficieDe("components/layout/header.tsx"), "layout");
});
