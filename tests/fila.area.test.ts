import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Fila, validarLote } from "../lib/fila.ts";
import { loteDeExemplo } from "./ajuda.ts";

const viewport = { largura: 873, altura: 746, dpr: 2, scrollX: 10, scrollY: 200 };
const area = {
  rectPagina: { left: 30.25, top: 230.5, width: 220.5, height: 140.25 }, viewport,
  elementos: [
    { seletores: [{tipo:"css",valor:"#primeiro",unico:true,pontos:100}], meta: {tag:"button",texto:"Primeiro",attrs:{class:"botao"}}, framePath:[],shadowPath:[],rect:{left:30,top:40,width:90,height:40},intersecao:"parcial" },
    { seletores: [{tipo:"css",valor:"#segundo",unico:true,pontos:100}], meta: {tag:"a",texto:"Segundo",attrs:{}}, framePath:["iframe#teste"],shadowPath:["widget-ui"],rect:{left:220,top:70,width:40,height:40},intersecao:"inteiro" },
    { seletores: [{tipo:"css",valor:"#fora",unico:true,pontos:100}], meta: {tag:"div",texto:"Fora"},rect:{left:600,top:400,width:30,height:30},intersecao:"inteiro" },
  ],truncado:false,
};
function entrada(): Record<string, unknown> {
  const original=loteDeExemplo();return {...original,pagina:{...original.pagina,viewport},anotacoes:[{...original.anotacoes[0],area}]};
}
test("área mantém coordenadas fracionárias, vários alvos e rejeita expansão ao ancestral",()=>{
  const lote=validarLote(entrada()), a=lote.anotacoes[0]!;
  assert.deepEqual(a.area?.rectPagina,area.rectPagina);
  assert.deepEqual(a.area?.viewport,viewport);
  assert.equal(a.area?.elementos.length,2);
  assert.deepEqual(a.area?.elementos.map(e=>e.intersecao),["inteiro","parcial"]);
  assert.deepEqual(a.area?.elementos[1]?.framePath,["iframe#teste"]);
  assert.deepEqual(a.area?.elementos[1]?.shadowPath,["widget-ui"]);
  assert.deepEqual(a.elemento.rectPagina,area.rectPagina);
  assert.equal(a.elemento.rect.left,20.25);
  assert.equal(a.elemento.rect.top,30.5);
  assert.deepEqual(a.elemento.seletores,[]);
  assert.deepEqual(a.alteracoes,[]);
  assert.equal(a.texto,null);
});
test("área inválida recusa lote; lista limitada explicita truncamento",()=>{
  const comArea=(valor:unknown)=>({...entrada(),anotacoes:[{...loteDeExemplo().anotacoes[0],area:valor}]});
  for(const valor of [null,[],{}, {...area,rectPagina:{...area.rectPagina,width:-2}}, {...area,viewport:{...viewport,dpr:0}}, {...area,rectPagina:{...area.rectPagina,top:Infinity}}])assert.throws(()=>validarLote(comArea(valor)),/região selecionada inválida/);
  const lote=validarLote(comArea({...area,elementos:Array.from({length:101},()=>area.elementos[0])}));
  assert.equal(lote.anotacoes[0]?.area?.elementos.length,100);
  assert.equal(lote.anotacoes[0]?.area?.truncado,true);
});
test("fila e Markdown preservam região precisa e os seletores de cada elemento",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"anotador-area-fila-"));
  try{
    const fila=new Fila(dir);await fila.preparar();const lote=validarLote(entrada());await fila.gravar(lote);
    assert.deepEqual((await fila.ler(lote.id))?.anotacoes[0]?.area,lote.anotacoes[0]?.area);
    const md=await fila.lerMarkdown(lote.id);
    assert.match(md??"",/x=30\.25, y=230\.5, largura=220\.5, altura=140\.25/);
    assert.match(md??"",/#primeiro/);assert.match(md??"",/#segundo/);assert.doesNotMatch(md??"",/#fora/);
    assert.match(md??"",/parcialmente na região/);assert.match(md??"",/iframe#teste/);
    assert.doesNotMatch(md??"",/Elemento: `<area>`/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
