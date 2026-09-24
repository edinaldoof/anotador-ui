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

// Os fundamentos que o código deixa conferir: duração escrita à mão onde o sistema tem
// token, a que passa do orçamento, a curva, o rótulo em caixa-alta com três espaçamentos
// de letra e as animações com e sem variante de movimento reduzido.
const movimento: ArquivoFonte[] = [
  arquivo("app/globals.css", [
    '@import "tailwindcss";',
    "@theme {",
    "  --motion-duration-feedback: 150ms;",
    "  --motion-duration-panel: 300ms; /* painel que expande */",
    "  --motion-ease-intro: cubic-bezier(0.22, 1, 0.36, 1);",
    "}",
    ".cartao { transition: box-shadow 0.3s ease, transform 700ms cubic-bezier(0.22, 1, 0.36, 1); line-height: 1.4; font-weight: 600; }",
    ".girar { animation: girar 1s linear infinite; }",
  ].join("\n")),
  arquivo("app/painel/page.tsx", [
    "export default function Painel() {",
    "  return (<>",
    '    <p className="text-xs font-bold uppercase tracking-[0.13em]">Prazo</p>',
    '    <p className="text-xs font-bold uppercase tracking-[.12em]">Status</p>',
    '    <p className="text-xs font-bold uppercase tracking-[0.10em]">Fase</p>',
    '    <p className="font-light leading-[1.3] duration-200 transition-opacity">nota</p>',
    '    <div className="animate-spin" /><div className="motion-safe:animate-pulse" />',
    '    <div className="data-[state=open]:animate-in zoom-in-95 motion-reduce:animate-none" />',
    "  </>);",
    "}",
  ].join("\n")),
];

test("movimento no código: o token que já existe, o orçamento de 500ms e o spinner que é loop", () => {
  const r = analisarUso(movimento, lerSistemaDeDesign(movimento));
  const por = (valor: string) => r.literais.find((l) => l.categoria === "movimento" && l.valor === valor);
  assert.equal(por("300ms")?.usar, "var(--motion-duration-panel)", "o 0.3s do CSS é o token de 300ms");
  assert.equal(por("700ms")?.acimaDoOrcamento, true);
  assert.equal(por("1000ms")?.acimaDoOrcamento, false, "animação em loop não é transição lenta");
  assert.equal(por("200ms")?.usar, null, "duration-200 é número solto no Tailwind 4 e não tem token de 200ms");
  assert.equal(por("cubic-bezier(0.22,1,0.36,1)")?.usar, "var(--motion-ease-intro)");
  assert.deepEqual(r.duracoes, [150, 300]);

  // Quem pediu movimento reduzido: o spinner cru e a animação de CSS em arquivo sem a
  // media query seguem; motion-safe e motion-reduce contam como tratados.
  assert.equal(r.movimentoReduzido.pisoGlobal, null);
  assert.equal(r.movimentoReduzido.tratadas, 2);
  assert.deepEqual(r.movimentoReduzido.quais, [{ nome: "animate-spin", usos: 1 }, { nome: "girar", usos: 1 }]);

  const texto = linhasDoUso(r).join("\n");
  assert.match(texto, /movimento: tokens de 150, 300ms; à mão no código: .*300ms ×1 \(use var\(--motion-duration-panel\)\).*700ms ×1 \(acima de 500ms\)/);
  assert.match(texto, /movimento reduzido: 2 animação\(ões\) sem variante \(animate-spin ×1, girar ×1\), 2 com — loop decorativo deveria parar/);
  assert.match(texto, /700ms \(movimento\) ×1 · acima de 500ms/);

  // Um piso global — o * que zera animação e transição — trata tudo de uma vez.
  const comPiso = [...movimento, arquivo("app/movimento.css", "@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n")];
  const comPisoUso = analisarUso(comPiso, lerSistemaDeDesign(comPiso));
  assert.equal(comPisoUso.movimentoReduzido.pisoGlobal, "app/movimento.css:1");
  assert.equal(comPisoUso.movimentoReduzido.semVariante, 0);
  assert.ok(!comPisoUso.literais.some((l) => l.valor === "0.01ms"), "o 0.01ms do piso é desligar, não duração escrita à mão");
});

test("tipografia no código: a escada de pesos, e o mesmo rótulo com três espaçamentos de letra", () => {
  const r = analisarUso(movimento, lerSistemaDeDesign(movimento));
  assert.deepEqual(r.pesos, [{ peso: 300, usos: 1 }, { peso: 600, usos: 1 }, { peso: 700, usos: 3 }]);
  const letras = r.literais.filter((l) => l.categoria === "entreletra").map((l) => [l.valor, l.usos, l.caixaAlta, l.usar]);
  // `.12em` e `0.10em` escritos de outro jeito continuam sendo 0.12em e 0.1em.
  assert.deepEqual(letras.sort(), [["0.12em", 1, 1, null], ["0.13em", 1, 1, null], ["0.1em", 1, 1, "tracking-widest"]]);
  const linha = (padrao: RegExp) => linhasDoUso(r).find((l) => padrao.test(l)) ?? "";
  assert.match(linha(/entreletra:/), /3 valores escritos à mão em 3 lugares \(.*\), 3 em texto caixa-alta — é o mesmo papel escrito de 3 jeitos; um token resolve/);
  assert.match(linha(/pesos em uso/), /300 ×1 · 600 ×1 · 700 ×3 — 3 peso\(s\), dentro do limite de 4 do playbook/);
  const entrelinha = r.literais.filter((l) => l.categoria === "entrelinha").map((l) => [l.valor, l.usar, l.proximo]);
  assert.deepEqual(entrelinha.sort(), [["1.3", null, "leading-tight (1.25)"], ["1.4", null, "leading-snug (1.375)"]]);
});
