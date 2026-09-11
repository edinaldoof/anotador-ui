// Fila em disco: cada lote vira JSON + Markdown legível; o status acompanha o
// ciclo recebido → processado. A gravação é idempotente pelo id do lote.

import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
    return {
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
    if (!a.comentario) l.push("_Sem comentário — só alterações de propriedade._");
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
    const captura = capturas?.anotacoes[a.id];
    if (captura) l.push(`- Recorte: ${captura}`);
    l.push("");
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

  constructor(dir: string) {
    this.dir = dir;
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

  async gravar(lote: Lote): Promise<{ registro: RegistroLote; novo: boolean }> {
    if (await this.existe(lote.id)) {
      const registro = await this.registro(lote.id);
      if (registro) return { registro, novo: false };
    }
    const recebidoEm = new Date().toISOString();
    const { instantaneo, ...resto } = lote;
    const persistido: LotePersistido = { ...resto, recebidoEm, temInstantaneo: !!instantaneo };
    await writeFile(this.caminhoJson(lote.id), JSON.stringify(persistido, null, 2));
    if (instantaneo) await writeFile(this.caminhoInstantaneo(lote.id), instantaneo);
    await writeFile(this.caminhoMd(lote.id), gerarMarkdown(lote));
    const status: StatusLote = { id: lote.id, estado: "recebido" };
    await writeFile(this.caminhoStatus(lote.id), JSON.stringify(status));
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
    await writeFile(this.caminhoCapturas(id), JSON.stringify(capturas, null, 2));
    await this.regerarMarkdown(id);
  }

  async anexarAnalise(id: string, analise: AnaliseLote): Promise<void> {
    await writeFile(this.caminhoAnalise(id), JSON.stringify(analise, null, 2));
    await this.regerarMarkdown(id);
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
    await writeFile(this.caminhoMd(id), gerarMarkdown({ ...lote, instantaneo: null }, capturas, analise));
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
  }

  async perguntasAbertas(id: string): Promise<Mensagem[]> {
    const mensagens = await this.conversa(id);
    const respondidas = new Set(mensagens.filter((m) => m.responde).map((m) => m.responde));
    return mensagens.filter((m) => m.autor === "agente" && m.tipo !== "nota" && !respondidas.has(m.id));
  }

  async marcarProgresso(id: string, nota: string): Promise<StatusLote | null> {
    if (!(await this.existe(id))) return null;
    const atual = await this.status(id);
    if (atual.estado === "processado") return atual;
    const status: StatusLote = { id, estado: "em_andamento", nota: nota.slice(0, 2000), atualizadoEm: new Date().toISOString() };
    await writeFile(this.caminhoStatus(id), JSON.stringify(status));
    return status;
  }

  async marcarProcessado(id: string, nota?: string): Promise<StatusLote | null> {
    if (!(await this.existe(id))) return null;
    const status: StatusLote = { id, estado: "processado", processadoEm: new Date().toISOString() };
    if (nota) status.nota = nota.slice(0, 2000);
    await writeFile(this.caminhoStatus(id), JSON.stringify(status));
    await appendFile(join(this.dir, "processadas.jsonl"), JSON.stringify(status) + "\n");
    return status;
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
