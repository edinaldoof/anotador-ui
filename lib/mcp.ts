// Servidor MCP do Anotador: o sistema de design do projeto como ferramentas que qualquer
// agente consulta — Claude Code, Codex, Antigravity, Cursor —, sem depender de quem
// está conectado ao overlay nem de alguém abrir a página.
//
// O dossiê da avaliação entrega o sistema uma vez, como texto, e só quando alguém pede
// uma avaliação. Aqui o agente pergunta na hora em que vai escrever: "este #3b82f6 já
// tem token?", "já existe um componente de diálogo?", "a tela que acabei de mexer vaza
// no celular?". A pergunta certa no momento certo evita o valor literal antes de ele
// existir, em vez de apontá-lo depois numa revisão.
//
// Transporte stdio, JSON-RPC 2.0 uma mensagem por linha: é o que Claude Code, Codex e
// Cursor sabem lançar como processo local, e dispensa porta, chave e certificado.
// Sem dependência: o protocolo são seis métodos, e o projeto não tem nenhuma.

import { createInterface } from "node:readline";
import { medirUrl } from "./captura.ts";
import { analisarSistema, deBiblioteca, emPixels, lerSistemaDeDesign, paraDtcg, type CategoriaToken, type SistemaDeDesign, type TokenDesign } from "./design.ts";
import { extrairDesign } from "./extracao.ts";
import { lerProjeto, paraRgb, type ArquivoFonte } from "./fonte.ts";
import { achadosDaTela } from "./tela.ts";

type Id = string | number | null;
interface RespostaMcp { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } }
interface ResultadoFerramenta { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }

/** Da mais nova para a mais antiga. O cliente propõe; respondemos a mesma se a conhecemos. */
const VERSOES_PROTOCOLO = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Resposta grande demais custa contexto do agente em toda chamada seguinte. */
const LIMITE_TEXTO = 60_000;
const CATEGORIAS: CategoriaToken[] = ["cor", "espaco", "texto", "raio", "sombra", "fonte", "outro"];

export interface OpcoesMcp { fonte: string; chrome?: string | null; versao?: string }

// ---------------------------------------------------------------------------
// Consultas ao sistema — puras, testáveis sem processo nem navegador
// ---------------------------------------------------------------------------

/**
 * Alias para outro token é a camada semântica (`--cor-acao: var(--azul-600)`); valor
 * cru é a primitiva. Não é convenção de nome, é estrutura: quem aponta para outro
 * token declarou uma intenção, e é esse que o agente deve preferir.
 */
function camadaDe(t: TokenDesign): "semantica" | "primitiva" {
  return /^var\(--/.test(t.valor.trim()) ? "semantica" : "primitiva";
}

function descreverToken(t: TokenDesign): Record<string, unknown> {
  return {
    nome: t.nome, valor: t.valor, categoria: t.categoria, camada: camadaDe(t), ...(deBiblioteca(t.nome) ? { biblioteca: true } : {}),
    ...(t.px !== undefined ? { px: t.px } : {}), ...(t.rgb ? { rgb: t.rgb } : {}),
    ...(t.intencao ? { intencao: t.intencao } : {}), onde: `${t.arquivo}:${t.linha}`, usar: `var(${t.nome})`,
  };
}

// OKLab: distância que acompanha o olho. Em RGB, dois azuis visivelmente diferentes
// podem ficar mais perto que um azul e o mesmo azul um tom abaixo.
function paraOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function distanciaCor(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [paraOklab(a), paraOklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Entre tokens de mesmo valor: do projeto antes de biblioteca, semântico antes de
// primitivo, explicado antes de mudo. É o que o autor quis que fosse usado, e o que
// continua certo quando a paleta mudar. Sugerir `var(--rdp-accent-color)` — a variável
// interna do date picker — para pintar um botão seria obedecer ao valor e errar o sistema.
function preferencia(a: TokenDesign, b: TokenDesign): number {
  return Number(deBiblioteca(a.nome)) - Number(deBiblioteca(b.nome))
    || (camadaDe(a) === "semantica" ? 0 : 1) - (camadaDe(b) === "semantica" ? 0 : 1)
    || (a.intencao ? 0 : 1) - (b.intencao ? 0 : 1) || a.nome.localeCompare(b.nome);
}
/** O token a recomendar: o preferido, desde que seja do projeto. */
function recomendado(tokens: TokenDesign[]): TokenDesign | undefined {
  return [...tokens].sort(preferencia).find((t) => !deBiblioteca(t.nome));
}

export function conferirValor(sistema: SistemaDeDesign, valor: string, categoria?: CategoriaToken): Record<string, unknown> {
  const texto = valor.trim();
  const rgb = categoria === undefined || categoria === "cor" ? paraRgb(texto) : null;
  if (rgb) {
    const comCor = sistema.tokens.map((t) => ({ t, rgb: t.rgb ? paraRgb(t.rgb) : null })).filter((c): c is { t: TokenDesign; rgb: [number, number, number] } => !!c.rgb);
    const medidos = comCor.map((c) => ({ t: c.t, d: distanciaCor(rgb, c.rgb) })).sort((a, b) => a.d - b.d || preferencia(a.t, b.t));
    const exatos = medidos.filter((m) => m.d < 0.002).map((m) => m.t).sort(preferencia);
    // Abaixo de 0,02 em OKLab a diferença mal se vê: é quase sempre o mesmo token
    // escrito à mão com um dígito trocado, e o agente deveria usar o token.
    const proximos = medidos.filter((m) => m.d >= 0.002 && m.d <= 0.08 && !deBiblioteca(m.t.nome)).slice(0, 3);
    const escolhido = recomendado(exatos) ?? (proximos[0] && proximos[0].d < 0.02 ? proximos[0].t : undefined);
    return {
      valor: texto, tipo: "cor", noSistema: exatos.some((t) => !deBiblioteca(t.nome)),
      usar: escolhido ? `var(${escolhido.nome})` : null,
      exatos: exatos.map(descreverToken),
      proximos: proximos.map((m) => ({ ...descreverToken(m.t), distancia: Math.round(m.d * 1000) / 1000, quaseIgual: m.d < 0.02 })),
      observacao: recomendado(exatos) ? "a cor já tem token; use-o em vez do valor literal"
        : proximos[0] && proximos[0].d < 0.02 ? "praticamente a mesma cor de um token existente — provavelmente é ele"
        : proximos.length ? "nenhum token com esta cor; os mais próximos estão listados — prefira um deles ou declare um token novo com intenção"
        : "nenhum token parecido; se a cor é nova de propósito, declare um token com um comentário dizendo para que serve",
    };
  }
  const px = emPixels(texto);
  if (px === undefined) return { valor: texto, tipo: "desconhecido", noSistema: false, observacao: "não é uma cor nem uma medida em px, rem ou em" };
  const cat: CategoriaToken = categoria ?? "espaco";
  const candidatos = sistema.tokens.filter((t) => t.px !== undefined && !deBiblioteca(t.nome) && (cat === "espaco" ? t.categoria === "espaco" : t.categoria === cat));
  const medidos = candidatos.map((t) => ({ t, d: Math.abs((t.px as number) - px) })).sort((a, b) => a.d - b.d || preferencia(a.t, b.t));
  const exatos = medidos.filter((m) => m.d < 0.01).map((m) => m.t).sort(preferencia);
  const proximos = medidos.filter((m) => m.d >= 0.01 && m.d <= Math.max(4, px * 0.25)).slice(0, 3);
  const base = sistema.espaco.base;
  const naEscala = cat === "espaco" && base ? Math.abs(px % base) < 0.01 : cat === "texto" && sistema.escalaDeTexto.length ? sistema.escalaDeTexto.includes(px) : null;
  return {
    valor: texto, tipo: cat, px, noSistema: exatos.length > 0,
    usar: exatos[0] ? `var(${exatos[0].nome})` : null,
    exatos: exatos.map(descreverToken),
    proximos: proximos.map((m) => ({ ...descreverToken(m.t), diferencaPx: Math.round(m.d * 100) / 100 })),
    ...(naEscala === null ? {} : { naEscala, ...(cat === "espaco" && base ? { passo: base } : {}), ...(cat === "texto" ? { escalaDeTexto: sistema.escalaDeTexto } : {}) }),
    observacao: exatos.length ? "a medida já tem token; use-o em vez do valor literal"
      : naEscala === false ? `fora da escala do projeto${cat === "espaco" && base ? ` (passo de ${base}px)` : ""}; prefira o token mais próximo`
      : proximos.length ? "sem token exato; os mais próximos estão listados"
      : "sem token para esta medida",
  };
}

interface ComponenteEncontrado { nome: string; arquivo: string; linha: number; assinatura: string; usos: number }

/**
 * Componentes exportados em .tsx/.jsx, com quantas vezes cada um é usado. O número é o
 * que importa: um agente que cria `<Modal>` quando o projeto usa `<Dialog>` quarenta
 * vezes não errou o código, errou o vocabulário — e é o erro que mais se repete.
 */
export function buscarComponente(arquivos: ArquivoFonte[], consulta: string, limite = 10): ComponenteEncontrado[] {
  const q = consulta.trim().toLowerCase();
  if (!q) return [];
  const vistos = new Map<string, ComponenteEncontrado>();
  for (const a of arquivos) {
    if (!/\.(tsx|jsx)$/.test(a.relativo) || /\.(stories|test|spec)\.[jt]sx$/.test(a.relativo)) continue;
    a.linhas.forEach((linha, i) => {
      const m = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/.exec(linha);
      const nome = m?.[1];
      if (!nome || vistos.has(nome)) return;
      if (!nome.toLowerCase().includes(q) && !a.relativo.toLowerCase().includes(q)) return;
      vistos.set(nome, { nome, arquivo: a.relativo, linha: i + 1, assinatura: linha.trim().slice(0, 200), usos: 0 });
    });
  }
  if (!vistos.size) return [];
  const padrao = new RegExp("<(" + [...vistos.keys()].join("|") + ")[\\s/>]", "g");
  // Uso é o que o produto usa: a história do Storybook e o teste existem justamente
  // para exercitar o componente, e contá-los inflaria quem só é usado em demonstração.
  for (const a of arquivos) {
    if (!/\.(tsx|jsx)$/.test(a.relativo) || /\.(stories|test|spec)\.[jt]sx$/.test(a.relativo)) continue;
    for (const linha of a.linhas) for (const uso of linha.matchAll(padrao)) { const c = uso[1] && vistos.get(uso[1]); if (c) c.usos++; }
  }
  // Nome que casa com a consulta antes do que só mora numa pasta com o nome dela.
  return [...vistos.values()].sort((a, b) => Number(!a.nome.toLowerCase().includes(q)) - Number(!b.nome.toLowerCase().includes(q)) || b.usos - a.usos || a.nome.localeCompare(b.nome)).slice(0, limite);
}

// ---------------------------------------------------------------------------
// Protocolo
// ---------------------------------------------------------------------------

const SOMENTE_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

export const FERRAMENTAS = [
  {
    name: "listar_tokens",
    title: "Tokens do projeto",
    description: "Tokens de design declarados no CSS do projeto (variáveis --*), com valor, categoria, camada (semântica quando aponta para outro token, primitiva quando é valor cru), a intenção escrita no comentário ao lado e onde estão. Use para saber o vocabulário antes de estilizar.",
    inputSchema: { type: "object", properties: { categoria: { type: "string", enum: CATEGORIAS, description: "Filtra por categoria." } }, additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "conferir_valor",
    title: "Conferir valor literal",
    description: "Antes de escrever uma cor, espaçamento, raio ou tamanho de texto literal, pergunte aqui: diz se o valor já tem token (e qual usar), quais tokens estão mais perto e se a medida respeita a escala do projeto. Cores são comparadas em OKLab, então um #3b82f5 escrito à mão encontra o token de #3b82f6.",
    inputSchema: { type: "object", properties: { valor: { type: "string", description: "Ex.: #3b82f6, rgb(59 130 246), oklch(0.62 0.19 259), 13px, 0.875rem." }, categoria: { type: "string", enum: ["cor", "espaco", "texto", "raio"], description: "Para medidas: onde o valor será usado. Padrão: espaco." } }, required: ["valor"], additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "buscar_componente",
    title: "Buscar componente existente",
    description: "Antes de criar um componente, procure se o projeto já tem um: busca componentes React exportados em .tsx/.jsx pelo nome ou pela pasta e diz quantas vezes cada um é usado. Prefira o que já é usado a inventar outro com o mesmo papel.",
    inputSchema: { type: "object", properties: { consulta: { type: "string", description: "Parte do nome ou da pasta: dialog, button, tabela, empty." } }, required: ["consulta"], additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "auditar_sistema",
    title: "Auditar o sistema declarado",
    description: "O que o CSS do projeto declara e não se sustenta: espaçamento fora do passo da escala, a mesma cor escrita em vários tokens em vez de apontar para um só, tokens declarados e nunca usados. Análise do código, sem abrir a página.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "medir_pagina",
    title: "Medir a página renderizada",
    description: "Abre a URL num Chromium temporário em 390, 768 e 1280px e mede o que só existe depois de renderizar: rolagem horizontal, elemento vazando da tela, texto abaixo de 12px, alvo de toque abaixo do mínimo do WCAG 2.2 e borda a 1–4px de uma coluna que o resto da página respeita. Use depois de mexer em layout. Leva de 5 a 30 segundos.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "URL http(s) da tela, ex.: http://localhost:3000/painel." }, larguras: { type: "array", items: { type: "integer", minimum: 240, maximum: 3840 }, maxItems: 6, description: "Larguras em px. Padrão: 390, 768, 1280." } }, required: ["url"], additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: true },
  },
  {
    name: "extrair_design",
    title: "Extrair design de um site",
    description: "Gera um DESIGN.md de referência a partir de uma URL: cores, tipografia, espaçamento, raios, sombras e componentes medidos nos estilos computados do DOM renderizado, em desktop e mobile. Serve para estudar uma referência externa; não é o sistema deste projeto. Leva de 10 a 45 segundos.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "URL http(s) do site de referência." } }, required: ["url"], additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: true },
  },
] as const;

const RECURSOS = [
  { uri: "anotador://tokens.dtcg.json", name: "tokens.dtcg.json", title: "Tokens no formato W3C", description: "Os tokens do projeto no formato do W3C Design Tokens, que Figma, Style Dictionary e Tokens Studio leem. A intenção de cada token vai em $description.", mimeType: "application/json" },
];

function instrucoes(fonte: string): string {
  return [
    `Sistema de design do projeto em ${fonte}, lido pelo Anotador.`,
    "Antes de escrever cor, espaçamento, raio ou tamanho de texto literal, chame conferir_valor: ele diz qual token já existe para aquilo.",
    "Antes de criar um componente, chame buscar_componente e prefira o que o projeto já usa.",
    "Depois de mexer em layout, chame medir_pagina na URL da tela para ver o que quebra no celular.",
    "listar_tokens e auditar_sistema descrevem o que o CSS declara; medir_pagina e extrair_design, o que a página renderiza.",
  ].join(" ");
}

function resultado(dados: Record<string, unknown> | string, erro = false): ResultadoFerramenta {
  let texto = typeof dados === "string" ? dados : JSON.stringify(dados, null, 2);
  if (texto.length > LIMITE_TEXTO) texto = texto.slice(0, LIMITE_TEXTO) + `\n\n[cortado em ${LIMITE_TEXTO} caracteres]`;
  return { content: [{ type: "text", text: texto }], ...(typeof dados === "string" ? {} : { structuredContent: dados }), ...(erro ? { isError: true } : {}) };
}

function objeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function criarServidorMcp(opcoes: OpcoesMcp): { tratar(mensagem: unknown): Promise<RespostaMcp | null> } {
  const sistema = async (): Promise<{ arquivos: ArquivoFonte[]; sistema: SistemaDeDesign }> => {
    const arquivos = await lerProjeto(opcoes.fonte);
    return { arquivos, sistema: lerSistemaDeDesign(arquivos) };
  };

  async function chamar(nome: string, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
    switch (nome) {
      case "listar_tokens": {
        const categoria = args["categoria"];
        if (categoria !== undefined && !CATEGORIAS.includes(categoria as CategoriaToken)) return resultado(`categoria inválida: use ${CATEGORIAS.join(", ")}`, true);
        const { sistema: s } = await sistema();
        const tokens = s.tokens.filter((t) => categoria === undefined || t.categoria === categoria);
        return resultado({
          total: tokens.length, arquivos: s.arquivos,
          passoDeEspaco: s.espaco.base ?? null, escalaDeTexto: s.escalaDeTexto,
          tokens: tokens.map(descreverToken),
        });
      }
      case "conferir_valor": {
        const valor = args["valor"], categoria = args["categoria"];
        if (typeof valor !== "string" || !valor.trim() || valor.length > 200) return resultado("informe o valor como texto, ex.: #3b82f6 ou 13px", true);
        if (categoria !== undefined && !["cor", "espaco", "texto", "raio"].includes(categoria as string)) return resultado("categoria inválida: use cor, espaco, texto ou raio", true);
        const { sistema: s } = await sistema();
        return resultado(conferirValor(s, valor, categoria as CategoriaToken | undefined));
      }
      case "buscar_componente": {
        const consulta = args["consulta"];
        if (typeof consulta !== "string" || !consulta.trim() || consulta.length > 100) return resultado("informe parte do nome do componente, ex.: dialog", true);
        const { arquivos } = await sistema();
        const encontrados = buscarComponente(arquivos, consulta);
        return resultado({ consulta, total: encontrados.length, componentes: encontrados, ...(encontrados.length ? {} : { observacao: "nenhum componente exportado com esse nome ou nessa pasta" }) });
      }
      case "auditar_sistema": {
        const { sistema: s, achados } = analisarSistema((await sistema()).arquivos);
        return resultado({ tokens: s.tokens.length, arquivos: s.arquivos, passoDeEspaco: s.espaco.base ?? null, total: achados.length, achados: achados.slice(0, 80) });
      }
      case "medir_pagina": {
        const url = args["url"], larguras = args["larguras"];
        if (typeof url !== "string") return resultado("informe a URL http(s) da tela", true);
        if (larguras !== undefined && (!Array.isArray(larguras) || !larguras.every((l) => Number.isInteger(l)))) return resultado("larguras deve ser uma lista de inteiros", true);
        const medidas = await medirUrl(url, { chrome: opcoes.chrome ?? null, ...(larguras ? { larguras: larguras as number[] } : {}) });
        if (!medidas.length) return resultado("a página abriu, mas nenhuma largura pôde ser medida", true);
        return resultado({ url, medidas, achados: achadosDaTela(medidas) });
      }
      case "extrair_design": {
        const url = args["url"];
        if (typeof url !== "string") return resultado("informe a URL http(s) do site", true);
        const r = await extrairDesign(url, { chrome: opcoes.chrome ?? null });
        return resultado(r.markdown);
      }
      default:
        return resultado(`ferramenta desconhecida: ${nome}`, true);
    }
  }

  async function tratar(mensagem: unknown): Promise<RespostaMcp | null> {
    if (!objeto(mensagem) || mensagem["jsonrpc"] !== "2.0" || typeof mensagem["method"] !== "string") {
      const id = objeto(mensagem) && (typeof mensagem["id"] === "string" || typeof mensagem["id"] === "number") ? mensagem["id"] : null;
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "pedido JSON-RPC inválido" } };
    }
    const metodo = mensagem["method"];
    const temId = "id" in mensagem && mensagem["id"] !== undefined;
    const id: Id = typeof mensagem["id"] === "string" || typeof mensagem["id"] === "number" ? mensagem["id"] : null;
    const params = objeto(mensagem["params"]) ? mensagem["params"] : {};
    // Notificação não tem resposta — nem de erro.
    if (!temId) return null;
    const ok = (result: unknown): RespostaMcp => ({ jsonrpc: "2.0", id, result });
    const falha = (code: number, message: string): RespostaMcp => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (metodo) {
      case "initialize": {
        const pedida = params["protocolVersion"];
        return ok({
          protocolVersion: typeof pedida === "string" && VERSOES_PROTOCOLO.includes(pedida) ? pedida : VERSOES_PROTOCOLO[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "anotador-ui", title: "Anotador · sistema de design", version: opcoes.versao ?? "0.0.0" },
          instructions: instrucoes(opcoes.fonte),
        });
      }
      case "ping": return ok({});
      case "tools/list": return ok({ tools: FERRAMENTAS });
      case "tools/call": {
        const nome = params["name"];
        if (typeof nome !== "string") return falha(-32602, "falta o nome da ferramenta");
        if (!FERRAMENTAS.some((f) => f.name === nome)) return falha(-32602, `ferramenta desconhecida: ${nome}`);
        // Erro da ferramenta volta como resultado, não como erro do protocolo: é o agente
        // que precisa ler o motivo e decidir, não o cliente que precisa descartar a chamada.
        try { return ok(await chamar(nome, objeto(params["arguments"]) ? params["arguments"] : {})); }
        catch (erro) { return ok(resultado(erro instanceof Error ? erro.message : String(erro), true)); }
      }
      case "resources/list": return ok({ resources: RECURSOS });
      case "resources/templates/list": return ok({ resourceTemplates: [] });
      case "resources/read": {
        const recurso = RECURSOS.find((r) => r.uri === params["uri"]);
        if (!recurso) return falha(-32002, `recurso desconhecido: ${String(params["uri"])}`);
        const { documento } = paraDtcg((await sistema()).sistema);
        return ok({ contents: [{ uri: recurso.uri, mimeType: recurso.mimeType, text: JSON.stringify(documento, null, 2) }] });
      }
      default: return falha(-32601, `método não suportado: ${metodo}`);
    }
  }

  return { tratar };
}

/**
 * Lê pedidos do stdin e responde no stdout. O stdout é do protocolo: qualquer outra
 * linha escrita nele quebra o cliente, então diagnóstico vai para o stderr.
 */
export async function servirMcpStdio(opcoes: OpcoesMcp): Promise<void> {
  const servidor = criarServidorMcp(opcoes);
  // A primeira leitura do projeto passa de cinco segundos num repositório grande.
  // Começa agora, enquanto o cliente ainda negocia a versão do protocolo.
  void lerProjeto(opcoes.fonte).catch(() => undefined);
  const escrever = (r: RespostaMcp) => { process.stdout.write(JSON.stringify(r) + "\n"); };
  const pendentes = new Set<Promise<void>>();
  const linhas = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const linha of linhas) {
    if (!linha.trim()) continue;
    let mensagem: unknown;
    try { mensagem = JSON.parse(linha); }
    catch { escrever({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }); continue; }
    // Em paralelo: medir uma página leva segundos e não pode segurar um ping.
    const tarefa = servidor.tratar(mensagem)
      .then((r) => { if (r) escrever(r); })
      .catch((erro) => { process.stderr.write(`anotador mcp: ${erro instanceof Error ? erro.message : String(erro)}\n`); });
    pendentes.add(tarefa);
    void tarefa.finally(() => pendentes.delete(tarefa));
  }
  await Promise.allSettled(pendentes);
}
