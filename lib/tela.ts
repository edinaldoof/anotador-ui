// O que a tela mostra em cada largura: a metade que nenhum arquivo declara.
//
// `lib/design.ts` lê o sistema no CSS — quais tokens existem e o que cada um vale.
// Aqui é o contrário: abre a página em três larguras e mede o que ela de fato faz.
// Rolagem horizontal, elemento vazando, texto miúdo, alvo de toque pequeno e borda
// que quase encosta numa coluna são coisas que não estão escritas em lugar nenhum —
// só aparecem quando a página é renderizada e medida.

/** Larguras da medição: celular estreito, tablet e desktop comum. */
export const LARGURAS_PADRAO = [390, 768, 1280] as const;

export interface MedidaTela {
  largura: number;
  altura: number;
  /** Quanto o documento passa da viewport na horizontal. Acima de 1px a página rola de lado. */
  rolagemHorizontal: number;
  vazamentos: Array<{ alvo: string; excesso: number }>;
  textoMiudo: { total: number; menor: number; exemplos: string[] };
  alvosPequenos: { total: number; exemplos: string[] };
  /** Bordas esquerdas que três ou mais blocos compartilham: as colunas de fato da página. */
  colunas: number[];
  quaseAlinhados: Array<{ alvo: string; borda: string; valor: number; coluna: number }>;
}

export interface AchadoTela {
  regra: string;
  gravidade: "alta" | "media" | "baixa";
  largura: number;
  alvo: string;
  evidencia: string;
}

// Roda dentro da página. Sem template literal de propósito: o texto é embutido em
// outro template, e um `${` aqui dentro seria interpolado antes de chegar ao navegador.
export const SCRIPT_MEDIDA = `(() => {
  const vw = innerWidth;
  const caminho = (el) => {
    const partes = [];
    for (let n = el; n && n.nodeType === 1 && partes.length < 3; n = n.parentElement) {
      // Todo elemento da página desce de html > body: repetir isso em cada linha do
      // relatório gasta espaço e não distingue coisa nenhuma.
      if (n.tagName === "BODY" || n.tagName === "HTML") break;
      let p = n.tagName.toLowerCase();
      if (n.id) { partes.unshift(p + "#" + n.id); break; }
      const classes = (n.getAttribute("class") || "").trim().split(/\\s+/);
      const cls = classes.filter((c) => c && c.length < 24 && !/^(css-|sc-|jsx-)/.test(c))[0];
      if (cls) p += "." + cls;
      partes.unshift(p);
    }
    return partes.join(" > ").slice(0, 120);
  };
  const blocos = [], vazamentos = [], miudos = [], alvos = [];
  let menorTexto = Infinity, vistos = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (vistos > 3000) break;
    if (el.closest("#__anotador_host")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    vistos++;
    // Vazamento: só quem começa a passar da borda. Se o pai já vaza, os filhos vão
    // arrastados junto e repetir cada um deles só encheria o relatório de eco.
    const excesso = Math.round(Math.max(r.right - vw, -r.left));
    if (excesso > 1 && cs.position !== "fixed") {
      const pai = el.parentElement, rp = pai ? pai.getBoundingClientRect() : null;
      if (!rp || (rp.right - vw <= 1 && rp.left >= -1)) vazamentos.push({ alvo: caminho(el), excesso });
    }
    // Só quem tem texto próprio: herdar o tamanho do pai não é decisão de ninguém.
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
      const px = parseFloat(cs.fontSize);
      if (px > 0) {
        if (px < menorTexto) menorTexto = px;
        if (px < 12) miudos.push(caminho(el) + " (" + Math.round(px * 10) / 10 + "px)");
      }
    }
    if (el.matches("a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox]") && (r.width < 24 || r.height < 24)) {
      alvos.push(caminho(el) + " (" + Math.round(r.width) + "x" + Math.round(r.height) + ")");
    }
    if (r.width >= 64 && r.height >= 16) blocos.push({ alvo: caminho(el), esquerda: Math.round(r.left), direita: Math.round(r.right) });
  }
  const analisarBorda = (campo, nome) => {
    const conta = new Map();
    for (const b of blocos) conta.set(b[campo], (conta.get(b[campo]) || 0) + 1);
    const fortes = [...conta.entries()].filter((par) => par[1] >= 3).map((par) => par[0]).sort((a, b) => a - b);
    const quase = [];
    for (const b of blocos) {
      if ((conta.get(b[campo]) || 0) >= 3) continue;
      const perto = fortes.find((c) => Math.abs(c - b[campo]) >= 1 && Math.abs(c - b[campo]) <= 4);
      if (perto !== undefined) quase.push({ alvo: b.alvo, borda: nome, valor: b[campo], coluna: perto });
    }
    return { fortes, quase };
  };
  const esquerda = analisarBorda("esquerda", "esquerda"), direita = analisarBorda("direita", "direita");
  const vistosQuase = new Set();
  const quaseAlinhados = [...esquerda.quase, ...direita.quase].filter((q) => {
    if (vistosQuase.has(q.alvo)) return false;
    vistosQuase.add(q.alvo); return true;
  }).slice(0, 8);
  return {
    largura: vw,
    altura: innerHeight,
    rolagemHorizontal: Math.max(0, Math.round(document.documentElement.scrollWidth - vw)),
    vazamentos: vazamentos.sort((a, b) => b.excesso - a.excesso).slice(0, 5),
    textoMiudo: { total: miudos.length, menor: Number.isFinite(menorTexto) ? Math.round(menorTexto * 10) / 10 : 0, exemplos: miudos.slice(0, 3) },
    alvosPequenos: { total: alvos.length, exemplos: alvos.slice(0, 3) },
    colunas: esquerda.fortes.slice(0, 12),
    quaseAlinhados,
  };
})()`;

/** Tamanho mínimo de alvo apontável do WCAG 2.2 (2.5.8, nível AA). */
const ALVO_MINIMO = 24;
/** Abaixo disto o texto deixa de ser legível em tela pequena. */
const TEXTO_MINIMO = 12;

export function achadosDaTela(medidas: MedidaTela[]): AchadoTela[] {
  const achados: AchadoTela[] = [];
  for (const m of medidas) {
    if (m.rolagemHorizontal > 1) {
      achados.push({ regra: "rolagem horizontal", gravidade: "alta", largura: m.largura, alvo: "documento",
        evidencia: `a página passa ${m.rolagemHorizontal}px da viewport de ${m.largura}px e rola de lado` });
    }
    for (const v of m.vazamentos) {
      achados.push({ regra: "elemento vazando", gravidade: v.excesso > 24 ? "alta" : "media", largura: m.largura, alvo: v.alvo,
        evidencia: `passa ${v.excesso}px da borda em ${m.largura}px de largura` });
    }
    if (m.textoMiudo.total) {
      achados.push({ regra: "texto miúdo", gravidade: m.textoMiudo.menor < 10 ? "media" : "baixa", largura: m.largura,
        alvo: m.textoMiudo.exemplos[0] ?? "texto", evidencia: `${m.textoMiudo.total} trecho(s) abaixo de ${TEXTO_MINIMO}px, o menor com ${m.textoMiudo.menor}px${m.textoMiudo.exemplos.length > 1 ? " — também " + m.textoMiudo.exemplos.slice(1).join(", ") : ""}` });
    }
    // Alvo pequeno só pesa onde se toca com o dedo; no desktop o ponteiro dá conta.
    if (m.alvosPequenos.total && m.largura <= 480) {
      achados.push({ regra: "alvo de toque pequeno", gravidade: "media", largura: m.largura,
        alvo: m.alvosPequenos.exemplos[0] ?? "controle", evidencia: `${m.alvosPequenos.total} controle(s) abaixo de ${ALVO_MINIMO}x${ALVO_MINIMO}px, o mínimo apontável do WCAG 2.2${m.alvosPequenos.exemplos.length > 1 ? " — também " + m.alvosPequenos.exemplos.slice(1).join(", ") : ""}` });
    }
    for (const q of m.quaseAlinhados) {
      const distancia = Math.abs(q.coluna - q.valor);
      achados.push({ regra: "quase alinhado", gravidade: "baixa", largura: m.largura, alvo: q.alvo,
        evidencia: `borda ${q.borda} em ${q.valor}px, a ${distancia}px da coluna de ${q.coluna}px que o resto da página usa — ou alinha, ou afasta o bastante para virar intenção` });
    }
  }
  const ordem = { alta: 0, media: 1, baixa: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || a.largura - b.largura || a.regra.localeCompare(b.regra));
  return achados;
}

/** Seção do dossiê. Sem medida nenhuma devolve string vazia: nada a dizer é melhor que um título vazio. */
export function resumoDaTela(medidas: MedidaTela[], achados: AchadoTela[]): string {
  if (!medidas.length) return "";
  const linhas: string[] = [];
  linhas.push("Medido na própria página renderizada, em " + medidas.map((m) => m.largura + "px").join(", ") + ".", "");
  for (const m of medidas) {
    const colunas = m.colunas.length ? m.colunas.join(", ") + "px" : "nenhuma coluna repetida o bastante para ser regra";
    linhas.push(`- **${m.largura}px** — rolagem horizontal: ${m.rolagemHorizontal > 1 ? m.rolagemHorizontal + "px" : "nenhuma"} · bordas esquerdas dominantes: ${colunas}`);
  }
  if (!achados.length) {
    linhas.push("", "Nenhum vazamento, texto miúdo, alvo pequeno ou borda quase alinhada nessas larguras.");
    return linhas.join("\n");
  }
  linhas.push("", "| gravidade | largura | regra | onde | evidência |", "| --- | --- | --- | --- | --- |");
  for (const a of achados.slice(0, 40)) {
    linhas.push(`| ${a.gravidade} | ${a.largura}px | ${a.regra} | \`${a.alvo.replace(/\|/g, "/")}\` | ${a.evidencia.replace(/\|/g, "/")} |`);
  }
  if (achados.length > 40) linhas.push("", `_(${achados.length - 40} achado(s) além dos 40 listados.)_`);
  return linhas.join("\n");
}
