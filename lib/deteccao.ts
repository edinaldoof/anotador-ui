// Descobre servidores de desenvolvimento na máquina e sonda uma URL: alcance, título e framework.

export interface Sondagem {
  url: string;
  alcancavel: boolean;
  status: number | null;
  titulo: string | null;
  framework: string | null;
  /** o próprio anotador (evita apontar o proxy para si mesmo) */
  anotador: boolean;
  html: boolean;
  erro: string | null;
}

export const PORTAS_COMUNS = [3000, 3001, 3002, 3003, 3004, 3005, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 6006, 8000, 8080, 8081, 8888, 1234, 1313, 9000];

const SINAIS_FRAMEWORK: Array<[string, RegExp]> = [
  ["Next.js", /\/_next\/|__next|next\/dist/i],
  ["Nuxt", /__nuxt|\/_nuxt\//i],
  ["SvelteKit", /data-sveltekit|__sveltekit/i],
  ["Remix", /__remixContext|\/build\/root-/i],
  ["Astro", /astro-island|\/_astro\//i],
  ["Angular", /ng-version=|\/main\.js.*ng/i],
  ["Vite", /\/@vite\/client|\/@react-refresh|type="module"[^>]+src="\/src\//i],
  ["Create React App", /\/static\/js\/bundle\.js/i],
  ["Storybook", /storybook/i],
  ["Hugo", /generator" content="Hugo/i],
];

export function detectarFramework(cabecalhos: Headers, html: string): string | null {
  const poweredBy = cabecalhos.get("x-powered-by") ?? "";
  if (/next\.js/i.test(poweredBy)) return "Next.js";
  if (/express/i.test(poweredBy) && !html) return "Express";
  for (const [nome, re] of SINAIS_FRAMEWORK) if (re.test(html)) return nome;
  return null;
}

export function extrairTitulo(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = (m[1] ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 120) : null;
}

export async function sondar(url: string, timeoutMs = 2500): Promise<Sondagem> {
  const base: Sondagem = { url, alcancavel: false, status: null, titulo: null, framework: null, anotador: false, html: false, erro: null };
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return { ...base, erro: "URL inválida" };
  }
  try {
    const resp = await fetch(alvo, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,*/*;q=0.8", "user-agent": "anotador-ui/sondagem" },
    });
    const tipo = resp.headers.get("content-type") ?? "";
    const html = /text\/html/i.test(tipo);
    let corpo = "";
    if (html) {
      const leitor = resp.body?.getReader();
      if (leitor) {
        const decodificador = new TextDecoder();
        let lido = 0;
        while (lido < 96 * 1024) {
          const { value, done } = await leitor.read();
          if (done) break;
          corpo += decodificador.decode(value, { stream: true });
          lido += value.byteLength;
        }
        await leitor.cancel().catch(() => undefined);
      }
    } else {
      await resp.body?.cancel().catch(() => undefined);
    }
    return {
      url,
      alcancavel: true,
      status: resp.status,
      titulo: html ? extrairTitulo(corpo) : null,
      framework: detectarFramework(resp.headers, corpo),
      anotador: /__anotador\/overlay\.js|anotador-ui/.test(corpo) || resp.headers.get("x-anotador") !== null,
      html,
      erro: null,
    };
  } catch (erro) {
    const e = erro as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    const codigo = e.cause?.code ?? e.code ?? e.name;
    return { ...base, erro: codigo === "TimeoutError" || e.name === "TimeoutError" ? "sem resposta a tempo" : String(codigo ?? e.message) };
  }
}

export interface ServidorDetectado extends Sondagem {
  porta: number;
}

// Sonda portas comuns em paralelo; porta fechada falha na hora, então a varredura toda cabe no timeout de uma.
export async function detectarServidores(portas: number[] = PORTAS_COMUNS, opcoes: { ignorar?: number[]; host?: string; timeoutMs?: number } = {}): Promise<ServidorDetectado[]> {
  const host = opcoes.host ?? "localhost";
  const ignorar = new Set(opcoes.ignorar ?? []);
  const candidatas = Array.from(new Set(portas)).filter((p) => Number.isInteger(p) && p > 0 && p < 65536 && !ignorar.has(p));
  const resultados = await Promise.all(
    candidatas.map(async (porta) => {
      const s = await sondar(`http://${host}:${porta}`, opcoes.timeoutMs ?? 2500);
      return { ...s, porta };
    })
  );
  return resultados.filter((r) => r.alcancavel && !r.anotador).sort((a, b) => a.porta - b.porta);
}

// Só alvos da própria máquina ou da rede local: o proxy não deve virar túnel para a internet.
export function alvoPermitido(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "use uma URL http:// ou https://";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return null;
    return "só endereços da própria máquina ou da rede local (10.x, 172.16-31.x, 192.168.x)";
  }
  if (/^f[cd][0-9a-f]{2}:|^fe80:/i.test(host)) return null;
  if (!host.includes(".") && !host.includes(":")) return null; // nome de máquina simples (ex.: minha-maquina, container do docker)
  return "só endereços da própria máquina ou da rede local; nomes públicos não são aceitos";
}
