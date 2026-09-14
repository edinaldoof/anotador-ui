// Fila em disco: cada lote vira JSON + Markdown legível; o status acompanha o
// ciclo recebido → processado. A gravação é idempotente pelo id do lote.

import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gravarAtomico, serializar } from "./persistencia.ts";
import { Anexos, ErroAnexo, idAnexoSeguro, LIMITE_ANEXOS_ANOTACAO, type ContextoVinculoAnexo } from "./anexos.ts";

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const LIMITE_ANOTACOES = 200;
const LIMITE_INSTANTANEO = 8 * 1024 * 1024;

export function idSeguro(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function numero(v: unknown, padrao = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : padrao;
}

function rect(v: unknown): Rect {
  const o = (v ?? {}) as Record<string, unknown>;
  return { left: numero(o["left"]), top: numero(o["top"]), width: numero(o["width"]), height: numero(o["height"]) };
}

function seletores(v: unknown): Seletor[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).flatMap((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const tipo = o["tipo"];
    if (typeof tipo !== "string" || typeof o["valor"] !== "string") return [];
    const sel: Seletor = {
      tipo: tipo as TipoSeletor,
      valor: texto(o["valor"], 2000),
      unico: o["unico"] === true,
      pontos: numero(o["pontos"]),
    };
    if (typeof o["tag"] === "string") sel.tag = o["tag"];
    return [sel];
  });
}

function meta(v: unknown): MetaElemento {
  const o = (v ?? {}) as Record<string, unknown>;
  const attrs: Record<string, string> = {};
  for (const [k, val] of Object.entries((o["attrs"] ?? {}) as Record<string, unknown>)) {
    if (typeof val === "string") attrs[k.slice(0, 64)] = val.slice(0, 1000);
  }
  const cadeia = Array.isArray(o["cadeia"])
    ? (o["cadeia"] as unknown[]).slice(0, 12).map((n) => {
        const item = (n ?? {}) as Record<string, unknown>;
        const nivel: NivelAncestral = { tag: texto(item["tag"], 32) || "?" };
        if (typeof item["id"] === "string") nivel.id = item["id"].slice(0, 64);
        if (typeof item["classe"] === "string") nivel.classe = item["classe"].slice(0, 64);
        if (typeof item["role"] === "string") nivel.role = item["role"].slice(0, 32);
        return nivel;
      })
    : [];
  const componentes = Array.isArray(o["componentes"])
    ? (o["componentes"] as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 10)
    : [];
  const m: MetaElemento = { tag: texto(o["tag"], 32) || "?", attrs, texto: texto(o["texto"], 400), cadeia, componentes };
  if (typeof o["html"] === "string") m.html = o["html"].slice(0, 2000);
  if (typeof o["htmlPai"] === "string") m.htmlPai = o["htmlPai"].slice(0, 600);
  return m;
}

function computado(v: unknown): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, val] of Object.entries((v ?? {}) as Record<string, unknown>)) {
    if (typeof val === "string") saida[k.slice(0, 64)] = val.slice(0, 400);
  }
  return saida;
}

const PROPRIEDADES_CONTEXTO_VISUAL = [
  "display", "position", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "overflow-x", "overflow-y", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "align-items", "align-self", "justify-content", "grid-template-columns", "grid-template-rows", "gap",
  "padding", "margin", "border-width", "border-color", "border-radius", "box-shadow",
  "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "white-space",
];

function contextoVisual(v: unknown): ContextoVisualAnotacao | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o["nos"])) return;
  const caminhos = (c: unknown): string[] => Array.isArray(c) ? c.filter((p): p is string => typeof p === "string").slice(0, 8).map((p) => p.slice(0, 400)) : [];
  const nos: NoContextoVisual[] = o["nos"].slice(0, 3).flatMap((bruto) => {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return [];
    const n = bruto as Record<string, unknown>;
    const relacao = n["relacao"];
    if (relacao !== "alvo" && relacao !== "pai" && relacao !== "avo") return [];
    const origem = n["estilos"] && typeof n["estilos"] === "object" ? n["estilos"] as Record<string, unknown> : {};
    const estilos: Record<string, string> = {};
    for (const propriedade of PROPRIEDADES_CONTEXTO_VISUAL) {
      if (typeof origem[propriedade] === "string") estilos[propriedade] = texto(origem[propriedade], 400);
    }
    return [{
      relacao, tag: texto(n["tag"], 32), seletor: seletores([n["seletor"]])[0] ?? null,
      framePath: caminhos(n["framePath"]), shadowPath: caminhos(n["shadowPath"]), rect: rect(n["rect"]),
      clientWidth: numero(n["clientWidth"]), clientHeight: numero(n["clientHeight"]),
      scrollWidth: numero(n["scrollWidth"]), scrollHeight: numero(n["scrollHeight"]), estilos,
    }];
  });
  if (!nos.length) return;
  const vp = (o["viewport"] ?? {}) as Record<string, unknown>;
  return {
    url: texto(o["url"], 2000), capturadoEm: texto(o["capturadoEm"], 40), nos,
    viewport: { largura: numero(vp["largura"]), altura: numero(vp["altura"]), dpr: numero(vp["dpr"], 1), scrollX: numero(vp["scrollX"]), scrollY: numero(vp["scrollY"]) },
  };
}

function elemento(v: unknown): ElementoAnotado {
  const o = (v ?? {}) as Record<string, unknown>;
  const el: ElementoAnotado = {
    seletores: seletores(o["seletores"]),
    meta: meta(o["meta"]),
    framePath: Array.isArray(o["framePath"]) ? (o["framePath"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
    shadowPath: Array.isArray(o["shadowPath"]) ? (o["shadowPath"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
    rect: rect(o["rect"]),
    rectPagina: o["rectPagina"] ? rect(o["rectPagina"]) : null,
    computado: computado(o["computado"]),
    localizado: o["localizado"] !== false,
  };
  const contexto = contextoVisual(o["contextoVisual"]);
  if (contexto) el.contextoVisual = contexto;
  if (o["interno"] && typeof o["interno"] === "object") {
    const i = o["interno"] as Record<string, unknown>;
    el.interno = { seletores: seletores(i["seletores"]), meta: meta(i["meta"]) };
  }
  return el;
}

function alteracoes(v: unknown): AlteracaoEstilo[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).flatMap((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    if (typeof o["propriedade"] !== "string") return [];
    return [{ propriedade: o["propriedade"].slice(0, 64), antes: texto(o["antes"], 400), depois: texto(o["depois"], 400) }];
  });
}

function referenciasAnexos(v: unknown): AnexoImagem[] {
  if (!Array.isArray(v) || v.length > LIMITE_ANEXOS_ANOTACAO) throw new ErroAnexo("cada anotação aceita no máximo 3 prints");
  const vistos = new Set<string>();
  return v.map((item: unknown) => {
    const id = item && typeof item === "object" ? (item as Record<string, unknown>)["id"] : null;
    if (!idAnexoSeguro(id) || vistos.has(id)) throw new ErroAnexo("id do print inválido ou repetido");
    vistos.add(id);
    // Referência transitória: Fila.gravar obrigatoriamente a resolve antes de
    // persistir ou entregar o lote. Nenhum outro metadado do cliente é aceito.
    return { id } as AnexoImagem;
  });
}

function areaAnotada(v: unknown): AreaAnotada {
  const falhar = (): never => { throw new Error("lote inválido: região selecionada inválida"); };
  if (!v || typeof v !== "object" || Array.isArray(v)) return falhar();
  const o = v as Record<string, unknown>;
  const caixa = (valor: unknown): Rect => {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return falhar();
    const r = valor as Record<string, unknown>;
    if (!["left", "top", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]) && Math.abs(r[k] as number) <= 10_000_000)
      || (r["width"] as number) <= 0 || (r["height"] as number) <= 0) return falhar();
    return rect(r);
  };
  const rectPagina = caixa(o["rectPagina"]);
  if (!o["viewport"] || typeof o["viewport"] !== "object" || !Array.isArray(o["elementos"])) return falhar();
  const vp = o["viewport"] as Record<string, unknown>;
  if (!["largura", "altura", "dpr", "scrollX", "scrollY"].every((k) => typeof vp[k] === "number" && Number.isFinite(vp[k]) && Math.abs(vp[k] as number) <= 10_000_000)
    || (vp["largura"] as number) <= 0 || (vp["altura"] as number) <= 0 || (vp["dpr"] as number) <= 0 || (vp["dpr"] as number) > 8) return falhar();
  const viewport: ViewportLote = { largura: numero(vp["largura"]), altura: numero(vp["altura"]), dpr: numero(vp["dpr"]), scrollX: numero(vp["scrollX"]), scrollY: numero(vp["scrollY"]) };
  const regiao = { left: rectPagina.left - viewport.scrollX, top: rectPagina.top - viewport.scrollY, width: rectPagina.width, height: rectPagina.height };
  const caminhos = (valor: unknown): string[] => Array.isArray(valor) ? valor.filter((c): c is string => typeof c === "string").slice(0,16).map((c) => c.slice(0,2000)) : [];
  const elementos = o["elementos"].slice(0,100).flatMap((bruto): ElementoArea[] => {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return [];
    const e = bruto as Record<string, unknown>;
    let r: Rect;
    try { r = caixa(e["rect"]); } catch { return []; }
    if (r.left >= regiao.left + regiao.width || r.top >= regiao.top + regiao.height || r.left + r.width <= regiao.left || r.top + r.height <= regiao.top) return [];
    const inteiro = r.left >= regiao.left - .5 && r.top >= regiao.top - .5 && r.left+r.width <= regiao.left+regiao.width+.5 && r.top+r.height <= regiao.top+regiao.height+.5;
    const metadados = meta(e["meta"]);
    delete metadados.html; delete metadados.htmlPai;
    metadados.attrs = Object.fromEntries(Object.entries(metadados.attrs).slice(0,30));
    return [{ seletores: seletores(e["seletores"]), meta: metadados, rect: r, framePath: caminhos(e["framePath"]), shadowPath: caminhos(e["shadowPath"]), intersecao: inteiro ? "inteiro" : "parcial" }];
  });
  return { rectPagina, viewport, elementos, truncado: o["truncado"] === true || o["elementos"].length > 100 };
}

export function validarLote(x: unknown): Lote {
  if (!x || typeof x !== "object") throw new Error("lote inválido: corpo não é objeto");
  const o = x as Record<string, unknown>;
  if (!idSeguro(o["id"])) throw new Error("lote inválido: id ausente ou fora do padrão");
  if (!Array.isArray(o["anotacoes"]) || o["anotacoes"].length === 0) throw new Error("lote inválido: sem anotações");
  if (o["anotacoes"].length > LIMITE_ANOTACOES) throw new Error("lote inválido: anotações demais");
  const pagina = (o["pagina"] ?? {}) as Record<string, unknown>;
  const vp = (pagina["viewport"] ?? {}) as Record<string, unknown>;
  const instantaneo = typeof o["instantaneo"] === "string" ? o["instantaneo"] : null;
  if (instantaneo && instantaneo.length > LIMITE_INSTANTANEO) throw new Error("lote inválido: instantâneo grande demais");
  const anotacoes: Anotacao[] = (o["anotacoes"] as unknown[]).map((a, i) => {
    const an = (a ?? {}) as Record<string, unknown>;
    const anotacao: Anotacao = {
      id: idSeguro(an["id"]) ? an["id"] : `${o["id"]}-${i + 1}`,
      ordem: numero(an["ordem"], i + 1),
      comentario: texto(an["comentario"], 4000),
      elemento: elemento(an["elemento"]),
      alteracoes: alteracoes(an["alteracoes"]),
      texto:
        an["texto"] && typeof an["texto"] === "object"
          ? { antes: texto((an["texto"] as Record<string, unknown>)["antes"], 4000), depois: texto((an["texto"] as Record<string, unknown>)["depois"], 4000) }
          : null,
      criadaEm: texto(an["criadaEm"], 40) || new Date().toISOString(),
    };
    if (an["anexos"] !== undefined) anotacao.anexos = referenciasAnexos(an["anexos"]);
    if (an["area"] !== undefined) {
      anotacao.area = areaAnotada(an["area"]);
      anotacao.elemento.meta = { tag: "area", texto: `${anotacao.area.elementos.length} elementos na região`, attrs: {}, cadeia: [], componentes: [] };
      anotacao.elemento.seletores = [];
      anotacao.elemento.computado = {};
      delete anotacao.elemento.interno;
      delete anotacao.elemento.contextoVisual;
      anotacao.elemento.framePath = [];
      anotacao.elemento.shadowPath = [];
      anotacao.elemento.rectPagina = { ...anotacao.area.rectPagina };
      anotacao.elemento.rect = { ...anotacao.area.rectPagina, left: anotacao.area.rectPagina.left - numero(vp["scrollX"]), top: anotacao.area.rectPagina.top - numero(vp["scrollY"]) };
      anotacao.alteracoes = [];
      anotacao.texto = null;
    }
    return anotacao;
  });
  return {
    id: o["id"],
    ferramenta: "anotador-ui",
    versao: 1,
    enviadoEm: texto(o["enviadoEm"], 40) || new Date().toISOString(),
    pagina: {
      url: texto(pagina["url"], 2000),
      caminho: texto(pagina["caminho"], 1000),
      titulo: texto(pagina["titulo"], 300),
      viewport: {
        largura: numero(vp["largura"], 1280),
        altura: numero(vp["altura"], 800),
        dpr: numero(vp["dpr"], 1),
        scrollX: numero(vp["scrollX"]),
        scrollY: numero(vp["scrollY"]),
      },
      tema: typeof pagina["tema"] === "string" ? pagina["tema"] : null,
      userAgent: texto(pagina["userAgent"], 400),
    },
    anotacoes,
    instantaneo,
  };
}

function celula(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/`/g, "'");
}

function descreverSeletor(s: Seletor): string {
  const valor = s.tipo === "texto" ? `texto "${s.valor}"${s.tag ? ` em <${s.tag}>` : ""}` : `\`${s.valor}\``;
  return `${valor} — ${s.tipo}, ${s.unico ? "único" : "não único"}, ${s.pontos} pts`;
}

function markdownArea(area: AreaAnotada): string[] {
  const r = area.rectPagina;
  const linhas = [
    "### Região selecionada", "",
    `- Retângulo exato no documento, em pixels CSS: x=${r.left}, y=${r.top}, largura=${r.width}, altura=${r.height}.`,
    `- Viewport na seleção: ${area.viewport.largura}×${area.viewport.altura} @${area.viewport.dpr}x; rolagem (${area.viewport.scrollX}, ${area.viewport.scrollY}).`,
    `- ${area.elementos.length} elemento(s) observado(s) na região${area.truncado ? "; a lista atingiu o limite de 100 referências" : ""}.`,
    "- O pedido vale para a região desenhada e seus elementos indicados. A caixa não representa o contêiner ancestral inteiro; um elemento parcial tem conteúdo fora da região.", "",
  ];
  for (const [i, el] of area.elementos.entries()) {
    linhas.push(`#### Elemento ${i+1} — ${celula(el.meta.tag)} (${el.intersecao === "inteiro" ? "inteiro na região" : "parcialmente na região"})`, "");
    for (const s of el.seletores.slice(0,3)) linhas.push(`- Seletor ${celula(s.tipo)}: \`${celula(s.valor)}\``);
    if (el.meta.texto) linhas.push(`- Texto observado: ${celula(el.meta.texto)}`);
    if (el.meta.attrs["class"]) linhas.push(`- Classes: \`${celula(el.meta.attrs["class"])}\``);
    if (el.meta.componentes.length) linhas.push(`- Componentes: ${el.meta.componentes.map(celula).join(" ‹ ")}`);
    if (el.framePath.length) linhas.push(`- Iframes: ${el.framePath.map(celula).join(" » ")}`);
    if (el.shadowPath.length) linhas.push(`- Shadow DOM: ${el.shadowPath.map(celula).join(" » ")}`);
    linhas.push(`- Caixa no viewport da seleção: ${el.rect.width}×${el.rect.height} em (${el.rect.left}, ${el.rect.top}).`, "");
  }
  return linhas;
}

function markdownContextoVisual(contexto: ContextoVisualAnotacao): string[] {
  const vp = contexto.viewport;
  const linhas = [
    "### Contexto visual na seleção", "",
    `Medições observadas em ${celula(contexto.capturadoEm)}, antes das edições. URL: \`${celula(contexto.url)}\`. Viewport: ${vp.largura}×${vp.altura} @${vp.dpr}x, rolagem (${vp.scrollX}, ${vp.scrollY}).`,
    "O recorte considera somente o alvo e até dois ancestrais. As medidas não identificam sozinhas a causa de um problema nem representam uma regra universal do design.", "",
  ];
  const grupos: Array<[string, string[]]> = [
    ["Layout", ["display", "position", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height"]],
    ["Flex/grid", ["flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content", "grid-template-columns", "grid-template-rows"]],
    ["Overflow e espaçamento", ["overflow-x", "overflow-y", "white-space", "gap", "padding", "margin"]],
    ["Cores e bordas", ["color", "background-color", "border-width", "border-color", "border-radius", "box-shadow"]],
    ["Tipografia", ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"]],
  ];
  const rotulos = { alvo: "Alvo", pai: "Pai visual", avo: "Avô visual" };
  for (const no of contexto.nos) {
    const r = no.rect;
    const medida = (valor: number) => Math.round(valor * 100) / 100;
    linhas.push(`**${rotulos[no.relacao]} — \`<${celula(no.tag)}>\`${no.seletor ? " · " + descreverSeletor(no.seletor) : ""}**`, "");
    linhas.push(`- Caixa no viewport superior: ${medida(r.width)}×${medida(r.height)} em (${medida(r.left)}, ${medida(r.top)}). Área cliente: ${no.clientWidth}×${no.clientHeight}; conteúdo rolável: ${no.scrollWidth}×${no.scrollHeight}.`);
    if (no.framePath.length) linhas.push(`- Iframe: ${no.framePath.map((s) => "`" + celula(s) + "`").join(" » ")}.`);
    if (no.shadowPath.length) linhas.push(`- Shadow DOM: ${no.shadowPath.map((s) => "`" + celula(s) + "`").join(" » ")}.`);
    for (const [grupo, propriedades] of grupos) {
      const valores = propriedades.filter((p) => no.estilos[p]).map((p) => "`" + p + ": " + celula(no.estilos[p]!) + "`");
      if (valores.length) linhas.push(`- ${grupo}: ${valores.join("; ")}.`);
    }
    linhas.push("");
  }
  return linhas;
}

export function gerarMarkdown(lote: Lote, capturas?: CapturaLote | null, analise?: AnaliseLote | null): string {
  const l: string[] = [];
  const vp = lote.pagina.viewport;
  l.push(`# Lote de anotações ${lote.id}`);
  l.push("");
  l.push(`- Enviado em: ${lote.enviadoEm}`);
  l.push(`- Página: ${lote.pagina.url}${lote.pagina.titulo ? ` — "${lote.pagina.titulo}"` : ""}`);
  l.push(`- Viewport: ${vp.largura}×${vp.altura} @${vp.dpr}x, rolagem (${vp.scrollX}, ${vp.scrollY})${lote.pagina.tema ? ` · tema ${lote.pagina.tema}` : ""}`);
  l.push(`- Anotações: ${lote.anotacoes.length}`);
  if (analise) {
    l.push(`- Código-fonte varrido: ${analise.raiz} (${analise.arquivosVarridos} arquivos)${analise.tailwind ? ` · Tailwind ${analise.tailwind}` : " · sem Tailwind detectado"}`);
    if (analise.rota) l.push(`- Rota ${analise.rota.caminho} → ${analise.rota.entradas.map((e) => `\`${e}\``).join(", ")} (+${analise.rota.alcance} arquivo(s) importado(s)); ocorrências marcadas "na rota" pesam mais`);
  }
  if (capturas?.pagina) l.push(`- Print da página: ${capturas.pagina}`);
  if (capturas?.erro) l.push(`- ${capturas.pagina ? "Capturas geradas com avisos" : "Capturas indisponíveis"}: ${capturas.erro}`);
  l.push("");
  const ordenadas = [...lote.anotacoes].sort((a, b) => a.ordem - b.ordem);
  for (const a of ordenadas) {
    const m = a.elemento.meta;
    l.push(`## Anotação ${a.ordem}${a.comentario ? ` — ${a.comentario}` : ""}`);
    l.push("");
    if (!a.comentario) l.push(a.area ? "_Região selecionada para referência visual._" : "_Sem comentário — só alterações de propriedade._");
    if (a.area) l.push(...markdownArea(a.area));
    else {
    l.push(
      `- Elemento: \`<${m.tag}>\` · ${
        m.componentes.length
          ? `componentes React: ${m.componentes.join(" ‹ ")}`
          : "sem componente React no cliente (provável Server Component — localize por classes e texto)"
      }`
    );
    const melhor = a.elemento.seletores[0];
    if (melhor) l.push(`- Melhor seletor: ${descreverSeletor(melhor)}`);
    const alternativas = a.elemento.seletores.slice(1, 5);
    if (alternativas.length) {
      l.push("- Alternativas:");
      for (const s of alternativas) l.push(`  - ${descreverSeletor(s)}`);
    }
    if (m.attrs["class"]) l.push(`- Classes: \`${m.attrs["class"]}\``);
    const outros = Object.entries(m.attrs).filter(([k]) => k !== "class");
    if (outros.length) l.push(`- Atributos: ${outros.map(([k, v]) => `${k}="${v}"`).join(", ")}`);
    if (m.texto) l.push(`- Texto visível: "${m.texto}"`);
    if (m.cadeia.length) {
      l.push(
        `- Ancestrais: ${m.cadeia
          .map((n) => n.tag + (n.id ? `#${n.id}` : "") + (n.classe ? `.${n.classe}` : "") + (n.role ? `[role=${n.role}]` : ""))
          .join(" > ")}`
      );
    }
    if (a.elemento.interno) {
      const im = a.elemento.interno.meta;
      l.push(`- Elemento exato clicado: \`<${im.tag}>\`${im.texto ? ` "${im.texto}"` : ""}${im.attrs["class"] ? ` classes \`${im.attrs["class"]}\`` : ""}`);
    }
    if (a.elemento.framePath.length) l.push(`- Dentro de iframe: ${a.elemento.framePath.join(" » ")}`);
    if (a.elemento.shadowPath.length) l.push(`- Dentro de shadow DOM: ${a.elemento.shadowPath.join(" » ")}`);
    const r = a.elemento.rect;
    l.push(`- Posição no viewport: ${Math.round(r.width)}×${Math.round(r.height)} em (${Math.round(r.left)}, ${Math.round(r.top)})${a.elemento.localizado === false ? " · elemento não localizado no envio" : ""}`);
    }
    const captura = capturas?.anotacoes[a.id];
    if (captura) l.push(`- Recorte: ${captura}`);
    l.push("");
    if (a.anexos?.length) {
      l.push("### Prints anexados manualmente", "", "Capturas escolhidas pelo usuário no momento indicado; preservam o estado da página naquele instante.", "");
      for (const [i, anexo] of a.anexos.entries()) {
        l.push(`#### Print ${i + 1}`, "", `- Captura manual em: ${celula(anexo.capturadoEm)}`,
          `- Página da captura: ${celula(anexo.paginaUrl)}`, `- Imagem: ${anexo.largura}×${anexo.altura} pixels`,
          `- Viewport: ${anexo.viewport.largura}×${anexo.viewport.altura} @${anexo.viewport.dpr}x, rolagem (${anexo.viewport.scrollX}, ${anexo.viewport.scrollY})`,
          `- Arquivo: \`${celula(anexo.caminho)}\``, "",
          `![Print manual ${i + 1} da anotação ${a.ordem}](<${encodeURI(anexo.caminho).replace(/</g, "%3C").replace(/>/g, "%3E")}>)`, "");
      }
    }
    if (a.elemento.contextoVisual) l.push(...markdownContextoVisual(a.elemento.contextoVisual));
    const an = analise?.anotacoes[a.id];
    if (an) {
      l.push("### Onde está no código");
      l.push("");
      if (an.localizacoes.length) {
        for (const loc of an.localizacoes) l.push(`- \`${loc.arquivo}:${loc.linha}\` — ${loc.criterios.join(", ")} (${loc.pontos} pts)${loc.rota ? " · na rota" : ""} — \`${celula(loc.trecho)}\``);
        const repetidas = an.localizacoes.filter((loc) => loc.criterios.includes("classes completas"));
        if (new Set(repetidas.map((loc) => loc.arquivo)).size >= 3) l.push("- _A mesma sequência de classes aparece em vários arquivos: é um estilo compartilhado; prefira a ocorrência na rota e confira pelo texto/HTML._");
      } else {
        l.push(`_Nenhuma ocorrência direta em ${analise?.raiz ?? "?"}. Procure pelo texto visível, pela cadeia de ancestrais e pelo HTML abaixo._`);
      }
      l.push("");
    }
    if (a.alteracoes.length) {
      if (an && an.sugestoes.length) {
        l.push("### Alterações de estilo e como aplicar");
        l.push("");
        l.push("| Propriedade | Antes | Depois | Classe atual | Sugestão |");
        l.push("|---|---|---|---|---|");
        for (const s of an.sugestoes) {
          const classe = s.classeAtual ? `\`${celula(s.classeAtual)}\`` : "—";
          const sugestao = (s.sugestao ? `\`${celula(s.sugestao)}\`` : "—") + (s.observacao ? ` — ${celula(s.observacao)}` : "");
          l.push(`| \`${celula(s.propriedade)}\` | \`${celula(s.antes)}\` | \`${celula(s.depois)}\` | ${classe} | ${sugestao} |`);
        }
      } else {
        l.push("### Alterações de estilo");
        l.push("");
        l.push("| Propriedade | Antes | Depois |");
        l.push("|---|---|---|");
        for (const alt of a.alteracoes) l.push(`| \`${celula(alt.propriedade)}\` | \`${celula(alt.antes)}\` | \`${celula(alt.depois)}\` |`);
      }
      l.push("");
    }
    if (a.texto) {
      l.push("### Alteração de texto");
      l.push("");
      l.push(`- Antes: "${a.texto.antes}"`);
      l.push(`- Depois: "${a.texto.depois}"`);
      for (const loc of an?.texto?.localizacoes ?? []) l.push(`- Texto original aparece em \`${loc.arquivo}:${loc.linha}\``);
      l.push("");
    }
    if (m.html) {
      l.push("<details><summary>HTML do elemento na seleção</summary>");
      l.push("");
      l.push("```html");
      if (m.htmlPai) l.push(`${m.htmlPai} <!-- pai -->`);
      l.push(m.html);
      l.push("```");
      l.push("</details>");
      l.push("");
    }
    const chaves = ["color", "background-color", "font-family", "font-size", "font-weight", "padding-top", "padding-left", "margin-top", "border-radius", "display", "position"];
    const comp = chaves.filter((k) => a.elemento.computado[k]).map((k) => `${k}: ${a.elemento.computado[k]}`);
    if (comp.length) {
      l.push("<details><summary>Estilos computados no momento da seleção</summary>");
      l.push("");
      l.push("```");
      l.push(...comp);
      l.push("```");
      l.push("</details>");
      l.push("");
    }
  }
  return l.join("\n");
}

type LotePersistido = Omit<Lote, "instantaneo"> & { recebidoEm: string; temInstantaneo: boolean };

export class Fila {
  readonly dir: string;
  readonly anexos: Anexos;

  constructor(dir: string) {
    this.dir = dir;
    this.anexos = new Anexos(dir);
  }

  get dirLotes(): string {
    return join(this.dir, "lotes");
  }

  get dirCapturas(): string {
    return join(this.dir, "capturas");
  }

  caminhoJson(id: string): string {
    return join(this.dirLotes, `${id}.json`);
  }

  caminhoMd(id: string): string {
    return join(this.dirLotes, `${id}.md`);
  }

  caminhoInstantaneo(id: string): string {
    return join(this.dirLotes, `${id}.instantaneo.html`);
  }

  caminhoStatus(id: string): string {
    return join(this.dirLotes, `${id}.status.json`);
  }

  caminhoCapturas(id: string): string {
    return join(this.dirLotes, `${id}.capturas.json`);
  }

  caminhoAnalise(id: string): string {
    return join(this.dirLotes, `${id}.analise.json`);
  }

  caminhoConversa(id: string): string {
    return join(this.dirLotes, `${id}.conversa.jsonl`);
  }

  dirCapturasLote(id: string): string {
    return join(this.dirCapturas, id);
  }

  async preparar(): Promise<void> {
    await mkdir(this.dirLotes, { recursive: true });
    await mkdir(this.dirCapturas, { recursive: true });
  }

  async existe(id: string): Promise<boolean> {
    try {
      await access(this.caminhoJson(id));
      return true;
    } catch {
      return false;
    }
  }

  async gravar(lote: Lote, contextoAnexos: ContextoVinculoAnexo = {}): Promise<{ registro: RegistroLote; novo: boolean }> {
    return serializar(this.caminhoJson(lote.id), async () => {
      if (lote.anotacoes.some((a) => a.anexos !== undefined)) {
        const ids = new Set<string>();
        const normalizadas: Anotacao[] = [];
        for (const anotacao of lote.anotacoes) {
          if (ids.has(anotacao.id)) throw new ErroAnexo("anotações com prints precisam de identificadores únicos");
          ids.add(anotacao.id);
          normalizadas.push(anotacao.anexos === undefined ? anotacao : {
            ...anotacao, anexos: await this.anexos.resolver(anotacao.anexos, anotacao.id, lote.pagina.url, contextoAnexos),
          });
        }
        // O mesmo objeto segue para processarLote: a ponte só recebe metadados
        // confiáveis após a validação de todos os vínculos, sem gravação parcial.
        lote.anotacoes = normalizadas;
      }
      if (await this.existe(lote.id)) {
        const registro = await this.registro(lote.id);
        if (registro) return { registro, novo: false };
      }
      const recebidoEm = new Date().toISOString();
      const { instantaneo, ...resto } = lote;
      const persistido: LotePersistido = { ...resto, recebidoEm, temInstantaneo: !!instantaneo };
      if (instantaneo) await gravarAtomico(this.caminhoInstantaneo(lote.id), instantaneo);
      await gravarAtomico(this.caminhoMd(lote.id), gerarMarkdown(lote));
      const status: StatusLote = { id: lote.id, estado: "recebido" };
      await gravarAtomico(this.caminhoStatus(lote.id), JSON.stringify(status));
      await gravarAtomico(this.caminhoJson(lote.id), JSON.stringify(persistido, null, 2));
      const registro: RegistroLote = {
        id: lote.id,
        recebidoEm,
        enviadoEm: lote.enviadoEm,
        url: lote.pagina.url,
        titulo: lote.pagina.titulo,
        quantidade: lote.anotacoes.length,
        caminhoMd: this.caminhoMd(lote.id),
        caminhoJson: this.caminhoJson(lote.id),
      };
      await appendFile(join(this.dir, "fila.jsonl"), JSON.stringify(registro) + "\n");
      return { registro, novo: true };
    });
  }

  async ler(id: string): Promise<LotePersistido | null> {
    try {
      return JSON.parse(await readFile(this.caminhoJson(id), "utf8")) as LotePersistido;
    } catch {
      return null;
    }
  }

  async lerInstantaneo(id: string): Promise<string | null> {
    try {
      return await readFile(this.caminhoInstantaneo(id), "utf8");
    } catch {
      return null;
    }
  }

  async lerMarkdown(id: string): Promise<string | null> {
    try {
      return await readFile(this.caminhoMd(id), "utf8");
    } catch {
      return null;
    }
  }

  async registro(id: string): Promise<RegistroLote | null> {
    const lote = await this.ler(id);
    if (!lote) return null;
    return {
      id: lote.id,
      recebidoEm: lote.recebidoEm,
      enviadoEm: lote.enviadoEm,
      url: lote.pagina.url,
      titulo: lote.pagina.titulo,
      quantidade: lote.anotacoes.length,
      caminhoMd: this.caminhoMd(id),
      caminhoJson: this.caminhoJson(id),
    };
  }

  async anexarCapturas(id: string, capturas: CapturaLote): Promise<void> {
    return serializar(this.caminhoJson(id), async () => {
      await gravarAtomico(this.caminhoCapturas(id), JSON.stringify(capturas, null, 2));
      await this.regerarMarkdown(id);
    });
  }

  async anexarAnalise(id: string, analise: AnaliseLote): Promise<void> {
    return serializar(this.caminhoJson(id), async () => {
      await gravarAtomico(this.caminhoAnalise(id), JSON.stringify(analise, null, 2));
      await this.regerarMarkdown(id);
    });
  }

  async capturas(id: string): Promise<CapturaLote | null> {
    try {
      return JSON.parse(await readFile(this.caminhoCapturas(id), "utf8")) as CapturaLote;
    } catch {
      return null;
    }
  }

  async analise(id: string): Promise<AnaliseLote | null> {
    try {
      return JSON.parse(await readFile(this.caminhoAnalise(id), "utf8")) as AnaliseLote;
    } catch {
      return null;
    }
  }

  private async regerarMarkdown(id: string): Promise<void> {
    const lote = await this.ler(id);
    if (!lote) return;
    const [capturas, analise] = await Promise.all([this.capturas(id), this.analise(id)]);
    await gravarAtomico(this.caminhoMd(id), gerarMarkdown({ ...lote, instantaneo: null }, capturas, analise));
  }

  async status(id: string): Promise<StatusLote> {
    let status: StatusLote;
    try {
      status = JSON.parse(await readFile(this.caminhoStatus(id), "utf8")) as StatusLote;
    } catch {
      return { id, estado: "desconhecido" };
    }
    const abertas = await this.perguntasAbertas(id);
    if (abertas.length) status.perguntasAbertas = abertas.length;
    return status;
  }

  async conversa(id: string): Promise<Mensagem[]> {
    let conteudo = "";
    try {
      conteudo = await readFile(this.caminhoConversa(id), "utf8");
    } catch {
      return [];
    }
    const mensagens: Mensagem[] = [];
    for (const linha of conteudo.split("\n")) {
      if (!linha.trim()) continue;
      try {
        mensagens.push(JSON.parse(linha) as Mensagem);
      } catch {
        /* linha truncada por queda no meio da escrita */
      }
    }
    return mensagens;
  }

  async registrarMensagem(entrada: Omit<Mensagem, "id" | "em"> & { id?: string }): Promise<Mensagem | null> {
    return serializar(this.caminhoJson(entrada.lote), async () => {
      if (!(await this.existe(entrada.lote))) return null;
      if (entrada.responde) {
        const anteriores = await this.conversa(entrada.lote);
        const alvo = anteriores.find((m) => m.id === entrada.responde);
        if (!alvo || alvo.autor !== "agente" || alvo.tipo === "nota") throw new Error("resposta a mensagem que não é pergunta deste lote");
        if (anteriores.some((m) => m.responde === entrada.responde)) throw new Error("pergunta já respondida");
      }
      const mensagem: Mensagem = {
        id: entrada.id && idSeguro(entrada.id) ? entrada.id : randomUUID(),
        lote: entrada.lote,
        autor: entrada.autor,
        tipo: entrada.tipo,
        texto: entrada.texto.slice(0, 4000),
        em: new Date().toISOString(),
      };
      if (entrada.autor === "agente" && entrada.agente) mensagem.agente = entrada.agente.slice(0, 60);
      if (entrada.opcoes?.length) mensagem.opcoes = entrada.opcoes.slice(0, 12).map((o) => o.slice(0, 200));
      if (entrada.responde) mensagem.responde = entrada.responde;
      if (entrada.multipla) mensagem.multipla = true;
      await appendFile(this.caminhoConversa(entrada.lote), JSON.stringify(mensagem) + "\n");
      return mensagem;
    });
  }

  async perguntasAbertas(id: string): Promise<Mensagem[]> {
    const mensagens = await this.conversa(id);
    const respondidas = new Set(mensagens.filter((m) => m.responde).map((m) => m.responde));
    // Listar o que pede resposta, em vez de excluir o que não pede: com a segunda forma
    // um tipo novo entra na conta sozinho, e foi assim que `passo` virou pergunta aberta.
    return mensagens.filter((m) => m.autor === "agente" && (m.tipo === "pergunta" || m.tipo === "escolha") && !respondidas.has(m.id));
  }

  async registrarExecucao(id: string, execucao: NonNullable<StatusLote["execucao"]>): Promise<StatusLote | null> {
    return serializar(this.caminhoJson(id), async () => {
      if (!(await this.existe(id))) return null;
      const atual = await this.status(id);
      if (atual.execucao && atual.execucao.iniciadoEm > execucao.iniciadoEm) return atual;
      if (atual.execucao?.id === execucao.id && atual.execucao.terminadoEm && !execucao.terminadoEm) return atual;
      const status = { ...atual, execucao: { ...execucao } };
      await gravarAtomico(this.caminhoStatus(id), JSON.stringify(status));
      return status;
    });
  }

  async marcarProgresso(id: string, nota: string): Promise<StatusLote | null> {
    return serializar(this.caminhoJson(id), async () => {
      if (!(await this.existe(id))) return null;
      const atual = await this.status(id);
      if (atual.estado === "processado") return atual;
      const status: StatusLote = { id, estado: "em_andamento", nota: nota.slice(0, 2000), atualizadoEm: new Date().toISOString(), ...(atual.execucao ? { execucao: atual.execucao } : {}) };
      await gravarAtomico(this.caminhoStatus(id), JSON.stringify(status));
      return status;
    });
  }

  async marcarProcessado(id: string, nota?: string): Promise<StatusLote | null> {
    return serializar(this.caminhoJson(id), async () => {
      if (!(await this.existe(id))) return null;
      const atual = await this.status(id);
      const status: StatusLote = { id, estado: "processado", processadoEm: new Date().toISOString(), ...(atual.execucao ? { execucao: atual.execucao } : {}) };
      if (nota) status.nota = nota.slice(0, 2000);
      await gravarAtomico(this.caminhoStatus(id), JSON.stringify(status));
      await appendFile(join(this.dir, "processadas.jsonl"), JSON.stringify(status) + "\n");
      return status;
    });
  }

  async listar(): Promise<RegistroLote[]> {
    let conteudo = "";
    try {
      conteudo = await readFile(join(this.dir, "fila.jsonl"), "utf8");
    } catch {
      return [];
    }
    const registros: RegistroLote[] = [];
    for (const linha of conteudo.split("\n")) {
      if (!linha.trim()) continue;
      try {
        registros.push(JSON.parse(linha) as RegistroLote);
      } catch {
        /* linha truncada por queda no meio da escrita: ignora */
      }
    }
    return registros;
  }

  async pendentes(): Promise<RegistroLote[]> {
    const todos = await this.listar();
    const saida: RegistroLote[] = [];
    for (const r of todos) {
      const s = await this.status(r.id);
      if (s.estado !== "processado") saida.push(r);
    }
    return saida;
  }
}
