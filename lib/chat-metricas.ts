// Contadores reportados pelos CLIs, sem estimar tokens por caracteres nem manter
// tabelas de preços/limites. O consumo da sessão e a última ocupação do contexto
// são grandezas diferentes; um total acumulado nunca vira percentual de contexto.
// Fontes dos formatos: code.claude.com/docs/en/agent-sdk/cost-tracking,
// code.claude.com/docs/en/statusline, developers.openai.com/codex/noninteractive,
// www.antigravity.google/docs/cli/headless/ e /cli/statusline/.

export interface UsoChat {
  entrada: number | null; saida: number | null; total: number | null;
  cacheLeitura: number | null; cacheEscrita: number | null; raciocinio: number | null;
  /** Estimativa em USD reportada pelo CLI; não é faturamento da conta. */
  custoUSD: number | null;
}
export interface ContextoChat {
  usados: number | null; limite: number | null; percentual: number | null;
  base: "ultima_entrada" | "ultimo_evento" | null;
  modelo: string | null; atualizadoEm: string | null;
}
export interface MetricasChat {
  versao: 1; acumulado: UsoChat; ultimoTurno: UsoChat | null;
  contexto: ContextoChat; atualizadoEm: string | null;
  cobertura: "sessao" | "chat" | "parcial";
  /** IDs locais, não conteúdo de prompts; tornam a persistência idempotente. */
  execucoesContadas: string[];
}
export interface ObservacaoMetricasChat {
  tipo: "execucao" | "sessao" | "parcial" | "contexto";
  uso: UsoChat | null; ultimoTurno: UsoChat | null;
  contexto: ContextoChat | null; em: string;
}
export interface OpcoesMetricasChat {
  origem: "execucao" | "transcript";
  modelo?: string | null; em?: string; parcial?: boolean;
}
type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Objeto : null;
const contador = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const dinheiro = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12 ? v : null;
const nome = (v: unknown): string | null => typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\x00-\x1f]/.test(v) ? v : null;
const data = (v: unknown): string | null => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const soma = (...valores: Array<number | null>): number | null => valores.some((v) => v === null) ? null : contador(valores.reduce<number>((a, b) => a + b!, 0));
const vazio = (): UsoChat => ({ entrada: null, saida: null, total: null, cacheLeitura: null, cacheEscrita: null, raciocinio: null, custoUSD: null });
const temUso = (v: UsoChat): boolean => Object.values(v).some((n) => n !== null);
const contextoVazio = (): ContextoChat => ({ usados: null, limite: null, percentual: null, base: null, modelo: null, atualizadoEm: null });
export const metricasChatVazias = (): MetricasChat => ({ versao: 1, acumulado: vazio(), ultimoTurno: null, contexto: contextoVazio(), atualizadoEm: null, cobertura: "chat", execucoesContadas: [] });

function contexto(usados: number | null, limite: number | null, modelo: string | null, em: string, base: ContextoChat["base"]): ContextoChat {
  if (limite === 0) limite = null;
  return { usados, limite, percentual: usados !== null && limite !== null ? Math.round(usados / limite * 1000) / 10 : null, modelo, atualizadoEm: em, base };
}
function somarUsos(usos: UsoChat[]): UsoChat {
  const resultado = vazio();
  for (const chave of Object.keys(resultado) as Array<keyof UsoChat>) {
    const valores = usos.map((u) => u[chave]);
    if (!valores.length || valores.some((v) => v === null)) continue;
    const total = valores.reduce<number>((a, b) => a + b!, 0);
    resultado[chave] = chave === "custoUSD" ? dinheiro(total) : contador(total);
  }
  return resultado;
}
function usoClaude(v: unknown, modelo = false, respostaFinal = true): UsoChat {
  const o = objeto(v) ?? {};
  const cacheLeitura = contador(o[modelo ? "cacheReadInputTokens" : "cache_read_input_tokens"]);
  const cacheEscrita = contador(o[modelo ? "cacheCreationInputTokens" : "cache_creation_input_tokens"]);
  const entrada = soma(contador(o[modelo ? "inputTokens" : "input_tokens"]), cacheLeitura, cacheEscrita);
  // Assistant messages do SDK podem trazer output_tokens provisório. Somente
  // result/modelUsage é autoritativo para contabilizar saída.
  const saida = respostaFinal ? contador(o[modelo ? "outputTokens" : "output_tokens"]) : null;
  return { entrada, saida, total: soma(entrada, saida), cacheLeitura, cacheEscrita,
    raciocinio: respostaFinal ? contador(objeto(o["output_tokens_details"])?.["thinking_tokens"]) : null,
    custoUSD: modelo ? dinheiro(o["costUSD"]) : null };
}
function usoCodex(v: unknown): UsoChat {
  const o = objeto(v) ?? {}, entrada = contador(o["input_tokens"]), saida = contador(o["output_tokens"]);
  return { entrada, saida, total: contador(o["total_tokens"]) ?? soma(entrada, saida),
    cacheLeitura: contador(o["cached_input_tokens"]), cacheEscrita: contador(o["cache_write_input_tokens"]),
    raciocinio: contador(o["reasoning_output_tokens"]), custoUSD: null };
}
function usoAntigravity(v: unknown): UsoChat {
  const o = objeto(v) ?? {}, entrada = contador(o["input_tokens"]), saida = contador(o["output_tokens"]);
  // AGY normaliza provedores diferentes: preservamos o total que ele reporta,
  // sem acrescentar cache/thinking novamente (o schema não garante a inclusão
  // do cache em input_tokens para todos os provedores).
  return { entrada, saida, total: contador(o["total_tokens"]) ?? soma(entrada, saida),
    cacheLeitura: contador(o["cache_read_tokens"]), cacheEscrita: null,
    raciocinio: contador(o["thinking_tokens"]), custoUSD: null };
}
function objetos(texto: string): Objeto[] {
  // O leitor de sessões e o executor também limitam os bytes. Este limite evita
  // que uma chamada acidental do parser aloque estruturas sem limite.
  if (texto.length > 8 * 1024 * 1024) return [];
  try { const o = objeto(JSON.parse(texto)); if (o) return [o]; } catch { /* JSONL */ }
  const resultado: Objeto[] = [];
  for (const linha of texto.split("\n").slice(-30_000)) {
    try { const o = objeto(JSON.parse(linha)); if (o) resultado.push(o); } catch { /* eventos incompletos */ }
  }
  return resultado;
}

/** Aceita somente envelopes conhecidos; nunca procura usage dentro de texto,
 * ferramentas ou JSON produzido pelo próprio modelo. */
export function extrairMetricasChat(agente: string, texto: string, opcoes: OpcoesMetricasChat): ObservacaoMetricasChat | null {
  const lista = objetos(texto);
  let em = data(opcoes.em) ?? new Date().toISOString(), modelo = nome(opcoes.modelo);
  let ultimoContexto: ContextoChat | null = null, final: UsoChat | null = null, tipo: ObservacaoMetricasChat["tipo"] = "execucao";
  let ultimoTurno: UsoChat | null = null;
  const passosClaude = new Map<string, UsoChat>();
  let limitesClaude: Objeto | null = null;
  for (const o of lista) {
    if (o["isSidechain"] === true || o["parent_tool_use_id"]) continue;
    const timestamp = data(o["timestamp"]) ?? em;
    if (agente === "claude") {
      const m = objeto(o["message"]);
      if (o["type"] === "assistant" && m && objeto(m["usage"])) {
        const uso = usoClaude(m["usage"], false, false);
        modelo = nome(m["model"]) ?? modelo;
        ultimoContexto = contexto(uso.entrada, null, modelo, timestamp, "ultima_entrada");
        const id = nome(m["id"]);
        if (id) passosClaude.set(id, uso);
        em = timestamp;
      }
      if (o["type"] === "system" && o["subtype"] === "compact_boundary") {
        // O contador antes de /compact não descreve mais o contexto atual.
        ultimoContexto = contexto(null, null, modelo, timestamp, null); em = timestamp;
      }
      if (o["type"] === "result") {
        limitesClaude = objeto(o["modelUsage"]) ?? objeto(o["model_usage"]);
        const porModelo = limitesClaude ? Object.values(limitesClaude).map((v) => usoClaude(v, true)) : [];
        const totalModelos = somarUsos(porModelo);
        final = porModelo.length && temUso(totalModelos) ? totalModelos : usoClaude(o["usage"]);
        final.custoUSD = dinheiro(o["total_cost_usd"]) ?? final.custoUSD;
        ultimoTurno = final; em = timestamp;
      }
    } else if (agente === "codex") {
      const p = objeto(o["payload"]);
      if (o["type"] === "turn_context" && p) modelo = nome(p["model"]) ?? modelo;
      if (o["type"] === "compacted" || o["type"] === "event_msg" && p?.["type"] === "context_compacted") {
        ultimoContexto = contexto(null, null, modelo, timestamp, null); em = timestamp;
      }
      const info = o["type"] === "event_msg" && p?.["type"] === "token_count" ? objeto(p["info"]) : null;
      if (info) {
        const uso = usoCodex(info["total_token_usage"]);
        if (temUso(uso)) { final = uso; tipo = "sessao"; }
        const ultimo = usoCodex(info["last_token_usage"]);
        ultimoContexto = contexto(ultimo.total, contador(info["model_context_window"]), modelo, timestamp, "ultimo_evento");
        em = timestamp;
      }
      if (opcoes.origem === "execucao" && o["type"] === "turn.completed") {
        final = usoCodex(o["usage"]); ultimoTurno = final; em = timestamp;
      }
    } else if (agente === "antigravity") {
      const init = o["event"] === "init" ? objeto(o["init"]) : null;
      if (init) modelo = nome(init["model"]) ?? modelo;
      const step = o["event"] === "step_update" ? objeto(o["step_update"]) : null;
      if (step?.["state"] === "DONE" && step["step_type"] === "agent_response" && objeto(step["usage"])) {
        // Não há garantia de semântica uniforme de cache entre provedores no
        // envelope headless AGY. Mantém ocupação desconhecida sem statusline.
        ultimoContexto = contexto(null, null, modelo, timestamp, null);
      }
      const resultado = o["event"] === "result" ? objeto(o["result"]) : typeof o["conversation_id"] === "string" && typeof o["status"] === "string" ? o : null;
      if (resultado && objeto(resultado["usage"])) {
        final = usoAntigravity(resultado["usage"]); tipo = "sessao"; em = timestamp;
      }
    }
  }
  if (agente === "claude") {
    if (limitesClaude) {
      let chave = modelo && Object.hasOwn(limitesClaude, modelo) ? modelo : null;
      // Uma única entrada resolve o modelo padrão; múltiplas podem incluir
      // subagentes e não autorizam escolher arbitrariamente o maior limite.
      if (!chave && Object.keys(limitesClaude).length === 1 && !ultimoContexto?.modelo) chave = Object.keys(limitesClaude)[0]!;
      const limite = chave ? contador(objeto(limitesClaude[chave])?.["contextWindow"]) : null;
      if (limite) ultimoContexto = contexto(ultimoContexto?.usados ?? null, limite, chave, em, ultimoContexto?.base ?? null);
    }
    if (!final && passosClaude.size) { final = somarUsos([...passosClaude.values()]); tipo = "parcial"; }
    // Uma leitura do transcript contém apenas o main loop e output provisório,
    // mesmo quando o arquivo é completo. Nunca sobrepõe totais result do chat.
    if (opcoes.origem === "transcript" && tipo !== "parcial") tipo = "contexto";
  }
  if (final && !temUso(final)) final = null;
  if (!final && !ultimoContexto) return null;
  // A leitura pode ocorrer após stdout, cujo timestamp é de término do processo.
  // O evento nativo costuma antecedê-lo em milissegundos: em explícito identifica
  // a leitura autoritativa, enquanto contexto.atualizadoEm preserva a medição.
  return { tipo: final ? tipo : "contexto", uso: final, ultimoTurno, contexto: ultimoContexto, em: data(opcoes.em) ?? em };
}

/** Aplica deltas uma vez. Snapshots nativos substituem contadores e não são
 * somados a stdout da mesma execução. O chamador deve aplicar stdout primeiro e
 * depois o transcript atualizado, sob a trava da sessão. */
export function aplicarMetricasChat(anterior: MetricasChat | null | undefined, observacao: ObservacaoMetricasChat | null, execucaoId: string): MetricasChat {
  const m = anterior ? structuredClone(anterior) : metricasChatVazias();
  if (!observacao) return m;
  const id = execucaoId.slice(0, 250);
  if (observacao.tipo === "execucao" && m.execucoesContadas.includes(id)) return m;
  const recente = !m.atualizadoEm || Date.parse(observacao.em) >= Date.parse(m.atualizadoEm);
  if (observacao.tipo === "sessao" && observacao.uso && recente) {
    m.acumulado = structuredClone(observacao.uso); m.cobertura = "sessao";
  } else if (observacao.tipo === "execucao" && observacao.uso) {
    const jaContava = temUso(m.acumulado);
    const somaParcial = vazio();
    for (const chave of Object.keys(somaParcial) as Array<keyof UsoChat>) {
      const a = m.acumulado[chave], b = observacao.uso[chave];
      if (a === null || b === null) {
        somaParcial[chave] = a ?? b;
        if (jaContava && a !== b) m.cobertura = "parcial";
      } else somaParcial[chave] = chave === "custoUSD" ? dinheiro(a + b) : contador(a + b);
    }
    m.acumulado = somaParcial;
  } else if (observacao.tipo === "parcial" && observacao.uso && !temUso(m.acumulado)) {
    m.acumulado = structuredClone(observacao.uso); m.cobertura = "parcial";
  }
  if (observacao.tipo === "execucao") m.execucoesContadas = [...m.execucoesContadas, id].slice(-2000);
  if (observacao.ultimoTurno && recente) m.ultimoTurno = structuredClone(observacao.ultimoTurno);
  const podeCompletar = observacao.contexto?.usados !== null && m.contexto.usados === null &&
    observacao.contexto?.modelo !== null && observacao.contexto?.modelo === m.contexto.modelo;
  if (observacao.contexto && (podeCompletar || !m.contexto.atualizadoEm || Date.parse(observacao.contexto.atualizadoEm!) >= Date.parse(m.contexto.atualizadoEm))) {
    const c = observacao.contexto;
    // Reutiliza o limite apenas quando confirmado para o MESMO modelo. Após
    // uma troca, o chamador invalida o contexto até chegar a próxima medição.
    const limite = c.limite ?? (c.modelo && c.modelo === m.contexto.modelo ? m.contexto.limite : null);
    m.contexto = contexto(c.usados, limite, c.modelo, c.atualizadoEm ?? observacao.em, c.base);
  }
  if (recente) m.atualizadoEm = observacao.em;
  return m;
}

export function invalidarContextoMetricasChat(metricas: MetricasChat | undefined, modelo: string | null = null): MetricasChat {
  const m = metricas ? structuredClone(metricas) : metricasChatVazias();
  m.contexto = { ...contextoVazio(), modelo };
  return m;
}
