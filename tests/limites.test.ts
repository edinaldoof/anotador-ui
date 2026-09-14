import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { criarLeitorLimitesConta, interpretarLimitesAntigravity, interpretarLimitesClaude, interpretarLimitesCodex, type OpcoesLeitorLimites } from "../lib/limites.ts";
import { esperarAte } from "./ajuda.ts";

const em = "2026-09-14T20:00:00.000Z";
const reset = 1_789_415_000;
const codex = {
  rateLimits: { limitId: "codex", planType: "pro", primary: null, secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: reset }, accountId: "NAO_EXIBIR_IDENTIDADE" },
  rateLimitsByLimitId: {
    codex: { limitId: "codex", planType: "pro", primary: null, secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: reset } },
    spark: { limitId: "spark", limitName: "Spark", primary: { usedPercent: 11, windowDurationMins: 300, resetsAt: reset }, secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: reset } },
  },
};
const claude = { five_hour: { utilization: 8.5, resets_at: "2026-09-14T21:00:00+00:00" }, seven_day: { utilization: 72, resets_at: "2026-09-20T21:00:00Z" } };
const antigravity = 'Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-21T19:17:38Z\nGemini Models\tFive Hour Limit Remaining\t87.5%\t2026-09-15T00:17:38Z\nClaude and GPT models\tWeekly Limit Remaining\t60%\t2026-09-21T19:17:38Z\nClaude and GPT models\tFive Hour Limit Remaining\t0%\t2026-09-15T00:17:38Z\n';

test("Antigravity converte restante em uso e preserva grupos, janelas e renovação informados pelo CLI", () => {
  const dados = interpretarLimitesAntigravity(antigravity, em);
  assert.equal(dados.agente, 'antigravity'); assert.equal(dados.atualizadoEm, em);
  assert.deepEqual(dados.janelas.map(j=>[j.grupo,j.janelaMinutos,j.usadoPercentual]), [
    ['Gemini Models',10080,0], ['Gemini Models',300,12.5], ['Claude and GPT models',10080,40], ['Claude and GPT models',300,100],
  ]);
  assert.equal(dados.janelas[1]?.redefineEm, '2026-09-15T00:17:38.000Z');
  assert.equal(dados.janelas[0]?.titulo, 'Semanal');
  assert.equal(interpretarLimitesAntigravity('Gemini Models\tFive Hour Limit Remaining\t20%\tindisponível').janelas[0]?.redefineEm,null);
  for(const invalido of ['', 'texto de um modelo', antigravity+antigravity, antigravity.replace('100%','101%'),antigravity.replace('87.5%','-2%'),antigravity.replace('Weekly Limit Remaining','saldo estimado')]) assert.throws(()=>interpretarLimitesAntigravity(invalido));
});

async function antigravityFalso(codigo: string, tarefa: (opts: OpcoesLeitorLimites, pasta: string) => Promise<void>) {
  const pasta=await mkdtemp(join(tmpdir(),'anotador-agy-limites-')), script=join(pasta,'agy.mjs');
  await writeFile(script, `import fs from 'node:fs';const pasta=${JSON.stringify(pasta)};fs.writeFileSync(pasta+'/pid',String(process.pid));fs.writeFileSync(pasta+'/args',JSON.stringify(process.argv.slice(2)));${codigo}`);
  try { await tarefa({antigravity:process.execPath,argumentosAntigravity:[script],pastaAntigravity:()=>pasta,timeoutMs:1000},pasta); }
  finally { try { process.kill(Number(await readFile(join(pasta,'pid'),'utf8')),'SIGKILL'); } catch {} await rm(pasta,{recursive:true,force:true}); }
}

test("Antigravity executa apenas /usage nativo, deduplica consultas e não envia prompt ou lê OAuth", async () => {
  await antigravityFalso(`process.stdout.write(${JSON.stringify(antigravity)});`,async(opts,pasta)=>{
    const ler=criarLeitorLimitesConta({...opts,pastaClaude:()=>{throw new Error('não usa credenciais do Claude')},requisitar:async()=>{throw new Error('não chama API externa diretamente')}});
    const [a,b]=await Promise.all([ler('antigravity'),ler('antigravity')]);assert.deepEqual(a,b);assert.equal(a.disponivel,true);
    const pid=await readFile(join(pasta,'pid'),'utf8');
    assert.deepEqual(JSON.parse(await readFile(join(pasta,'args'),'utf8')),['--print','/usage','--print-timeout','1s']);
    assert.throws(()=>process.kill(Number(pid),0));
    await ler('antigravity');assert.equal(await readFile(join(pasta,'pid'),'utf8'),pid);
  });
});

test("Antigravity limita saída, trata erro de login e encerra timeout sem divulgar stderr", async () => {
  for(const codigo of ["process.stderr.write('token-secreto');process.exit(1)","process.stdout.write('x'.repeat(256*1024+1))","process.on('SIGTERM',()=>{});setInterval(()=>{},5000)"]) {
    await antigravityFalso(codigo,async(opts,pasta)=>{
      const r=await criarLeitorLimitesConta({...opts,timeoutMs:300})('antigravity');
      assert.equal(r.disponivel,false);assert.deepEqual(r.janelas,[]);assert.doesNotMatch(JSON.stringify(r),/token-secreto/);
      const pid=Number(await readFile(join(pasta,'pid'),'utf8'));
      assert.throws(()=>process.kill(pid,0));
    });
  }
  const r=await criarLeitorLimitesConta({antigravity:'/arquivo-que-nao-existe-agy',timeoutMs:300})('antigravity');
  assert.equal(r.disponivel,false);assert.match(r.aviso??'',/CLI não está disponível/);
});

test("Codex preserva cotas independentes e não duplica janela principal nem expõe identidade", () => {
  const r = interpretarLimitesCodex(codex, em);
  assert.equal(r.disponivel, true); assert.equal(r.plano, "pro"); assert.equal(r.atualizadoEm, em);
  assert.equal(r.janelas.length, 3);
  assert.deepEqual(r.janelas.map(j => [j.id, j.titulo, j.usadoPercentual, j.grupo]), [
    ["codex:secondary", "Semanal", 86, "Codex"], ["spark:primary", "5 horas", 11, "Spark"], ["spark:secondary", "Semanal", 5, "Spark"],
  ]);
  assert.equal(r.janelas[0]?.redefineEm, new Date(reset * 1000).toISOString());
  assert.doesNotMatch(JSON.stringify(r), /accountId|NAO_EXIBIR_IDENTIDADE/);
});

test("Codex valida percentuais sem fabricar números nem resets", () => {
  for (const valor of [-1, 101, "80", null, NaN, Infinity]) {
    assert.throws(() => interpretarLimitesCodex({ rateLimits: { primary: { usedPercent: valor } } }));
  }
  for (const valor of [0, 100]) {
    const r = interpretarLimitesCodex({ rateLimits: { primary: { usedPercent: valor, windowDurationMins: -1, resetsAt: 1e99 } } });
    assert.equal(r.janelas[0]?.usadoPercentual, valor);
    assert.equal(r.janelas[0]?.janelaMinutos, null); assert.equal(r.janelas[0]?.redefineEm, null);
  }
  assert.throws(() => interpretarLimitesCodex([]));
  assert.equal(interpretarLimitesCodex({ rateLimits: { primary: { usedPercent: 0, resetsAt: 0 } } }).janelas[0]?.redefineEm, null);
});

test("Claude apresenta limites semanais por modelo e ignora identidade, saldo e porcentagens inválidas", () => {
  const r = interpretarLimitesClaude({ ...claude,
    seven_day_sonnet: { utilization: 20, resets_at: null }, seven_day_opus: { utilization: 101 },
    accountId: "SEGREDO", extra_usage: { utilization: 90, used_credits: 10 },
    limits: [
      { kind: "weekly_scoped", group: "weekly", percent: 20, scope: { model: { display_name: "Sonnet" } } },
      { kind: "weekly_scoped", group: "weekly", percent: 35, resets_at: "inválido", scope: { model: { display_name: "Fable", id: "fable" } } },
      { kind: "weekly_scoped", group: "weekly", percent: 15, scope: { model: { display_name: "all models" } } },
    ],
  }, em);
  assert.equal(r.janelas.length, 4); assert.equal(r.janelas[0]?.redefineEm, "2026-09-14T21:00:00.000Z");
  assert.deepEqual(r.janelas.map(j => j.grupo), [null, null, "Sonnet", "Fable"]);
  assert.equal(r.janelas[3]?.usadoPercentual, 35); assert.equal(r.janelas[3]?.redefineEm, null);
  assert.doesNotMatch(JSON.stringify(r), /SEGREDO|extra_usage|credits/);
  assert.throws(() => interpretarLimitesClaude({ five_hour: { utilization: "12" } }));
});

async function credenciais(tarefa: (pasta: string, original: string) => Promise<void>) {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-limites-"));
  const original = JSON.stringify({ claudeAiOauth: { accessToken: "token-ficticio-somente-teste", refreshToken: "NAO_RENOVAR" } });
  await writeFile(join(pasta, ".credentials.json"), original, { mode: 0o600 });
  try { await tarefa(pasta, original); }
  finally { await rm(pasta, { recursive: true, force: true }); }
}
const resposta = (dados: unknown) => new Response(JSON.stringify(dados), { status: 200, headers: { "content-type": "application/json" } });

test("Claude usa somente GET oficial sem redirects, não altera login e oculta tokens", async () => {
  await credenciais(async (pasta, original) => {
    let chamadas = 0;
    const ler = criarLeitorLimitesConta({ pastaClaude: () => pasta, agora: () => Date.parse(em), requisitar: async (url, init) => {
      chamadas++;
      assert.equal(url, "https://api.anthropic.com/api/oauth/usage"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer token-ficticio-somente-teste");
      assert.equal(headers.get("anthropic-beta"), "oauth-2025-04-20");
      assert.equal(init?.body, undefined);
      return resposta(claude);
    } });
    const r = await ler("claude"); assert.equal(chamadas, 1); assert.equal(r.disponivel, true);
    assert.doesNotMatch(JSON.stringify(r), /token-ficticio|NAO_RENOVAR/);
    assert.equal(await readFile(join(pasta, ".credentials.json"), "utf8"), original);
  });
});

test("cache deduplica consultas, protege objetos retornados e marca último sucesso em falhas", async () => {
  await credenciais(async (pasta) => {
    let relogio = Date.parse(em), chamadas = 0, falhar = false;
    const ler = criarLeitorLimitesConta({ pastaClaude: () => pasta, agora: () => relogio, requisitar: async () => {
      chamadas++;
      if (falhar) throw new Error("token-privado-nao-pode-aparecer");
      await new Promise(r => setTimeout(r, 15)); return resposta(claude);
    } });
    const [a, b] = await Promise.all([ler("claude"), ler("claude")]);
    assert.equal(chamadas, 1); assert.deepEqual(a, b);
    a.janelas[0]!.usadoPercentual = 99;
    assert.equal((await ler("claude")).janelas[0]?.usadoPercentual, 8.5);
    relogio += 60_001; falhar = true;
    const antigo = await ler("claude"); assert.equal(chamadas, 2);
    assert.equal(antigo.disponivel, true); assert.equal(antigo.desatualizado, true);
    assert.equal(antigo.atualizadoEm, em); assert.doesNotMatch(JSON.stringify(antigo), /token-privado/);
    await ler("claude"); assert.equal(chamadas, 2, "falhas também respeitam intervalo sem martelar provedor");
    relogio += 60_001; falhar = false;
    const novo = await ler("claude"); assert.equal(novo.desatualizado, undefined); assert.equal(novo.atualizadoEm, new Date(relogio).toISOString());
  });
});

test("Claude sem escopo fica indisponível sem tentar prompts ou renovar token", async () => {
  for (const status of [401, 403, 429, 500]) await credenciais(async (pasta, original) => {
    let n = 0;
    const ler = criarLeitorLimitesConta({ pastaClaude: () => pasta, requisitar: async () => { n++; return new Response("token-privado-do-servidor", { status }); } });
    const r = await ler("claude"); assert.equal(n, 1); assert.equal(r.disponivel, false); assert.deepEqual(r.janelas, []);
    assert.equal(r.motivo, status === 401 ? "login_expirado" : status === 403 ? "sem_permissao" : "indisponivel");
    assert.doesNotMatch(JSON.stringify(r), /token-privado/);
    assert.equal(await readFile(join(pasta, ".credentials.json"), "utf8"), original);
  });
});

test("novo login invalida a falha em cache e uma troca de conta não herda cotas anteriores", async () => {
  await credenciais(async (pasta, original) => {
    let chamadas = 0, falhar = false;
    const arquivo = join(pasta, ".credentials.json");
    await writeFile(arquivo, JSON.stringify({ claudeAiOauth: { accessToken: "", refreshToken: "" } }));
    const ler = criarLeitorLimitesConta({ pastaClaude: () => pasta, agora: () => Date.parse(em), requisitar: async () => {
      chamadas++; return falhar ? new Response("", { status: 401 }) : resposta(claude);
    } });
    const semLogin = await ler("claude");
    assert.equal(semLogin.motivo, "login_necessario"); assert.equal(semLogin.disponivel, false); assert.equal(chamadas, 0);
    await writeFile(arquivo, original);
    const conectado = await ler("claude");
    assert.equal(conectado.disponivel, true); assert.equal(chamadas, 1, "consulta o login novo sem aguardar 60s");
    falhar = true;
    await writeFile(arquivo, JSON.stringify({ claudeAiOauth: { accessToken: "outra-conta-token-ficticio" } }));
    const outraConta = await ler("claude");
    assert.equal(chamadas, 2); assert.equal(outraConta.disponivel, false); assert.deepEqual(outraConta.janelas, []);
    assert.equal(outraConta.atualizadoEm, null); assert.equal(outraConta.desatualizado, undefined);
    assert.equal(outraConta.motivo, "login_expirado");
  });
});

test("credenciais inválidas, grandes e symlink não saem da máquina", async () => {
  await credenciais(async (pasta) => {
    let chamadas = 0;
    const opts = { pastaClaude: () => pasta, requisitar: async () => { chamadas++; return resposta(claude); } };
    for (const conteudo of ["não JSON", JSON.stringify({ claudeAiOauth: { accessToken: "abc\r\nheader" } }), " ".repeat(256 * 1024 + 1)]) {
      await writeFile(join(pasta, ".credentials.json"), conteudo);
      assert.equal((await criarLeitorLimitesConta(opts)("claude")).disponivel, false);
    }
    await rm(join(pasta, ".credentials.json"));
    await writeFile(join(pasta, "outro.json"), JSON.stringify({ claudeAiOauth: { accessToken: "token-ficticio-somente-teste" } }));
    await symlink(join(pasta, "outro.json"), join(pasta, ".credentials.json"));
    assert.equal((await criarLeitorLimitesConta(opts)("claude")).disponivel, false);
    assert.equal(chamadas, 0);
  });
});

test("resposta HTTP acima de256KiB é cancelada e timeout interrompe a consulta", async () => {
  await credenciais(async (pasta) => {
    let cancelada = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(128 * 1024)); }, cancel() { cancelada = true; } });
    const r = await criarLeitorLimitesConta({ pastaClaude: () => pasta, requisitar: async () => new Response(stream) })("claude");
    assert.equal(r.disponivel, false); assert.equal(cancelada, true);
    let abortou = false;
    const ler = criarLeitorLimitesConta({ pastaClaude: () => pasta, timeoutMs: 30, requisitar: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { abortou = true; reject(new Error("Abort")); }, { once: true });
    }) });
    assert.equal((await ler("claude")).disponivel, false); assert.equal(abortou, true);
  });
});

async function codexFalso(codigo: string, tarefa: (opcoes: OpcoesLeitorLimites, pasta: string) => Promise<void>) {
  const pasta = await mkdtemp(join(tmpdir(), "anotador-codex-limites-")), script = join(pasta, "worker.mjs");
  await writeFile(script, `import fs from 'node:fs';import readline from 'node:readline';import {spawn} from 'node:child_process';
    const pasta=${JSON.stringify(pasta)};
    fs.writeFileSync(pasta+'/pid',String(process.pid));fs.writeFileSync(pasta+'/args',JSON.stringify(process.argv.slice(2)));
    const chamadas=[];const responder=o=>process.stdout.write(JSON.stringify(o)+'\\n');
    readline.createInterface({input:process.stdin}).on('line',linha=>{
      const m=JSON.parse(linha);chamadas.push(m);fs.writeFileSync(pasta+'/chamadas',JSON.stringify(chamadas));
      ${codigo}
    });`);
  try { await tarefa({ codex: process.execPath, argumentosCodex: [script], timeoutMs: 1000 }, pasta); }
  finally {
    try { process.kill(Number(await readFile(join(pasta, "helper"), "utf8")), "SIGKILL"); } catch { /* helper já foi encerrado */ }
    try { process.kill(Number(await readFile(join(pasta, "pid"), "utf8")), "SIGKILL"); } catch { /* processo já foi recolhido */ }
    await rm(pasta, { recursive: true, force: true });
  }
}

test("Codex faz somente handshake e leitura de cotas, deduplica e encerra subprocesso", async () => {
  await codexFalso(`if(m.id===1)responder({id:1,result:{}});else if(m.id===2)responder({id:2,result:${JSON.stringify(codex)}});`, async (opts, pasta) => {
    const ler = criarLeitorLimitesConta(opts);
    const [a, b] = await Promise.all([ler("codex"), ler("codex")]);
    assert.equal(a.disponivel, true); assert.deepEqual(a, b);
    const chamadas = JSON.parse(await readFile(join(pasta, "chamadas"), "utf8"));
    assert.deepEqual(chamadas.map((m: { method: string }) => m.method), ["initialize", "initialized", "account/rateLimits/read"]);
    assert.deepEqual(chamadas[0], { id: 1, method: "initialize", params: { clientInfo: { name: "anotador_ui_usage", version: "0.2.0" }, capabilities: {} } });
    assert.deepEqual(JSON.parse(await readFile(join(pasta, "args"), "utf8")), ["app-server", "--stdio"]);
    const pid = Number(await readFile(join(pasta, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0));
  });
});

async function dentroDoPrazo<T>(promessa: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promessa, new Promise<never>((_, rejeitar) => { timeout = setTimeout(() => rejeitar(new Error("consulta manteve cache pendente após prazo de limpeza")), 2000); })]); }
  finally { clearTimeout(timeout); }
}
async function processoExecutando(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      // Um neto encerrado pode aguardar coleta pelo init do container.
      const estado = await readFile(`/proc/${pid}/stat`, "utf8");
      return !/^\s+Z\s/.test(estado.slice(estado.lastIndexOf(")") + 1));
    }
    return true;
  } catch { return false; }
}
const auxiliar = `process.on('SIGTERM',()=>{});process.send('pronto');setInterval(()=>{},5000);`;

test("consulta encerra helper que herdou pipes mesmo depois de o pai responder e sair", { skip: process.platform === "win32" }, async () => {
  const codigo = `if(m.id===1){const h=spawn(process.execPath,['-e',${JSON.stringify(auxiliar)}],{stdio:['ignore','inherit','inherit','ipc']});fs.writeFileSync(pasta+'/helper',String(h.pid));h.once('message',()=>responder({id:1,result:{}}));}
    else if(m.id===2)process.stdout.write(JSON.stringify({id:2,result:${JSON.stringify(codex)}})+'\\n',()=>process.exit(0));`;
  await codexFalso(codigo, async (opts, pasta) => {
    const ler = criarLeitorLimitesConta({ ...opts, timeoutMs: 300 });
    const r = await dentroDoPrazo(ler("codex")); assert.equal(r.disponivel, true);
    const pid = Number(await readFile(join(pasta, "helper"), "utf8"));
    await esperarAte(async () => !await processoExecutando(pid), 1000, 20, "helper do grupo precisa parar");
    assert.deepEqual(await dentroDoPrazo(ler("codex")), r, "cache deixa de ficar pendente depois de recolher o grupo");
  });
});

test("timeout mata grupo com helper que ignora TERM e libera nova consulta", { skip: process.platform === "win32" }, async () => {
  const codigo = `if(m.id===1){const h=spawn(process.execPath,['-e',${JSON.stringify(auxiliar)}],{stdio:['ignore','inherit','inherit','ipc']});fs.writeFileSync(pasta+'/helper',String(h.pid));}`;
  await codexFalso(codigo, async (opts, pasta) => {
    let relogio = Date.parse(em);
    const ler = criarLeitorLimitesConta({ ...opts, timeoutMs: 300, agora: () => relogio });
    const r = await dentroDoPrazo(ler("codex")); assert.equal(r.disponivel, false); assert.match(r.aviso ?? "", /demorou/);
    const pid = Number(await readFile(join(pasta, "helper"), "utf8"));
    await esperarAte(async () => !await processoExecutando(pid), 1000, 20);
    relogio += 60_001;
    await dentroDoPrazo(ler("codex"));
    assert.notEqual(Number(await readFile(join(pasta, "helper"), "utf8")), pid, "nova consulta após expirar cache não reutiliza Promise presa");
  });
});

test("prazo final fecha pipes e resolve mesmo se helper sair do grupo da consulta", { skip: process.platform === "win32" }, async () => {
  const codigo = `if(m.id===1){const h=spawn(process.execPath,['-e',${JSON.stringify(auxiliar)}],{detached:true,stdio:['ignore','inherit','inherit','ipc']});fs.writeFileSync(pasta+'/helper',String(h.pid));h.once('message',()=>responder({id:1,result:{}}));}
    else if(m.id===2)responder({id:2,result:${JSON.stringify(codex)}});`;
  await codexFalso(codigo, async (opts) => {
    // A fixture limpa seu helper isolado no finally; o módulo só pode matar o
    // grupo que criou. Fechar os pipes precisa bastar para liberar a consulta.
    const r = await dentroDoPrazo(criarLeitorLimitesConta({ ...opts, timeoutMs: 300 })("codex"));
    assert.equal(r.disponivel, true);
  });
});

test("Codex respeita timeout mesmo quando o processo ignora SIGTERM", async () => {
  await codexFalso("process.on('SIGTERM',()=>{});setInterval(()=>{},5000);", async (opts, pasta) => {
    const r = await criarLeitorLimitesConta({ ...opts, timeoutMs: 300 })("codex");
    assert.equal(r.disponivel, false); assert.match(r.aviso ?? "", /demorou/);
    const pid = Number(await readFile(join(pasta, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0));
  });
});

test("Codex rejeita protocolo inválido, erro de login e saída excessiva sem expor o erro original", async () => {
  for (const codigo of [
    "process.stdout.write('INVALIDO token-secreto\\n');",
    "responder({id:1,error:{message:'token-secreto'}});",
    "if(m.id===1)responder({id:1,result:{}});else if(m.id===2)responder({id:2,error:{message:'token-secreto'}});",
    "process.stdout.write('x'.repeat(256*1024+1));",
  ]) await codexFalso(codigo, async (opts) => {
    const r = await criarLeitorLimitesConta(opts)("codex");
    assert.equal(r.disponivel, false); assert.doesNotMatch(JSON.stringify(r), /token-secreto/);
  });
});

test("agente sem integração fica indisponível sem acessar credenciais ou rede", async () => {
  const ler = criarLeitorLimitesConta({ pastaClaude: () => { throw new Error("não deve ler"); }, requisitar: async () => { throw new Error("não deve chamar"); } });
  for (const agente of ["gemini", "cursor", "outro"]) {
    const r = await ler(agente); assert.equal(r.agente, agente); assert.equal(r.disponivel, false); assert.equal(r.atualizadoEm, null);
  }
});

test("Codex ausente resolve indisponibilidade sem Promise pendente", async () => {
  const r = await criarLeitorLimitesConta({ codex: join(tmpdir(), "anotador-codex-nao-existe-882753"), timeoutMs: 300 })("codex");
  assert.equal(r.disponivel, false); assert.match(r.aviso ?? "", /não está disponível/);
});

test("cache mantém cotas de Codex e Claude isoladas e respeita mudança de pasta Claude", async () => {
  await credenciais(async (pastaA) => credenciais(async (pastaB) => {
    await codexFalso(`if(m.id===1)responder({id:1,result:{}});else if(m.id===2)responder({id:2,result:${JSON.stringify(codex)}});`, async (opts) => {
      let pasta = pastaA, consultas = 0;
      const ler = criarLeitorLimitesConta({ ...opts, pastaClaude: () => pasta, requisitar: async () => { consultas++; return resposta(claude); } });
      const [c, d] = await Promise.all([ler("claude"), ler("codex")]);
      assert.equal(c.agente, "claude"); assert.equal(d.agente, "codex");
      assert.equal(c.janelas[0]?.usadoPercentual, 8.5); assert.equal(d.janelas[0]?.usadoPercentual, 86);
      await ler("claude"); assert.equal(consultas, 1);
      pasta = pastaB; await ler("claude"); assert.equal(consultas, 2);
    });
  }));
});
