// Avaliação de uma página: a medição objetiva feita no navegador vira um dossiê,
// o agente julga o que a medição não alcança (hierarquia, clareza, elegância) e
// devolve um parecer. Guardado ao lado dos lotes, no mesmo diretório do projeto.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PaginaAvaliada {
  url: string;
  caminho: string;
  titulo: string;
  viewport: { largura: number; altura: number; dpr: number };
  tema: string | null;
}

export interface PedidoAvaliacao {
  id: string;
  em: string;
  pagina: PaginaAvaliada;
  contexto: Record<string, unknown>;
  achados: AchadoAuditoria[];
  /** o que a pessoa quer que seja olhado com atenção */
  foco: string | null;
  instantaneo: string | null;
}

export interface ItemParecer {
  titulo: string;
  categoria: string;
  gravidade: "alta" | "media" | "baixa";
  seletor?: string | null;
  problema: string;
  sugestao: string;
  comoAplicar?: string;
}

export interface Parecer {
  agente: string;
  em: string;
  resumo: string;
  itens: ItemParecer[];
}

export interface RegistroAvaliacao {
  id: string;
  em: string;
  url: string;
  titulo: string;
  achados: number;
  temParecer: boolean;
}

const CATEGORIAS_PARECER = ["hierarquia", "espacamento", "contraste", "consistencia", "clareza", "intuitividade", "elegancia", "conteudo", "acessibilidade"];

export function validarPedido(bruto: unknown): PedidoAvaliacao {
  if (!bruto || typeof bruto !== "object") throw new Error("corpo vazio");
  const o = bruto as Record<string, unknown>;
  const pagina = o["pagina"] as Record<string, unknown> | undefined;
  if (!pagina || typeof pagina["url"] !== "string") throw new Error("falta a página");
  const achados = Array.isArray(o["achados"]) ? (o["achados"] as AchadoAuditoria[]) : [];
  if (achados.length > 500) throw new Error("achados demais");
  const viewport = (pagina["viewport"] ?? {}) as Record<string, unknown>;
  return {
    id: typeof o["id"] === "string" ? o["id"] : crypto.randomUUID(),
    em: new Date().toISOString(),
    pagina: {
      url: pagina["url"],
      caminho: typeof pagina["caminho"] === "string" ? pagina["caminho"] : "/",
      titulo: typeof pagina["titulo"] === "string" ? pagina["titulo"] : "",
      viewport: {
        largura: Number(viewport["largura"]) || 0,
        altura: Number(viewport["altura"]) || 0,
        dpr: Number(viewport["dpr"]) || 1,
      },
      tema: typeof pagina["tema"] === "string" ? pagina["tema"] : null,
    },
    contexto: (o["contexto"] ?? {}) as Record<string, unknown>,
    achados,
    foco: typeof o["foco"] === "string" && o["foco"].trim() ? o["foco"].trim().slice(0, 500) : null,
    instantaneo: typeof o["instantaneo"] === "string" ? o["instantaneo"] : null,
  };
}

export function validarParecer(bruto: unknown, agentePadrao: string): Parecer {
  if (!bruto || typeof bruto !== "object") throw new Error("corpo vazio");
  const o = bruto as Record<string, unknown>;
  const itensBrutos = Array.isArray(o["itens"]) ? o["itens"] : [];
  const itens: ItemParecer[] = [];
  for (const i of itensBrutos.slice(0, 60)) {
    if (!i || typeof i !== "object") continue;
    const it = i as Record<string, unknown>;
    const titulo = typeof it["titulo"] === "string" ? it["titulo"].trim() : "";
    const problema = typeof it["problema"] === "string" ? it["problema"].trim() : "";
    const sugestao = typeof it["sugestao"] === "string" ? it["sugestao"].trim() : "";
    if (!titulo || !problema || !sugestao) continue;
    const categoria = typeof it["categoria"] === "string" && CATEGORIAS_PARECER.includes(it["categoria"]) ? it["categoria"] : "clareza";
    const gravidade = it["gravidade"] === "alta" || it["gravidade"] === "baixa" ? it["gravidade"] : "media";
    const item: ItemParecer = { titulo: titulo.slice(0, 140), categoria, gravidade, problema: problema.slice(0, 800), sugestao: sugestao.slice(0, 800) };
    if (typeof it["seletor"] === "string" && it["seletor"].trim()) item.seletor = it["seletor"].trim().slice(0, 300);
    if (typeof it["comoAplicar"] === "string" && it["comoAplicar"].trim()) item.comoAplicar = it["comoAplicar"].trim().slice(0, 800);
    itens.push(item);
  }
  if (!itens.length && typeof o["resumo"] !== "string") throw new Error("parecer sem itens nem resumo");
  return {
    agente: typeof o["agente"] === "string" && o["agente"].trim() ? o["agente"].trim().slice(0, 40) : agentePadrao,
    em: new Date().toISOString(),
    resumo: typeof o["resumo"] === "string" ? o["resumo"].trim().slice(0, 1500) : "",
    itens,
  };
}

const SINAL = { alta: "⚠", media: "•", baixa: "·" } as const;

export function gerarDossie(pedido: PedidoAvaliacao, extras: { porta: number; sistema?: string | null; captura?: string | null }): string {
  const p = pedido.pagina;
  const linhas: string[] = [
    `# Avaliação de página ${pedido.id}`,
    "",
    `- Página: ${p.url}${p.titulo ? ` — "${p.titulo}"` : ""}`,
    `- Viewport: ${p.viewport.largura}×${p.viewport.altura} @${p.viewport.dpr}x${p.tema ? ` · tema ${p.tema}` : ""}`,
    `- Medição: ${(pedido.contexto["medidos"] as number) ?? "?"} elementos visíveis, ${pedido.achados.length} achado(s) objetivo(s)`,
  ];
  if (extras.captura) linhas.push(`- Captura da página: ${extras.captura}`);
  if (pedido.foco) linhas.push(`- **Pedido de quem abriu:** ${pedido.foco}`);

  linhas.push("", "## Já medido — não reconfira, use como base", "");
  if (!pedido.achados.length) {
    linhas.push("Nada fora do lugar nas regras objetivas (contraste, alvo de toque, hierarquia de cabeçalho, transbordo, alinhamento, consistência de controles).");
  } else {
    linhas.push("| | Regra | Elemento | Evidência |", "| --- | --- | --- | --- |");
    for (const a of pedido.achados.slice(0, 60)) {
      linhas.push(`| ${SINAL[a.gravidade]} | ${a.regra} | \`${a.alvo}\` | ${a.evidencia} |`);
    }
  }

  const estrutura = pedido.contexto["estrutura"] as Record<string, unknown> | undefined;
  if (estrutura) {
    linhas.push("", "## Estrutura da página", "");
    const cabecalhos = estrutura["cabecalhos"] as string[] | undefined;
    if (cabecalhos?.length) linhas.push("Cabeçalhos, na ordem:", ...cabecalhos.map((c) => `- ${c}`), "");
    const marcos = estrutura["marcos"] as string[] | undefined;
    if (marcos?.length) linhas.push(`Marcos: ${marcos.join(", ")}`);
    linhas.push(`Controles: ${estrutura["botoes"] ?? 0} botões, ${estrutura["links"] ?? 0} links, ${estrutura["campos"] ?? 0} campos, ${estrutura["imagens"] ?? 0} imagens`);
  }
  const componentes = pedido.contexto["componentes"] as string[] | undefined;
  if (componentes?.length) linhas.push("", `Componentes React em cena: ${componentes.join(", ")}`);
  if (extras.sistema) linhas.push("", "## Sistema de design do projeto", "", extras.sistema);

  linhas.push(
    "",
    "## O que se espera do seu parecer",
    "",
    "A tabela acima é o que a régua alcança. Julgue o que ela não alcança, **olhando a captura**:",
    "",
    "- **Hierarquia visual**: o olho encontra primeiro o que importa mais? O que compete por atenção?",
    "- **Clareza e intuitividade**: dá para saber, sem ler tudo, qual é a ação principal e o que acontece depois?",
    "- **Consistência**: componentes com o mesmo papel se parecem? Espaçamento e alinhamento seguem um ritmo?",
    "- **Densidade e respiro**: falta ou sobra ar? O agrupamento reflete o significado?",
    "- **Elegância**: o que destoa do conjunto e por quê.",
    "",
    "Regras do parecer: cada item precisa apontar **um elemento concreto** (use o seletor), dizer o **problema** e uma **sugestão aplicável**, na linguagem do projeto (tokens e utilitárias, não valores soltos). Não repita o que já está medido. Se algo estiver bom, não invente defeito — parecer curto e certo vale mais que longo.",
    "",
    "Devolva assim:",
    "",
    "```bash",
    `curl -s -X POST http://127.0.0.1:${extras.porta}/__anotador/avaliacoes/${pedido.id}/parecer \\`,
    `  -H 'content-type: application/json' -d @parecer.json`,
    "```",
    "",
    "```json",
    JSON.stringify(
      {
        resumo: "duas ou três frases sobre a impressão geral",
        itens: [
          {
            titulo: "frase curta do problema",
            categoria: "hierarquia | espacamento | contraste | consistencia | clareza | intuitividade | elegancia | conteudo | acessibilidade",
            gravidade: "alta | media | baixa",
            seletor: "seletor CSS do elemento",
            problema: "o que está acontecendo e por que atrapalha quem usa",
            sugestao: "o que fazer, concreto",
            comoAplicar: "classe ou token do projeto, e onde",
          },
        ],
      },
      null,
      2
    ),
    "```",
  );
  return linhas.join("\n") + "\n";
}

export class Avaliacoes {
  readonly dir: string;

  constructor(base: string) {
    this.dir = join(base, "avaliacoes");
  }

  async preparar(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  caminhoMd(id: string): string {
    return join(this.dir, `${id}.md`);
  }

  async gravar(pedido: PedidoAvaliacao, dossie: string): Promise<void> {
    await this.preparar();
    await writeFile(join(this.dir, `${pedido.id}.json`), JSON.stringify(pedido, null, 2));
    await writeFile(this.caminhoMd(pedido.id), dossie);
    if (pedido.instantaneo) await writeFile(join(this.dir, `${pedido.id}.instantaneo.html`), pedido.instantaneo);
  }

  async ler(id: string): Promise<PedidoAvaliacao | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), "utf8")) as PedidoAvaliacao;
    } catch {
      return null;
    }
  }

  async lerMarkdown(id: string): Promise<string | null> {
    try {
      return await readFile(this.caminhoMd(id), "utf8");
    } catch {
      return null;
    }
  }

  async lerInstantaneo(id: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, `${id}.instantaneo.html`), "utf8");
    } catch {
      return null;
    }
  }

  async gravarParecer(id: string, parecer: Parecer): Promise<void> {
    await this.preparar();
    await writeFile(join(this.dir, `${id}.parecer.json`), JSON.stringify(parecer, null, 2));
  }

  async lerParecer(id: string): Promise<Parecer | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.parecer.json`), "utf8")) as Parecer;
    } catch {
      return null;
    }
  }

  async listar(limite = 20): Promise<RegistroAvaliacao[]> {
    let nomes: string[] = [];
    try {
      nomes = (await readdir(this.dir)).filter((n) => n.endsWith(".json") && !n.endsWith(".parecer.json"));
    } catch {
      return [];
    }
    const registros: RegistroAvaliacao[] = [];
    for (const nome of nomes) {
      const id = nome.slice(0, -5);
      const pedido = await this.ler(id);
      if (!pedido) continue;
      registros.push({
        id,
        em: pedido.em,
        url: pedido.pagina.url,
        titulo: pedido.pagina.titulo,
        achados: pedido.achados.length,
        temParecer: (await this.lerParecer(id)) !== null,
      });
    }
    return registros.sort((a, b) => b.em.localeCompare(a.em)).slice(0, limite);
  }
}
