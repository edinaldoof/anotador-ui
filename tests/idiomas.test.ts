import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { injetarIdiomasHtml, scriptIdiomas } from "../lib/idiomas.ts";

interface Idiomas { idioma():string; definir(idioma:string):void; t(texto:string,parametros?:Record<string,unknown>):string; registrar(catalogo:unknown):void; observar(callback:(idioma:string)=>void):()=>void }
async function ambiente(valor?: string, bloqueado = false) {
  const armazenamento = new Map(valor ? [["anotador-ui:idioma-interface", valor]] : []);
  const janela = new EventTarget() as EventTarget & { __anotador_i18n: Idiomas };
  runInNewContext(await scriptIdiomas(), { window: janela, CustomEvent, console, localStorage: { getItem: (chave:string) => { if (bloqueado) throw new Error("bloqueado"); return armazenamento.get(chave) ?? null; }, setItem: (chave:string,valor:string) => { if (bloqueado) throw new Error("bloqueado"); armazenamento.set(chave,valor); } } });
  return { i18n: janela.__anotador_i18n, janela, armazenamento };
}

test("interface começa em português, valida preferência e funciona sem armazenamento", async () => {
  for (const [valor,bloqueado] of [[undefined,false],["invalido",false],[undefined,true]] as const) {
    const {i18n}=await ambiente(valor,bloqueado); assert.equal(i18n.idioma(),"pt-BR"); i18n.definir("en"); assert.equal(i18n.idioma(),"en");
  }
  assert.equal((await ambiente("es")).i18n.idioma(), "es");
});

test("dicionários traduzem apenas frases explícitas e interpolam dados sem alterá-los", async () => {
  const {i18n}=await ambiente("en");
  i18n.registrar({en:{"Sessão {nome}":"Session {nome}"},es:{"Sessão {nome}":"Sesión {nome}"}});
  const nome="Ponte automática <img src=x onerror=alert(1)>";
  assert.equal(i18n.t("Sessão {nome}",{nome}),"Session "+nome);
  assert.equal(i18n.t("Conteúdo que o usuário escreveu"),"Conteúdo que o usuário escreveu");
  assert.equal(i18n.t("{faltante}"),"{faltante}");
  i18n.definir("es");assert.equal(i18n.t("Sessão {nome}",{nome}),"Sesión "+nome);
  i18n.definir("pt-BR");assert.equal(i18n.t("Sessão {nome}",{nome}),"Sessão "+nome);
});

test("preferência da interface não altera ditado e observa mudanças entre abas", async () => {
  const {i18n,janela,armazenamento}=await ambiente();const vistos:string[]=[];
  armazenamento.set("anotador-ui:idioma-ditado","de"); const remover=i18n.observar(idioma=>vistos.push(idioma));
  i18n.definir("en");assert.equal(armazenamento.get("anotador-ui:idioma-interface"),"en");
  janela.dispatchEvent(Object.assign(new Event("storage"),{key:"anotador-ui:idioma-interface",newValue:"es"}));
  assert.deepEqual(vistos,["en","es"]);assert.equal(i18n.idioma(),"es");assert.equal(armazenamento.get("anotador-ui:idioma-ditado"),"de");
  remover();i18n.definir("pt-BR");assert.deepEqual(vistos,["en","es"]);
});

test("runtime é injetado antes do código da página e não usa serviço externo", async () => {
  const html=await injetarIdiomasHtml('<html><head></head><body><script>window.codigoDaPagina=true</script></body></html>');
  assert.ok(html.indexOf('data-anotador-idiomas') < html.indexOf('window.codigoDaPagina'));
  assert.doesNotMatch(await scriptIdiomas(),/fetch\(|XMLHttpRequest|https:\/\//);
});
