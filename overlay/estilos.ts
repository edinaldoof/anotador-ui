const CSS_OVERLAY = `
:host {
  all: initial;
  --an-fonte: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Helvetica Neue", "Segoe UI", Roboto, system-ui, sans-serif;
  --an-fonte-mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  font-family: var(--an-fonte);
  /* ---------- paleta do anotador ----------
     Cores sólidas e nomeadas. Só três lugares guardam transparência, e por necessidade:
     sombra, anel de foco e a caixa que marca o elemento na página (precisa deixar ver o que está sob ela). */
  --an-fundo: #1a1e1d;
  --an-superficie: #212625;
  --an-superficie-alta: #2b302f;
  --an-borda: #373d3c;
  --an-borda-forte: #4c5453;
  --an-texto: #dde2e0;
  /* Secundário e terciário calculados pelo WCAG, não no olho: o terciário mede 4,61:1 na
     superfície mais clara (--an-superficie-alta), o pior caso; o secundário, 6:1. A
     régua que o Anotador aplica aos outros vale para a interface dele. */
  --an-texto-2: #a8afad;
  --an-texto-3: #929997;
  --an-sobre-cor: #ffffff;

  --an-marca: #2f6df6;
  --an-marca-forte: #1f5ae0;
  --an-marca-clara: #8fb0ff;
  --an-marca-fundo: #1e2a40;

  --an-ok: #2f9e6a;
  --an-ok-claro: #7ee2b0;
  --an-ok-fundo: #1b3626;

  --an-aviso: #d99a2b;
  --an-aviso-claro: #f2c14e;
  --an-aviso-fundo: #362c14;

  --an-erro: #e05a52;
  --an-erro-claro: #f28b82;
  --an-erro-fundo: #3d2221;

  /* Transparência só onde ela é necessária: sombra, anel de foco e a marcação sobre a página. */
  --an-sombra: 0 8px 30px rgba(0, 0, 0, .35);
  --an-sombra-alta: 0 16px 50px rgba(0, 0, 0, .45);
  --an-foco: 0 0 0 3px rgba(143, 176, 255, .18);
  --an-marcacao: rgba(47, 109, 246, .12);
}
*, *::before, *::after { box-sizing: border-box; }
.an-raiz {
  position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font-size: 13px; line-height: 1.4; color: var(--an-texto);
  font-family: var(--an-fonte);
}
[hidden] { display: none !important; }
.arrastando, .arrastando * { cursor: grabbing !important; user-select: none !important; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; background: transparent; }
.mono { font-family: var(--an-fonte-mono); }
.an-alca { width: 22px; height: 30px; border-radius: 999px; display: grid; place-items: center; color: var(--an-texto-2); cursor: grab; touch-action: none; user-select: none; flex: none; }
.an-alca:hover { color: var(--an-sobre-cor); background: var(--an-superficie-alta); }
.an-alca svg { width: 16px; height: 16px; }

.an-caixa {
  position: fixed; pointer-events: none; border: 2px solid var(--an-marca);
  background: var(--an-marcacao); border-radius: 3px; display: none;
}
.an-caixa.selecao { border-color: var(--an-marca); background: transparent; }
.an-dica {
  position: fixed; pointer-events: none; background: var(--an-fundo); color: var(--an-sobre-cor); padding: 2px 8px;
  border-radius: 4px; display: none; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; font-family: var(--an-fonte-mono);
}

.an-barra {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px; width: max-content; min-height: 44px; padding: 6px 7px 6px 6px; line-height: 1;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 999px;
  box-shadow: var(--an-sombra); white-space: nowrap; max-width: calc(100vw - 24px);
}
.an-barra > * { flex: none; }
.an-sep { width: 1px; height: 18px; background: var(--an-borda); margin: 0 3px; }
.an-barra .titulo { display: flex; flex: 0 1 auto; min-width: 0; align-items: center; gap: 6px; height: 30px; padding: 0 6px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; cursor: grab; user-select: none; }
.an-barra .titulo .url { font-weight: 400; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; }
.an-barra .titulo:focus-visible { outline: 2px solid var(--an-marca); outline-offset: -2px; border-radius: 7px; }
.an-barra .an-titulo-prefixo { flex: none; }
.an-tooltip-url { position: fixed; z-index: 60; pointer-events: auto; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; padding: 13px 15px; border: 1px solid var(--an-borda-forte); border-radius: 13px; background: var(--an-fundo); color: var(--an-texto); box-shadow: var(--an-sombra-alta); white-space: normal; line-height: 1.55; user-select: text; overscroll-behavior: contain; scrollbar-width: thin; }
.an-url-rotulo { display: block; margin-bottom: 5px; color: var(--an-texto-2); font-size: 12px; font-weight: 600; letter-spacing: .03em; }
.an-url-completa { display: block; font-family: var(--an-fonte-mono); font-size: 12px; overflow-wrap: anywhere; word-break: break-word; user-select: text; }
.an-barra .an-alca { color: var(--an-texto-2); }
.an-barra > .an-alca { padding: 0; }
.an-barra > .an-alca svg { display: block; }
.an-ico { width: 30px; height: 30px; border-radius: 999px; display: grid; place-items: center; color: var(--an-texto); flex: none; }
.an-ico:hover { background: var(--an-superficie-alta); color: var(--an-sobre-cor); }
.an-ico:disabled { opacity: .3; cursor: default; background: transparent; }
.an-ico svg { width: 16px; height: 16px; }
.an-modo { display: flex; align-items: center; height: 30px; padding: 2px; background: var(--an-superficie-alta); border-radius: 999px; }
.an-modo button { height: 26px; padding: 0 11px; border-radius: 999px; color: var(--an-texto-2); font-size: 12px; font-weight: 700; line-height: 26px; }
.an-modo button:hover { color: var(--an-sobre-cor); }
.an-modo button.ativo { background: var(--an-borda); color: var(--an-sobre-cor); }
.an-enviar {
  display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px 0 14px; border-radius: 999px;
  /* Texto escuro sobre o verde (4,99:1), como o botão de enviar do chat: branco dava 3,38:1. */
  background: var(--an-ok); color: var(--an-fundo); font-weight: 700; font-size: 13px;
}
.an-enviar:hover { background: var(--an-ok); }
.an-enviar:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-enviar .n { background: var(--an-ok-fundo); color: var(--an-ok-claro); border-radius: 999px; min-width: 18px; height: 18px; padding: 0 6px; display: grid; place-items: center; font-size: 12px; line-height: 1; }
.an-enviar:disabled .n { background: var(--an-borda); }
.an-estado {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 10px; border-radius: 999px;
  background: var(--an-superficie-alta); color: var(--an-texto); font-size: 12px; font-weight: 700; max-width: min(300px, 100%);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1;
}
.an-estado::before { content: ""; width: 8px; height: 8px; border-radius: 999px; background: currentColor; flex: none; animation: an-pulsar 1.6s ease-in-out infinite; }
.an-estado:hover { filter: brightness(1.12); }
.an-estado:empty { display: none; }
.an-estado.ok { background: var(--an-ok-fundo); color: var(--an-ok-claro); }
.an-estado.ok::before { animation: none; }
.an-estado.andamento { background: var(--an-aviso-fundo); color: var(--an-aviso-claro); }
.an-estado.erro { background: var(--an-erro-fundo); color: var(--an-erro-claro); }
.an-estado.erro::before { animation: none; }
@keyframes an-pulsar { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

.an-pin {
  position: fixed; pointer-events: auto; width: 24px; height: 24px; border-radius: 999px;
  background: var(--an-marca); color: var(--an-sobre-cor); display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 2px solid var(--an-sobre-cor); box-shadow: var(--an-sombra); transform: translate(-50%, -50%);
}
.an-pin.enviado { background: var(--an-ok); }
.an-pin.perdido { background: var(--an-texto-3); }
.an-pin:hover { transform: translate(-50%, -50%) scale(1.08); }
.an-balao {
  position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 4px;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 999px; padding: 4px 6px;
  box-shadow: var(--an-sombra); min-width: 300px; max-width: min(520px, calc(100vw - 24px));
}
.an-balao input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; padding: 6px 4px; color: var(--an-sobre-cor); }
.an-balao input::placeholder { color: var(--an-texto-2); }
.an-ico.grav { color: var(--an-erro-claro); }

.an-painel {
  /* Abaixo da barra real (--an-topo-paineis, atualizada quando ela muda de altura). */
  position: fixed; right: 14px; top: var(--an-topo-paineis, 62px); width: min(380px, calc(100vw - 28px)); max-height: calc(100vh - var(--an-topo-paineis, 62px) - 12px);
  pointer-events: auto; display: flex; flex-direction: column;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 18px; box-shadow: var(--an-sombra-alta);
  overflow: hidden;
}
.an-painel .cab { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; }
.an-painel .cab .an-ico { background: var(--an-superficie-alta); }
.an-painel .cab textarea {
  flex: 1; resize: none; background: transparent; border: 0; outline: 0; color: var(--an-sobre-cor); min-height: 24px; max-height: 96px; padding: 4px 2px;
}
.an-painel .cab textarea::placeholder { color: var(--an-texto-2); }
.an-painel .sub {
  display: flex; align-items: center; justify-content: space-between; padding: 6px 14px 8px; border-bottom: 1px solid var(--an-superficie-alta);
  background: var(--an-superficie); cursor: grab; user-select: none;
}
.an-painel .sub .acoes { display: flex; align-items: center; gap: 2px; }
.an-painel .sub .tag { font-weight: 700; }
.an-painel .sub .comp { color: var(--an-texto-2); font-size: 12px; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; display: inline-block; vertical-align: bottom; }
.an-painel .corpo { overflow: auto; padding: 4px 14px 8px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-secao { padding: 8px 0; border-bottom: 1px solid var(--an-superficie-alta); }
.an-secao:last-child { border-bottom: 0; }
.an-linha { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 176px); align-items: center; gap: 10px; min-height: 40px; }
.an-linha.larga { grid-template-columns: minmax(0, 1fr) minmax(160px, 236px); }
.an-linha > * { min-width: 0; }
@media (max-width: 480px) {
  .an-linha, .an-linha.larga { grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 4px 0; }
}
.an-linha label { color: var(--an-texto); }
.an-linha label .sub { color: var(--an-texto-2); font-size: 12px; display: block; background: transparent; border: 0; padding: 0; }
.an-campo {
  display: flex; align-items: center; gap: 6px; background: var(--an-superficie-alta); border: 1px solid var(--an-borda); border-radius: 10px; padding: 0 10px; height: 34px;
}
.an-campo:focus-within { border-color: var(--an-marca-clara); }
/* width: 0 zera a largura intrínseca do input (size=20 ≈ 190px), que senão dita o mínimo da coluna do grid. */
.an-campo input, .an-campo select { flex: 1 1 0; width: 0; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--an-sobre-cor); height: 100%; }
.an-campo select option { background: var(--an-superficie-alta); color: var(--an-sobre-cor); }
.an-campo input.mono, .an-campo select { font-size: 13px; }
.an-campo .un { color: var(--an-texto-2); font-size: 12px; }
.an-campo .sw { width: 18px; height: 18px; border-radius: 999px; border: 2px solid var(--an-borda-forte); flex: none; position: relative; overflow: hidden; }
.an-campo .sw input[type=color] { position: absolute; inset: -8px; width: 40px; height: 40px; padding: 0; border: 0; cursor: pointer; opacity: 0; }
.an-campo.alterado { border-color: var(--an-ok); }
.an-quatro { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; min-width: 0; }
.an-quatro .an-campo { padding: 0 6px; min-width: 0; }
.an-quatro .an-campo input { text-align: center; }
.an-titulo-sec { display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: var(--an-texto); }
.an-seletor { padding: 8px 0 4px; }
.an-seletor .melhor { display: flex; align-items: center; gap: 6px; color: var(--an-texto-2); font-size: 12px; }
.an-seletor code { color: var(--an-marca-clara); font-size: 12px; word-break: break-all; }
.an-seletor code.classes { color: var(--an-texto-2); }
.an-seletor .pts { background: var(--an-superficie-alta); border-radius: 6px; padding: 1px 6px; font-size: 12px; white-space: nowrap; }
.an-rodape { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--an-superficie-alta); }
.an-rodape .esp { flex: 1; }
.an-btn { padding: 8px 14px; border-radius: 999px; background: var(--an-superficie-alta); color: var(--an-sobre-cor); }
.an-btn:hover { background: var(--an-borda); }
.an-btn.perigo:hover { background: var(--an-erro-fundo); }
.an-ok { width: 38px; height: 38px; border-radius: 999px; background: var(--an-ok); color: var(--an-sobre-cor); display: grid; place-items: center; }
.an-ok:hover { background: var(--an-ok); }
.an-ok svg { width: 18px; height: 18px; }
.an-religar {
  position: fixed; right: 14px; bottom: 14px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 999px; color: var(--an-sobre-cor);
  font-family: var(--an-fonte);
  font-size: 13px; font-weight: 700; line-height: 1; box-shadow: var(--an-sombra);
  cursor: grab; user-select: none; touch-action: none;
}
.an-religar:hover { background: var(--an-superficie-alta); border-color: var(--an-borda-forte); }
.an-religar .an-alca { width: 18px; height: 26px; }
.an-religar-ico { width: 26px; height: 26px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); display: grid; place-items: center; flex: none; }
.an-religar-ico svg { width: 15px; height: 15px; }
.an-religar .n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--an-ok); color: var(--an-sobre-cor); font-size: 12px; display: grid; place-items: center; }
.an-religar.aguardando .n { background: var(--an-aviso); color: var(--an-fundo); }

.an-fila {
  position: fixed; width: 440px; max-height: 60vh; pointer-events: auto;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 14px; box-shadow: var(--an-sombra-alta); overflow: auto;
}
.an-fila .item { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--an-superficie-alta); align-items: flex-start; }
.an-fila .item:last-child { border-bottom: 0; }
.an-fila .num { width: 22px; height: 22px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
.an-fila .txt { flex: 1; min-width: 0; }
.an-fila .txt .el { color: var(--an-texto-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-fila .txt .com { color: var(--an-sobre-cor); }
.an-fila .txt .alt { color: var(--an-ok-claro); font-size: 12px; }
.an-fila .vazio { padding: 16px; color: var(--an-texto-2); text-align: center; }
.an-fila .cab-lotes { padding: 8px 12px 4px; color: var(--an-texto-2); font-size: 12px; font-weight: 600; }
.an-fila .item.lote { cursor: pointer; }
.an-fila .item.lote:hover { background: var(--an-superficie); }
.an-fila .item.lote .perg { color: var(--an-aviso-claro); font-size: 12px; }
.an-fila .item.lote .an-lote-remover {
  flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 8px;
  background: transparent; color: var(--an-texto-2); font: inherit; font-size: 12px; line-height: 1;
  cursor: pointer; opacity: 0; transition: opacity .12s ease, background .12s ease, color .12s ease;
}
.an-fila .item.lote:hover .an-lote-remover, .an-fila .item.lote .an-lote-remover:focus-visible { opacity: 1; }
.an-fila .item.lote .an-lote-remover:hover { background: var(--an-superficie-alta); color: var(--an-sobre-cor); }
/* Sem mouse não há hover: no toque o botão fica sempre à vista, senão não existe. */
@media (hover: none) { .an-fila .item.lote .an-lote-remover { opacity: 1; } }

/* Caminho até um contexto seguro, quando o microfone é pedido pelo endereço da rede. */
.an-tunel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; pointer-events: auto;
  display: flex; flex-direction: column; gap: 12px; padding: 20px;
  background: var(--an-fundo); color: var(--an-sobre-cor);
  border: 1px solid var(--an-borda); border-radius: 18px; box-shadow: var(--an-sombra-alta);
}
.an-tunel .an-tunel-cab { display: flex; gap: 12px; align-items: flex-start; }
.an-tunel .an-tunel-cab strong { flex: 1; font-size: 15px; line-height: 1.3; }
.an-tunel p { margin: 0; color: var(--an-texto-2); font-size: 13px; line-height: 1.5; }
.an-tunel .an-tunel-linha { display: flex; flex-wrap: wrap; gap: 8px; }
.an-tunel .an-tunel-comando {
  flex: 1 1 260px; min-width: 0; padding: 10px 12px;
  background: var(--an-superficie); color: var(--an-sobre-cor);
  border: 1px solid var(--an-borda); border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px;
}
.an-tunel .an-tunel-depois { color: var(--an-ok-claro); }
.an-tunel .an-tunel-nota { font-size: 12px; }
.an-tunel .an-tunel-abrir, .an-tunel .an-tunel-https { width: 100%; }
.an-tunel .an-tunel-certificado { display: block; text-align: center; text-decoration: none; }
.an-tunel .an-tunel-ssh { border-top: 1px solid var(--an-superficie-alta); padding-top: 12px; }
.an-tunel .an-tunel-ssh > summary { cursor: pointer; color: var(--an-texto-2); font-size: 13px; list-style: none; }
.an-tunel .an-tunel-ssh > summary::-webkit-details-marker { display: none; }
.an-tunel .an-tunel-ssh > summary::before { content: "▸ "; }
.an-tunel .an-tunel-ssh[open] > summary::before { content: "▾ "; }
.an-tunel .an-tunel-ssh > summary:hover { color: var(--an-sobre-cor); }
.an-tunel .an-tunel-ssh > *:not(summary) { margin-top: 12px; }

.an-conversa {
  position: fixed; left: 14px; bottom: 14px; width: 420px; max-height: min(74vh, 680px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 20px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-conversa .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-superficie-alta); background: var(--an-superficie); }
.an-conversa .cab .marca { width: 28px; height: 28px; border-radius: 9px; background: var(--an-superficie-alta); display: grid; place-items: center; flex: none; }
.an-conversa .cab .marca svg { width: 17px; height: 17px; }
.an-conversa .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-conversa .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-conversa .fluxo { flex: 1; overflow: auto; padding: 14px 13px 6px; display: flex; flex-direction: column; gap: 15px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-conversa .vazio { color: var(--an-texto-2); text-align: center; padding: 22px 10px; font-size: 13px; line-height: 1.5; }

/* mensagem do agente: avatar + texto corrido; do usuário: balão à direita (padrão do Nexus UI) */
.an-msg { display: flex; gap: 9px; }
.an-msg.agente { align-self: stretch; }
.an-msg.agente .av { width: 26px; height: 26px; border-radius: 8px; background: var(--an-superficie); display: grid; place-items: center; flex: none; margin-top: 1px; }
.an-msg.agente .av svg { width: 16px; height: 16px; }
.an-msg .corpo { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; }
.an-msg .quem { color: var(--an-texto-2); font-size: 12px; }
.an-msg.agente .balao { color: var(--an-texto); line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg.usuario { align-self: flex-end; max-width: 88%; }
.an-msg.usuario .corpo { align-items: flex-end; }
.an-msg.usuario .balao { background: var(--an-superficie-alta); color: var(--an-sobre-cor); border-radius: 16px 16px 5px 16px; padding: 9px 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg .escolhida { color: var(--an-ok-claro); font-size: 12px; display: flex; align-items: center; gap: 6px; }
.an-msg .escolhida::before { content: "✓"; font-weight: 700; }

/* perguntas com opções */
.an-perguntas { display: flex; flex-direction: column; gap: 6px; padding: 9px; background: var(--an-superficie); border: 1px solid var(--an-superficie-alta); border-radius: 14px; }
.an-perguntas .rot { color: var(--an-texto-2); font-size: 12px; font-weight: 600; padding: 1px 3px 3px; }
.an-opcao {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; padding: 9px 11px; border-radius: 10px;
  background: var(--an-fundo); border: 1px solid var(--an-borda); color: var(--an-texto); font-size: 13px; line-height: 1.35;
}
.an-opcao:hover { border-color: var(--an-marca-clara); background: var(--an-marca-fundo); }
.an-opcao .mira { width: 14px; height: 14px; border-radius: 999px; border: 1.6px solid var(--an-borda-forte); flex: none; }
.an-opcao.marcada { border-color: var(--an-marca-clara); background: var(--an-marca-fundo); }
.an-opcao.marcada .mira { border-color: var(--an-marca-clara); box-shadow: inset 0 0 0 3px var(--an-marca-clara); }
.an-opcao.livre { border-style: dashed; color: var(--an-texto-2); }
.an-opcao:disabled { opacity: .5; cursor: default; }

/* entrada: caixa única com a área de texto em cima e as ações embaixo */
.an-barra .an-agente-atual {
  display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 999px;
  border: 1px solid var(--an-borda); background: var(--an-superficie); cursor: pointer; flex: none; padding: 0;
}
.an-barra .an-agente-atual:hover { background: var(--an-superficie-alta); border-color: var(--an-borda-forte); }
.an-barra .an-agente-atual .marca { display: flex; width: 17px; height: 17px; }
.an-barra .an-agente-atual .marca svg { width: 100%; height: 100%; }
.an-agentes {
  position: fixed; z-index: 2147483646; pointer-events: auto; width: 312px; max-width: calc(100vw - 16px); max-height: 60vh; overflow-y: auto;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 14px;
  box-shadow: var(--an-sombra-alta); padding: 5px; display: flex; flex-direction: column; gap: 1px;
}
.an-agentes-topo { padding: 8px 9px 5px; font-size: 12px; font-weight: 600; color: var(--an-texto-2); }
.an-modelo-campo { display: flex; flex-direction: column; gap: 7px; padding: 8px 9px; font-size: 12px; color: var(--an-texto-2); }
.an-modelo-acoes { padding: 9px; display: flex; justify-content: flex-end; }
.an-seletor-acoes { display: flex; gap: 8px; padding-top: 10px; }
.an-anexos { display: flex; flex-direction: column; gap: 8px; }
.an-anexos-nota { font-size: 12px; color: var(--an-texto-2); margin: 10px 0 0; }
.an-anexo { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--an-superficie); border: 1px solid var(--an-borda); border-radius: 12px; min-width: 0; }
.an-anexo > a { display: block; flex: none; width: 88px; }
.an-anexo img { display: block; width: 88px; height: 62px; object-fit: contain; border-radius: 6px; background: var(--an-fundo); }
.an-anexo-info { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; font-size: 12px; color: var(--an-texto-2); }
.an-anexo-info strong { color: var(--an-texto); font-weight: 600; }
.an-anexo-info a { color: var(--an-marca-clara); text-decoration: underline; width: fit-content; }
.an-anexo a:focus-visible { outline: 2px solid var(--an-marca-clara); outline-offset: 2px; }
.an-contexto { margin-top: 12px; font-size: 12px; color: var(--an-texto-2); line-height: 1.5; }
.an-contexto summary { cursor: pointer; padding: 7px 0; color: var(--an-texto); font-size: 12px; }
.an-contexto summary:focus-visible { outline: 2px solid var(--an-marca-clara); outline-offset: 2px; border-radius: 4px; }
.an-contexto p { margin: 5px 0; }
.an-contexto-no { margin-top: 8px; padding: 9px; border: 1px solid var(--an-borda); border-radius: 10px; overflow-wrap: anywhere; }
.an-contexto-titulo { display: flex; flex-wrap: wrap; gap: 4px 10px; justify-content: space-between; }
.an-contexto-titulo strong { font-weight: 600; color: var(--an-texto); }
.an-contexto-excede { color: var(--an-aviso, var(--an-texto)); }
.an-agentes-vazio, .an-agentes-aviso { padding: 9px; font-size: 12px; color: var(--an-texto-3); line-height: 1.45; }
.an-agente {
  display: flex; align-items: center; gap: 10px; padding: 8px 9px; border: 0; border-radius: 10px;
  background: transparent; cursor: pointer; text-align: left; font: inherit; color: var(--an-texto); width: 100%;
}
.an-agente:hover:not(.inerte) { background: var(--an-superficie); }
.an-agente.inerte { cursor: default; opacity: 0.62; }
.an-agente.ativo { background: var(--an-marca-fundo); }
.an-agente .marca { display: flex; width: 20px; height: 20px; flex: none; }
.an-agente .marca svg { width: 100%; height: 100%; }
.an-agente .col { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.an-agente .nome { font-size: 13px; font-weight: 600; }
.an-agente .sit { font-size: 12px; color: var(--an-texto-3); overflow: hidden; text-overflow: ellipsis; }
.an-agente .selo-vivo { flex: none; font-size: 12px; font-weight: 600; color: var(--an-ok-claro); background: var(--an-ok-fundo); border-radius: 999px; padding: 2px 7px; }
.an-agente.apagar { margin-top: 3px; border-top: 1px solid var(--an-borda); border-radius: 0 0 10px 10px; padding-top: 10px; }
.an-agentes-chave { display: flex; gap: 6px; padding: 4px 9px 9px; }
.an-agentes-chave input {
  flex: 1; min-width: 0; height: 30px; border-radius: 8px; border: 1px solid var(--an-borda);
  background: var(--an-superficie); color: var(--an-texto); padding: 0 9px; font-size: 12px; outline: 0;
}
.an-agentes-chave input:focus { border-color: var(--an-marca-clara); box-shadow: var(--an-foco); }
.an-ok-pequeno {
  height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--an-marca);
  color: var(--an-sobre-cor); font-size: 12px; font-weight: 600; cursor: pointer; flex: none;
}
.an-conversa .an-passo { display: flex; align-items: baseline; gap: 8px; padding: 3px 12px 3px 14px; font-size: 12px; color: var(--an-texto-3); }
.an-conversa .an-passo .ponto { width: 5px; height: 5px; border-radius: 999px; background: var(--an-borda-forte); flex: none; align-self: center; }
.an-conversa .an-passo .texto { flex: 1; min-width: 0; }
.an-conversa .an-passo:last-of-type .ponto { background: var(--an-marca-clara); }
.an-conversa .an-passo:last-of-type .texto { color: var(--an-texto-2); }
.an-conversa .an-passo .quando { flex: none; font-size: 12px; }
.an-conversa .entrada {
  margin: 8px 10px 10px; border: 1px solid var(--an-borda); background: var(--an-superficie); border-radius: 18px;
  display: flex; flex-direction: column; overflow: hidden; cursor: text;
}
.an-conversa .entrada:focus-within { border-color: var(--an-marca-clara); box-shadow: var(--an-foco); }
.an-conversa .entrada textarea {
  border: 0; background: transparent; outline: 0; resize: none; color: var(--an-sobre-cor);
  min-height: 42px; max-height: 160px; padding: 11px 13px 3px; line-height: 1.45; font-size: 13px;
}
.an-conversa .entrada textarea::placeholder { color: var(--an-texto-3); }
.an-conversa .entrada .acoes { display: flex; align-items: center; gap: 6px; padding: 4px 7px 7px; }
.an-conversa .entrada .acoes .esp { flex: 1; }
.an-conversa .entrada .acoes .atalho { color: var(--an-texto-3); font-size: 12px; padding-left: 4px; }
.an-conversa .entrada .an-comandos {
  order: -1; border-bottom: 1px solid var(--an-borda); background: var(--an-fundo);
  max-height: 232px; overflow-y: auto; overscroll-behavior: contain;
}
.an-conversa .an-comandos-lista { display: flex; flex-direction: column; padding: 5px; gap: 1px; }
.an-conversa .an-comandos-vazio { padding: 11px 12px; font-size: 12px; color: var(--an-texto-3); }
.an-conversa .an-comando {
  display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: 9px;
  padding: 7px 9px; border: 0; border-radius: 9px; background: transparent; cursor: pointer;
  text-align: left; font: inherit; color: var(--an-sobre-cor); width: 100%;
}
.an-conversa .an-comando.foco { background: var(--an-superficie-alta); }
.an-conversa .an-comando .nome { font-size: 13px; font-weight: 600; white-space: nowrap; }
.an-conversa .an-comando .desc {
  font-size: 12px; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.an-conversa .an-comando .origem {
  font-size: 12px; font-weight: 600;
  color: var(--an-texto-3); border: 1px solid var(--an-borda); border-radius: 999px; padding: 0 6px; white-space: nowrap;
}
.an-conversa .entrada .an-ok { width: 32px; height: 32px; background: var(--an-marca); }
.an-conversa .entrada .an-ok:hover { background: var(--an-marca-forte); }
.an-conversa .entrada .an-ok:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-conversa .dica-resp { padding: 0 15px 6px; color: var(--an-aviso-claro); font-size: 12px; }
.an-estado.pergunta { background: var(--an-aviso-fundo); color: var(--an-aviso-claro); }
.an-religar.pergunta .n { background: var(--an-aviso-claro); color: var(--an-fundo); }
.an-fila .item.lote .num { background: var(--an-borda); }
.an-fila .item.lote.em_andamento .num { background: var(--an-aviso); color: var(--an-fundo); }
.an-fila .item.lote.processado .num { background: var(--an-ok); }
.an-fila .txt .nota { color: var(--an-texto); font-size: 12px; white-space: normal; }

.an-toast {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); pointer-events: none;
  background: var(--an-fundo); border: 1px solid var(--an-borda); color: var(--an-sobre-cor); padding: 8px 14px; border-radius: 999px; box-shadow: var(--an-sombra);
  max-width: min(720px, calc(100vw - 24px)); text-align: center;
}

.an-barra .an-ico.ativo { background: var(--an-borda); color: var(--an-sobre-cor); }
.an-area {
  position: fixed; pointer-events: none; display: none; border: 1.5px dashed var(--an-marca-clara); background: var(--an-marcacao); border-radius: 3px;
}
.an-area.ativa { border-style: solid; border-color: var(--an-marca); background: var(--an-marcacao); }
.an-area .n { position: absolute; left: -1.5px; bottom: 100%; margin-bottom: 4px; background: var(--an-fundo); color: var(--an-sobre-cor); font-size: 12px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; font-family: var(--an-fonte-mono); }

.an-arvore {
  position: fixed; left: 14px; top: var(--an-topo-paineis, 62px); width: min(360px, calc(100vw - 28px)); max-height: min(70vh, 640px, calc(100vh - var(--an-topo-paineis, 62px) - 12px)); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 18px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-arvore .cab { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--an-superficie-alta); background: var(--an-superficie); cursor: grab; user-select: none; }
.an-arvore .cab .tit { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-arvore .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-arvore .cab .an-ico.ativo { background: var(--an-marca-fundo); color: var(--an-marca-clara); }
.an-btn.mini { padding: 5px 10px; font-size: 12px; flex: none; }
.an-arvore .corpo { position: relative; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 6px 6px 8px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; outline: 0; }
.an-arvore .corpo::-webkit-scrollbar { width: 7px; height: 7px; }
.an-arvore .corpo::-webkit-scrollbar-thumb { background: var(--an-borda-forte); border-radius: 999px; }
.an-arvore .corpo::-webkit-scrollbar-track, .an-arvore .corpo::-webkit-scrollbar-corner { background: transparent; }
.an-arvore .dica-uso { padding: 6px 12px 8px; border-top: 1px solid var(--an-superficie-alta); color: var(--an-texto-3); font-size: 12px; line-height: 1.4; display: flex; flex-direction: column; gap: 1px; }
.an-no {
  display: flex; align-items: center; gap: 5px; height: 22px; padding-right: 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; white-space: nowrap; color: var(--an-texto); outline: 0; width: max-content; min-width: 100%;
}
.an-no:hover { background: var(--an-superficie-alta); }
.an-no:focus { box-shadow: inset 0 0 0 1px var(--an-marca-clara); }
.an-no.foco { background: var(--an-marca-fundo); color: var(--an-sobre-cor); }
.an-no.foco .tag { color: var(--an-sobre-cor); }
.an-no.fora { opacity: .55; }
.an-no.invisivel { opacity: .4; }
.an-no .seta { width: 16px; height: 16px; border-radius: 4px; color: var(--an-texto-2); display: grid; place-items: center; flex: none; transition: transform .12s; padding: 0; }
.an-no .seta svg { width: 12px; height: 12px; }
.an-no .seta.aberto { transform: rotate(90deg); }
.an-no .seta:hover { background: var(--an-borda); color: var(--an-sobre-cor); }
.an-no .seta.vazia { visibility: hidden; }
.an-no .comp { flex: none; color: var(--an-marca-clara); background: var(--an-marca-fundo); border-radius: 4px; padding: 1px 5px; font-size: 12px; font-weight: 700; }
.an-no .nome { flex: none; font-size: 12px; }
.an-no .tag { color: var(--an-texto); }
.an-no .id { color: var(--an-aviso-claro); }
.an-no .cls { color: var(--an-texto-2); }
.an-no .txt { flex: none; color: var(--an-texto-2); font-style: italic; }
.an-no .pin { flex: none; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); font-size: 12px; font-weight: 700; display: grid; place-items: center; }
.an-no .pin.enviado { background: var(--an-ok); }
.an-no .dim { margin-left: auto; flex: none; color: var(--an-texto-3); font-size: 12px; font-family: var(--an-fonte-mono); padding-left: 6px; }
.an-mais { height: 20px; display: flex; align-items: center; color: var(--an-texto-2); font-size: 12px; cursor: pointer; border-radius: 6px; }
.an-mais:hover { color: var(--an-sobre-cor); background: var(--an-superficie-alta); }

/* ---------- explorador do sistema de design ---------- */
.an-realce { position: fixed; pointer-events: none; border: 1.5px solid var(--an-marca-clara); background: var(--an-marcacao); border-radius: 2px; }
.an-design {
  /* Numa tela de 390px, 380px fixos a 14px da borda começavam 4px fora da tela. */
  position: fixed; right: 14px; bottom: 14px; width: min(380px, calc(100vw - 28px)); max-height: min(76vh, 700px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 18px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-design .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-borda); background: var(--an-superficie); }
.an-design .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 14px; }
.an-design .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-design .abas { display: flex; flex-wrap: wrap; gap: 3px; padding: 8px 9px; border-bottom: 1px solid var(--an-borda); }
.an-design .aba {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; flex: none;
  background: transparent; color: var(--an-texto-2); font-size: 12px; font-weight: 600; white-space: nowrap;
}
.an-design .aba:hover { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-design .aba.ativa { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-design .aba .n { background: var(--an-superficie); border-radius: 999px; padding: 1px 6px; font-size: 12px; color: var(--an-texto-2); }
.an-design .aba.ativa .n { background: var(--an-borda); color: var(--an-texto); }
.an-design .aba.alerta { color: var(--an-aviso-claro); }
.an-design .aba.alerta .n { background: var(--an-aviso-fundo); color: var(--an-aviso-claro); }
.an-design .corpo { flex: 1; overflow: auto; padding: 6px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-design .vazio { color: var(--an-texto-2); text-align: center; padding: 22px 10px; font-size: 13px; }
.an-valor { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 10px; cursor: pointer; width: 100%; text-align: left; }
.an-valor:hover { background: var(--an-superficie); }
.an-valor .amostra { width: 26px; height: 26px; border-radius: 7px; flex: none; display: grid; place-items: center; }
.an-valor .amostra.cor { border: 1px solid var(--an-borda-forte); }
.an-valor .amostra.medida { background: var(--an-superficie-alta); color: var(--an-texto-2); font-size: 12px; font-weight: 700; font-family: var(--an-fonte-mono); }
.an-valor .col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.an-valor .titulo { font-size: 13px; color: var(--an-texto); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-valor .sub { font-size: 12px; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-valor .usos { flex: none; min-width: 26px; text-align: right; color: var(--an-texto-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.an-valor.fora .titulo { color: var(--an-aviso-claro); }
.an-valor .motivo { flex-basis: 100%; color: var(--an-texto-3); font-size: 12px; }
.an-design .rodape { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--an-borda); color: var(--an-texto-3); font-size: 12px; }
.an-design .rodape .dica { flex: 1; }
.an-design .rodape .fonte { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.an-barra .an-ico.ativo { background: var(--an-superficie-alta); color: var(--an-texto); }

/* ---------- avaliação da página ---------- */
.an-avaliacao {
  position: fixed; right: 14px; top: var(--an-topo-paineis, 62px); width: min(400px, calc(100vw - 28px)); max-height: min(78vh, 720px, calc(100vh - var(--an-topo-paineis, 62px) - 12px)); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda);
  border-radius: 18px; box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-avaliacao .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-borda); background: var(--an-superficie); }
.an-avaliacao .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 14px; }
.an-avaliacao .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 12px; font-weight: 400; }
.an-avaliacao .corpo { flex: 1; overflow: auto; padding: 6px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-avaliacao .secao { color: var(--an-texto-2); font-size: 12px; font-weight: 600; padding: 10px 8px 5px; }
.an-avaliacao .vazio { color: var(--an-texto-2); font-size: 13px; padding: 10px 8px; }
.an-avaliacao .aguardando { color: var(--an-aviso-claro); font-size: 13px; padding: 10px 8px; }
.an-avaliacao .resumo { color: var(--an-texto); font-size: 13px; line-height: 1.5; padding: 4px 8px 8px; }
.an-avaliacao .erro { color: var(--an-erro-claro); font-size: 12px; padding: 0 12px 10px; }
.an-achado { display: flex; gap: 9px; padding: 8px 9px; border-radius: 10px; cursor: pointer; align-items: flex-start; }
.an-achado:hover { background: var(--an-superficie); }
.an-achado .sinal { width: 7px; height: 7px; border-radius: 999px; flex: none; margin-top: 5px; background: var(--an-texto-3); }
.an-achado.alta .sinal { background: var(--an-erro); }
.an-achado.media .sinal { background: var(--an-aviso); }
.an-achado .col { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.an-achado .titulo { font-size: 13px; font-weight: 600; color: var(--an-texto); display: flex; align-items: center; gap: 7px; }
.an-achado .cat { font-size: 12px; font-weight: 600; color: var(--an-marca-clara); background: var(--an-marca-fundo); border-radius: 999px; padding: 1px 7px; }
.an-achado .an-selo { font-size: 12px; font-weight: 600; color: var(--an-texto-3); border: 1px solid var(--an-borda); border-radius: 999px; padding: 0 6px; flex: none; }
.an-achado .sub { font-size: 12px; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-achado .evid { font-size: 12px; color: var(--an-texto-3); line-height: 1.45; }
.an-achado .sugestao { font-size: 12px; color: var(--an-ok-claro); line-height: 1.45; }
.an-achado .aplicar { font-size: 12px; color: var(--an-marca-clara); line-height: 1.4; }
.an-achado.parecer { cursor: default; align-items: flex-start; }
.an-btn.mini { padding: 4px 10px; font-size: 12px; flex: none; align-self: center; }
.an-btn.primario { background: var(--an-marca); }
.an-btn.primario:hover { background: var(--an-marca-forte); }
.an-btn.primario:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-avaliacao .cab,.an-avaliacao .rodape,.an-avaliacao-vinculo { flex-shrink:0; }
.an-avaliacao .rodape { display: flex; flex-wrap:wrap; gap: 7px; padding: 9px 10px; border-top: 1px solid var(--an-borda); }
.an-avaliacao-vinculo { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--an-borda); }
.an-avaliacao-chat { flex:1; display:flex; align-items:center; flex-wrap:wrap; gap:4px 6px; min-width:0; padding:5px 6px; color:var(--an-texto); background:transparent; border:0; border-radius:8px; cursor:pointer; text-align:left; }
.an-avaliacao-chat > .an-ico { width:22px; height:22px; }
.an-avaliacao-chat:hover { background:var(--an-borda); }
.an-avaliacao-chat:focus-visible { outline:2px solid var(--an-marca-clara); outline-offset:-3px; }
.an-avaliacao-chat-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; font-size:12px; }
.an-avaliacao-chat-info strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.an-avaliacao-chat-info > span,.an-chat-sessao-id { color:var(--an-texto-3); font-size: 12px; }
.an-avaliacao-chat-acao { flex-basis:100%; padding-left:28px; color:var(--an-marca-clara); font-size: 12px; }
.an-avaliacao-nova { white-space:nowrap; border:1px solid var(--an-borda); }
.an-avaliacao-nova[aria-expanded="true"] { color:var(--an-marca-clara); border-color:var(--an-marca-clara); }
.an-avaliacao-escolhas { display:flex; flex-direction:column; gap:14px; padding:10px 8px; }
.an-avaliacao-escolhas-cab { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; }
.an-avaliacao-escolhas p { margin:0; color:var(--an-texto-2); font-size:12px; }
.an-avaliacao-escolha { display:flex; flex-direction:column; gap:5px; min-width:0; font-size: 12px; color:var(--an-texto-2); }
.an-avaliacao-escolha .an-seletor-botao { width:100%; min-width:0; height:auto; border:1px solid var(--an-borda); border-radius:10px; padding:9px 10px; color:var(--an-texto); background:var(--an-superficie-alta); }
.an-avaliacao-modelos { display:grid; grid-template-columns:minmax(0, 1.5fr) minmax(0, 1fr); gap:10px; }
.an-avaliacao .rodape input {
  flex: 1 1 160px; min-width: 0; background: var(--an-superficie-alta); border: 1px solid var(--an-borda);
  border-radius: 10px; padding: 7px 11px; color: var(--an-texto); outline: 0; font-size: 13px;
}
.an-avaliacao .rodape input:focus { border-color: var(--an-marca-clara); box-shadow: var(--an-foco); }
.an-avaliacao .rodape input::placeholder { color: var(--an-texto-3); }

.an-pergunta { display: flex; flex-direction: column; gap: 7px; margin: 8px 8px 10px; padding: 10px 11px; background: var(--an-aviso-fundo); border-radius: 12px; }
.an-pergunta .txt { color: var(--an-aviso-claro); font-size: 13px; line-height: 1.45; }
.an-pergunta .opcoes { display: flex; flex-direction: column; gap: 5px; }
.an-pergunta input {
  background: var(--an-superficie); border: 1px solid var(--an-borda); border-radius: 9px;
  padding: 6px 10px; color: var(--an-texto); outline: 0; font-size: 12px;
}
.an-pergunta input:focus { border-color: var(--an-marca-clara); }
.an-pergunta input::placeholder { color: var(--an-texto-3); }
.an-pergunta .respondida { color: var(--an-ok-claro); font-size: 12px; }

/* O ditado ocupa o próprio balão. Os pontos indicam atividade, não volume. */
.an-balao.an-ditando > :not(.an-voz-controles) { display: none !important; }
.an-voz-controles { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: 100%; }
.an-balao.an-ditando { border-radius: 16px; padding: 8px; }
.an-voz-previa { flex: 0 0 100%; min-width: 0; max-height: 120px; overflow: auto; overscroll-behavior: contain; border-top: 1px solid var(--an-borda); padding-top: 8px; text-align: left; user-select: text; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-voz-previa-rotulo { display: block; position: sticky; top: 0; background: var(--an-fundo); color: var(--an-texto-2); font-size: 12px; line-height: 1.5; margin-bottom: 4px; }
.an-voz-previa-texto { color: var(--an-texto); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.an-voz-controles .an-ico { flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--an-superficie); }
.an-voz-controles .an-ico:focus-visible { outline: 2px solid var(--an-marca-clara); outline-offset: 2px; }
.an-voz-controles .an-ico:disabled { opacity: .35; cursor: default; }
.an-conversa .entrada.an-ditando > .acoes { display: none; }
.an-conversa .entrada > .an-voz-controles { margin-top: 6px; }
.an-voz-controles .an-voz-usar { background: var(--an-texto); color: var(--an-fundo); }
.an-voz-controles .an-voz-usar:hover { background: var(--an-ok-claro); }
.an-voz-centro { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; flex: 1; min-width: 0; }
.an-voz-atividade { display: flex; align-items: center; justify-content: center; gap: 4px; height: 9px; width: 100%; overflow: hidden; }
.an-voz-atividade i { flex: none; width: 3px; height: 3px; border-radius: 50%; background: var(--an-texto-3); opacity: .45; }
.an-voz-controles.ouvindo .an-voz-atividade i { background: var(--an-ok-claro); animation: an-voz-atividade 1.2s ease-in-out infinite; }
.an-voz-controles.ouvindo .an-voz-atividade i:nth-child(3n+1) { animation-delay: .2s; }
.an-voz-controles.ouvindo .an-voz-atividade i:nth-child(3n+2) { animation-delay: .4s; }
.an-voz-status { color: var(--an-texto-2); font-size: 12px; line-height: 1.2; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes an-voz-atividade { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .an-voz-controles.ouvindo .an-voz-atividade i { animation: none; opacity: 1; } }

/* ---------- escolhas de propriedades ---------- */
.an-campo.an-campo-selecao { padding: 0; }
.an-seletor-botao {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; height: 100%;
  min-width: 0; padding: 0 9px; border-radius: inherit; text-align: left; outline: 0; font-size: 13px;
}
.an-seletor-botao:hover { background: var(--an-superficie); }
.an-seletor-botao:focus-visible { box-shadow: var(--an-foco); }
.an-seletor-botao[aria-expanded="true"] { background: var(--an-superficie); }
.an-seletor-botao:disabled { opacity: .5; cursor: default; }
.an-seletor-valor { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-seletor-seta { display: flex; color: var(--an-texto-2); flex: none; transition: transform .15s ease; }
.an-seletor-seta svg, .an-seletor-check svg { width: 16px; height: 16px; }
.an-seletor-botao[aria-expanded="true"] .an-seletor-seta { transform: rotate(180deg); color: var(--an-marca-clara); }
.an-seletor-popup {
  position: fixed; z-index: 2147483647; pointer-events: auto; padding: 5px; overflow: auto;
  color: var(--an-texto); background: var(--an-fundo); border: 1px solid var(--an-borda-forte);
  border-radius: 12px; box-shadow: var(--an-sombra-alta); scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent;
  overscroll-behavior: contain;
}
.an-seletor-opcao {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px;
  padding: 7px 9px; border-radius: 7px; font-size: 13px; line-height: 1.4; cursor: pointer;
}
.an-seletor-opcao.ativa { background: var(--an-superficie-alta); }
.an-seletor-opcao[aria-selected="true"] { color: var(--an-marca-clara); }
.an-seletor-opcao[aria-selected="true"].ativa { background: var(--an-marca-fundo); }
.an-seletor-opcao-texto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-seletor-check { display: flex; flex: none; visibility: hidden; }
.an-seletor-opcao[aria-selected="true"] .an-seletor-check { visibility: visible; }

/* A identificação cede espaço aos controles; em celular a mesma barra usa duas linhas. */
@media (max-width: 1000px) {
  .an-barra .titulo { max-width: 120px; }
}
@media (max-width: 760px) {
  .an-barra > .an-sep, .an-barra .an-titulo-prefixo { display: none; }
  .an-barra .titulo { display: flex; flex: 0 1 92px; max-width: 92px; }
}
@media (max-width: 640px) {
  .an-barra { width: calc(100vw - 24px); justify-content: center; border-radius: 20px; row-gap: 6px; }
  .an-barra .an-estado:not(:empty) { flex: 1 1 100%; max-width: 100%; justify-content: center; }
}

/* Chat de sessões: superfície separada da conversa de cada lote. */
.an-chat { position: fixed; pointer-events: auto; top: 72px; right: 14px; width: min(520px, calc(100vw - 28px)); height: min(750px, calc(100dvh - 88px)); display: flex; flex-direction: column; min-height: 0; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 20px; box-shadow: var(--an-sombra-alta); overflow: hidden; }
.an-chat-cab { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--an-borda); gap: 12px; }
.an-chat-cab strong { display: block; font-size: 17px; line-height: 1.4; }
.an-chat-sub { color: var(--an-texto-2); font-size: 12px; line-height: 1.45; }
.an-chat-cab .an-chat-sub { display: block; margin-top: 2px; }
.an-chat-filtros { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px 8px; }
.an-chat-escolha { display: flex; flex-direction: column; flex: 1 1 130px; min-width: 0; gap: 5px; }
.an-chat-escolha > span { color: var(--an-texto-2); font-size: 12px; }
.an-chat-escolha .an-seletor-botao { width: 100%; min-width: 0; border: 1px solid var(--an-borda); border-radius: 10px; padding: 9px 10px; background: var(--an-superficie-alta); }
.an-chat-escolha .an-seletor-botao:disabled { opacity: .7; cursor: default; }
.an-chat-acoes { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 16px 12px; }
.an-chat-acoes .an-btn { flex: none; }
.an-chat-acoes .an-chat-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-chat-historico { flex: none; border-block: 1px solid var(--an-borda); background: var(--an-superficie); }
.an-chat-historico summary { padding: 10px 16px; cursor: pointer; color: var(--an-texto-2); font-size: 12px; }
.an-chat-sessoes { max-height: 160px; overflow: auto; overscroll-behavior: contain; padding: 0 8px 8px; }
.an-chat-sessao { display: flex; flex-direction: column; align-items: stretch; text-align: left; gap: 3px; width: 100%; border-radius: 9px; padding: 9px; border: 1px solid transparent; }
.an-chat-sessao:hover, .an-chat-sessao.atual { background: var(--an-superficie-alta); border-color: var(--an-borda); }
.an-chat-sessao strong { font-size: 12px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.an-chat-sessao span { color: var(--an-texto-2); font-size: 12px; }
.an-chat-mensagens { flex: 1 1 auto; min-height: 80px; overflow: auto; overscroll-behavior: contain; padding: 18px 16px; }
.an-chat-mensagem { max-width: 94%; padding: 10px 12px; border: 1px solid var(--an-borda); border-radius: 12px; background: var(--an-superficie); margin-bottom: 12px; }
.an-chat-mensagem.usuario { margin-left: auto; background: var(--an-marca-fundo); border-color: var(--an-borda-forte); }
.an-chat-mensagem.sistema { color: var(--an-texto-2); }
.an-chat-mensagem strong { display: block; margin-bottom: 5px; font-size: 12px; color: var(--an-texto-2); }
.an-chat-texto { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; font-size: 13px; line-height: 1.6; }
.an-chat-trabalhando { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; color: var(--an-texto-2); }
.an-chat-trabalhando-passo:not(:empty) { flex: 1 1 100%; padding-left: 16px; color: var(--an-texto-3, var(--an-texto-2)); opacity: .85; overflow-wrap: anywhere; }
.an-chat-pulso { flex: none; width: 8px; height: 8px; border-radius: 999px; background: var(--an-ok-claro); animation: an-pulsar 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .an-chat-pulso { animation: none; } }
.an-chat-vazio { text-align: center; color: var(--an-texto-2); margin: 20px auto; max-width: 320px; line-height: 1.6; }
.an-chat-vazio > span { display: grid; place-items: center; width: 40px; height: 40px; margin: 0 auto 12px; border-radius: 12px; background: var(--an-superficie-alta); }
.an-chat-vazio svg { width: 23px; height: 23px; }
.an-chat-vazio strong { color: var(--an-texto); font-size: 14px; }
.an-chat-vazio p { margin: 8px 0; font-size: 12px; }
.an-chat-status { flex: none; padding: 0 16px 8px; font-size: 12px; color: var(--an-ok-claro); }
.an-chat-status:empty { display: none; }
.an-chat-status.erro { color: var(--an-erro-claro); }
.an-chat-entrada { flex: none; padding: 12px; background: var(--an-superficie); border-top: 1px solid var(--an-borda); }
.an-chat-entrada textarea { display: block; width: 100%; min-height: 56px; max-height: 120px; resize: vertical; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 10px; padding: 10px; outline: none; line-height: 1.5; }
.an-chat-entrada textarea:focus { border-color: var(--an-marca-clara); }
.an-chat-rodape { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
.an-chat-enviar { color: var(--an-fundo); background: var(--an-ok-claro); }
.an-chat-enviar:disabled { opacity: .4; cursor: default; }
.an-chat button:focus-visible, .an-chat summary:focus-visible { outline: 2px solid var(--an-marca-clara); outline-offset: -2px; }
@media (max-width: 540px) {
  .an-chat { top: 112px; right: 8px; width: calc(100vw - 16px); height: calc(100dvh - 122px); border-radius: 16px; }
  .an-chat-cab { padding: 10px 12px; }
  .an-chat-filtros { padding: 8px 12px; }
  .an-chat-escolha { flex-basis: 100px; }
  .an-chat-acoes { padding: 0 12px 8px; }
  .an-chat-sessoes { max-height: 108px; }
  .an-chat-rodape .an-chat-sub { max-width: 155px; font-size: 12px; }
}

.an-chat.ampliado { width: min(940px, calc(100vw - 28px)); }
.an-chat-texto { white-space: normal; font-size: 14px; line-height: 1.7; }
.an-chat-texto p { margin: 0 0 10px; white-space: pre-wrap; }
.an-chat-texto p:last-child { margin-bottom: 0; }
.an-chat-texto h3 { font-size: 15px; margin: 14px 0 6px; }
.an-chat-texto h3:first-child { margin-top: 0; }
.an-chat-texto a { color: var(--an-marca-clara); text-decoration: underline; }
.an-chat-texto :is(ul,ol) { padding-left: 22px; margin: 6px 0 12px; }
.an-chat-texto li { margin: 4px 0; }
.an-chat-texto code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em; background: var(--an-fundo); border-radius: 4px; padding: 1px 4px; }
.an-chat-texto blockquote { border-left: 3px solid var(--an-borda-forte); color: var(--an-texto-2); margin: 10px 0; padding-left: 12px; }
.an-chat-codigo { border: 1px solid var(--an-borda); border-radius: 9px; overflow: hidden; margin: 10px 0; background: var(--an-fundo); }
.an-chat-codigo-cab { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 9px; background:var(--an-superficie-alta); font-size: 12px; color:var(--an-texto-2); }
.an-chat-copiar { font-size: 12px; padding:3px; border-radius:4px; }
.an-chat-copiar:hover { color:var(--an-texto); }
.an-chat-codigo pre { margin:0; padding:12px; overflow:auto; max-height:400px; white-space:pre; line-height:1.55; }
.an-chat-codigo pre code { padding:0; border:0; background:transparent; }
.an-chat-tabela { max-width:100%; overflow:auto; margin:10px 0; }
.an-chat-tabela table { border-collapse:collapse; font-size:12px; min-width:100%; }
.an-chat-tabela :is(td,th) { text-align:left; border:1px solid var(--an-borda); padding:6px 8px; }
@media(max-width:540px) { .an-chat.ampliado { width:calc(100vw - 16px); } }

.an-chat-entrada { position:relative; }
.an-chat-comandos { position:absolute; bottom:calc(100% - 8px); left:12px; right:12px; background:var(--an-fundo); border:1px solid var(--an-borda-forte); border-radius:12px; box-shadow:var(--an-sombra); overflow:hidden; }
.an-chat-comandos-cab { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; border-bottom:1px solid var(--an-borda); font-size: 12px; color:var(--an-texto-2); }
.an-chat-comandos-cab .an-ico { width:24px; height:24px; }
.an-chat-comandos-lista { max-height:min(270px, 38dvh); overflow:auto; overscroll-behavior:contain; padding:4px; }
.an-chat-comando { display:block; width:100%; padding:9px 10px; border-radius:8px; text-align:left; }
.an-chat-comando.foco, .an-chat-comando:hover { background:var(--an-superficie-alta); }
.an-chat-comando[aria-disabled=true] { opacity:.65; }
.an-chat-comando-topo { display:flex; gap:10px; justify-content:space-between; align-items:center; }
.an-chat-comando-topo strong { font-size:12px; color:var(--an-marca-clara); overflow-wrap:anywhere; }
.an-chat-comando-topo small { font-size: 12px; flex:none; color:var(--an-texto-3); }
.an-chat-comando-desc { display:block; font-size: 12px; line-height:1.5; color:var(--an-texto-2); margin-top:3px; }
.an-chat-comandos-abrir { padding:6px 8px; font-size: 12px; flex:none; }
@media(max-width:540px){.an-chat-rodape .an-chat-sub { display:none; }}

/* Consumo e contexto são medidas distintas; detalhes abrem sem reduzir a conversa. */
.an-chat-monitor { flex: none; min-width: 0; position: relative; z-index: 2; border-top: 1px solid var(--an-borda); }
.an-chat-metricas summary { display: block; list-style: none; padding: 8px 14px; cursor: pointer; }
.an-chat-metricas summary::-webkit-details-marker { display: none; }
.an-chat-metrica-linha { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.an-chat-contexto-valor { margin-left: auto; color: var(--an-texto-2); }
.an-chat-metrica-expandir { color: var(--an-texto-3); }
.an-chat-metrica-acao { color: var(--an-texto-2); font-size: 12px; white-space: nowrap; }
.an-chat-metricas summary { transition: background .15s; }
.an-chat-metricas summary:hover, .an-chat-metricas summary:focus-visible { background: var(--an-superficie); }
.an-chat-metricas summary:hover .an-chat-metrica-acao { color: var(--an-texto); }
.an-chat-metricas[open] .an-chat-metrica-expandir { transform: rotate(180deg); }
.an-chat-contexto-trilho { display: block; height: 3px; margin: 5px 0; background: var(--an-borda); overflow: hidden; border-radius: 3px; }
.an-chat-contexto-trilho > span { display: block; height: 100%; background: var(--an-ok-claro); border-radius: inherit; }
.an-chat-metricas.atencao .an-chat-contexto-trilho > span { background: #edc477; }
.an-chat-metricas.critico .an-chat-contexto-trilho > span { background: var(--an-erro-claro); }
.an-chat-consumo-resumo { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 12px; color: var(--an-texto-2); font-size: 12px; }
.an-chat-metricas-corpo { position: absolute; bottom: calc(100% + 4px); left: 8px; right: 8px; max-height: min(430px, 56dvh); overflow: auto; overscroll-behavior: contain; padding: 12px; background: var(--an-fundo); border: 1px solid var(--an-borda-forte); border-radius: 12px; box-shadow: var(--an-sombra-alta); }
.an-chat-metricas-cab { display: flex; gap: 8px; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; }
.an-chat-metricas-cab .an-ico { flex: none; height: 24px; width: 24px; }
.an-chat-metricas-grade { display: grid; grid-template-columns: 1fr 1fr; margin: 0; gap: 8px 12px; }
.an-chat-metricas-grade > div { min-width: 0; }
.an-chat-metricas-grade dt { color: var(--an-texto-2); font-size: 12px; line-height: 1.5; }
.an-chat-metricas-grade dd { font-size: 12px; font-variant-numeric: tabular-nums; margin: 0; overflow-wrap: anywhere; }
.an-chat-metricas-nota { color: var(--an-texto-2); font-size: 12px; line-height: 1.5; margin: 10px 0; }
.an-chat-compact-orientacao { font-size: 12px; line-height: 1.5; margin: 10px 0 4px; }
.an-chat-metricas.atencao .an-chat-compact-orientacao { color: #edc477; }
.an-chat-metricas.critico .an-chat-compact-orientacao { color: var(--an-erro-claro); }
.an-chat-compact { font-size: 12px; }
.an-chat-compact-ajuda { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--an-borda); font-size: 12px; line-height: 1.5; }
.an-chat-compact-ajuda p { margin: 6px 0; }
.an-chat-compact-ajuda code { display: block; user-select: text; overflow-wrap: anywhere; }
.an-chat-sessao .an-chat-dono { align-self: flex-start; color: var(--an-marca-clara); font-size: 12px; }
@media(max-width:540px) { .an-chat-metricas summary { padding: 7px 12px; } .an-chat-consumo-resumo { font-size: 12px; } }

.an-chat-sessao .an-chat-historico-remoto { color: var(--an-texto-2); font-size: 12px; }
.an-chat-aviso-historico { border: 1px solid var(--an-borda); border-radius: 10px; background: var(--an-superficie); padding: 10px 12px; margin-bottom: 12px; color: var(--an-texto-2); font-size: 12px; line-height: 1.5; }
.an-chat-aviso-historico strong { color: var(--an-texto); font-size: 12px; }
.an-chat-aviso-historico p { margin: 4px 0 0; }

/* Configuração sob demanda: a conversa ocupa o espaço principal do chat. */
.an-chat-cab { padding: 10px 12px 9px 16px; gap: 8px; min-height: 58px; flex-shrink: 0; }
.an-chat-identidade { min-width: 0; flex: 1; }
.an-chat-identidade > strong { font-size: 15px; }
.an-chat-identidade > .an-chat-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.an-chat-sessao-id { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.45; }
.an-chat-cab .an-chat-acoes { padding: 0; gap: 4px; flex: none; }
.an-chat-cab .an-chat-nova { font-size: 12px; padding: 6px 8px; }
.an-chat-cab .an-chat-uso-rapido { width: 78px; padding: 5px 8px; border: 1px solid var(--an-borda); border-radius: 10px; text-align: left; }
.an-chat-uso-topo { display: flex; justify-content: space-between; gap: 5px; font-size: 12px; line-height: 1.3; font-variant-numeric: tabular-nums; }
.an-chat-uso-janela { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--an-texto-2); font-size: 12px; line-height: 1.5; }
.an-chat-uso-trilho { display: block; height: 2px; margin-top: 2px; border-radius: 2px; background: var(--an-borda); overflow: hidden; }
.an-chat-uso-trilho > span { display: block; height: 100%; border-radius: inherit; background: var(--an-ok-claro); }
.an-chat-uso-rapido.atencao .an-chat-uso-trilho > span { background: #edc477; }
.an-chat-uso-rapido.critico .an-chat-uso-trilho > span { background: var(--an-erro-claro); }
.an-chat-uso-rapido:hover { border-color: var(--an-borda-forte); }
.an-chat-cab .an-ico { width: 28px; height: 28px; }
.an-chat-entrada { padding: 9px 10px; z-index: 4; }
.an-chat-entrada textarea { min-height: 40px; max-height: 108px; resize: none; padding: 8px 10px; line-height: 1.5; }
.an-chat-rodape { gap: 6px; margin-top: 7px; min-width: 0; }
.an-chat-modelo-resumo { min-width: 0; max-width: 100%; flex: 1; display: flex; align-items: center; gap: 5px; padding: 7px 8px; border: 1px solid var(--an-borda); border-radius: 999px; color: var(--an-texto-2); font-size: 12px; text-align: left; }
.an-chat-modelo-resumo:hover,.an-chat-modelo-resumo[aria-expanded=true] { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-chat-resumo-agente { flex: none; max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--an-texto); }
.an-chat-resumo-modelo { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-chat-resumo-esforco { flex: none; white-space: nowrap; }
.an-chat-resumo-seta { flex: none; display: flex; width: 14px; height: 14px; }
.an-chat-resumo-seta svg { width: 14px; height: 14px; }
.an-chat-rodape .an-chat-comandos-abrir { width: 30px; height: 30px; padding: 0; font-size: 16px; }
.an-chat-enviar { width: 32px; height: 32px; flex: none; padding: 7px; display: grid; place-items: center; border-radius: 999px; }
.an-chat-enviar svg { width: 18px; height: 18px; }
.an-chat-configuracao { position: absolute; bottom: calc(100% + 6px); left: 10px; right: 10px; max-height: min(340px, calc(100dvh - 190px)); overflow: auto; overscroll-behavior: contain; background: var(--an-fundo); border: 1px solid var(--an-borda-forte); border-radius: 12px; box-shadow: var(--an-sombra-alta); }
.an-chat-configuracao-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 10px 3px 14px; font-size: 12px; }
.an-chat-configuracao-cab .an-ico { width: 26px; height: 26px; }
.an-chat-configuracao .an-chat-filtros { display: flex; flex-direction: column; flex-wrap: nowrap; gap: 10px; padding: 8px 14px 14px; }
.an-chat-configuracao .an-chat-escolha { flex: none; min-width: 0; }
.an-chat-configuracao .an-chat-escolha > span { font-size: 12px; }
.an-chat-configuracao .an-seletor-botao { padding: 8px 10px; }
@media(max-width:540px) { .an-chat-cab { padding-left: 12px; } .an-chat-modelo-resumo { font-size: 12px; } .an-chat-resumo-agente { max-width: 82px; } }

.an-chat-rodape .an-chat-microfone { width: 30px; height: 30px; flex: none; }
.an-chat-entrada.an-ditando > .an-chat-rodape { display: none; }
.an-chat-entrada > .an-voz-controles { position: static; display: flex; align-items: center; width: 100%; margin-top: 7px; gap: 4px; }
.an-chat-entrada > .an-voz-controles .an-voz-centro { flex: 1; min-width: 0; }
.an-chat-entrada > .an-voz-controles .an-voz-status { overflow-wrap: anywhere; }
.an-chat-entrada > .an-voz-controles .an-ico { width: 30px; height: 30px; flex: none; }

/* Idioma da fala: nome completo no menu, código curto junto ao microfone. */
.an-idioma-ditado { display: flex; flex: none; width: 43px; height: 30px; border-radius: 8px; }
.an-idioma-ditado .an-seletor-botao { gap: 3px; padding: 0 5px; font-size: 12px; color: var(--an-texto-2); }
.an-idioma-ditado .an-seletor-seta svg { width: 12px; height: 12px; }
@media(max-width:540px) { .an-chat-resumo-esforco { max-width: 44px; overflow: hidden; text-overflow: ellipsis; } .an-chat-resumo-agente { max-width: 60px; } }

/* Paleta integrada: controles acessíveis sem abrir o seletor nativo do sistema. */
.an-campo .an-cor-abrir { padding: 0; outline-offset: 3px; overflow: visible; }
.an-cor-abrir:focus-visible { outline: 2px solid var(--an-marca-clara); }
.an-cor-popup { position: fixed; z-index: 90; pointer-events: auto; overflow: auto; overscroll-behavior: contain; padding: 12px; border: 1px solid var(--an-borda-forte); border-radius: 14px; background: var(--an-fundo); color: var(--an-texto); box-shadow: var(--an-sombra-alta); color-scheme: dark; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-cor-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.an-cor-cab strong { font-size: 12px; }
.an-cor-cab .an-ico { width: 26px; height: 26px; flex: none; }
.an-cor-plano { position: relative; width: 100%; height: clamp(100px, 24dvh, 154px); border-radius: 8px; background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); touch-action: none; cursor: crosshair; outline-offset: 3px; }
.an-cor-plano:focus-visible { outline: 2px solid var(--an-marca-clara); }
.an-cor-ponto { position: absolute; width: 12px; height: 12px; border: 2px solid #fff; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 1px #1a1e1d, 0 1px 3px #1a1e1d; pointer-events: none; }
.an-cor-ajuda { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.an-cor-faixa { display: flex; align-items: center; gap: 8px; min-height: 35px; font-size: 12px; color: var(--an-texto-2); }
.an-cor-faixa > span:first-child { flex: none; width: 53px; }
.an-cor-faixa input[type=range] { flex: 1; width: 0; min-width: 0; height: 12px; margin: 0; appearance: none; border-radius: 999px; outline-offset: 4px; cursor: pointer; }
.an-cor-matiz { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.an-cor-alpha { background-image: linear-gradient(to right, rgba(var(--an-cor-rgb), 0), rgba(var(--an-cor-rgb), 1)), conic-gradient(var(--an-borda-forte) 25%, var(--an-superficie) 0 50%, var(--an-borda-forte) 0 75%, var(--an-superficie) 0); background-size: auto, 8px 8px; }
.an-cor-faixa input[type=range]::-webkit-slider-thumb { appearance: none; width: 17px; height: 17px; border: 2px solid #fff; border-radius: 50%; background: var(--an-superficie-alta); box-shadow: 0 1px 3px #0008; }
.an-cor-faixa input[type=range]::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid #fff; border-radius: 50%; background: var(--an-superficie-alta); }
.an-cor-percentual { width: 30px; text-align: right; font-variant-numeric: tabular-nums; }
.an-cor-valores { display: grid; grid-template-columns: minmax(85px, 1.7fr) repeat(3, minmax(0, 1fr)); gap: 6px; padding-top: 6px; }
.an-cor-valores label { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--an-texto-2); font-size: 12px; }
.an-cor-valores input { width: 100%; min-width: 0; padding: 7px 5px; border: 1px solid var(--an-borda); border-radius: 7px; background: var(--an-superficie-alta); color: var(--an-texto); font-size: 12px; outline: none; }
.an-cor-valores input:focus { border-color: var(--an-marca-clara); box-shadow: var(--an-foco); }
.an-cor-valores input[aria-invalid=true], .an-campo input[aria-invalid=true] { color: var(--an-erro-claro); }
.an-cor-valores input[type=number] { appearance: textfield; }
.an-cor-valores input::-webkit-inner-spin-button { appearance: none; }
/* O scroll acompanha o tema apenas nas superfícies do chat. */
:is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista) { scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; color-scheme: dark; scrollbar-gutter: stable; }
:is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista)::-webkit-scrollbar { width: 7px; height: 7px; }
:is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista)::-webkit-scrollbar-track { background: transparent; }
:is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista)::-webkit-scrollbar-thumb { background: var(--an-borda-forte); border: 2px solid var(--an-fundo); border-radius: 999px; }
:is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista)::-webkit-scrollbar-thumb:hover { background: var(--an-texto-3); }
@supports selector(::-webkit-scrollbar) {
  :is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista) { scrollbar-width: auto; scrollbar-color: auto; }
  :is(.an-chat-mensagens, .an-chat-sessoes, .an-chat-metricas-corpo, .an-chat-configuracao, .an-chat-comandos-lista)::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
.an-chat-comandos { display: flex; flex-direction: column; max-height: min(320px, calc(100dvh - 180px)); }
.an-chat-comandos-cab { flex: none; min-width: 0; }
.an-chat-comandos-cab strong { min-width: 0; overflow-wrap: anywhere; }
.an-chat-comandos-lista { min-height: 0; overflow-x: hidden; }

/* A conta tem janelas compartilhadas; a sessão mantém seu próprio contexto. */
.an-chat-metricas-abas { display: flex; gap: 4px; padding: 3px; margin: 0 0 12px; border: 1px solid var(--an-borda); border-radius: 9px; background: var(--an-superficie); }
.an-chat-metricas-abas button { flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; color: var(--an-texto-2); font-size: 12px; }
.an-chat-metricas-abas button[aria-selected=true] { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-chat-sessao-titulo { display: block; font-size: 12px; margin-bottom: 10px; }
.an-chat-conta-cab, .an-chat-conta-linha { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
.an-chat-conta-cab strong, .an-chat-conta-linha strong { min-width: 0; overflow-wrap: anywhere; }
.an-chat-conta-plano { max-width: 45%; overflow-wrap: anywhere; border: 1px solid var(--an-borda); border-radius: 999px; padding: 3px 7px; color: var(--an-texto-2); font-size: 12px; }
.an-chat-conta-grupo { margin: 14px 0 7px; font-size: 12px; color: var(--an-texto-2); overflow-wrap: anywhere; }
.an-chat-conta-janela { padding: 10px 0; }
.an-chat-conta-linha > span { flex: none; color: var(--an-texto-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.an-chat-conta-trilho { height: 5px; margin-top: 7px; border-radius: 999px; overflow: hidden; background: var(--an-borda); }
.an-chat-conta-trilho > span { display: block; height: 100%; background: var(--an-ok-claro); border-radius: inherit; }
.an-chat-conta-janela.atencao .an-chat-conta-trilho > span { background: #edc477; }
.an-chat-conta-janela.critico .an-chat-conta-trilho > span { background: var(--an-erro-claro); }
.an-chat-conta-renovacao { margin: 6px 0 0; color: var(--an-texto-2); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.an-chat-conta-fonte { padding-top: 9px; margin-top: 6px; border-top: 1px solid var(--an-borda); color: var(--an-texto-3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.an-chat-conta-fonte p { margin: 3px 0; }
.an-chat-conta-indisponivel, .an-chat-conta-aviso { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; margin: 14px 0; }
.an-chat-conta-aviso { color: #edc477; }
.an-chat-conta-login { margin: 10px 0; color: var(--an-texto-2); font-size: 12px; line-height: 1.5; }
.an-chat-conta-login summary { cursor: pointer; color: var(--an-texto); padding: 5px 0; }
.an-chat-conta-login p { margin: 8px 0; }
.an-chat-conta-login code { display: block; padding: 8px 10px; border: 1px solid var(--an-borda); border-radius: 8px; background: var(--an-superficie-alta); color: var(--an-texto); user-select: text; overflow-wrap: anywhere; }
.an-chat-conta-login a { color: var(--an-ok-claro); }
.an-chat-conta-verificar { margin: 2px 0 8px; font-size: 12px; }


/* Conversa de lotes: histórico, progresso publicado e acesso ao chat do autor. */
.an-conversa { width: min(420px, calc(100vw - 16px)); max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); min-height: min(280px, calc(100dvh - 16px)); }
.an-conversa > .cab, .an-conversa > .entrada, .an-conversa-navegacao, .an-conversa-atividade, .an-conversa-atalhos { flex: none; }
.an-conversa .fluxo { min-height: 50px; overflow-wrap: anywhere; }
.an-conversa-navegacao { padding: 10px 12px 6px; }
.an-conversa-historico { display: grid; gap: 5px; font-size: 12px; color: var(--an-texto-2); min-width: 0; }
.an-conversa-historico .an-seletor-gatilho { width: 100%; max-width: 100%; text-align: left; }
.an-conversa-atividade { display: grid; gap: 4px; padding: 8px 12px; font-size: 12px; line-height: 1.4; border-bottom: 1px solid var(--an-borda); }
.an-conversa-atividade strong { color: var(--an-marca-clara); }
.an-conversa-atividade.falha strong { color: var(--an-erro-claro); }
.an-conversa-atividade > span { color: var(--an-texto-2); max-height: 64px; overflow: auto; overflow-wrap: anywhere; scrollbar-width: thin; }
.an-conversa-atalhos { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 12px 0; }
.an-conversa-atalhos .an-btn { padding: 6px 8px; font-size: 12px; }
.an-conversa-erro { padding: 8px 12px; color: var(--an-erro-claro); font-size: 12px; }
.an-conversa-redimensionar { position: absolute; bottom: 1px; right: 1px; width: 20px; height: 20px; color: var(--an-texto-2); cursor: nwse-resize; touch-action: none; padding: 2px; background: transparent; border: 0; }
.an-conversa-redimensionar svg { width: 100%; height: 100%; }
.an-conversa .entrada { margin-right: 16px; }
.an-barra .an-estado { max-width: 110px; padding-inline: 8px; font-size: 12px; gap: 5px; }
@media (min-width: 641px) and (max-width: 1000px) {
  .an-barra:has(.an-estado:not(:empty)) .titulo { max-width: 45px; }
  .an-barra:has(.an-estado:not(:empty)) > .an-sep { display: none; }
  .an-barra:has(.an-estado:not(:empty)) .an-titulo-prefixo { display: none; }
}
@media (max-width: 640px) {
  .an-barra .an-estado:not(:empty) { flex: 0 0 auto; max-width: 110px; }
}
`;
