// A saída bruta da ponte fica no servidor. Só mensagens públicas reconhecidas
// chegam ao chat; resultados de ferramentas e raciocínio nunca viram mensagens.
import { createHash } from "node:crypto";
import type { IdAgente } from "./agentes.ts";
import { validarParecer, type Parecer } from "./avaliacao.ts";
import { ID_SESSAO_NATIVA } from "./chat-sessoes.ts";

export function idConversaAvaliacao(id: string): string {
  const hash = createHash("sha256").update("avaliacao:" + id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function parecerDaResposta(texto: string, agente: string): Parecer | null {
  const candidatos = [texto.trim(), ...Array.from(texto.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g), m => m[1]!)];
  for (const candidato of candidatos) {
    if (candidato.length > 512 * 1024) continue;
    try {
      const objeto: unknown = JSON.parse(candidato);
      if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) continue;
      const p = objeto as Record<string, unknown>;
      if (typeof p.resumo !== "string" || !p.resumo.trim() || !Array.isArray(p.itens) || !Array.isArray(p.perguntas)) continue;
      return validarParecer(p, agente);
    } catch { /* Uma mensagem de progresso não é um parecer. */ }
  }
  return null;
}

export function textoDoParecer(p: Parecer): string {
  return [p.resumo, ...p.itens.map(i => `### ${i.titulo}\n\n${i.problema}\n\n${i.sugestao}${i.comoAplicar ? "\n\n" + i.comoAplicar : ""}${i.seletor ? "\n\n`" + i.seletor + "`" : ""}`),
    ...p.perguntas.map(q => q.texto + (q.opcoes.length ? "\n\n" + q.opcoes.map(o => "- " + o).join("\n") : ""))].join("\n\n");
}

export interface AtividadeAvaliacao { ferramenta: string; alvo: string | null; passos: number }

// Só o nome do arquivo, ou o começo do comando: o caminho inteiro não cabe no painel
// e o diretório de quem roda o servidor não interessa a quem olha a página.
function alvoDaFerramenta(entrada: unknown): string | null {
  if (!entrada || typeof entrada !== "object") return null;
  const campos = entrada as Record<string, unknown>;
  for (const chave of ["file_path", "path", "notebook_path", "pattern", "command", "url", "query"]) {
    const valor = campos[chave];
    if (typeof valor !== "string" || !valor.trim()) continue;
    const limpo = valor.trim().replace(/\s+/g, " ");
    const nome = ["file_path", "path", "notebook_path"].includes(chave) ? limpo.split("/").pop() || limpo : limpo;
    return nome.slice(0, 60);
  }
  return null;
}

export function saidaPublicaAvaliacao(agente: IdAgente, texto: string): { sessao: string | null; mensagens: string[]; parecer: Parecer | null; atividade: AtividadeAvaliacao | null } {
  let sessao: string | null = null, parecer: Parecer | null = null;
  // O que o agente está fazendo agora. Numa avaliação de oito minutos ele emite duas
  // frases e quarenta e quatro chamadas de ferramenta: sem isso, a tela fica parada.
  let atividade: AtividadeAvaliacao | null = null;
  let passos = 0;
  const mensagens: string[] = [];
  const adicionar = (valor: unknown) => {
    if (typeof valor !== "string" || !valor.trim()) return;
    const publico = valor.trim().slice(0, 64_000);
    const resultado = parecerDaResposta(valor, agente);
    if (resultado) parecer = resultado;
    const exibido = resultado ? textoDoParecer(resultado) : publico;
    if (!mensagens.includes(exibido)) mensagens.push(exibido);
  };
  let linhas = texto.split("\n");
  try { const inteiro = JSON.parse(texto); if (inteiro && typeof inteiro === "object" && !Array.isArray(inteiro)) linhas = [JSON.stringify(inteiro)]; } catch { /* JSONL */ }
  for (const linha of linhas) {
    try {
      const o = JSON.parse(linha);
      if (!o || typeof o !== "object" || Array.isArray(o) || o.parent_tool_use_id || o.isSidechain) continue;
      const eventoPublico = ["thread.started", "system", "assistant", "result", "init"].includes(o.type) || !o.type && ["antigravity", "gemini"].includes(agente);
      const id = eventoPublico ? o.thread_id ?? o.session_id ?? o.sessionId ?? o.conversation_id ?? o.conversationId : null;
      if (typeof id === "string" && ID_SESSAO_NATIVA.test(id)) sessao = id;
      if (agente === "codex" && o.type === "item.completed" && o.item?.type === "agent_message" && (!o.item.phase || ["commentary", "final_answer", "final"].includes(o.item.phase)) && (!o.item.channel || ["commentary", "final"].includes(o.item.channel))) adicionar(o.item.text);
      else if (agente === "claude" && o.type === "assistant" && Array.isArray(o.message?.content)) {
        for (const p of o.message.content) {
          if (p.type === "text") adicionar(p.text);
          else if (p.type === "tool_use" && typeof p.name === "string") { passos++; atividade = { ferramenta: p.name.slice(0, 40), alvo: alvoDaFerramenta(p.input), passos }; }
        }
      } else if (agente === "opencode" && o.type === "text") adicionar(o.part?.text);
      // Melhor esforço para agentes que anunciam o passo antes de terminá-lo.
      else if (o.type === "item.started" && o.item && typeof o.item.type === "string" && o.item.type !== "agent_message") { passos++; atividade = { ferramenta: String(o.item.type).slice(0, 40), alvo: alvoDaFerramenta(o.item), passos }; }
      else if (agente !== "codex" && !o.is_error && !o.error && (o.type === "result" || !o.type && ["gemini", "antigravity"].includes(agente))) adicionar(o.result ?? o.response);
    } catch { /* Banner, ferramentas, eventos parciais e stderr não são mensagens. */ }
  }
  if (!sessao && agente === "codex") {
    // Compatibilidade com execuções antigas: somente o banner anterior ao prompt.
    const banner = texto.slice(0, 8192).split(/\r?\nuser\r?\n/)[0] ?? "";
    const id = /^session id:\s*([\da-f-]+)\s*$/im.exec(banner)?.[1];
    if (id && ID_SESSAO_NATIVA.test(id)) sessao = id;
  }
  return { sessao, mensagens: mensagens.slice(-100), parecer, atividade };
}
