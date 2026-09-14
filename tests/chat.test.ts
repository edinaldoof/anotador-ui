import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AGENTES, slugProjetoClaude, type AgenteDetectado, type IdAgente, type SessaoAgente } from "../lib/agentes.ts";
import { ChatAgentes, ErroChat, type ComandoChat, type DependenciasChat, type ResultadoExecucaoChat } from "../lib/chat.ts";
import { importarSessaoChat } from "../lib/chat-sessoes.ts";
import { extrairMetricasChat } from "../lib/chat-metricas.ts";
import { esperarAte } from "./ajuda.ts";

async function ambiente(tarefa: (a: { pasta: string; fonte: string; binario: string; agente: (id?: IdAgente) => AgenteDetectado }) => Promise<void>): Promise<void> {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-chat-"));
  const fonte = join(pasta, "projeto"), binario = join(pasta, "cli simulado");
  await mkdir(fonte);
  await writeFile(binario, `#!${process.execPath}\nprocess.exit(99);\n`, { mode: 0o700 });
  const agente = (id: IdAgente = "claude"): AgenteDetectado => ({
    ...AGENTES.find((a) => a.id === id)!, instalado: true, caminho: binario, marca: "", modelos: [
      { valor: "modelo-teste", titulo: "Modelo teste", esforcos: ["low", "high"], padrao: true },
      { valor: "modelo-alternativo", titulo: "Outro modelo", esforcos: ["medium"] },
    ],
  });
  try { await tarefa({ pasta, fonte, binario, agente }); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}
const status = (codigo: number) => (erro: unknown): boolean => erro instanceof ErroChat && erro.status === codigo;
const semSessoes = async (): Promise<SessaoAgente[]> => [];
async function terminar(chat: ChatAgentes, id: string) {
  await esperarAte(async () => !(await chat.obter(id)).ocupada, 5000);
  return chat.obter(id);
}

test("sessões mantêm dono imutável e recusam leitura, configuração ou envio de outro agente", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let chamadas = 0;
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente("claude"), agente("codex")], sessoes: semSessoes,
      executar: async () => { chamadas++; return { codigo: 0, stdout: JSON.stringify({ result: "Resposta" }), stderr: "" }; } });
    const claude = await chat.criar({ agente: "claude", modelo: "modelo-teste" });
    const codex = await chat.criar({ agente: "codex", modelo: "modelo-teste" });
    assert.deepEqual((await chat.listar("claude")).map((s) => s.id), [claude.id]);
    assert.deepEqual((await chat.listar("codex")).map((s) => s.id), [codex.id]);
    await assert.rejects(chat.obter(claude.id, "codex"), status(409));
    await assert.rejects(chat.configurar(claude.id, { modelo: "modelo-alternativo" }, "codex"), status(409));
    await assert.rejects(chat.enviar(claude.id, "Não pode assumir a sessão", "codex"), status(409));
    await assert.rejects(chat.listar("inexistente"), status(400));
    const preservada = await chat.obter(claude.id, "claude");
    assert.equal(preservada.agente, "claude");
    assert.equal(preservada.modelo, "modelo-teste");
    assert.equal(preservada.mensagens.length, 0);
    assert.equal(chamadas, 0);
  });
});

test("mesmo ID nativo em agentes diferentes nunca compartilha conversa nem importação", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    const id = randomUUID();
    const lista: SessaoAgente[] = (["claude", "codex"] as const).map((a) => ({ agente:a,id,cwd:fonte,ativa:false,pid:null,em:new Date().toISOString(),nome:a,titulo:a,origem:"cli" }));
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente("claude"), agente("codex")], sessoes: async () => lista,
      importar: async (a) => ({ sessao:lista.find((s) => s.agente === a)!,mensagens:[{autor:"usuario",texto:"Histórico de " + a,em:new Date().toISOString()}] }) });
    const claude = await chat.criar({ agente:"claude",sessaoExterna:id });
    const codex = await chat.criar({ agente:"codex",sessaoExterna:id });
    assert.notEqual(claude.id, codex.id);
    assert.equal((await chat.criar({ agente:"codex",sessaoExterna:id })).id,codex.id);
    assert.equal(claude.mensagens[0]?.texto,"Histórico de claude");
    assert.equal(codex.mensagens[0]?.texto,"Histórico de codex");
    const importacaoErrada = new ChatAgentes(join(pasta,"outra-fila"),fonte,{detectar:()=>[agente("codex")],sessoes:semSessoes,
      importar:async()=>({sessao:lista[0]!,mensagens:[]})});
    await assert.rejects(importacaoErrada.criar({agente:"codex",sessaoExterna:id}),status(409));
    assert.deepEqual(await importacaoErrada.listar(),[]);
  });
});

test("consumo persiste sem duplicar snapshots e contexto antigo não reaparece após trocar modelo", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    const id = randomUUID(), antes = new Date(Date.now() - 60_000).toISOString();
    const nativa: SessaoAgente = { agente:"codex",id,cwd:fonte,ativa:false,pid:null,em:antes,nome:"Histórico",titulo:"Histórico",origem:"cli" };
    const snapshot = (em: string, total: number, usados: number, modelo = "modelo-teste") => extrairMetricasChat("codex", [
      { type:"turn_context",payload:{model:modelo} },
      { type:"event_msg",timestamp:em,payload:{type:"token_count",info:{total_token_usage:{input_tokens:total-500,output_tokens:500,total_tokens:total,cached_input_tokens:0},last_token_usage:{input_tokens:usados-100,output_tokens:100,total_tokens:usados},model_context_window:10000}} },
    ].map((o) => JSON.stringify(o)).join("\n"), {origem:"transcript",em:new Date().toISOString()})!;
    let medida = snapshot(antes,10000,1000);
    const deps: DependenciasChat = { detectar:()=>[agente("codex")],sessoes:async()=>[nativa],importar:async()=>({sessao:nativa,mensagens:[]}),metricas:async()=>medida,
      executar:async()=>({codigo:0,stderr:"",stdout:[{type:"item.completed",item:{type:"agent_message",text:"Resposta"}},{type:"turn.completed",usage:{input_tokens:2000,output_tokens:500,cached_input_tokens:0}}].map((o) => JSON.stringify(o)).join("\n")}) };
    const chat = new ChatAgentes(pasta,fonte,deps);
    const c = await chat.criar({agente:"codex",modelo:"modelo-teste",sessaoExterna:id});
    assert.equal(c.metricas?.acumulado.total,10000);
    assert.equal(c.metricas?.contexto.percentual,10);
    await chat.enviar(c.id,"Continuar","codex");
    let pronta = await terminar(chat,c.id);
    assert.equal(pronta.metricas?.acumulado.total,12500,"snapshot ainda no turno anterior não desfaz o consumo novo");
    const emNovo = new Date().toISOString();
    medida = snapshot(emNovo,12500,3000);
    const reiniciado = new ChatAgentes(pasta,fonte,deps);
    pronta = await reiniciado.obter(c.id,"codex");
    assert.equal(pronta.metricas?.acumulado.total,12500,"snapshot não é somado ao delta de novo");
    assert.equal(pronta.metricas?.contexto.percentual,30);
    assert.equal((await reiniciado.obter(c.id)).metricas?.acumulado.total,12500,"polling é idempotente");
    await new Promise((resolve)=>setTimeout(resolve,5));
    await reiniciado.configurar(c.id,{modelo:"modelo-alternativo",esforco:"medium"},"codex");
    const alterada = await new ChatAgentes(pasta,fonte,deps).obter(c.id,"codex");
    assert.equal(alterada.metricas?.contexto.percentual,null,"janela do modelo antigo não é reutilizada");
    assert.equal(alterada.metricas?.contexto.usados,null);
    assert.equal(alterada.metricas?.acumulado.total,12500,"trocar modelo mantém consumo acumulado");
  });
});

test("/compact sem comando personalizado não dispara um prompt comum no CLI", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let chamadas = 0;
    const chat = new ChatAgentes(pasta,fonte,{detectar:()=>[agente("codex")],sessoes:semSessoes,expandir:async()=>null,
      executar:async()=>{chamadas++;throw new Error("não deve iniciar");}});
    const c = await chat.criar({agente:"codex"});
    await assert.rejects(chat.enviar(c.id,"/compact","codex"),status(400));
    assert.equal(chamadas,0);assert.deepEqual((await chat.obter(c.id)).mensagens,[]);
  });
});

test("Antigravity retoma apenas sua sessão nativa e informa que o histórico anterior está no agente", async () => {
  await ambiente(async ({pasta,fonte,agente}) => {
    const id = randomUUID(); let ativa = true;
    const sessao = (): SessaoAgente => ({agente:"antigravity",id,cwd:fonte,ativa,pid:null,em:new Date().toISOString(),nome:"Conversa AGY",titulo:null,origem:"cli",historicoDisponivel:false,descobertaParcial:true});
    const comandos:ComandoChat[]=[];
    const chat = new ChatAgentes(pasta,fonte,{detectar:()=>[agente("antigravity"),agente("claude")],sessoes:async()=>[sessao()],importar:async()=>({sessao:sessao(),mensagens:[]}),
      executar:async(c)=>{comandos.push(c);return {codigo:0,stderr:"",stdout:JSON.stringify({response:"Continuando a sessão",conversation_id:id,status:"success",usage:{input_tokens:800,output_tokens:100,thinking_tokens:20,cache_read_tokens:300,total_tokens:900}})}}});
    const c = await chat.criar({agente:"antigravity",sessaoExterna:id});
    assert.match(c.avisoHistorico??"",/histórico anterior permanece no Antigravity/);
    assert.equal(c.somenteLeitura,true);assert.equal(comandos.length,0);
    await assert.rejects(chat.enviar(c.id,"Continuar","claude"),status(409));
    await assert.rejects(chat.enviar(c.id,"Continuar","antigravity"),status(409));
    ativa=false;
    await chat.enviar(c.id,"Continuar","antigravity");
    const pronta=await terminar(chat,c.id);
    assert.equal(comandos[0]?.args[comandos[0].args.indexOf("--conversation")+1],id);
    assert.equal(pronta.agente,"antigravity");assert.equal(pronta.sessaoExterna,id);
    assert.equal(pronta.metricas?.acumulado.total,900);assert.equal(pronta.metricas?.contexto.percentual,null);
    assert.match(pronta.avisoHistorico??"",/histórico anterior/);
  });
});

test("criar, listar e trocar modelo não executam agentes; histórico é privado e isolado por projeto", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let execucoes = 0;
    const deps: DependenciasChat = { detectar: () => [agente(), { ...agente("cursor"), ponte: false }], sessoes: semSessoes,
      executar: async () => { execucoes++; throw new Error("não deve executar"); } };
    const chat = new ChatAgentes(pasta, fonte, deps);
    assert.equal((await chat.catalogo()).agentes.length, 1);
    const c = await chat.criar({ agente: "claude", modelo: "modelo-teste", esforco: "high" });
    const configurada = await chat.configurar(c.id, { modelo: "modelo-alternativo", esforco: "medium" });
    assert.equal(configurada.modelo, "modelo-alternativo");
    assert.equal(configurada.agente, "claude");
    assert.deepEqual(configurada.mensagens, []);
    assert.equal((await chat.listar())[0]?.id, c.id);
    assert.deepEqual(await new ChatAgentes(pasta, fonte, deps).obter(c.id), configurada);
    const outro = new ChatAgentes(pasta, join(pasta, "outro-projeto"), deps);
    assert.deepEqual(await outro.listar(), []);
    await assert.rejects(outro.obter(c.id), status(404));
    await assert.rejects(chat.obter("../../segredo"), status(400));
    await assert.rejects(chat.criar({ agente: "claude", modelo: "--model-malicioso" }), status(400));
    await assert.rejects(chat.configurar(c.id, { modelo: "modelo-teste", esforco: "max" }), status(400));
    await assert.rejects(chat.criar({ agente: "cursor" }), status(503));
    assert.equal(execucoes, 0);
    assert.equal((await stat(join(chat.dir, c.id + ".json"))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(chat.dir)).filter((n) => n.endsWith(".tmp")), []);
  });
});

test("executável simulado recebe texto literal sem shell, persiste resposta e continua o mesmo Claude", async () => {
  await ambiente(async ({ pasta, fonte, binario, agente }) => {
    await writeFile(binario, `#!${process.execPath}\nconst fs = require('node:fs'); const args=process.argv.slice(2); fs.writeFileSync('invocacao.json', JSON.stringify(args)); const i=args.indexOf('--resume'); const n=args.indexOf('--session-id'); console.error('SEGREDO_EM_LOG'); console.log(JSON.stringify({type:'result',result:'Resposta do agente',session_id:args[i>=0?i+1:n+1]}));\n`);
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente()], sessoes: semSessoes });
    const c = await chat.criar({ agente: "claude", modelo: "modelo-teste", esforco: "high" });
    await assert.rejects(access(join(fonte, "invocacao.json")), "criar não inicia o executável");
    const texto = "--help $(touch INDEVIDO) `touch INDEVIDO`\nsegunda linha";
    assert.equal((await chat.enviar(c.id, texto)).ocupada, true);
    const pronta = await terminar(chat, c.id);
    assert.deepEqual(pronta.mensagens.map((m) => [m.autor, m.texto]), [["usuario", texto], ["agente", "Resposta do agente"]]);
    assert.equal(pronta.sessaoExterna, c.id);
    let args = JSON.parse(await readFile(join(fonte, "invocacao.json"), "utf8")) as string[];
    assert.deepEqual(args.slice(-2), ["--", texto]);
    assert.ok(args.includes("--session-id"));
    await assert.rejects(access(join(fonte, "INDEVIDO")));
    await chat.configurar(c.id, { modelo: "modelo-alternativo", esforco: "medium" });
    await chat.enviar(c.id, "Continue");
    const segunda = await terminar(chat, c.id);
    args = JSON.parse(await readFile(join(fonte, "invocacao.json"), "utf8")) as string[];
    assert.equal(args[args.indexOf("--resume") + 1], c.id);
    assert.equal(args[args.indexOf("--model") + 1], "modelo-alternativo");
    assert.equal(args[args.indexOf("--effort") + 1], "medium");
    assert.equal(segunda.mensagens.length, 4);
    assert.equal(JSON.stringify(segunda).includes("SEGREDO_EM_LOG"), false);
  });
});

test("concorrência entre instâncias bloqueia segundo envio/configuração e ignora tool output no Codex", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let concluir!: (r: ResultadoExecucaoChat) => void;
    const comandos: ComandoChat[] = [];
    const deps: DependenciasChat = { detectar: () => [agente("codex")], sessoes: semSessoes, executar: (c) => {
      comandos.push(c); return new Promise((resolve) => { concluir = resolve; });
    } };
    const chat = new ChatAgentes(pasta, fonte, deps), outra = new ChatAgentes(pasta, fonte, deps);
    const c = await chat.criar({ agente: "codex", modelo: "modelo-teste", esforco: "high" });
    await chat.enviar(c.id, "Primeira mensagem");
    await assert.rejects(outra.enviar(c.id, "Duplicada"), status(409));
    await assert.rejects(chat.configurar(c.id, { modelo: "modelo-alternativo", esforco: "medium" }), status(409));
    assert.equal(comandos.length, 1);
    assert.equal(comandos[0]?.stdin, "Primeira mensagem");
    const sessao = randomUUID();
    concluir({ codigo: 0, stderr: "SEGREDO_STDERR", stdout: [
      { type: "thread.started", thread_id: sessao },
      { type: "item.completed", item: { type: "command_execution", aggregated_output: "SEGREDO_FERRAMENTA" } },
      { type: "item.completed", item: { type: "agent_message", text: "Resposta pública" } },
      { type: "turn.completed" },
    ].map((o) => JSON.stringify(o)).join("\n") });
    const pronta = await terminar(outra, c.id);
    assert.equal(pronta.sessaoExterna, sessao);
    assert.deepEqual(pronta.mensagens.map((m) => m.texto), ["Primeira mensagem", "Resposta pública"]);
    assert.equal(JSON.stringify(pronta).includes("SEGREDO"), false);
    await outra.enviar(c.id, "Segunda mensagem");
    assert.ok(comandos[1]?.args.includes("resume"));
    assert.ok(comandos[1]?.args.includes(sessao));
    concluir({ codigo: 0, stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Continuação" } }), stderr: "" });
    await terminar(chat, c.id);
  });
});

test("falha preserva uma única mensagem e restart não reexecuta pedido incompleto", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let chamadas = 0;
    const deps: DependenciasChat = { detectar: () => [agente()], sessoes: semSessoes, executar: async () => {
      chamadas++; return { codigo: 1, stdout: "LOG_INTERNO", stderr: "CHAVE_SECRETA" };
    } };
    const chat = new ChatAgentes(pasta, fonte, deps);
    const c = await chat.criar({ agente: "claude" });
    await assert.rejects(chat.enviar(c.id, "x".repeat(16_001)), status(400));
    await assert.rejects(chat.enviar(c.id, " "), status(400));
    await chat.enviar(c.id, "Mensagem preservada");
    const falhou = await terminar(chat, c.id);
    assert.ok(falhou.erro);
    assert.equal(falhou.mensagens.filter((m) => m.autor === "usuario").length, 1);
    assert.equal(JSON.stringify(falhou).includes("CHAVE_SECRETA"), false);
    assert.equal(JSON.stringify(falhou).includes("LOG_INTERNO"), false);
    assert.equal(chamadas, 1);
    await writeFile(join(chat.dir, c.id + ".json"), JSON.stringify({ ...falhou, ocupada: true }));
    const reiniciado = await new ChatAgentes(pasta, fonte, deps).obter(c.id);
    assert.equal(reiniciado.ocupada, false);
    assert.match(reiniciado.erro ?? "", /interrompida/);
    assert.equal(chamadas, 1);
  });
});

test("runner limita saída do processo e não publica o dump como mensagem", async () => {
  await ambiente(async ({ pasta, fonte, binario, agente }) => {
    await writeFile(binario, `#!${process.execPath}\nprocess.stdout.write('DUMP_PRIVADO'.repeat(250000));\n`);
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente()], sessoes: semSessoes });
    const c = await chat.criar({ agente: "claude" });
    await chat.enviar(c.id, "Teste de limite");
    const pronta = await terminar(chat, c.id);
    assert.match(pronta.erro ?? "", /excedeu o limite/);
    assert.equal(JSON.stringify(pronta).includes("DUMP_PRIVADO"), false);
    assert.equal(pronta.mensagens.filter((m) => m.autor === "agente").length, 0);
  });
});

test("respostas longas persistem até 64 mil caracteres e sinalizam qualquer truncamento", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    let resposta = "ç".repeat(32_000);
    const deps: DependenciasChat = { detectar: () => [agente()], sessoes: semSessoes,
      executar: async () => ({ codigo: 0, stdout: JSON.stringify({ result: resposta }), stderr: "" }) };
    const chat = new ChatAgentes(pasta, fonte, deps);
    const c = await chat.criar({ agente: "claude" });
    await chat.enviar(c.id, "Explique com detalhes");
    assert.equal((await terminar(chat, c.id)).mensagens.at(-1)?.texto, resposta);
    resposta = "🧪".repeat(40_000);
    await chat.enviar(c.id, "Continue");
    const pronta = await terminar(chat, c.id);
    const texto = pronta.mensagens.at(-1)?.texto ?? "";
    assert.equal(texto.length, 64_000);
    assert.match(texto, /\[Resposta truncada no limite de 64\.000 caracteres\.\]$/);
    assert.equal(Buffer.from(texto, "utf8").toString("utf8"), texto, "não persiste metade de um par Unicode");
    assert.deepEqual((await new ChatAgentes(pasta, fonte, deps).obter(c.id)).mensagens, pronta.mensagens);
  });
});

test("provedores sem sessão nativa usam histórico limitado, saídas estruturadas e permissões normais", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    for (const id of ["gemini", "opencode", "antigravity"] as const) {
      const comandos: ComandoChat[] = [];
      const chat = new ChatAgentes(join(pasta, id), fonte, { detectar: () => [agente(id)], sessoes: semSessoes,
        executar: async (c) => { comandos.push(c); return { codigo: 0, stderr: "", stdout: id === "opencode"
          ? JSON.stringify({ type: "text", part: { text: "Resposta anterior" } })
          : JSON.stringify({ response: "Resposta anterior" }) }; } });
      const c = await chat.criar({ agente: id, modelo: "modelo-teste" });
      await chat.enviar(c.id, "Pergunta anterior"); await terminar(chat, c.id);
      await chat.enviar(c.id, "Continue a explicação"); await terminar(chat, c.id);
      const argumentos = comandos[1]?.args ?? [];
      assert.ok(argumentos.at(-1)?.includes("Pergunta anterior"));
      assert.ok(argumentos.at(-1)?.includes("Resposta anterior"));
      assert.ok(argumentos.at(-1)?.includes("Continue a explicação"));
      assert.ok(!argumentos.some((a) => /yolo|skip-permissions|bypass/.test(a)));
    }
  });
});

test("slash conhecido expande só a instrução do runner e conserva comando/argumentos no histórico", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    const comandos: ComandoChat[] = [];
    const texto = "/revisar argumento literal $(sem-shell)";
    const expansao = "Leia o comando descoberto no arquivo canônico do projeto e revise o código conforme seus argumentos.";
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente()], sessoes: semSessoes,
      expandir: async (recebido, id, projeto) => { assert.equal(recebido, texto); assert.equal(id, "claude"); assert.equal(projeto, fonte); return expansao; },
      executar: async (c) => { comandos.push(c); return { codigo: 0, stdout: JSON.stringify({ result: "Comando atendido" }), stderr: "" }; } });
    const c = await chat.criar({ agente: "claude" });
    await chat.enviar(c.id, texto);
    const pronta = await terminar(chat, c.id);
    assert.equal(comandos[0]?.args.at(-1), expansao);
    assert.equal(pronta.mensagens[0]?.texto, texto);
    assert.equal(pronta.mensagens[1]?.texto, "Comando atendido");
  });
});

test("importar histórico canônico Claude/Codex exclui ferramentas, recusa outro projeto e mantém sessão ativa somente para leitura", async () => {
  await ambiente(async ({ pasta, fonte, agente }) => {
    const raizClaude = join(pasta, "config-claude"), raizCodex = join(pasta, "config-codex");
    const claudeId = randomUUID(), codexId = randomUUID();
    const dirClaude = join(raizClaude, "projects", slugProjetoClaude(fonte));
    const dirCodex = join(raizCodex, "sessions", "2026", "09", "14");
    await mkdir(dirClaude, { recursive: true }); await mkdir(dirCodex, { recursive: true });
    const arquivoClaude = join(dirClaude, claudeId + ".jsonl");
    const arquivoCodex = join(dirCodex, "rollout-2026-09-14-" + codexId + ".jsonl");
    await writeFile(arquivoClaude, [
      { type: "user", cwd: fonte, message: { content: "Pergunta original" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Resposta original" }, { type: "tool_use", input: "SEGREDO" }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "SEGREDO" }] } },
    ].map((o) => JSON.stringify(o)).join("\n"));
    await writeFile(arquivoCodex, [
      { type: "session_meta", payload: { id: codexId, cwd: fonte } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Pergunta Codex" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Resposta Codex" }] } },
      { type: "response_item", payload: { type: "function_call_output", output: "SEGREDO" } },
    ].map((o) => JSON.stringify(o)).join("\n"));
    let ativa = true;
    const sessoes = async (): Promise<SessaoAgente[]> => [
      { agente: "claude", id: claudeId, cwd: fonte, ativa, pid: null, em: new Date().toISOString(), nome: null, titulo: "Histórico Claude", origem: "cli" },
      { agente: "codex", id: codexId, cwd: fonte, ativa: false, pid: null, em: new Date().toISOString(), nome: null, titulo: "Histórico Codex", origem: "cli" },
    ];
    const importar: typeof importarSessaoChat = (a, id, f) => importarSessaoChat(a, id, f, { raizClaude, raizCodex, listar: sessoes });
    const historico = await importar("codex", codexId, fonte);
    assert.deepEqual(historico.mensagens.map((m) => m.texto), ["Pergunta Codex", "Resposta Codex"]);
    await assert.rejects(importar("claude", "../../segredo", fonte));
    await assert.rejects(importar("claude", claudeId, join(pasta, "outro")));
    const fonteColisao = fonte.replace(/\/projeto$/, "-projeto");
    assert.equal(slugProjetoClaude(fonteColisao), slugProjetoClaude(fonte));
    await assert.rejects(importarSessaoChat("claude", claudeId, fonteColisao, { raizClaude, raizCodex,
      listar: async () => (await sessoes()).map((s) => ({ ...s, cwd: fonteColisao })) }), /outro projeto/);
    const comandos: ComandoChat[] = [];
    const chat = new ChatAgentes(pasta, fonte, { detectar: () => [agente()], sessoes, importar,
      executar: async (c) => { comandos.push(c); return { codigo: 0, stderr: "", stdout: JSON.stringify({ result: "Resposta nova", session_id: claudeId }) }; } });
    const c = await chat.criar({ agente: "claude", sessaoExterna: claudeId });
    assert.deepEqual(c.mensagens.map((m) => m.texto), ["Pergunta original", "Resposta original"]);
    assert.equal(c.somenteLeitura, true);
    assert.match(c.motivoSomenteLeitura ?? "", /ativa no CLI/);
    assert.equal((await chat.obter(c.id)).somenteLeitura, true);
    assert.equal((await chat.criar({ agente: "claude", sessaoExterna: claudeId })).id, c.id, "a mesma sessão externa não é duplicada");
    await assert.rejects(chat.enviar(c.id, "Continuar"), status(409));
    assert.equal(comandos.length, 0);
    ativa = false;
    await chat.enviar(c.id, "Continuar"); await terminar(chat, c.id);
    assert.equal((await chat.obter(c.id)).somenteLeitura, undefined);
    assert.equal(comandos[0]?.args[(comandos[0]?.args.indexOf("--resume") ?? -1) + 1], claudeId);
    await rm(arquivoClaude); await symlink(arquivoCodex, arquivoClaude);
    await assert.rejects(importar("claude", claudeId, fonte), /inválido/);
  });
});
