// Ponte de estado de uma única navegação HTTP→HTTPS. O token tem vida curta,
// é consumido uma vez e nunca é enviado ao app que está sendo anotado.
import { randomBytes } from "node:crypto";

export const LIMITE_ARMAZENAMENTO_CONTINUACAO = 2 * 1024 * 1024;
const VIDA_CONTINUACAO = 5 * 60_000;
const MAX_CONTINUACOES = 50;

export interface EstadoContinuacao {
  voltar: string;
  armazenamento: string;
  campo: "anotacao" | "conversa" | "chat";
}

export class ErroContinuacao extends Error {
  readonly status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; }
}

export function hostContinuacao(valor: unknown): string {
  try {
    if (typeof valor !== "string" || !valor || /[\\/\s?#@]/.test(valor)) throw new Error();
    const url = new URL("https://" + valor);
    if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.host;
  } catch { throw new ErroContinuacao("Endereço do Anotador inválido."); }
}

export function validarContinuacao(valor: unknown): EstadoContinuacao {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroContinuacao("Pedido de continuação inválido.");
  const dados = valor as Record<string, unknown>;
  const voltar = dados["voltar"];
  if (typeof voltar !== "string" || voltar.length > 4000 || !voltar.startsWith("/") || voltar.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(voltar)) {
    throw new ErroContinuacao("A continuação precisa voltar à mesma página do Anotador.");
  }
  let destino: URL;
  try {
    destino = new URL(voltar, "http://anotador.local");
    const caminho = decodeURIComponent(destino.pathname);
    if (destino.origin !== "http://anotador.local" || caminho.startsWith("//") || caminho.includes("\\") || caminho === "/__anotador" || caminho.startsWith("/__anotador/")) throw new Error();
  } catch { throw new ErroContinuacao("Página de retorno inválida para continuar o ditado."); }
  const armazenamento = dados["armazenamento"];
  if (typeof armazenamento !== "string" || Buffer.byteLength(armazenamento) > LIMITE_ARMAZENAMENTO_CONTINUACAO) {
    throw new ErroContinuacao("As anotações são grandes demais para continuar nesta página (limite de 2 MB).");
  }
  try {
    const objeto = JSON.parse(armazenamento) as unknown;
    if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) throw new Error();
  } catch { throw new ErroContinuacao("Não consegui ler o rascunho que será preservado."); }
  if (dados["campo"] !== "anotacao" && dados["campo"] !== "conversa" && dados["campo"] !== "chat") throw new ErroContinuacao("Campo de ditado inválido.");
  return { voltar: destino.pathname + destino.search + destino.hash, armazenamento, campo: dados["campo"] };
}

export class Continuacoes {
  private readonly entradas = new Map<string, { host: string; expira: number; estado: EstadoContinuacao }>();
  private readonly agora: () => number;
  constructor(agora: () => number = Date.now) { this.agora = agora; }

  private expirar(): void {
    for (const [token, entrada] of this.entradas) if (entrada.expira <= this.agora()) this.entradas.delete(token);
  }

  criar(corpo: unknown, host: string): string {
    const estado = validarContinuacao(corpo);
    const destino = hostContinuacao(host);
    this.expirar();
    if (this.entradas.size >= MAX_CONTINUACOES) throw new ErroContinuacao("Há muitas continuações em andamento. Tente novamente em alguns minutos.", 429);
    const token = randomBytes(32).toString("hex");
    this.entradas.set(token, { host: destino, expira: this.agora() + VIDA_CONTINUACAO, estado });
    return token;
  }

  consumir(token: unknown, host: string): EstadoContinuacao {
    this.expirar();
    const entrada = typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? this.entradas.get(token) : undefined;
    if (!entrada || entrada.host !== hostContinuacao(host)) throw new ErroContinuacao("Esta continuação expirou ou já foi usada. Volte à página original e clique no microfone novamente.", 410);
    this.entradas.delete(token as string);
    return { ...entrada.estado };
  }
}

export const PAGINA_RETOMADA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Continuando no Anotador</title>
<style>:root{font:16px/1.5 system-ui,sans-serif;color-scheme:dark;background:#161c19;color:#edf3f0}body{margin:0;display:grid;min-height:100vh;place-items:center}main{width:min(480px,calc(100% - 48px))}h1{font-size:26px;line-height:1.2}p{color:#b5c4bc}button,a{display:inline-block;border:1px solid #4b6155;border-radius:24px;background:#8adeb9;color:#112d20;padding:10px 18px;font:inherit;text-decoration:none;cursor:pointer}[hidden]{display:none}</style></head>
<body><main><h1>Continuando na mesma página</h1><p id="status" role="status">Preservando suas anotações para liberar o microfone…</p><button id="voltar" type="button" hidden>Voltar à página original</button></main>
<script>(()=>{"use strict";
const token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
const status=document.getElementById("status"),voltar=document.getElementById("voltar");
voltar.onclick=()=>{if(history.length>1)history.back();else location.replace("/")};
function falhar(texto){status.textContent=texto;voltar.hidden=false}
function objeto(texto){const dado=JSON.parse(texto);if(!dado||typeof dado!=="object"||Array.isArray(dado))throw new Error("Rascunho inválido.");return dado}
function unir(antigos,novos){const mapa=new Map();for(const item of [...(Array.isArray(antigos)?antigos:[]),...(Array.isArray(novos)?novos:[])]){if(item&&typeof item==="object"&&typeof item.id==="string")mapa.set(item.id,item)}return Array.from(mapa.values())}
if(!/^[a-f0-9]{64}$/.test(token)){falhar("Esta continuação expirou ou já foi usada. Volte à página original e clique no microfone novamente.");return}
(async()=>{try{
const resposta=await fetch("/__anotador/voz/retomar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token}),cache:"no-store",credentials:"same-origin",referrerPolicy:"no-referrer"});
const dados=await resposta.json();if(!resposta.ok)throw new Error(dados.erro||"Não foi possível continuar o ditado.");
// Só deixa a página de conexão quando o navegador confirma que guardou o cookie
// HttpOnly emitido na retomada. Bloqueio de cookies não vira erro de chave no app.
const acesso=await fetch("/__anotador/acesso/sessao",{cache:"no-store",credentials:"same-origin",referrerPolicy:"no-referrer"});
if(!acesso.ok)throw new Error("O navegador não conseguiu guardar a conexão segura. Permita cookies para este endereço e volte à página original para tentar novamente.");
const destino=new URL(dados.voltar,location.origin);if(destino.origin!==location.origin||destino.pathname==="/__anotador"||destino.pathname.startsWith("/__anotador/"))throw new Error("Página de retorno inválida.");
const chave="anotador-ui:"+destino.pathname,anterior=localStorage.getItem(chave),entrada=objeto(dados.armazenamento);
let antigos={};if(anterior){try{antigos=objeto(anterior)}catch{}localStorage.setItem("anotador-ui:antes-continuacao:"+destino.pathname,anterior)}
const salvo={...antigos,...entrada};for(const campo of ["anotacoes","enviadas","lotes"])salvo[campo]=unir(antigos[campo],entrada[campo]);
const pendentesNovas=new Set((Array.isArray(entrada.anotacoes)?entrada.anotacoes:[]).map(a=>a&&a.id));
const enviadasNovas=new Set((Array.isArray(entrada.enviadas)?entrada.enviadas:[]).map(a=>a&&a.id));
salvo.anotacoes=salvo.anotacoes.filter(a=>!enviadasNovas.has(a.id));salvo.enviadas=salvo.enviadas.filter(a=>!pendentesNovas.has(a.id));
for(const campo of ["rascunho","painelAberto","conversaRascunho","posicaoPagina"])if(!Object.prototype.hasOwnProperty.call(entrada,campo))delete salvo[campo];
localStorage.setItem(chave,JSON.stringify(salvo));
if(["pt","en","es","fr","de","it"].includes(entrada.idiomaDitado))localStorage.setItem("anotador-ui:idioma-ditado",entrada.idiomaDitado);
if(entrada.chat&&typeof entrada.chat.nome==="string"&&entrada.chat.nome.length<=80&&typeof entrada.chat.estado==="string"){
const chaveChat="anotador-ui:chat:"+encodeURIComponent(entrada.chat.nome)+":"+destino.pathname,novoChat=objeto(entrada.chat.estado),anteriorChat=localStorage.getItem(chaveChat);
if(novoChat.versao===1){let velhoChat={};if(anteriorChat){try{velhoChat=objeto(anteriorChat)}catch{}localStorage.setItem(chaveChat+":antes-continuacao",anteriorChat)}
const rascunhos=new Map();for(const item of [...(Array.isArray(velhoChat.rascunhos)?velhoChat.rascunhos:[]),...(Array.isArray(novoChat.rascunhos)?novoChat.rascunhos:[])])if(Array.isArray(item)&&typeof item[0]==="string"&&typeof item[1]==="string")rascunhos.set(item[0],item[1].slice(0,16000));
localStorage.setItem(chaveChat,JSON.stringify({...novoChat,rascunhos:Array.from(rascunhos)}));}}
sessionStorage.setItem("anotador-ui:ditado-pendente",JSON.stringify({campo:dados.campo,voltar:dados.voltar,criadaEm:Date.now()}));
location.replace(dados.voltar);
}catch(erro){falhar(erro&&erro.message?erro.message:"Não consegui preservar as anotações. Volte à página original e tente novamente.")}})();
})();</script></body></html>`;
