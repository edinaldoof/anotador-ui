// Um valor literal diante do sistema de design: qual token já existe para ele, quais
// estão perto, se respeita a escala — e quando a escolha é de papel, não de valor.
// Usado pelo MCP (conferir_valor) e pela análise do sistema em uso (lib/uso.ts).

import { deBiblioteca, emMs, emPixels, type CategoriaToken, type SistemaDeDesign, type TokenDesign } from "./design.ts";
import { paraRgb } from "./fonte.ts";

/**
 * Alias para outro token é a camada semântica (`--cor-acao: var(--azul-600)`); valor
 * cru é a primitiva. Não é convenção de nome, é estrutura: quem aponta para outro
 * token declarou uma intenção, e é esse que o agente deve preferir.
 */
function camadaDe(t: TokenDesign): "semantica" | "primitiva" {
  return /^var\(--/.test(t.valor.trim()) ? "semantica" : "primitiva";
}

export function descreverToken(t: TokenDesign): Record<string, unknown> {
  return {
    nome: t.nome, valor: t.valor, categoria: t.categoria, camada: camadaDe(t), ...(deBiblioteca(t.nome) ? { biblioteca: true } : {}),
    ...(t.px !== undefined ? { px: t.px } : {}), ...(t.rgb ? { rgb: t.rgb } : {}), ...(t.ms !== undefined ? { ms: t.ms } : {}),
    ...(t.intencao ? { intencao: t.intencao } : {}), onde: `${t.arquivo}:${t.linha}`, usar: `var(${t.nome})`,
  };
}

// OKLab: distância que acompanha o olho. Em RGB, dois azuis visivelmente diferentes
// podem ficar mais perto que um azul e o mesmo azul um tom abaixo.
function paraOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function distanciaCor(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [paraOklab(a), paraOklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Entre tokens de mesmo valor: do projeto antes de biblioteca, semântico antes de
// primitivo, explicado antes de mudo. É o que o autor quis que fosse usado, e o que
// continua certo quando a paleta mudar. Sugerir `var(--rdp-accent-color)` — a variável
// interna do date picker — para pintar um botão seria obedecer ao valor e errar o sistema.
function preferencia(a: TokenDesign, b: TokenDesign): number {
  return Number(deBiblioteca(a.nome)) - Number(deBiblioteca(b.nome))
    || (camadaDe(a) === "semantica" ? 0 : 1) - (camadaDe(b) === "semantica" ? 0 : 1)
    || (a.intencao ? 0 : 1) - (b.intencao ? 0 : 1) || a.nome.localeCompare(b.nome);
}
/** O token a recomendar: o preferido, desde que seja do projeto. */
function recomendado(tokens: TokenDesign[]): TokenDesign | undefined {
  return [...tokens].sort(preferencia).find((t) => !deBiblioteca(t.nome));
}

/**
 * Entre tokens do projeto com o mesmo valor, qual usar — ou nenhum, se a escolha é de
 * papel. `--cor-acao: var(--azul-600)` e `--azul-600` são uma camada sobre a outra: a
 * semântica resolve sozinha. Já `--color-action-primary`, `--color-focus` e
 * `--color-brand-teal-deep` com o mesmo #046b66 são papéis diferentes, e o Pré-Projetos
 * proíbe por escrito a cor da marca em botão. Recomendar o primeiro da lista ali
 * ensinaria o agente a errar com confiança; sem `usar`, ele escolhe pelo papel.
 */
function escolherPorPapel(tokens: TokenDesign[]): { usar: TokenDesign | null; papeis: TokenDesign[] } {
  const doProjeto = tokens.filter((t) => !deBiblioteca(t.nome));
  const apontados = new Set(doProjeto.flatMap((t) => [.../var\((--[A-Za-z0-9_-]+)\)/g[Symbol.matchAll](t.valor)].map((m) => m[1])));
  const papeis = doProjeto.filter((t) => !apontados.has(t.nome)).sort(preferencia);
  return { usar: papeis.length === 1 ? papeis[0] ?? null : null, papeis: papeis.length > 1 ? papeis : [] };
}

/**
 * A faixa do orçamento de movimento do playbook em que a duração cai. Entre duas faixas,
 * diz entre quais — arredondar para uma delas seria decidir pelo autor.
 */
export function faixaDeMovimento(ms: number): string {
  if (ms < 0) return "negativo: é atraso que começa a animação no meio, não duração";
  const faixas: Array<[number, number, string]> = [
    [0, 80, "instantâneo (0–80ms): hover e anel de foco"],
    [100, 150, "rápido (100–150ms): pressionar, alternar, retorno imediato"],
    [200, 300, "padrão (200–300ms): abrir, fechar, esmaecer, deslizar"],
    [400, 500, "considerado (400–500ms): transição de página, painel que expande"],
    [600, Infinity, "cinematográfico (600ms ou mais): abertura e onboarding — raro"],
  ];
  const dentro = faixas.find(([de, ate]) => ms >= de && ms <= ate);
  if (dentro) return dentro[2];
  const antes = [...faixas].reverse().find(([, ate]) => ate < ms), depois = faixas.find(([de]) => de > ms);
  return `entre ${antes?.[2].split(":")[0]} e ${depois?.[2].split(":")[0]}`;
}

export function conferirValor(sistema: SistemaDeDesign, valor: string, categoria?: CategoriaToken): Record<string, unknown> {
  const texto = valor.trim();
  // Movimento: duração em ms ou s, ou uma curva. O que importa é o token que já existe
  // e, para a duração, em que faixa do orçamento ela cai.
  const ms = categoria === undefined || categoria === "movimento" ? emMs(texto) : undefined;
  if (ms !== undefined) {
    const candidatos = sistema.tokens.filter((t) => t.ms !== undefined && !deBiblioteca(t.nome));
    const medidos = candidatos.map((t) => ({ t, d: Math.abs((t.ms as number) - ms) })).sort((a, b) => a.d - b.d || preferencia(a.t, b.t));
    const exatos = medidos.filter((m) => m.d < 0.5).map((m) => m.t).sort(preferencia);
    const proximos = medidos.filter((m) => m.d >= 0.5 && m.d <= Math.max(50, ms * 0.25)).slice(0, 3);
    const escolha = escolherPorPapel(exatos);
    return {
      valor: texto, tipo: "movimento", ms, noSistema: exatos.length > 0,
      usar: escolha.usar ? `var(${escolha.usar.nome})` : null,
      exatos: exatos.map(descreverToken),
      proximos: proximos.map((m) => ({ ...descreverToken(m.t), diferencaMs: Math.round(m.d) })),
      ...(escolha.papeis.length ? { papeis: escolha.papeis.map(descreverToken) } : {}),
      faixa: faixaDeMovimento(ms),
      observacao: escolha.papeis.length ? `${escolha.papeis.length} tokens do projeto têm esta duração, com papéis diferentes: escolha pelo que a animação faz`
        : exatos.length ? "a duração já tem token; use-o em vez do valor literal"
        : ms > 500 ? "acima dos 500ms que o playbook dá a painel que expande: em interação frequente, fica lento — reserve para abertura rara"
        : proximos.length ? "sem token exato; os mais próximos estão listados"
        : candidatos.length ? "nenhum token de duração perto deste valor"
        : "o projeto não declara token de duração; o playbook pede duração e curva como tokens",
    };
  }
  if (categoria === "movimento") {
    const normal = (v: string) => v.toLowerCase().replace(/\s+/g, "");
    const exatos = sistema.tokens.filter((t) => t.categoria === "movimento" && !deBiblioteca(t.nome) && normal(t.valor) === normal(texto)).sort(preferencia);
    const escolha = escolherPorPapel(exatos);
    return {
      valor: texto, tipo: "movimento", noSistema: exatos.length > 0, usar: escolha.usar ? `var(${escolha.usar.nome})` : null, exatos: exatos.map(descreverToken),
      ...(escolha.papeis.length ? { papeis: escolha.papeis.map(descreverToken) } : {}),
      observacao: exatos.length ? "a curva já tem token; use-o em vez do valor literal" : "nenhum token de movimento com este valor",
    };
  }
  const rgb = categoria === undefined || categoria === "cor" ? paraRgb(texto) : null;
  if (rgb) {
    const comCor = sistema.tokens.map((t) => ({ t, rgb: t.rgb ? paraRgb(t.rgb) : null })).filter((c): c is { t: TokenDesign; rgb: [number, number, number] } => !!c.rgb);
    const medidos = comCor.map((c) => ({ t: c.t, d: distanciaCor(rgb, c.rgb) })).sort((a, b) => a.d - b.d || preferencia(a.t, b.t));
    const exatos = medidos.filter((m) => m.d < 0.002).map((m) => m.t).sort(preferencia);
    // Abaixo de 0,02 em OKLab a diferença mal se vê: é quase sempre o mesmo token
    // escrito à mão com um dígito trocado, e o agente deveria usar o token.
    const proximos = medidos.filter((m) => m.d >= 0.002 && m.d <= 0.08 && !deBiblioteca(m.t.nome)).slice(0, 3);
    // Quase igual: a mesma cor escrita com um dígito trocado. Todos os tokens daquela
    // cor entram na escolha, não só o primeiro da distância.
    const quase = proximos[0] && proximos[0].d < 0.02 ? medidos.filter((m) => Math.abs(m.d - (proximos[0]?.d ?? 0)) < 0.0005).map((m) => m.t) : [];
    const escolha = escolherPorPapel(exatos.length ? exatos : quase);
    return {
      valor: texto, tipo: "cor", noSistema: exatos.some((t) => !deBiblioteca(t.nome)),
      usar: escolha.usar ? `var(${escolha.usar.nome})` : null,
      exatos: exatos.map(descreverToken),
      proximos: proximos.map((m) => ({ ...descreverToken(m.t), distancia: Math.round(m.d * 1000) / 1000, quaseIgual: m.d < 0.02 })),
      ...(escolha.papeis.length ? { papeis: escolha.papeis.map(descreverToken) } : {}),
      observacao: escolha.papeis.length ? `${escolha.papeis.length} tokens do projeto têm esta cor, com papéis diferentes (ação, link, foco, marca…): escolha pelo papel do elemento e pela intenção de cada um — não pelo valor`
        : recomendado(exatos) ? "a cor já tem token; use-o em vez do valor literal"
        : proximos[0] && proximos[0].d < 0.02 ? "praticamente a mesma cor de um token existente — provavelmente é ele"
        : proximos.length ? "nenhum token com esta cor; os mais próximos estão listados — prefira um deles ou declare um token novo com intenção"
        : "nenhum token parecido; se a cor é nova de propósito, declare um token com um comentário dizendo para que serve",
    };
  }
  const px = emPixels(texto);
  if (px === undefined) return { valor: texto, tipo: "desconhecido", noSistema: false, observacao: "não é uma cor nem uma medida em px, rem ou em" };
  const cat: CategoriaToken = categoria ?? "espaco";
  const candidatos = sistema.tokens.filter((t) => t.px !== undefined && !deBiblioteca(t.nome) && (cat === "espaco" ? t.categoria === "espaco" : t.categoria === cat));
  const medidos = candidatos.map((t) => ({ t, d: Math.abs((t.px as number) - px) })).sort((a, b) => a.d - b.d || preferencia(a.t, b.t));
  const exatos = medidos.filter((m) => m.d < 0.01).map((m) => m.t).sort(preferencia);
  const proximos = medidos.filter((m) => m.d >= 0.01 && m.d <= Math.max(4, px * 0.25)).slice(0, 3);
  const base = sistema.espaco.base;
  const naEscala = cat === "espaco" && base ? Math.abs(px % base) < 0.01 : cat === "texto" && sistema.escalaDeTexto.length ? sistema.escalaDeTexto.includes(px) : null;
  const medida = escolherPorPapel(exatos);
  return {
    valor: texto, tipo: cat, px, noSistema: exatos.length > 0,
    usar: medida.usar ? `var(${medida.usar.nome})` : null,
    exatos: exatos.map(descreverToken),
    proximos: proximos.map((m) => ({ ...descreverToken(m.t), diferencaPx: Math.round(m.d * 100) / 100 })),
    ...(medida.papeis.length ? { papeis: medida.papeis.map(descreverToken) } : {}),
    ...(naEscala === null ? {} : { naEscala, ...(cat === "espaco" && base ? { passo: base } : {}), ...(cat === "texto" ? { escalaDeTexto: sistema.escalaDeTexto } : {}) }),
    observacao: medida.papeis.length ? `${medida.papeis.length} tokens do projeto têm esta medida, com papéis diferentes (ritmo, recuo, alvo de toque…): escolha pelo papel`
      : exatos.length ? "a medida já tem token; use-o em vez do valor literal"
      : naEscala === false ? `fora da escala do projeto${cat === "espaco" && base ? ` (passo de ${base}px)` : ""}; prefira o token mais próximo`
      : proximos.length ? "sem token exato; os mais próximos estão listados"
      : "sem token para esta medida",
  };
}
