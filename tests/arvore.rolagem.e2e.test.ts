import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Navegador,encontrarChromium} from '../lib/cdp.ts';
import {criarAlvoFalso,criarProxy} from './ajuda.ts';

test('árvore revela nós profundos e permite ler nomes completos sem deslocar o site', {skip:!encontrarChromium(),timeout:30000}, async()=>{
 const alvo=await criarAlvoFalso(), proxy=await criarProxy(alvo), navegador=await Navegador.abrir({mostrarBarrasRolagem:true});
 try {
  const p=await navegador.novaPagina();await p.definirViewport(873,746);await p.navegar(proxy.origem+'/');await p.esperarPor('window.__anotadorCarregado');
  await p.avaliar(`(()=>{let n=document.createElement('div');n.style.cssText='position:fixed;right:20px;top:150px';document.body.append(n);for(let i=0;i<24;i++){const f=document.createElement('div');f.id='nivel-profundo-'+i;n.append(f);n=f;}const b=document.createElement('button');b.id='elemento-com-identificador-completo';b.className='classe-completa-sem-recorte';b.textContent='Escolher elemento';n.append(b)})()`);
  const r=await p.avaliar<{x:number,y:number}>(`(()=>{const r=document.getElementById('elemento-com-identificador-completo').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await p.clicar(r.x,r.y);
  await p.avaliar('window.__anotadorDebug.abrirArvore()');
  const root=`document.getElementById('__anotador_host').shadowRoot`, corpo=`${root}.querySelector('.an-arvore .corpo')`;
  await p.esperarPor(`${corpo}.scrollLeft>100`);
  const nome=`${corpo}.querySelector('.an-no.foco .nome')`;
  assert.match(await p.avaliar<string>(`${nome}.textContent`), /elemento-com-identificador-completo\.classe-completa-sem-recorte/);
  assert.equal(await p.avaliar(`${nome}.scrollWidth<=${nome}.clientWidth+1`),true,'o nome não sofre recorte interno');
  const antes=await p.avaliar('({x:scrollX,y:scrollY})');
  await p.avaliar(`${corpo}.querySelector('.an-no.foco').focus({preventScroll:true})`);
  await p.pressionar('ArrowUp');
  assert.deepEqual(await p.avaliar('({x:scrollX,y:scrollY})'),antes);
  await p.avaliar(`${corpo}.scrollLeft=${corpo}.scrollWidth`);
  const scroll=await p.avaliar<number>(`${corpo}.scrollLeft`);
  await p.avaliar("document.body.append(document.createElement('div'))");await p.esperar(400);
  assert.ok(Math.abs(await p.avaliar<number>(`${corpo}.scrollLeft`)-scroll)<2,'atualização mantém rolagem manual');
  for(const width of [390,320]){
   await p.definirViewport(width,746);
   assert.equal(await p.avaliar(`(()=>{const r=${root}.querySelector('.an-arvore').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`),true);
   assert.equal(await p.avaliar(`${corpo}.scrollWidth>${corpo}.clientWidth`),true);
  }
  assert.deepEqual(p.erros,[]);
 }finally{await navegador.fechar();await proxy.fechar();await alvo.fechar();}
});
