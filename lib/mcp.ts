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

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { aliasesDoTsconfig, conferirArquivosDeAgente, gerarSkillDeDesign, lerArquivosDeAgente, prontidaoParaAgentes } from "./arquivos-agente.ts";
import { medirUrl } from "./captura.ts";
import { analisarSistema, lerSistemaDeDesign, paraDtcg, type CategoriaToken, type SistemaDeDesign } from "./design.ts";
import { extrairDesign } from "./extracao.ts";
import { buscarComponente } from "./componentes.ts";
import { lerProjeto, tailwindDoProjeto, type ArquivoFonte } from "./fonte.ts";
import { achadosDaTela } from "./tela.ts";
import { conferirValor, descreverToken } from "./valores.ts";
import { analisarUso } from "./uso.ts";

// Os testes e quem já importava daqui continuam achando a busca no mesmo lugar.
export { buscarComponente, conferirValor };

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
    description: "O que o CSS do projeto declara e não se sustenta — espaçamento fora do passo, a mesma cor em vários tokens, token nunca usado — e o quanto as telas usam o sistema: valores literais no código com o token que existe para cada um, cobertura de controles (botão cru contra o Button do sistema) por tela, componentes base sem uso e os dez componentes do núcleo. Análise do código, sem abrir a página.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "medir_pagina",
    title: "Medir a página renderizada",
    description: "Abre a URL num Chromium temporário em 390, 768 e 1280px e mede o que só existe depois de renderizar: rolagem horizontal, elemento vazando da tela, texto abaixo de 12px, alvo de toque abaixo do mínimo do WCAG 2.2, borda a 1–4px de uma coluna que o resto da página respeita, parágrafo acima de 75ch por linha, tamanhos de texto a menos de 1px um do outro, pesos fora da escada de quatro, texto a menos de 16px da borda no celular — e, forçando as preferências do sistema, contraste nos temas claro e escuro, falta de região principal e animação que ignora movimento reduzido. Use depois de mexer em layout. Leva de 5 a 30 segundos.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "URL http(s) da tela, ex.: http://localhost:3000/painel." }, larguras: { type: "array", items: { type: "integer", minimum: 240, maximum: 3840 }, maxItems: 6, description: "Larguras em px. Padrão: 390, 768, 1280." } }, required: ["url"], additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: true },
  },
  {
    name: "conferir_arquivos_de_agente",
    title: "Conferir AGENTS.md, CLAUDE.md e skills",
    description: "Confere se os arquivos que os agentes leem — AGENTS.md, CLAUDE.md, skills, regras do Cursor e do Copilot — citam componentes e tokens que ainda existem no código. Documento desatualizado é fonte de alucinação: o agente usa o nome documentado e o build quebra. Aponta também pasta de skill sem SKILL.md e frontmatter fora do padrão.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
  },
  {
    name: "gerar_skill_de_design",
    title: "Gerar a skill de design do projeto",
    description: "Gera, a partir do código, o texto de uma skill design-system: componentes base com o caminho de import e os usos, componentes compartilhados, os nomes comuns de outras bibliotecas que não existem aqui (com o que usar no lugar) e os tokens, semânticos primeiro. Devolve o texto; não grava nada — quem decide onde salvar é a pessoa.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...SOMENTE_LEITURA, openWorldHint: false },
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
    "Depois de editar AGENTS.md, CLAUDE.md ou uma skill, chame conferir_arquivos_de_agente para ver se todo nome citado ainda existe.",
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
        const { arquivos } = await sistema();
        const { sistema: s, achados } = analisarSistema(arquivos);
        const uso = analisarUso(arquivos, s);
        return resultado({
          tokens: s.tokens.length, arquivos: s.arquivos, passoDeEspaco: s.espaco.base ?? null, total: achados.length, achados: achados.slice(0, 80),
          uso: { ...uso, literais: uso.literais.slice(0, 30), semUso: uso.semUso.map((c) => ({ nome: c.nome, arquivo: c.arquivo })) },
        });
      }
      case "medir_pagina": {
        const url = args["url"], larguras = args["larguras"];
        if (typeof url !== "string") return resultado("informe a URL http(s) da tela", true);
        if (larguras !== undefined && (!Array.isArray(larguras) || !larguras.every((l) => Number.isInteger(l)))) return resultado("larguras deve ser uma lista de inteiros", true);
        const r = await medirUrl(url, { chrome: opcoes.chrome ?? null, ...(larguras ? { larguras: larguras as number[] } : {}) });
        if (!r.medidas.length) return resultado("a página abriu, mas nenhuma largura pôde ser medida", true);
        // O aviso vem primeiro no objeto: é a primeira coisa que o agente lê. Redirecionado
        // para uma tela com senha, o resultado não responde o que foi pedido — é erro, não
        // medida: o agente precisa parar, não resumir a tela de login como se fosse o painel.
        const aviso = r.redirecionada
          ? `A página pedida (${url}) redirecionou para ${r.urlMedida}${r.pareceLogin ? ", que tem campo de senha — quase certamente o login de uma rota protegida" : ""}. O que segue é a medida de ${r.urlMedida}, não da página pedida. Este navegador não tem a sessão de ninguém; para medir uma página que exige login, use a avaliação no overlay do Anotador, que mede o DOM de quem já está logado.`
          : null;
        return resultado({ ...(aviso ? { aviso } : {}), urlPedida: url, urlMedida: r.urlMedida, medidas: r.medidas, acessibilidade: r.acessibilidade, achados: achadosDaTela(r.medidas, r.acessibilidade) }, r.redirecionada && r.pareceLogin);
      }
      case "conferir_arquivos_de_agente": {
        const { arquivos, sistema: s } = await sistema();
        const lidos = await lerArquivosDeAgente(opcoes.fonte, arquivos);
        const achados = conferirArquivosDeAgente(lidos.arquivos, arquivos, s, lidos.skillsVazias);
        const prontidao = await prontidaoParaAgentes(opcoes.fonte, arquivos);
        return resultado({ arquivos: lidos.arquivos.map((a) => a.relativo), total: achados.length, achados, prontidao: { pontos: prontidao.filter((p) => p.presente).length, de: 5, sinais: prontidao }, ...(achados.length ? {} : { observacao: "todo nome citado existe no código" }) });
      }
      case "gerar_skill_de_design": {
        const { arquivos, sistema: s } = await sistema();
        const scripts = await readFile(join(opcoes.fonte, "package.json"), "utf8").then((t) => (JSON.parse(t) as { scripts?: Record<string, string> }).scripts ?? {}).catch(() => ({}));
        return resultado(gerarSkillDeDesign({ nome: basename(opcoes.fonte), codigo: arquivos, sistema: s, aliases: await aliasesDoTsconfig(opcoes.fonte), scripts, tailwind: !!(await tailwindDoProjeto(opcoes.fonte)), hoje: new Date().toISOString().slice(0, 10) }));
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
