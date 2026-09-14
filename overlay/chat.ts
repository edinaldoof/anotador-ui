// Conversas independentes dos lotes, com histórico por agente/modelo.
interface AgenteChatUI {
  id: string; nome: string; instalado: boolean; ponte: boolean; modelos: ModeloNoOverlay[];
}
interface SessaoExternaChatUI {
  agente: string; id: string; nome: string | null; titulo: string | null; em: string; ativa: boolean;
  historicoDisponivel?: boolean; descobertaParcial?: boolean;
}
interface MensagemChatUI { id: string; autor: "usuario" | "agente" | "sistema"; texto: string; em: string }
interface UsoChatUI {
  entrada: number | null; saida: number | null; total: number | null;
  cacheLeitura: number | null; cacheEscrita: number | null; raciocinio: number | null; custoUSD: number | null;
}
interface MetricasChatUI {
  versao: 1; acumulado: UsoChatUI; ultimoTurno: UsoChatUI | null;
  contexto: { usados: number | null; limite: number | null; percentual: number | null; base: "ultima_entrada" | "ultimo_evento" | null; modelo: string | null; atualizadoEm: string | null };
  atualizadoEm: string | null; cobertura: "sessao" | "chat" | "parcial";
}
interface LimitesContaChatUI {
  agente: string; disponivel: boolean; atualizadoEm: string | null; origem: string;
  janelas: Array<{ id: string; titulo: string; usadoPercentual: number; janelaMinutos: number | null; redefineEm: string | null; grupo: string | null }>;
  plano?: string; desatualizado?: boolean; aviso?: string;
  motivo?: "login_necessario" | "login_expirado" | "sem_permissao" | "indisponivel";
}
interface LeituraLimitesChatUI { dados: LimitesContaChatUI | null; consultadoEm: number; carregando: boolean; erro: string | null }
interface ConversaChatUI {
  id: string; agente: string; modelo: string | null; esforco?: string | null; titulo: string;
  atualizadaEm: string; ocupada: boolean; mensagens: MensagemChatUI[]; erro?: string | null; sessaoExterna?: string | null;
  somenteLeitura?: boolean; motivoSomenteLeitura?: string; metricas?: MetricasChatUI; avisoHistorico?: string;
  avaliacao?: { id: string; url: string; acompanhando: boolean; emAndamento: boolean };
}
interface ConversaAvaliacaoUI { id: string; agente: string; modelo: string | null; sessaoExterna: string | null }
interface AberturaSessaoChatUI {
  id: string; agente: string; externa: boolean; titulo: string;
  modelo: string | null; esforco: string | null; erro: string | null;
}
const CHAVE_RASCUNHOS_CHAT = "anotador-ui:chat:" + encodeURIComponent(CFG.nome) + ":" + location.pathname;
function recuperarRascunhosChat(): { rascunhos: Map<string, string>; agente: string; modelo: string; esforco: string; atual: ConversaChatUI | null } {
  const vazio = { rascunhos: new Map<string, string>(), agente: "", modelo: "", esforco: "", atual: null as ConversaChatUI | null };
  try {
    const bruto = localStorage.getItem(CHAVE_RASCUNHOS_CHAT);
    if (!bruto || bruto.length > 4 * 1024 * 1024) return vazio;
    const dado = JSON.parse(bruto) as Record<string, unknown>;
    if (dado.versao !== 1 || !Array.isArray(dado.rascunhos)) return vazio;
    for (const item of dado.rascunhos.slice(-200)) {
      if (Array.isArray(item) && typeof item[0] === "string" && item[0].length <= 400 && typeof item[1] === "string" && item[1].length <= 16000) vazio.rascunhos.set(item[0], item[1]);
    }
    if (typeof dado.agente === "string" && /^[a-z-]{1,30}$/.test(dado.agente)) vazio.agente = dado.agente;
    if (typeof dado.modelo === "string" && dado.modelo.length <= 200) vazio.modelo = dado.modelo;
    if (typeof dado.esforco === "string" && dado.esforco.length <= 30) vazio.esforco = dado.esforco;
    if (typeof dado.sessao === "string" && /^[\w-]{1,128}$/.test(dado.sessao) && vazio.agente) {
      vazio.atual = { id: dado.sessao, agente: vazio.agente, modelo: vazio.modelo || null, esforco: vazio.esforco || null, titulo: "", atualizadaEm: "", ocupada: false, mensagens: [] };
    }
  } catch { /* armazenamento bloqueado ou inválido não impede usar o chat */ }
  return vazio;
}
const rascunhosChatSalvos = recuperarRascunhosChat();
const chatUI = {
  painel: null as HTMLDivElement | null,
  botao: null as HTMLButtonElement | null,
  agentes: [] as AgenteChatUI[], externas: [] as SessaoExternaChatUI[], sessoes: [] as ConversaChatUI[],
  atual: rascunhosChatSalvos.atual, agente: rascunhosChatSalvos.agente, modelo: rascunhosChatSalvos.modelo, esforco: rascunhosChatSalvos.esforco, carregando: false, preparando: false, enviando: false, configurando: false,
  geracao: 0, geracaoLeitura: 0, timer: null as ReturnType<typeof setTimeout> | null,
  rascunhos: rascunhosChatSalvos.rascunhos,
  porAgente: new Map<string, { atual: ConversaChatUI | null; modelo: string; esforco: string }>(),
  abertura: null as AberturaSessaoChatUI | null,
  configuracaoAberta: false,
  observadorDitado: null as MutationObserver | null,
  limites: new Map<string, LeituraLimitesChatUI>(),
  limitesAgente: "", limitesGeracao: 0,
  limitesTimer: null as ReturnType<typeof setTimeout> | null,
  limitesPedido: null as AbortController | null,
  abaMetricas: "sessao" as "sessao" | "conta",
};
const ICONE_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5A7.5 7.5 0 0 1 9.5 4h3A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7 10h8M7 14h5"/></svg>';
function botaoChat(): HTMLButtonElement {
  chatUI.botao = h("button", { type: "button", class: "an-ico an-chat-abrir", title: textoInterface("Chat: conversas por agente e modelo"), "aria-label": textoInterface("Abrir chat"), "aria-expanded": "false", html: ICONE_CHAT, onclick: () => void alternarChat() });
  return chatUI.botao;
}
function chaveRascunhoChat(): string { return chatUI.atual?.id ?? `nova:${chatUI.agente}:${chatUI.modelo}:${chatUI.esforco}`; }
function persistirRascunhosChat(): void {
  try {
    const rascunhos = Array.from(chatUI.rascunhos).filter(([chave, texto]) => chave.length <= 400 && texto.length <= 16000 && texto.length > 0).slice(-200);
    localStorage.setItem(CHAVE_RASCUNHOS_CHAT, JSON.stringify({ versao: 1, rascunhos, agente: chatUI.agente, modelo: chatUI.modelo, esforco: chatUI.esforco, sessao: chatUI.atual?.id ?? null }));
  } catch { /* rascunhos continuam em memória se o navegador negar armazenamento */ }
}
function guardarRascunhoChat(): void {
  const campo = chatUI.painel?.querySelector<HTMLTextAreaElement>(".an-chat-entrada textarea");
  if (campo && !chatUI.abertura) chatUI.rascunhos.set(chaveRascunhoChat(), campo.value.slice(0, 16000));
  persistirRascunhosChat();
}
function fecharChat(): void {
  pausarAcompanhamentoChat();
  pararDitadoChat();
  guardarRascunhoChat();
  fecharConfiguracaoChat(false);
  if (chatUI.abertura && !chatUI.abertura.erro) chatUI.abertura.erro = "A abertura da sessão foi interrompida. Tente novamente.";
  if (chatUI.painel) chatUI.painel.hidden = true;
  chatUI.botao?.setAttribute("aria-expanded", "false");
  chatUI.botao?.classList.remove("ativo");
  chatUI.geracao++;
  if (chatUI.timer) clearTimeout(chatUI.timer);
  chatUI.timer = null;
  chatUI.botao?.focus({ preventScroll: true });
}
function erroChat(erro: unknown): void {
  const status = chatUI.painel?.querySelector<HTMLElement>(".an-chat-status");
  if (!status) return;
  status.textContent = erro instanceof Error ? erro.message : String(erro);
  status.classList.add("erro");
}
async function apiChat(caminho: string, corpo?: unknown): Promise<Record<string, unknown>> {
  const resposta = await pedirApi("/chat" + caminho, corpo);
  if (!resposta.ok) throw new Error(typeof resposta.dados.erro === "string" ? resposta.dados.erro : resposta.status === 403 ? "Este navegador precisa estar conectado ao Anotador para abrir o chat." : "Não consegui carregar a conversa. Tente novamente.");
  return resposta.dados;
}
function caminhoSessaoChat(id: string, agente: string): string { return "/sessoes/" + encodeURIComponent(id) + "?agente=" + encodeURIComponent(agente); }
function validarConversaChat(dados: Record<string, unknown>, agente: string, id?: string): ConversaChatUI {
  const conversa = dados.conversa as ConversaChatUI | undefined;
  if (!conversa || conversa.agente !== agente || (id && conversa.id !== id)) throw new Error("Esta sessão pertence a outro agente. Abra-a na lista do agente correspondente.");
  return conversa;
}
function guardarListaChat(sessoes: ConversaChatUI[], agente: string): void {
  chatUI.sessoes = [...chatUI.sessoes.filter(s => s.agente !== agente), ...sessoes.filter(s => s.agente === agente)];
}
async function trocarAgenteChat(agente: string): Promise<void> {
  if (agente === chatUI.agente || chatUI.enviando || chatUI.configurando) return;
  pararDitadoChat();
  guardarRascunhoChat();
  chatUI.porAgente.set(chatUI.agente, { atual: chatUI.atual, modelo: chatUI.modelo, esforco: chatUI.esforco });
  const salvo = chatUI.porAgente.get(agente);
  chatUI.abertura = null;
  chatUI.agente = agente; chatUI.atual = salvo?.atual ?? null; chatUI.modelo = salvo?.modelo ?? ""; chatUI.esforco = salvo?.esforco ?? "";
  chatUI.carregando = true;
  const geracao = ++chatUI.geracao;
  if (chatUI.timer) clearTimeout(chatUI.timer);
  renderizarChat();
  try {
    const lista = await apiChat("/sessoes?agente=" + encodeURIComponent(agente));
    if (geracao !== chatUI.geracao || agente !== chatUI.agente) return;
    guardarListaChat((lista.sessoes ?? []) as ConversaChatUI[], agente);
    if (chatUI.atual) {
      chatUI.carregando = false;
      await abrirSessaoChat(chatUI.atual.id, false, undefined, true);
      return;
    }
    chatUI.carregando = false; renderizarChat(); agendarChat();
  } catch (erro) {
    if (geracao !== chatUI.geracao || agente !== chatUI.agente) return;
    falharLeituraInicialChat(erro);
  }
}
async function alternarChat(): Promise<void> {
  if (chatUI.painel && !chatUI.painel.hidden) { fecharChat(); return; }
  if (!chatUI.painel) {
    chatUI.painel = h("div", { class: "an-chat", role: "dialog", "aria-label": "Chat com agentes" });
    raiz?.append(chatUI.painel);
    const reposicionar = (): void => { posicionarChat(); const campo = chatUI.painel?.querySelector<HTMLTextAreaElement>("textarea"); if (campo) ajustarAlturaEntradaChat(campo); };
    window.addEventListener("resize", reposicionar);
    new ResizeObserver(reposicionar).observe(ui.barra);
    new MutationObserver(reposicionar).observe(ui.barra, { attributes: true, attributeFilter: ["style", "class"] });
    document.addEventListener("pointerdown", (e) => {
      if (!chatUI.configuracaoAberta || chatUI.painel?.hidden) return;
      const dentro = e.composedPath().some(no => no instanceof Element && (no.classList.contains("an-chat-configuracao") || no.classList.contains("an-chat-modelo-resumo") || no.classList.contains("an-seletor-popup")));
      if (!dentro) fecharConfiguracaoChat(false);
    }, true);
  }
  chatUI.painel.hidden = false;
  chatUI.botao?.setAttribute("aria-expanded", "true");
  chatUI.botao?.classList.add("ativo");
  chatUI.carregando = true;
  renderizarChat();
  const geracao = ++chatUI.geracao;
  try {
    const catalogo = await apiChat("/catalogo");
    if (geracao !== chatUI.geracao) return;
    chatUI.agentes = catalogo.agentes as AgenteChatUI[];
    chatUI.externas = (catalogo.sessoesExternas ?? []) as SessaoExternaChatUI[];
    if (!chatUI.agente) chatUI.agente = chatUI.agentes.find((a) => a.instalado && a.ponte && (a.nome === AGENTE || a.id === AGENTE.toLowerCase()))?.id ?? chatUI.agentes.find((a) => a.instalado && a.ponte)?.id ?? "claude";
    const agente = chatUI.agente;
    const lista = await apiChat("/sessoes?agente=" + encodeURIComponent(agente));
    if (geracao !== chatUI.geracao) return;
    guardarListaChat((lista.sessoes ?? []) as ConversaChatUI[], agente);
    if (chatUI.atual && !chatUI.abertura) {
      chatUI.carregando = false;
      await abrirSessaoChat(chatUI.atual.id, false, undefined, true);
      return;
    }
    chatUI.carregando = false;
    renderizarChat();
    agendarChat();
  } catch (erro) {
    if (geracao !== chatUI.geracao) return;
    falharLeituraInicialChat(erro);
  }
}
function falharLeituraInicialChat(erro: unknown): void {
  chatUI.carregando = false;
  if (chatUI.atual && !chatUI.abertura) chatUI.abertura = {
    id: chatUI.atual.id, agente: chatUI.atual.agente, externa: false,
    titulo: chatUI.atual.titulo || "Sessão " + chatUI.atual.id.slice(0, 8),
    modelo: chatUI.atual.modelo, esforco: chatUI.atual.esforco ?? null,
    erro: erro instanceof Error ? erro.message : String(erro),
  };
  renderizarChat();
  if (!chatUI.abertura) erroChat(erro);
}
function seletorChat(rotulo: string, opcoes: Array<{valor: string; titulo: string}>, valor: string, mudar: (valor: string) => void, desabilitado = false): HTMLElement {
  const select = h("select", { disabled: desabilitado });
  for (const opcao of opcoes) select.append(h("option", { value: opcao.valor }, !opcao.valor || rotulo === "Raciocínio" ? textoInterface(opcao.titulo) : opcao.titulo));
  select.value = valor;
  select.addEventListener("change", () => { if (chatUI.enviando || chatUI.configurando) return; guardarRascunhoChat(); mudar(select.value); renderizarChat(); });
  return h("label", { class: "an-chat-escolha" }, h("span", null, textoInterface(rotulo)), select, criarSeletorPersonalizado(select, rotulo));
}
function ditandoNoChat(): boolean { return !!chatUI.painel && !!estado.ditado && estado.ditado.botao.closest(".an-chat") === chatUI.painel; }
function pararDitadoChat(): void { if (ditandoNoChat()) estado.ditado?.parar(); }
function podeDitarChat(): boolean {
  return !chatUI.preparando && !chatUI.enviando && !chatUI.configurando && !chatUI.carregando && !chatUI.abertura && !chatUI.atual?.ocupada && !chatUI.atual?.somenteLeitura && chatUI.agentes.some(a => a.id === chatUI.agente && a.instalado && a.ponte);
}
async function retomarDitadoChat(): Promise<boolean> {
  if (!chatUI.painel || chatUI.painel.hidden) await alternarChat();
  const geracao = chatUI.geracao, limite = Date.now() + 15000;
  while (chatUI.carregando && geracao === chatUI.geracao && Date.now() < limite && !chatUI.painel?.hidden) await new Promise(resolve => setTimeout(resolve, 50));
  const botao = chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-microfone");
  if (geracao !== chatUI.geracao || chatUI.painel?.hidden || raiz?.hidden || !botao || botao.disabled || !podeDitarChat() || document.hidden) return false;
  botao.click();
  return true;
}
function posicionarChat(): void {
  const painel = chatUI.painel;
  if (!painel || painel.hidden) return;
  const barra = ui.barra?.getBoundingClientRect();
  const barraNoTopo = barra && ui.barra.checkVisibility() && barra.top < Math.min(170, innerHeight / 3) && barra.bottom > 0;
  const top = barraNoTopo ? Math.max(12, barra.bottom + 8) : 16;
  painel.style.top = top + "px";
  painel.style.height = Math.min(750, Math.max(0, innerHeight - top - 12)) + "px";
}
function fecharConfiguracaoChat(focar = true): boolean {
  if (!chatUI.configuracaoAberta) return false;
  chatUI.configuracaoAberta = false;
  fecharSeletorAberto?.();
  const popup = chatUI.painel?.querySelector<HTMLElement>(".an-chat-configuracao");
  if (popup) popup.hidden = true;
  const botao = chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-modelo-resumo");
  botao?.setAttribute("aria-expanded", "false");
  if (focar) botao?.focus({ preventScroll: true });
  return true;
}
function abrirConfiguracaoChat(focar = true): void {
  const popup = chatUI.painel?.querySelector<HTMLElement>(".an-chat-configuracao");
  if (!popup) return;
  const comandos = chatUI.painel?.querySelector<HTMLElement>(".an-chat-comandos");
  if (comandos) comandos.hidden = true;
  const metricas = chatUI.painel?.querySelector<HTMLDetailsElement>(".an-chat-metricas");
  if (metricas) metricas.open = false;
  chatUI.configuracaoAberta = true; popup.hidden = false;
  chatUI.painel?.querySelector(".an-chat-modelo-resumo")?.setAttribute("aria-expanded", "true");
  if (focar) popup.querySelector<HTMLButtonElement>('[role="combobox"]:not(:disabled)')?.focus({ preventScroll: true });
}
function ajustarAlturaEntradaChat(campo: HTMLTextAreaElement): void {
  const posicao = campo.scrollTop;
  campo.style.height = "auto";
  const altura = Math.min(108, Math.max(40, campo.scrollHeight));
  campo.style.height = altura + "px";
  campo.style.overflowY = campo.scrollHeight > altura ? "auto" : "hidden";
  campo.scrollTop = posicao;
}
function novaConversaChat(): void {
  if (chatUI.enviando || chatUI.configurando || chatUI.carregando) return;
  pararDitadoChat();
  guardarRascunhoChat();
  chatUI.geracao++;
  fecharConfiguracaoChat(false);
  chatUI.abertura = null;
  chatUI.atual = null;
  chatUI.enviando = false;
  renderizarChat();
  agendarChat();
  chatUI.painel?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
}
async function abrirSessaoChat(id: string, externa = false, repetir?: AberturaSessaoChatUI, restaurando = false): Promise<void> {
  if (!restaurando && (chatUI.enviando || chatUI.configurando)) return;
  pararDitadoChat();
  guardarRascunhoChat();
  const geracao = ++chatUI.geracao, agente = chatUI.agente;
  if (repetir && repetir.agente !== agente) return;
  const sessao = externa ? chatUI.externas.find(s => s.id === id && s.agente === agente) : chatUI.sessoes.find(s => s.id === id && s.agente === agente);
  const abertura: AberturaSessaoChatUI = repetir ? { ...repetir, erro: null } : {
    id, agente, externa, titulo: (externa ? (sessao as SessaoExternaChatUI | undefined)?.nome || sessao?.titulo : sessao?.titulo) || chatUI.atual?.id === id && chatUI.atual.titulo || "Sessão " + id.slice(0, 8),
    modelo: chatUI.modelo || null, esforco: chatUI.esforco || null, erro: null,
  };
  chatUI.abertura = abertura; chatUI.carregando = true;
  if (chatUI.timer) clearTimeout(chatUI.timer);
  renderizarChat();
  try {
    const dados = abertura.externa
      ? await apiChat("/sessoes", { agente: abertura.agente, modelo: abertura.modelo, esforco: abertura.esforco, sessaoExterna: abertura.id })
      : await apiChat(caminhoSessaoChat(abertura.id, abertura.agente));
    if (geracao !== chatUI.geracao || abertura.agente !== chatUI.agente) return;
    chatUI.atual = validarConversaChat(dados, abertura.agente, abertura.externa ? undefined : abertura.id);
    chatUI.abertura = null; chatUI.carregando = false;
    chatUI.modelo = chatUI.atual.modelo ?? "";
    chatUI.esforco = chatUI.atual.esforco ?? "";
    atualizarResumoChat(chatUI.atual);
    renderizarChat();
    agendarChat();
  } catch (erro) {
    if (geracao !== chatUI.geracao || abertura.agente !== chatUI.agente) return;
    abertura.erro = erro instanceof Error ? erro.message : String(erro);
    chatUI.carregando = false; renderizarChat();
  }
}
async function abrirChatDaAvaliacao(conversa: ConversaAvaliacaoUI): Promise<boolean> {
  if (chatUI.enviando || chatUI.configurando) {
    avisar(traduzirInterface("Aguarde o envio atual antes de abrir a avaliação no chat."));
    return false;
  }
  if (!chatUI.painel || chatUI.painel.hidden) await alternarChat();
  await trocarAgenteChat(conversa.agente);
  if (chatUI.agente !== conversa.agente) return false;
  await abrirSessaoChat(conversa.id);
  return chatUI.atual?.id === conversa.id && !chatUI.abertura;
}
function voltarSessoesChat(): void {
  if (chatUI.enviando || chatUI.configurando) return;
  chatUI.geracao++; chatUI.abertura = null; chatUI.carregando = false;
  // Um ID recuperado do localStorage ainda não é uma sessão aberta. Se o
  // histórico não pôde ser lido, recupera seu rascunho sem enviar para esse ID.
  if (chatUI.atual && !chatUI.atual.atualizadaEm) {
    const texto = chatUI.rascunhos.get(chatUI.atual.id) ?? "";
    chatUI.atual = null;
    if (texto && !chatUI.rascunhos.get(chaveRascunhoChat())) chatUI.rascunhos.set(chaveRascunhoChat(), texto);
  }
  renderizarChat();
  const lista = chatUI.painel?.querySelector<HTMLDetailsElement>(".an-chat-historico");
  if (lista) { lista.open = true; lista.querySelector("summary")?.focus(); }
  agendarChat();
}
function atualizarResumoChat(conversa: ConversaChatUI): void {
  chatUI.sessoes = [conversa, ...chatUI.sessoes.filter((s) => s.id !== conversa.id || s.agente !== conversa.agente)];
}
async function configurarChat(modelo: string, esforco: string): Promise<void> {
  if (chatUI.enviando || chatUI.configurando || chatUI.carregando || chatUI.abertura || chatUI.atual?.ocupada) return;
  guardarRascunhoChat();
  if (!chatUI.atual) {
    const texto = chatUI.rascunhos.get(chaveRascunhoChat()) ?? "";
    chatUI.modelo = modelo; chatUI.esforco = esforco;
    chatUI.rascunhos.set(chaveRascunhoChat(), texto);
    renderizarChat();
    return;
  }
  chatUI.configurando = true;
  const geracao = ++chatUI.geracao, id = chatUI.atual.id, agente = chatUI.agente;
  renderizarChat();
  try {
    const dados = await apiChat("/sessoes/" + encodeURIComponent(id) + "/configuracao", { agente, modelo: modelo || null, esforco: esforco || null });
    if (geracao !== chatUI.geracao) return;
    chatUI.atual = validarConversaChat(dados, agente, id);
    chatUI.modelo = chatUI.atual.modelo ?? "";
    chatUI.esforco = chatUI.atual.esforco ?? "";
    atualizarResumoChat(chatUI.atual);
    chatUI.configurando = false;
    renderizarChat();
    agendarChat();
  } catch (erro) {
    if (geracao === chatUI.geracao) { chatUI.configurando = false; renderizarChat(); erroChat(erro); agendarChat(); }
  } finally { chatUI.configurando = false; }
}
function renderizarChat(): void {
  const painel = chatUI.painel;
  if (!painel) return;
  pararDitadoChat();
  chatUI.observadorDitado?.disconnect();
  persistirRascunhosChat();
  painel.replaceChildren();
  const titulo = chatUI.abertura?.titulo ?? chatUI.atual?.titulo;
  const acoes = h("div", { class: "an-chat-acoes" },
    h("button", { type: "button", class: "an-btn an-chat-uso-rapido", "aria-label": textoInterface("Visualizar uso da conta"), "aria-controls": "an-chat-metricas-conta", title: textoInterface("Visualizar uso da conta e renovação dos limites"), onclick: abrirUsoContaChat }, textoInterface("Uso")),
    h("button", { type: "button", class: "an-btn an-chat-nova", title: textoInterface("Nova conversa"), "aria-label": textoInterface("Nova conversa"), disabled: chatUI.enviando || chatUI.configurando, onclick: novaConversaChat }, textoInterface("+ Nova")),
    h("button", { type: "button", class: "an-ico an-chat-ampliar", title: textoInterface("Ampliar ou reduzir chat"), "aria-label": textoInterface("Ampliar chat"), "aria-pressed": String(painel.classList.contains("ampliado")), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>', onclick: (e: Event) => { const ampliado = painel.classList.toggle("ampliado"); (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(ampliado)); const campo = painel.querySelector<HTMLTextAreaElement>("textarea"); if (campo) ajustarAlturaEntradaChat(campo); } }),
    h("button", { type: "button", class: "an-ico", title: textoInterface("Fechar chat"), "aria-label": textoInterface("Fechar chat"), html: ICONES.fechar, onclick: fecharChat }));
  const cab = h("div", { class: "an-chat-cab" }, h("div", { class: "an-chat-identidade" }, h("strong", null, textoInterface("Conversas")), h("span", { class: "an-chat-sub", title: titulo || textoInterface("Nova conversa") }, titulo || textoInterface("Nova conversa"))), acoes);
  if (chatUI.atual?.avaliacao) cab.querySelector(".an-chat-identidade")?.append(h("span", { class: "an-chat-sessao-id" }));
  painel.append(cab);
  const agente = chatUI.agentes.find((a) => a.id === chatUI.agente);
  const bloqueado = chatUI.enviando || chatUI.configurando || chatUI.carregando || !!chatUI.abertura || !!chatUI.atual?.ocupada;
  const filtros = h("div", { class: "an-chat-filtros" },
    seletorChat("Agente da conversa", chatUI.agentes.filter((a) => a.instalado && a.ponte).map((a) => ({valor:a.id,titulo:a.nome})), chatUI.agente, (valor) => { void trocarAgenteChat(valor); }, chatUI.enviando || chatUI.configurando),
    seletorChat("Modelo da conversa", [{valor:"",titulo:"Padrão do agente"}, ...(agente?.modelos ?? []), ...(chatUI.modelo && !agente?.modelos.some((m) => m.valor === chatUI.modelo) ? [{valor:chatUI.modelo,titulo:chatUI.modelo}] : [])], chatUI.modelo, (valor) => { void configurarChat(valor, ""); }, bloqueado),
  );
  const esforcos = (agente?.modelos.find((m) => m.valor === chatUI.modelo) ?? (!chatUI.modelo ? agente?.modelos.find((m) => m.padrao) : undefined))?.esforcos ?? [];
  const niveis: Record<string,string> = { minimal:"Mínimo", low:"Baixo", medium:"Médio", high:"Alto", xhigh:"Muito alto", max:"Máximo" };
  if (esforcos.length) filtros.append(seletorChat("Raciocínio", [{valor:"",titulo:"Padrão"}, ...esforcos.map((valor) => ({valor,titulo:niveis[valor] ?? valor}))], chatUI.esforco, (valor) => { void configurarChat(chatUI.modelo, valor); }, bloqueado));
  const historico = h("details", { class: "an-chat-historico" }, h("summary", null, textoInterface("Sessões de {agente}", { agente: agente?.nome ?? chatUI.agente })));
  const lista = h("div", { class: "an-chat-sessoes" });
  for (const sessao of chatUI.sessoes.filter((s) => s.agente === chatUI.agente)) {
    lista.append(h("button", { type: "button", class: "an-chat-sessao" + (!chatUI.abertura && sessao.id === chatUI.atual?.id ? " atual" : ""), disabled: chatUI.enviando, onclick: () => void abrirSessaoChat(sessao.id) }, h("strong", null, sessao.titulo || "Nova conversa"), h("span", { class: "an-chat-dono" }, agente?.nome ?? sessao.agente), sessao.avisoHistorico ? h("span", { class: "an-chat-historico-remoto" }, textoInterface("Histórico no agente")) : null, h("span", null, [sessao.modelo || "Padrão", sessao.ocupada ? "Respondendo…" : "", new Date(sessao.atualizadaEm).toLocaleString(idiomaInterface())].filter(Boolean).join(" · "))));
  }
  const importadas = new Set(chatUI.sessoes.filter((s) => s.agente === chatUI.agente).map((s) => s.sessaoExterna));
  for (const sessao of chatUI.externas.filter((s) => s.agente === chatUI.agente && !importadas.has(s.id))) {
    lista.append(h("button", { type: "button", class: "an-chat-sessao", disabled: chatUI.enviando, onclick: () => void abrirSessaoChat(sessao.id, true) }, h("strong", null, sessao.nome || sessao.titulo || "Sessão " + sessao.id.slice(0,8)), h("span", { class: "an-chat-dono" }, agente?.nome ?? sessao.agente), sessao.historicoDisponivel === false ? h("span", { class: "an-chat-historico-remoto" }, textoInterface("Histórico no agente")) : null, h("span", null, (sessao.ativa ? "Aberta no agente · " : "Salva no agente · ") + new Date(sessao.em).toLocaleString(idiomaInterface()))));
  }
  if (!lista.childElementCount) lista.append(h("p", { class: "an-chat-sub" }, textoInterface(chatUI.carregando ? "Carregando sessões…" : "Ainda não há conversas deste agente no projeto.")));
  if (chatUI.externas.some(s => s.agente === chatUI.agente && s.descobertaParcial)) lista.append(h("p", { class: "an-chat-sub" }, textoInterface("Lista parcial das sessões localizadas neste projeto.")));
  historico.append(lista);
  painel.append(historico, h("div", { class: "an-chat-mensagens", role: "log", "aria-label": textoInterface("Mensagens da conversa"), "aria-live": "polite" }), h("div", { class: "an-chat-status", role: "status" }));
  painel.append(h("div", { class: "an-chat-monitor" }));
  const campo = h("textarea", { rows: 1, placeholder: textoInterface(chatUI.abertura ? "Abra uma sessão para enviar mensagens" : "Converse sobre o projeto…"), "aria-label": textoInterface("Mensagem para o agente"), title: textoInterface("Enter envia · Shift+Enter quebra linha"), maxlength: 16000, disabled: chatUI.carregando || !!chatUI.abertura });
  campo.value = chatUI.abertura ? "" : chatUI.rascunhos.get(chaveRascunhoChat()) ?? "";
  const enviar = h("button", { type: "button", class: "an-btn an-chat-enviar", "aria-label": textoInterface("Enviar mensagem"), title: textoInterface("Enviar mensagem"), html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>', onclick: () => void enviarChat() });
  const ajustar = (): void => {
    if (campo.value.length > 16000) campo.value = campo.value.slice(0, 16000);
    if (!chatUI.abertura) chatUI.rascunhos.set(chaveRascunhoChat(), campo.value);
    persistirRascunhosChat();
    ajustarAlturaEntradaChat(campo);
    enviar.disabled = !campo.value.trim() || ditandoNoChat() || chatUI.enviando || chatUI.configurando || chatUI.carregando || !!chatUI.abertura || !!chatUI.atual?.ocupada || !!chatUI.atual?.somenteLeitura || !agente?.instalado || !agente.ponte;
  };
  campo.addEventListener("input", ajustar);
  campo.addEventListener("keydown", (e) => {
    if (comandos.teclado(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!enviar.disabled) void enviarChat(); }
  });
  const tituloModelo = agente?.modelos.find(m => m.valor === chatUI.modelo)?.titulo ?? (chatUI.modelo || "Padrão");
  const tituloEsforco = chatUI.esforco ? niveis[chatUI.esforco] ?? chatUI.esforco : "";
  const resumoCompleto = [agente?.nome || "Escolher agente", tituloModelo, tituloEsforco].filter(Boolean).join(" · ");
  const resumo = h("button", { type: "button", class: "an-chat-modelo-resumo", "aria-label": textoInterface("Configurar conversa"), "aria-haspopup": "dialog", "aria-controls": "an-chat-configuracao", "aria-expanded": String(chatUI.configuracaoAberta), title: resumoCompleto, onclick: () => { if (!fecharConfiguracaoChat()) abrirConfiguracaoChat(); } },
    h("span", { class: "an-chat-resumo-agente" }, (agente?.nome || "Agente").replace(/ (?:Code|CLI)$/, "")), h("span", { class: "an-chat-resumo-ponto", "aria-hidden": "true" }, "·"), h("span", { class: "an-chat-resumo-modelo" }, chatUI.modelo ? tituloModelo : textoInterface("Padrão")),
    tituloEsforco ? h("span", { class: "an-chat-resumo-esforco" }, "· ", textoInterface(tituloEsforco)) : null,
    h("span", { class: "an-chat-resumo-seta", "aria-hidden": "true", html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4"/></svg>' }));
  const configuracao = h("div", { id: "an-chat-configuracao", class: "an-chat-configuracao", role: "dialog", "aria-label": textoInterface("Agente, modelo e raciocínio"), hidden: !chatUI.configuracaoAberta },
    h("div", { class: "an-chat-configuracao-cab" }, h("strong", null, textoInterface("Configurar conversa")), h("button", { type: "button", class: "an-ico", "aria-label": textoInterface("Fechar configuração"), title: textoInterface("Fechar configuração"), html: ICONES.fechar, onclick: () => fecharConfiguracaoChat() })), filtros);
  const microfone = h("button", { type: "button", class: "an-ico an-chat-microfone", "aria-label": textoInterface("Ditar mensagem"), title: textoInterface("Ditar mensagem"), html: ICONES.mic, disabled: !podeDitarChat(), onclick: () => {
    if (!podeDitarChat()) return;
    fecharConfiguracaoChat(false);
    iniciarDitado(campo, microfone, () => guardarRascunhoChat());
    renderizarMensagensChat();
  } });
  const entrada = h("div", { class: "an-chat-entrada" }, campo, h("div", { class: "an-chat-rodape" }, resumo,
    h("button", { type: "button", class: "an-btn an-chat-comandos-abrir", "aria-label": textoInterface("Comandos do agente"), title: textoInterface("Ver todos os comandos deste agente"), disabled: !!chatUI.abertura, onclick: () => comandos.abrir() }, "/"), criarIdiomaDitado(), microfone, enviar), configuracao);
  const comandos = ligarComandosChat(campo, entrada);
  painel.append(entrada);
  posicionarChat();
  chatUI.observadorDitado = new MutationObserver(() => renderizarMensagensChat());
  chatUI.observadorDitado.observe(entrada, { attributes: true, attributeFilter: ["class"] });
  ajustar();
  renderizarMensagensChat();
  acompanharLimitesContaChat();
}
function renderizarMensagensChat(): void {
  const fluxo = chatUI.painel?.querySelector<HTMLElement>(".an-chat-mensagens");
  const status = chatUI.painel?.querySelector<HTMLElement>(".an-chat-status");
  if (!fluxo || !status) return;
  const noFim = fluxo.scrollHeight - fluxo.scrollTop - fluxo.clientHeight < 60;
  const abertura = chatUI.abertura;
  if (abertura) {
    const assinatura = JSON.stringify(["abertura", abertura]);
    if (fluxo.dataset.assinatura !== assinatura) {
      const dono = chatUI.agentes.find(a => a.id === abertura.agente)?.nome ?? abertura.agente;
      const estado = h("div", { class: "an-chat-vazio an-chat-falha-abertura", role: abertura.erro ? "alert" : "status" },
        h("strong", null, textoInterface(abertura.erro ? "Não foi possível abrir esta sessão" : "Abrindo sessão…")),
        h("p", { class: "an-chat-abertura-identidade" }, abertura.titulo + " · " + dono),
        h("code", null, abertura.id));
      if (abertura.erro) estado.append(h("p", null, abertura.erro), h("p", { class: "an-chat-sub" }, textoInterface("A sessão anterior e seus rascunhos foram preservados. Escolha outra sessão ou tente abrir esta novamente.")),
        h("div", { style: "display:flex;flex-wrap:wrap;justify-content:center;gap:8px" },
          h("button", { type: "button", class: "an-btn an-chat-abertura-repetir", onclick: () => void abrirSessaoChat(abertura.id, abertura.externa, abertura) }, textoInterface("Tentar novamente")),
          h("button", { type: "button", class: "an-btn an-chat-abertura-voltar", onclick: voltarSessoesChat }, textoInterface("Voltar às sessões"))));
      fluxo.replaceChildren(estado); fluxo.dataset.assinatura = assinatura;
    }
    renderizarMetricasChat();
    if (abertura.erro) status.textContent = abertura.erro;
    else definirTextoInterface(status, "Abrindo sessão de {agente}…", {agente:chatUI.agentes.find(a => a.id === abertura.agente)?.nome ?? abertura.agente});
    status.classList.toggle("erro", !!abertura.erro);
    return;
  }
  const mensagens = chatUI.atual?.mensagens ?? [];
  const avisoHistorico = chatUI.atual?.avisoHistorico;
  const assinatura = JSON.stringify([mensagens, avisoHistorico]);
  if (fluxo.dataset.assinatura !== assinatura) {
    fluxo.replaceChildren();
    if (avisoHistorico) fluxo.append(h("div", { class: "an-chat-aviso-historico", role: "note" }, h("strong", null, textoInterface("Histórico no agente")), h("p", null, avisoHistorico)));
    for (const mensagem of mensagens) fluxo.append(h("div", { class: "an-chat-mensagem " + mensagem.autor }, h("strong", null, mensagem.autor === "usuario" ? textoInterface("Você") : mensagem.autor === "sistema" ? textoInterface("Anotador") : chatUI.agentes.find((a) => a.id === chatUI.atual?.agente)?.nome ?? textoInterface("Agente")), formatarMensagemChat(mensagem.texto)));
    if (!mensagens.length && !avisoHistorico) fluxo.append(h("div", { class: "an-chat-vazio" }, h("span", { html: ICONE_CHAT }), h("strong", null, textoInterface("O projeto também pode começar com uma conversa.")), h("p", null, textoInterface("Peça uma explicação, discuta uma mudança ou continue uma sessão existente."))));
    fluxo.dataset.assinatura = assinatura;
    if (noFim) fluxo.scrollTop = fluxo.scrollHeight;
  }
  renderizarMetricasChat();
  if (chatUI.carregando || chatUI.configurando || (!chatUI.atual?.erro && chatUI.atual?.ocupada)) definirTextoInterface(status, chatUI.carregando ? "Carregando…" : chatUI.configurando ? "Atualizando modelo e raciocínio…" : "Respondendo…");
  else status.textContent = traduzirInterface(chatUI.atual?.erro || chatUI.atual?.motivoSomenteLeitura || "");
  const identidade = chatUI.painel?.querySelector<HTMLElement>(".an-chat-sessao-id");
  if (identidade && chatUI.atual) {
    const id = chatUI.atual.sessaoExterna || chatUI.atual.id;
    identidade.textContent = traduzirInterface(chatUI.atual.sessaoExterna ? "Sessão {id}" : "Conversa {id}", { id: id.slice(0, 8) });
    identidade.title = id;
  }
  status.classList.toggle("erro", !!chatUI.atual?.erro);
  const enviar = chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-enviar");
  const campo = chatUI.painel?.querySelector<HTMLTextAreaElement>("textarea");
  if (campo) ajustarAlturaEntradaChat(campo);
  if (enviar && campo) enviar.disabled = !campo.value.trim() || ditandoNoChat() || chatUI.enviando || chatUI.configurando || chatUI.carregando || !!chatUI.atual?.ocupada || !!chatUI.atual?.somenteLeitura || !chatUI.agentes.some((a) => a.id === chatUI.agente && a.instalado && a.ponte);
  const microfone = chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-microfone");
  if (microfone) microfone.disabled = !podeDitarChat();
  chatUI.painel?.querySelectorAll<HTMLButtonElement>(".an-chat-nova,.an-chat-sessao").forEach((b) => { b.disabled = chatUI.enviando || chatUI.configurando; });
  chatUI.painel?.querySelectorAll<HTMLSelectElement>(".an-chat-filtros select").forEach((select, i) => {
    const desabilitado = chatUI.enviando || chatUI.configurando || (i !== 0 && (chatUI.carregando || !!chatUI.atual?.ocupada || !!chatUI.atual?.avaliacao?.emAndamento));
    if (select.disabled !== desabilitado) { select.disabled = desabilitado; atualizarSeletorPersonalizado(select); }
  });
}
function numeroMetricaChat(valor: number | null | undefined): string {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor.toLocaleString(idiomaInterface(), { maximumFractionDigits: 0 }) : traduzirInterface("Não informado");
}
function moedaMetricaChat(valor: number | null | undefined): string {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? new Intl.NumberFormat(idiomaInterface(), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(valor) : traduzirInterface("Não informado");
}
function pararLimitesContaChat(): void {
  const leitura = chatUI.limites.get(chatUI.limitesAgente);
  if (leitura?.carregando) chatUI.limites.set(chatUI.limitesAgente, { ...leitura, carregando: false });
  chatUI.limitesGeracao++;
  if (chatUI.limitesTimer) clearTimeout(chatUI.limitesTimer);
  chatUI.limitesTimer = null;
  chatUI.limitesPedido?.abort();
  chatUI.limitesPedido = null;
  chatUI.limitesAgente = "";
}
function pausarAcompanhamentoChat(): void {
  pararLimitesContaChat();
  chatUI.geracaoLeitura++;
  if (chatUI.timer) clearTimeout(chatUI.timer);
  chatUI.timer = null;
}
function retomarAcompanhamentoChat(): void {
  if (!chatUI.painel || chatUI.painel.hidden || !raiz || raiz.hidden) return;
  posicionarChat();
  acompanharLimitesContaChat();
  agendarChat();
}
function acompanharLimitesContaChat(): void {
  if (!chatUI.agente || !chatUI.painel || chatUI.painel.hidden || !raiz || raiz.hidden) return;
  if (chatUI.limitesAgente === chatUI.agente && (chatUI.limitesPedido || chatUI.limitesTimer)) return;
  pararLimitesContaChat();
  chatUI.limitesAgente = chatUI.agente;
  const leitura = chatUI.limites.get(chatUI.agente);
  const restante = leitura?.consultadoEm ? 60000 - (Date.now() - leitura.consultadoEm) : 0;
  if (restante > 0) agendarLimitesContaChat(restante);
  else void atualizarLimitesContaChat();
}
function agendarLimitesContaChat(atraso = 60000): void {
  if (chatUI.limitesTimer) clearTimeout(chatUI.limitesTimer);
  chatUI.limitesTimer = setTimeout(() => { chatUI.limitesTimer = null; void atualizarLimitesContaChat(); }, atraso);
}
function normalizarLimitesContaChat(dados: Record<string, unknown>, agente: string): LimitesContaChatUI {
  if (dados.agente !== agente || typeof dados.disponivel !== "boolean" || !Array.isArray(dados.janelas)) throw new Error("Não foi possível confirmar os limites da conta deste agente.");
  const texto = (valor: unknown, tamanho = 300): string | null => typeof valor === "string" && valor.trim() ? valor.slice(0, tamanho) : null;
  const janelas: LimitesContaChatUI["janelas"] = [];
  for (const bruto of dados.janelas.slice(0, 30)) {
    if (!bruto || typeof bruto !== "object") continue;
    const item = bruto as Record<string, unknown>;
    if (typeof item.usadoPercentual !== "number" || !Number.isFinite(item.usadoPercentual)) continue;
    janelas.push({ id: texto(item.id) ?? String(janelas.length), titulo: texto(item.titulo) ?? "Janela de uso", usadoPercentual: Math.max(0, Math.min(100, item.usadoPercentual)), janelaMinutos: typeof item.janelaMinutos === "number" && Number.isFinite(item.janelaMinutos) && item.janelaMinutos > 0 ? item.janelaMinutos : null, redefineEm: texto(item.redefineEm), grupo: texto(item.grupo) });
  }
  const motivo = ["login_necessario", "login_expirado", "sem_permissao", "indisponivel"].includes(String(dados.motivo)) ? dados.motivo as LimitesContaChatUI["motivo"] : undefined;
  return { agente, disponivel: dados.disponivel && janelas.length > 0, janelas, atualizadoEm: texto(dados.atualizadoEm), origem: texto(dados.origem) ?? "Não informada", plano: texto(dados.plano, 100) ?? undefined, desatualizado: dados.desatualizado === true, aviso: texto(dados.aviso, 1000) ?? undefined, motivo };
}
async function atualizarLimitesContaChat(): Promise<void> {
  const agente = chatUI.limitesAgente, geracao = chatUI.limitesGeracao;
  if (!agente || agente !== chatUI.agente || chatUI.limitesPedido || !chatUI.painel || chatUI.painel.hidden || !raiz || raiz.hidden) return;
  const anterior = chatUI.limites.get(agente);
  chatUI.limites.set(agente, { dados: anterior?.dados ?? null, consultadoEm: anterior?.consultadoEm ?? 0, carregando: true, erro: null });
  renderizarMetricasChat();
  const controlador = new AbortController();
  chatUI.limitesPedido = controlador;
  const timeout = setTimeout(() => controlador.abort(), 15000);
  const atual = (): boolean => geracao === chatUI.limitesGeracao && agente === chatUI.agente && !chatUI.painel?.hidden;
  try {
    const resposta = await pedirApi("/chat/limites?agente=" + encodeURIComponent(agente), undefined, controlador.signal);
    if (!atual()) return;
    if (!resposta.ok) throw new Error(typeof resposta.dados.erro === "string" ? resposta.dados.erro : "Os limites da conta estão indisponíveis agora.");
    chatUI.limites.set(agente, { dados: normalizarLimitesContaChat(resposta.dados, agente), consultadoEm: Date.now(), carregando: false, erro: null });
  } catch (erro) {
    if (!atual()) return;
    chatUI.limites.set(agente, { dados: anterior?.dados ?? null, consultadoEm: Date.now(), carregando: false, erro: erro instanceof Error && erro.name !== "AbortError" ? erro.message : "A consulta dos limites demorou demais." });
  } finally {
    clearTimeout(timeout);
    if (chatUI.limitesPedido === controlador) chatUI.limitesPedido = null;
    if (atual()) { renderizarMetricasChat(); agendarLimitesContaChat(); }
  }
}
function prazoLimiteChat(valor: string | null): string {
  if (!valor || !Number.isFinite(Date.parse(valor))) return traduzirInterface("Renovação não informada");
  const data = new Date(valor), minutos = Math.ceil((data.getTime() - Date.now()) / 60000);
  const instante = data.toLocaleString(idiomaInterface(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (minutos <= 0) return traduzirInterface("Horário de renovação atingido · {instante}", { instante });
  const dias = Math.floor(minutos / 1440), horas = Math.floor(minutos % 1440 / 60), resto = minutos % 60;
  const relativo = dias ? dias + "d" + (horas ? " " + horas + "h" : "") : horas ? horas + "h" + (resto ? " " + resto + "min" : "") : minutos + "min";
  return traduzirInterface("Renova em {tempo} · {instante}", {tempo:relativo, instante});
}
function tituloLimiteChat(janela: LimitesContaChatUI["janelas"][number]): string {
  const minutos = janela.janelaMinutos;
  if (minutos === null) return traduzirInterface(janela.titulo);
  if (minutos === 10080) return traduzirInterface("Semanal");
  if (minutos % 1440 === 0) return traduzirInterface("{valor} dias", { valor: minutos / 1440 });
  if (minutos % 60 === 0) return traduzirInterface("{valor} horas", { valor: minutos / 60 });
  return traduzirInterface("{valor} minutos", { valor: minutos });
}
function grupoLimiteChat(grupo: string): string {
  return traduzirInterface(grupo === "Gemini Models" ? "Modelos Gemini" : grupo === "Claude and GPT models" ? "Modelos Claude e GPT" : grupo);
}
function avisoLimitesChat(leitura: LeituraLimitesChatUI | undefined): string {
  if (leitura?.erro) return leitura.erro;
  const dados = leitura?.dados;
  if (dados?.agente === "claude") {
    if (dados.motivo === "login_necessario") return "Claude Code não está conectado neste servidor.";
    if (dados.motivo === "login_expirado") return "O login do Claude Code neste servidor expirou.";
    if (dados.motivo === "sem_permissao") return "O login do Claude Code não autoriza a consulta dos limites.";
  }
  return dados?.aviso ?? "Este agente não informou os limites da conta.";
}
function abrirUsoContaChat(): void {
  const detalhes = chatUI.painel?.querySelector<HTMLDetailsElement>(".an-chat-metricas");
  const conta = detalhes?.querySelector<HTMLButtonElement>('[data-metrica-aba="conta"]');
  if (!detalhes || !conta) return;
  fecharConfiguracaoChat(false);
  conta.click(); detalhes.open = true;
  conta.focus({ preventScroll: true });
}
function atualizarAtalhoUsoChat(leitura: LeituraLimitesChatUI | undefined): void {
  const botao = chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-uso-rapido");
  if (!botao) return;
  const dados = leitura?.dados;
  // O resumo usa somente a cota geral: não atribui o limite de outro modelo
  // (por exemplo, Spark) ao modelo escolhido na conversa.
  const grupoAntigravity = chatUI.agente === "antigravity" ? /^gemini-/.test(chatUI.modelo) ? "Gemini Models" : /^(claude-|gpt-)/.test(chatUI.modelo) ? "Claude and GPT models" : null : null;
  const candidatas = dados?.disponivel ? dados.janelas.filter(j => grupoAntigravity ? j.grupo === grupoAntigravity : !j.grupo || j.grupo.toLowerCase() === chatUI.agente) : [];
  const janela = grupoAntigravity ? candidatas.find(j => j.janelaMinutos === 300) ?? candidatas[0] : candidatas[0];
  const anterior = !!(dados?.desatualizado || leitura?.erro);
  const valor = janela ? janela.usadoPercentual.toLocaleString(idiomaInterface(), { maximumFractionDigits: 1 }) + "%" : "";
  const situacao = janela ? anterior ? "Leitura anterior" : tituloLimiteChat(janela) : leitura?.carregando ? "Consultando…" : dados?.motivo === "login_necessario" || dados?.motivo === "login_expirado" ? "Conectar conta" : "Ver limites";
  botao.classList.toggle("atencao", !!janela && janela.usadoPercentual >= 80);
  botao.classList.toggle("critico", !!janela && janela.usadoPercentual >= 95);
  botao.replaceChildren(h("span", { class: "an-chat-uso-topo" }, h("span", null, textoInterface("Uso")), valor ? h("span", null, valor) : null), h("span", { class: "an-chat-uso-janela" }, textoInterface(situacao)));
  if (janela) botao.append(h("span", { class: "an-chat-uso-trilho", "aria-hidden": "true" }, h("span", { style: "width:" + janela.usadoPercentual + "%" })));
  const descricao = janela ? traduzirInterface("{janela}: {valor} usado. {renovacao}", { janela: tituloLimiteChat(janela), valor, renovacao: prazoLimiteChat(janela.redefineEm) }) : traduzirInterface(avisoLimitesChat(leitura));
  botao.title = traduzirInterface("Uso da conta · {agente}. {descricao}", { agente: chatUI.agente, descricao });
  botao.setAttribute("aria-label", traduzirInterface("Visualizar uso da conta. {descricao}", { descricao }));
}
function criarLimitesContaChat(agente: string, leitura: LeituraLimitesChatUI | undefined, ajudaLoginAberta = false): HTMLElement {
  const dados = leitura?.dados;
  const conta = h("div", { class: "an-chat-conta", "aria-label": textoInterface("Limites da conta de {agente}", { agente }) });
  conta.append(h("div", { class: "an-chat-conta-cab" }, h("strong", null, textoInterface("Conta · {agente}", {agente})), dados?.plano ? h("span", { class: "an-chat-conta-plano" }, dados.plano) : null));
  conta.append(h("p", { class: "an-chat-metricas-nota" }, textoInterface("Limites compartilhados pelas sessões desta conta. /compact não renova esses limites.")));
  if (!dados?.disponivel) conta.append(h("p", { class: "an-chat-conta-indisponivel", role: "status" }, textoInterface(leitura?.carregando ? "Consultando os limites da conta…" : avisoLimitesChat(leitura))));
  else {
    if (dados.desatualizado || leitura?.erro) conta.append(h("p", { class: "an-chat-conta-aviso", role: "status" }, textoInterface("Última leitura disponível."), " ", textoInterface(avisoLimitesChat(leitura))));
    else if (dados.aviso) conta.append(h("p", { class: "an-chat-metricas-nota" }, textoInterface(dados.aviso)));
    let grupoAnterior: string | null | undefined;
    for (const janela of dados.janelas) {
      if (janela.grupo && janela.grupo !== grupoAnterior) conta.append(h("h4", { class: "an-chat-conta-grupo" }, grupoLimiteChat(janela.grupo)));
      grupoAnterior = janela.grupo;
      const percentual = janela.usadoPercentual.toLocaleString(idiomaInterface(), { maximumFractionDigits: 1 }) + "%";
      const rotulo = [janela.grupo ? grupoLimiteChat(janela.grupo) : null, tituloLimiteChat(janela)].filter(Boolean).join(" · ");
      conta.append(h("div", { class: "an-chat-conta-janela" + (janela.usadoPercentual >= 95 ? " critico" : janela.usadoPercentual >= 80 ? " atencao" : "") },
        h("div", { class: "an-chat-conta-linha" }, h("strong", null, tituloLimiteChat(janela)), h("span", null, textoInterface("{valor} usado", {valor:percentual}))),
        h("div", { class: "an-chat-conta-trilho", role: "progressbar", "aria-label": textoInterface("Uso da conta · {janela}", { janela: rotulo }), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(janela.usadoPercentual), "aria-valuetext": textoInterface("{valor} usado", { valor: percentual }) }, h("span", { style: "width:" + janela.usadoPercentual + "%" })),
        h("p", { class: "an-chat-conta-renovacao", title: janela.redefineEm && Number.isFinite(Date.parse(janela.redefineEm)) ? new Date(janela.redefineEm).toLocaleString(idiomaInterface(), { timeZoneName: "short" }) : "" }, prazoLimiteChat(janela.redefineEm))));
    }
  }
  if (dados?.agente === "claude" && ["login_necessario", "login_expirado", "sem_permissao"].includes(dados.motivo ?? "")) {
    const ajuda = h("details", { class: "an-chat-conta-login", open: ajudaLoginAberta },
      h("summary", { "data-metrica-acao": "login" }, textoInterface("Como conectar o Claude Code")),
      h("p", null, textoInterface("No terminal do computador que executa o Anotador, faça login com:")),
      h("code", null, "claude auth login"),
      h("p", null, textoInterface("Conclua a autorização no navegador e volte aqui para verificar os limites.")),
      h("a", { href: "https://code.claude.com/docs/en/authentication", target: "_blank", rel: "noopener noreferrer" }, textoInterface("Ajuda de conexão do Claude Code")));
    conta.append(ajuda);
  }
  conta.append(h("button", { type: "button", class: "an-btn an-chat-conta-verificar", "data-metrica-acao": "verificar", disabled: !!leitura?.carregando, onclick: () => {
    if (chatUI.limitesPedido) return;
    if (chatUI.limitesTimer) clearTimeout(chatUI.limitesTimer);
    chatUI.limitesTimer = null;
    void atualizarLimitesContaChat();
  } }, textoInterface(leitura?.carregando ? "Verificando…" : "Verificar novamente")));
  if (leitura?.carregando && dados) conta.append(h("p", { class: "an-chat-metricas-nota", role: "status" }, textoInterface("Atualizando limites…")));
  const rodape = h("div", { class: "an-chat-conta-fonte" });
  if (dados?.atualizadoEm && Number.isFinite(Date.parse(dados.atualizadoEm))) rodape.append(h("p", null, textoInterface("Dados de {instante}", { instante: new Date(dados.atualizadoEm).toLocaleString(idiomaInterface()) })));
  if (leitura?.consultadoEm) rodape.append(h("p", null, textoInterface(dados?.disponivel && !dados.desatualizado && !leitura.erro ? "Consultado em {instante}" : "Última tentativa: {instante}", { instante: new Date(leitura.consultadoEm).toLocaleString(idiomaInterface()) })));
  if (dados) rodape.append(h("p", null, textoInterface("Fonte: {origem}", { origem: traduzirInterface(dados.origem) })));
  conta.append(rodape);
  return conta;
}
function mostrarAjudaCompactChat(): void {
  fecharConfiguracaoChat(false);
  const monitor = chatUI.painel?.querySelector<HTMLDetailsElement>(".an-chat-metricas");
  const ajuda = chatUI.painel?.querySelector<HTMLElement>(".an-chat-compact-ajuda");
  if (!monitor || !ajuda) return;
  monitor.querySelector<HTMLButtonElement>('[data-metrica-aba="sessao"]')?.click();
  monitor.open = true; ajuda.hidden = false;
  ajuda.scrollIntoView({ block: "nearest" });
  ajuda.focus({ preventScroll: true });
}
function renderizarMetricasChat(): void {
  const lugar = chatUI.painel?.querySelector<HTMLElement>(".an-chat-monitor");
  if (!lugar) return;
  const conversa = chatUI.abertura ? null : chatUI.atual, metricas = conversa?.metricas;
  const leituraConta = chatUI.limites.get(chatUI.agente);
  atualizarAtalhoUsoChat(leituraConta);
  const assinatura = JSON.stringify([idiomaInterface(), chatUI.agente, conversa?.id, conversa?.modelo, metricas, !!chatUI.abertura, leituraConta]);
  if (lugar.dataset.assinatura === assinatura) return;
  const aberto = lugar.querySelector<HTMLDetailsElement>("details")?.open ?? false;
  const ajudaAberta = lugar.querySelector<HTMLElement>(".an-chat-compact-ajuda")?.hidden === false;
  const ajudaLoginAberta = lugar.querySelector<HTMLDetailsElement>(".an-chat-conta-login")?.open ?? false;
  const rolagem = lugar.querySelector<HTMLElement>(".an-chat-metricas-corpo")?.scrollTop ?? 0;
  const focoAnterior = lugar.contains(host?.shadowRoot?.activeElement ?? null) ? (host?.shadowRoot?.activeElement as HTMLElement | null)?.dataset.metricaAba : undefined;
  const acaoAnterior = lugar.contains(host?.shadowRoot?.activeElement ?? null) ? (host?.shadowRoot?.activeElement as HTMLElement | null)?.dataset.metricaAcao : undefined;
  const agente = chatUI.agentes.find(a => a.id === chatUI.agente)?.nome ?? chatUI.agente;
  const contexto = metricas?.contexto;
  const percentual = contexto && typeof contexto.percentual === "number" && Number.isFinite(contexto.percentual) && contexto.percentual >= 0 && contexto.usados !== null && contexto.limite !== null && contexto.limite > 0 ? contexto.percentual : null;
  const nivel = percentual === null ? "desconhecido" : percentual >= 95 ? "critico" : percentual >= 80 ? "atencao" : "normal";
  const rotulo = percentual === null ? traduzirInterface("Não informado") : percentual.toLocaleString(idiomaInterface(), { maximumFractionDigits: 1 }) + "%";
  const acumulado = metricas?.acumulado;
  const detalhe = h("details", { class: "an-chat-metricas " + nivel, open: aberto });
  const resumo = h("summary", { title: textoInterface("Ver consumo da sessão, contexto e limites da conta"), "aria-label": textoInterface("Ver detalhes de uso e contexto") },
    h("span", { class: "an-chat-metrica-linha" }, h("strong", null, textoInterface("Uso e contexto")), h("span", { class: "an-chat-contexto-valor", title: textoInterface("Ocupação do contexto da sessão") }, rotulo), h("span", { class: "an-chat-metrica-acao" }, textoInterface("Ver detalhes")), h("span", { class: "an-chat-metrica-expandir", "aria-hidden": "true" }, "⌃")),
    h("span", { class: "an-chat-contexto-trilho", ...(percentual === null ? { "aria-label": textoInterface("O agente não informou a ocupação da janela de contexto") } : { role: "progressbar", "aria-label": textoInterface("Ocupação do contexto informada pelo agente"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.min(100, percentual)), "aria-valuetext": rotulo }) }, h("span", { style: "width:" + (percentual === null ? 0 : Math.min(100, percentual)) + "%" })),
    h("span", { class: "an-chat-consumo-resumo" }, h("span", null, textoInterface("Tokens: {valor}", { valor: numeroMetricaChat(acumulado?.total) })), h("span", null, textoInterface("Custo reportado: {valor}", {valor:moedaMetricaChat(acumulado?.custoUSD)}))));
  detalhe.append(resumo);
  const popup = h("div", { class: "an-chat-metricas-corpo" });
  popup.append(h("div", { class: "an-chat-metricas-cab" }, h("strong", null, textoInterface("Consumo e limites · {agente}", {agente})), h("button", { type: "button", class: "an-ico", "aria-label": textoInterface("Fechar detalhes do consumo"), title: textoInterface("Fechar detalhes do consumo"), html: ICONES.fechar, onclick: () => { detalhe.open = false; resumo.focus(); } })));
  const corpo = h("div", { id: "an-chat-metricas-sessao", class: "an-chat-metricas-sessao", role: "tabpanel", "aria-labelledby": "an-chat-aba-sessao", hidden: chatUI.abaMetricas !== "sessao" });
  const conta = criarLimitesContaChat(agente, leituraConta, ajudaLoginAberta);
  conta.id = "an-chat-metricas-conta"; conta.setAttribute("role", "tabpanel"); conta.setAttribute("aria-labelledby", "an-chat-aba-conta"); conta.hidden = chatUI.abaMetricas !== "conta";
  const abas = h("div", { class: "an-chat-metricas-abas", role: "tablist", "aria-label": textoInterface("Tipo de consumo") });
  const selecionarAba = (aba: "sessao" | "conta"): void => {
    chatUI.abaMetricas = aba;
    popup.scrollTop = 0;
    corpo.hidden = aba !== "sessao"; conta.hidden = aba !== "conta";
    abas.querySelectorAll<HTMLButtonElement>("button").forEach(botao => { const selecionada = botao.dataset.metricaAba === aba; botao.setAttribute("aria-selected", String(selecionada)); botao.tabIndex = selecionada ? 0 : -1; });
  };
  for (const [id, titulo] of [["sessao", "Sessão"], ["conta", "Conta"]] as const) {
    const botao = h("button", { id: "an-chat-aba-" + id, type: "button", role: "tab", "data-metrica-aba": id, "aria-controls": "an-chat-metricas-" + id, "aria-selected": String(chatUI.abaMetricas === id), tabindex: chatUI.abaMetricas === id ? 0 : -1, onclick: () => selecionarAba(id) }, textoInterface(titulo));
    botao.addEventListener("keydown", evento => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(evento.key)) return;
      evento.preventDefault();
      const destino = evento.key === "Home" ? "sessao" : evento.key === "End" ? "conta" : id === "sessao" ? "conta" : "sessao";
      selecionarAba(destino); abas.querySelector<HTMLButtonElement>('[data-metrica-aba="' + destino + '"]')?.focus();
    });
    abas.append(botao);
  }
  popup.append(abas, corpo, conta);
  corpo.append(h("strong", { class: "an-chat-sessao-titulo" }, textoInterface("Uso desta sessão")));
  const grade = h("dl", { class: "an-chat-metricas-grade" });
  const item = (nome: string, valor: string): void => { grade.append(h("div", null, h("dt", null, textoInterface(nome)), h("dd", null, valor))); };
  item("Entrada acumulada", numeroMetricaChat(acumulado?.entrada)); item("Saída acumulada", numeroMetricaChat(acumulado?.saida));
  item("Leitura de cache", numeroMetricaChat(acumulado?.cacheLeitura)); item("Escrita de cache", numeroMetricaChat(acumulado?.cacheEscrita));
  item("Raciocínio", numeroMetricaChat(acumulado?.raciocinio)); item("Custo reportado", moedaMetricaChat(acumulado?.custoUSD));
  item("Contexto usado", numeroMetricaChat(contexto?.usados)); item("Janela do modelo", numeroMetricaChat(contexto?.limite));
  if (metricas?.ultimoTurno) { item("Último turno · tokens", numeroMetricaChat(metricas.ultimoTurno.total)); item("Último turno · custo", moedaMetricaChat(metricas.ultimoTurno.custoUSD)); }
  corpo.append(grade);
  if (contexto?.base) corpo.append(h("p", { class: "an-chat-metricas-nota" }, textoInterface(contexto.base === "ultima_entrada" ? "Contexto medido na última entrada do agente; a próxima mensagem ainda não está incluída." : "Contexto do último evento de uso informado pelo agente.")));
  if (metricas?.atualizadoEm && Number.isFinite(Date.parse(metricas.atualizadoEm))) corpo.append(h("p", { class: "an-chat-metricas-nota" }, textoInterface("Consulta do consumo: {instante}", { instante: new Date(metricas.atualizadoEm).toLocaleString(idiomaInterface()) })));
  if (contexto?.atualizadoEm && Number.isFinite(Date.parse(contexto.atualizadoEm))) corpo.append(h("p", { class: "an-chat-metricas-nota" }, textoInterface("Medição do contexto: {instante}", { instante: new Date(contexto.atualizadoEm).toLocaleString(idiomaInterface()) })));
  const cobertura = metricas?.cobertura === "sessao" ? "Histórico disponível da sessão." : metricas?.cobertura === "chat" ? "Uso registrado neste chat; pode não incluir o histórico anterior." : "Cobertura parcial: o agente não informou todos os valores.";
  corpo.append(h("p", { class: "an-chat-metricas-nota" }, metricas ? [textoInterface(cobertura), " ", textoInterface("Cache e raciocínio são reportados pelo agente e não são somados novamente ao total. O custo reportado pelo agente não é uma fatura.")] : textoInterface("Este agente ainda não informou o consumo. Valores ausentes não significam consumo zero.")));
  const compactVerificado = chatUI.agente === "claude" || chatUI.agente === "codex";
  const recomendacao = compactVerificado ? "Considere /compact" : "Verifique os recursos de compactação do agente";
  const orientacao = percentual === null ? "Sem uma medida de contexto, não é possível avaliar se /compact é necessário." : percentual >= 95 ? "Contexto próximo do limite. " + recomendacao + " antes de continuar." : percentual >= 80 ? "O contexto está ficando cheio. " + recomendacao + " se a conversa vai continuar." : "Há espaço no contexto. Não há indicação de compactar pelo uso atual.";
  corpo.append(h("p", { class: "an-chat-compact-orientacao" }, textoInterface(orientacao)), h("p", { class: "an-chat-metricas-nota" }, textoInterface("Avisos do Anotador em 80% e 95%. Consumo acumulado não representa o contexto atual.")), h("button", { type: "button", class: "an-btn an-chat-compact", onclick: mostrarAjudaCompactChat }, textoInterface("Sobre /compact")));
  const ajuda = h("div", { class: "an-chat-compact-ajuda", hidden: !ajudaAberta, tabindex: -1 });
  ajuda.append(h("strong", null, textoInterface("Compactação · {agente}", { agente })), h("p", null, textoInterface(compactVerificado
    ? "Retome esta mesma sessão no {agente} e use /compact. A compactação resume o histórico e pode reduzir detalhes."
    : "O suporte a /compact no {agente} não foi verificado. Consulte os recursos de contexto desse agente antes de usar o comando.", { agente })));
  if (conversa?.sessaoExterna) ajuda.append(h("p", null, textoInterface("Sessão nativa:")), h("code", null, conversa.sessaoExterna));
  else ajuda.append(h("p", null, textoInterface("A sessão nativa ainda não foi identificada. Não execute /compact em outra conversa esperando alterar esta.")));
  ajuda.append(h("p", null, textoInterface("Esta orientação não executa comandos nem envia mensagens.")));
  corpo.append(ajuda);
  if (chatUI.abertura) corpo.replaceChildren(h("p", { class: "an-chat-metricas-nota an-chat-monitor-pendente", role: "note" }, textoInterface("Abra a sessão para consultar consumo e contexto.")));
  detalhe.append(popup); lugar.replaceChildren(detalhe); lugar.dataset.assinatura = assinatura;
  popup.scrollTop = rolagem;
  if (focoAnterior) abas.querySelector<HTMLButtonElement>('[data-metrica-aba="' + focoAnterior + '"]')?.focus({ preventScroll: true });
  if (acaoAnterior) conta.querySelector<HTMLElement>('[data-metrica-acao="' + acaoAnterior + '"]')?.focus({ preventScroll: true });
}
// Recalcula datas, números e estados compostos, preservando o compositor do chat.
idiomasInterface?.observar(renderizarMetricasChat);

async function enviarChat(): Promise<void> {
  const campo = chatUI.painel?.querySelector<HTMLTextAreaElement>("textarea");
  const texto = campo?.value.trim();
  if (!texto || ditandoNoChat() || chatUI.preparando || chatUI.enviando || chatUI.configurando || chatUI.carregando || chatUI.abertura || chatUI.atual?.ocupada || chatUI.atual?.somenteLeitura) return;
  if (texto.length > 16000) { erroChat("Escreva uma mensagem de até 16.000 caracteres."); return; }
  const geracao = chatUI.geracao, chaveOrigem = chaveRascunhoChat(), agente = chatUI.agente;
  chatUI.preparando = true;
  try { if (await tratarComandoLocalChat(texto)) return; }
  finally { chatUI.preparando = false; }
  if (geracao !== chatUI.geracao || chaveOrigem !== chaveRascunhoChat()) return;
  chatUI.enviando = true;
  guardarRascunhoChat();
  let conversa = chatUI.atual;
  renderizarMensagensChat();
  try {
    if (!conversa) {
      const dados = await apiChat("/sessoes", { agente: chatUI.agente, modelo: chatUI.modelo || null, esforco: chatUI.esforco || null });
      conversa = validarConversaChat(dados, agente);
      // Guarda a sessão antes do envio para repetir em caso de falha sem criar outra.
      const rascunho = chatUI.rascunhos.get(chaveOrigem) ?? texto;
      chatUI.rascunhos.delete(chaveOrigem);
      if (chaveRascunhoChat() === chaveOrigem) chatUI.atual = conversa;
      chatUI.rascunhos.set(conversa.id, rascunho);
      atualizarResumoChat(conversa);
      persistirRascunhosChat();
    }
    const dados = await apiChat("/sessoes/" + encodeURIComponent(conversa.id) + "/mensagens", { agente, texto });
    const aceita = validarConversaChat(dados, agente, conversa.id);
    // A resposta pertence à sessão de origem mesmo que o painel tenha sido fechado
    // ou recriado. Nunca leia o textarea antigo, que pode já ter sido substituído.
    const rascunho = chatUI.rascunhos.get(conversa.id) ?? "";
    if (rascunho.trim() === texto) chatUI.rascunhos.set(conversa.id, "");
    atualizarResumoChat(aceita);
    chatUI.enviando = false;
    if (chatUI.atual?.id === conversa.id) {
      chatUI.atual = aceita;
      const atual = chatUI.painel?.querySelector<HTMLTextAreaElement>(".an-chat-entrada textarea");
      if (atual) atual.value = chatUI.rascunhos.get(conversa.id) ?? "";
      renderizarMensagensChat();
      if (geracao === chatUI.geracao) atual?.focus();
      agendarChat();
    }
    persistirRascunhosChat();
  } catch (erro) {
    chatUI.enviando = false;
    if (geracao === chatUI.geracao || conversa && chatUI.atual?.id === conversa.id) { renderizarChat(); erroChat(erro); }
  } finally { chatUI.enviando = false; }
}
function agendarChat(): void {
  if (chatUI.timer) clearTimeout(chatUI.timer);
  chatUI.timer = null;
  const leitura = ++chatUI.geracaoLeitura;
  if (!chatUI.atual || chatUI.abertura || chatUI.carregando || chatUI.painel?.hidden || !raiz || raiz.hidden) return;
  const id = chatUI.atual.id, geracao = chatUI.geracao, agente = chatUI.agente;
  const atual = (): boolean => geracao === chatUI.geracao && leitura === chatUI.geracaoLeitura && chatUI.atual?.id === id && !chatUI.painel?.hidden && !!raiz && !raiz.hidden;
  chatUI.timer = setTimeout(async () => {
    if (!atual()) return;
    chatUI.timer = null;
    try {
      const dados = await apiChat(caminhoSessaoChat(id, agente));
      if (!atual()) return;
      chatUI.atual = validarConversaChat(dados, agente, id);
      atualizarResumoChat(chatUI.atual);
      renderizarMensagensChat();
    } catch (erro) { if (atual()) erroChat(erro); }
    if (atual()) agendarChat();
  }, chatUI.atual.ocupada || chatUI.atual.avaliacao?.emAndamento ? 1000 : 5000);
}

// Markdown limitado, criado com nós de texto: HTML da resposta nunca vira código.
function formatarMensagemChat(texto: string): HTMLDivElement {
  const raizTexto = h("div", { class: "an-chat-texto" });
  const inline = (no: HTMLElement, textoInline: string): void => {
    const partes = textoInline.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g);
    for (const parte of partes) {
      if (parte.startsWith("`") && parte.endsWith("`")) no.append(h("code", null, parte.slice(1,-1)));
      else if (parte.startsWith("**") && parte.endsWith("**")) no.append(h("b", null, parte.slice(2,-2)));
      else {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(parte);
        if (link && /^https?:\/\//i.test(link[2] ?? "")) no.append(h("a", { href: link[2], target: "_blank", rel: "noopener noreferrer" }, link[1] ?? ""));
        else no.append(document.createTextNode(parte));
      }
    }
  };
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");
  for (let i=0; i<linhas.length; i++) {
    const linha = linhas[i] ?? "";
    if (/^\s*```/.test(linha)) {
      const linguagem = linha.trim().slice(3).trim().slice(0,40);
      const codigo: string[] = [];
      while (++i < linhas.length && !/^\s*```/.test(linhas[i] ?? "")) codigo.push(linhas[i] ?? "");
      const copiar = h("button", { type: "button", class: "an-chat-copiar" }, textoInterface("Copiar código"));
      copiar.addEventListener("click", async () => {
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(codigo.join("\n"));
          else {
            const campo = h("textarea", { value: codigo.join("\n"), style: "position:fixed;left:-9999px" });
            raiz?.append(campo); campo.select();
            const ok = document.execCommand("copy"); campo.remove();
            if (!ok) throw new Error();
          }
          definirTextoInterface(copiar, "Copiado");
          setTimeout(() => { if(copiar.isConnected) definirTextoInterface(copiar, "Copiar código"); },2000);
        } catch { avisar("Selecione o código e copie pelo navegador."); }
      });
      raizTexto.append(h("div", { class: "an-chat-codigo" }, h("div", { class: "an-chat-codigo-cab" }, h("span", null, linguagem || "Código"), copiar), h("pre", null, h("code", null, codigo.join("\n")))));
    } else if (!linha.trim()) continue;
    else if (/^\s*\|?.+\|.+/.test(linha) && /^\s*\|?\s*:?-{3,}/.test(linhas[i+1] ?? "")) {
      const celulas = (l: string): string[] => l.trim().replace(/^\||\|$/g, "").split("|").map((v)=>v.trim());
      const tabela=h("table"), cab=h("tr");
      for (const valor of celulas(linha)) { const th=h("th"); inline(th,valor); cab.append(th); }
      tabela.append(h("thead",null,cab));
      const corpo=h("tbody"); i++;
      while(i+1<linhas.length && (linhas[i+1]??"").includes("|") && (linhas[i+1]??"").trim()) {
        const tr=h("tr"); for(const valor of celulas(linhas[++i]??"")){const td=h("td"); inline(td,valor);tr.append(td)}corpo.append(tr);
      }
      tabela.append(corpo);raizTexto.append(h("div",{class:"an-chat-tabela"},tabela));
    } else if (/^#{1,6}\s/.test(linha)) {
      const titulo=h("h3"); inline(titulo,linha.replace(/^#{1,6}\s+/,""));raizTexto.append(titulo);
    } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(linha)) {
      const ordenada=/^\s*\d+\./.test(linha), lista=ordenada?h("ol"):h("ul");
      const item=(l:string):void=>{const li=h("li");inline(li,l.replace(/^\s*(?:[-*]|\d+\.)\s+/,""));lista.append(li)};
      item(linha);
      while(i+1<linhas.length && (ordenada?/^\s*\d+\.\s+/:/^\s*[-*]\s+/).test(linhas[i+1]??""))item(linhas[++i]??"");
      raizTexto.append(lista);
    } else if (/^>\s?/.test(linha)) {
      const citacao=h("blockquote");inline(citacao,linha.replace(/^>\s?/,""));raizTexto.append(citacao);
    } else {
      const p=h("p");inline(p,linha);raizTexto.append(p);
    }
  }
  return raizTexto;
}

interface ComandoChatUI { nome: string; descricao: string; origem: string; tipo: string; suporte?: "chat" | "terminal"; motivo?: string }
const comandosChatPorAgente = new Map<string, { em: number; lista: ComandoChatUI[] }>();
const consultasComandosChat = new Map<string, Promise<ComandoChatUI[]>>();
async function carregarComandosDoChat(agente: string): Promise<ComandoChatUI[]> {
  const salvo = comandosChatPorAgente.get(agente);
  if (salvo && Date.now() - salvo.em < 30_000) return salvo.lista;
  const emAndamento = consultasComandosChat.get(agente);
  if (emAndamento) return emAndamento;
  const pedido = (async () => {
    const dados = await apiChat("/comandos?agente=" + encodeURIComponent(agente));
    const lista = (Array.isArray(dados.comandos) ? dados.comandos : []) as ComandoChatUI[];
    comandosChatPorAgente.set(agente, { em: Date.now(), lista });
    return lista;
  })();
  consultasComandosChat.set(agente, pedido);
  try { return await pedido; }
  finally { if (consultasComandosChat.get(agente) === pedido) consultasComandosChat.delete(agente); }
}
function comandoPersonalizadoChat(comando: ComandoChatUI): boolean { return comando.tipo !== "nativo"; }
const comandosLocaisChat: ComandoChatUI[] = [
  {nome:"model",descricao:"Escolher o modelo desta conversa",origem:"Chat",tipo:"nativo",suporte:"chat"},
  {nome:"effort",descricao:"Ajustar o nível de raciocínio do modelo",origem:"Chat",tipo:"nativo",suporte:"chat"},
  {nome:"new",descricao:"Começar outra conversa, preservando o histórico",origem:"Chat",tipo:"nativo",suporte:"chat"},
  {nome:"resume",descricao:"Ver as sessões existentes deste agente",origem:"Chat",tipo:"nativo",suporte:"chat"},
  {nome:"compact",descricao:"Consultar o contexto e a orientação de compactação desta sessão",origem:"Chat",tipo:"nativo",suporte:"chat"},
  {nome:"help",descricao:"Ver e pesquisar todos os comandos disponíveis",origem:"Chat",tipo:"nativo",suporte:"chat"},
];
function ligarComandosChat(campo: HTMLTextAreaElement, entrada: HTMLElement): { teclado: (e: KeyboardEvent) => boolean; abrir: () => void } {
  const menu = h("div", { class: "an-chat-comandos", hidden: true, role: "listbox", "aria-label": textoInterface("Comandos do agente") });
  const agente = chatUI.agente;
  let lista = comandosChatPorAgente.get(agente)?.lista ?? [], carregando = false, falha = "", visiveis: ComandoChatUI[] = [], foco = 0, manual = false;
  const rotulo = (c: ComandoChatUI): string => c.suporte === "terminal" ? "No terminal" : c.origem;
  const escolher = (c: ComandoChatUI): void => {
    if(c.suporte === "terminal") { erroChat(c.motivo || "Este comando abre controles próprios do terminal. Use-o no agente instalado."); return; }
    const trecho = campo.value.startsWith("/") ? "" : campo.value;
    campo.value = "/" + c.nome + " " + trecho;
    menu.hidden = true; manual = false;
    campo.focus(); campo.dispatchEvent(new Event("input", {bubbles:true}));
  };
  const pintar = (): void => {
    if(!campo.isConnected) return;
    const termo = /^\/([^\s]*)$/.exec(campo.value)?.[1]?.toLocaleLowerCase();
    if(!manual && termo === undefined){menu.hidden=true;return}
    const porNome = new Map(lista.map(c=>[c.nome,c]));
    for(const c of comandosLocaisChat) {
      // Nomes instalados pertencem ao agente; os controles do chat ganham namespace.
      // Até confirmar o catálogo, o alias explícito também evita uma escolha ambígua.
      const colisao = lista.some(outro => outro.nome === c.nome && comandoPersonalizadoChat(outro));
      const nome = colisao || !comandosChatPorAgente.has(agente) ? "chat:" + c.nome : c.nome;
      porNome.set(nome, { ...c, nome });
    }
    visiveis=Array.from(porNome.values()).filter(c=>!termo || c.nome.toLocaleLowerCase().includes(termo) || c.descricao.toLocaleLowerCase().includes(termo));
    foco=Math.min(foco,Math.max(0,visiveis.length-1));
    const cab=h("div",{class:"an-chat-comandos-cab"},h("strong",null,carregando?"Carregando comandos…":`${visiveis.length} comandos · ${chatUI.agentes.find(a=>a.id===agente)?.nome??agente}`),h("button",{type:"button",class:"an-ico",title:textoInterface("Fechar comandos"),html:ICONES.fechar,onclick:()=>{menu.hidden=true;manual=false;campo.focus()}}));
    const corpo=h("div",{class:"an-chat-comandos-lista"});
    visiveis.forEach((c,i)=>{
      const item=h("button",{type:"button",role:"option",class:"an-chat-comando"+(i===foco?" foco":""),"aria-selected":String(i===foco),"aria-disabled":String(c.suporte==="terminal"),title:c.motivo??c.descricao,onclick:()=>escolher(c)},h("span",{class:"an-chat-comando-topo"},h("strong",null,"/"+c.nome),h("small",null,rotulo(c))),h("span",{class:"an-chat-comando-desc"},c.descricao));
      corpo.append(item);
    });
    if(!visiveis.length) corpo.append(h("p",{class:"an-chat-sub"},falha||"Nenhum comando encontrado para essa busca."));
    if(falha) corpo.append(h("p",{class:"an-chat-sub"},falha));
    menu.replaceChildren(cab,corpo);menu.hidden=false;
  };
  const carregar = async (): Promise<void> => {
    if(carregando){pintar();return}
    const salvo=comandosChatPorAgente.get(agente);
    if(salvo && Date.now()-salvo.em<30000){lista=salvo.lista;pintar();return}
    carregando=true;pintar();
    try { lista=await carregarComandosDoChat(agente);falha=""; }
    catch(erro){falha=erro instanceof Error?erro.message:"Não consegui listar os comandos."}
    finally{carregando=false;pintar()}
  };
  const atualizar=():void=>{manual=false;foco=0;pintar();if(!menu.hidden)void carregar()};
  campo.addEventListener("input",atualizar);
  campo.addEventListener("blur",()=>setTimeout(()=>{if(!menu.contains(host?.shadowRoot?.activeElement??null)) {menu.hidden=true;manual=false}},150));
  entrada.append(menu);
  return {
    abrir:()=>{fecharConfiguracaoChat(false);manual=true;foco=0;campo.focus();pintar();void carregar()},
    teclado:(e:KeyboardEvent):boolean=>{
      if(menu.hidden)return false;
      if(e.key==="Escape"){menu.hidden=true;manual=false;e.preventDefault();e.stopPropagation();return true}
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){
        e.preventDefault();foco=(foco+(e.key==="ArrowDown"?1:visiveis.length-1))%Math.max(1,visiveis.length);
        const itens=menu.querySelectorAll<HTMLElement>(".an-chat-comando");itens.forEach((item,i)=>{item.classList.toggle("foco",i===foco);item.setAttribute("aria-selected",String(i===foco))});itens[foco]?.scrollIntoView({block:"nearest"});return true;
      }
      if((e.key==="Enter"&&!e.shiftKey)||e.key==="Tab") { const c=visiveis[foco];if(c){e.preventDefault();escolher(c);return true} }
      return false;
    },
  };
}
async function tratarComandoLocalChat(texto: string): Promise<boolean> {
  const match=/^\/(chat:)?(model|effort|new|resume|compact|help)(?:\s+(.*))?$/s.exec(texto);
  if(!match)return false;
  const nome=match[2],arg=(match[3]??"").trim();
  const agenteSelecionado = chatUI.agente, geracao = chatUI.geracao;
  const campo=chatUI.painel?.querySelector<HTMLTextAreaElement>("textarea");
  if (!match[1]) {
    try {
      const catalogo = await carregarComandosDoChat(agenteSelecionado);
      if (geracao !== chatUI.geracao || agenteSelecionado !== chatUI.agente) return true;
      if (catalogo.some(c => c.nome === nome && comandoPersonalizadoChat(c))) return false;
    } catch {
      if (geracao === chatUI.geracao && agenteSelecionado === chatUI.agente) erroChat("Não consegui verificar os comandos deste agente. Seu texto foi mantido. Tente novamente ou use /chat:" + nome + " para o controle do chat.");
      return true;
    }
  }
  const limpar=():void=>{if(campo && campo.value.trim() === texto){campo.value="";campo.dispatchEvent(new Event("input",{bubbles:true}))}};
  if(nome==="new"){limpar();novaConversaChat();return true}
  if(nome==="resume"){limpar();const lista=chatUI.painel?.querySelector<HTMLDetailsElement>("details");if(lista){lista.open=true;lista.querySelector<HTMLElement>("summary")?.focus()}return true}
  if(nome==="compact"){limpar();mostrarAjudaCompactChat();return true}
  if(nome==="help"){limpar();chatUI.painel?.querySelector<HTMLButtonElement>(".an-chat-comandos-abrir")?.click();return true}
  const agente=chatUI.agentes.find(a=>a.id===chatUI.agente);
  const rotulo=nome==="model"?"Modelo da conversa":"Raciocínio";
  if(!arg){
    abrirConfiguracaoChat(false);
    const botao=chatUI.painel?.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${rotulo}"]`);
    if(botao){limpar();botao.click()}else erroChat("Este modelo não oferece ajuste separado de raciocínio.");
    return true;
  }
  if(nome==="model"){
    const modelo=arg==="default"||arg==="padrao"?"":agente?.modelos.find(m=>m.valor===arg||m.titulo.toLowerCase()===arg.toLowerCase())?.valor;
    if(modelo===undefined){erroChat("Escolha um dos modelos disponíveis no menu desta conversa.");return true}
    limpar();void configurarChat(modelo,"");return true;
  }
  const esforcos=(agente?.modelos.find(m=>m.valor===chatUI.modelo)??(!chatUI.modelo?agente?.modelos.find(m=>m.padrao):undefined))?.esforcos??[];
  const nivel=arg==="default"||arg==="padrao"?"":arg;
  if(nivel&&!esforcos.includes(nivel)){erroChat("Escolha um nível de raciocínio disponível para este modelo.");return true}
  limpar();void configurarChat(chatUI.modelo,nivel);return true;
}

// Lotes não contêm uma identidade de sessão do CLI: o usuário escolhe uma sessão
// real do autor, sem atribuir automaticamente o lote a uma conversa já aberta.
async function abrirChatDoLote(agenteNome: string, destino: "sessoes" | "conta" | "configuracao"): Promise<boolean> {
  if (chatUI.enviando || chatUI.configurando || chatUI.carregando) { avisar(traduzirInterface("Aguarde a operação do chat terminar.")); return false; }
  if (!chatUI.painel || chatUI.painel.hidden) await alternarChat();
  const nome = agenteNome.trim().toLowerCase();
  const agente = chatUI.agentes.find(a => a.id === nome || a.nome.toLowerCase() === nome);
  if (!agente) { erroChat(traduzirInterface("Este agente não está disponível no chat. Escolha um agente na configuração.")); abrirConfiguracaoChat(); return false; }
  if (chatUI.agente !== agente.id) await trocarAgenteChat(agente.id);
  if (chatUI.agente !== agente.id || chatUI.carregando || chatUI.painel?.hidden) return false;
  if (destino === "conta") abrirUsoContaChat();
  else if (destino === "configuracao") abrirConfiguracaoChat();
  else {
    fecharConfiguracaoChat(false);
    const historico = chatUI.painel?.querySelector<HTMLDetailsElement>(".an-chat-historico");
    if (historico) { historico.open = true; historico.querySelector("summary")?.focus({ preventScroll: true }); }
  }
  const status = chatUI.painel?.querySelector<HTMLElement>(".an-chat-status");
  if (status && !chatUI.abertura) { status.classList.remove("erro"); status.textContent = traduzirInterface("Escolha uma sessão do agente para consultar mensagens, consumo e contexto. O lote permanece no seu histórico."); }
  return true;
}
