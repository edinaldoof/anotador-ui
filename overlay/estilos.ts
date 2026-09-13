const CSS_OVERLAY = `
:host {
  all: initial;
  /* ---------- paleta do anotador ----------
     Cores sólidas e nomeadas. Só três lugares guardam transparência, e por necessidade:
     sombra, anel de foco e a caixa que marca o elemento na página (precisa deixar ver o que está sob ela). */
  --an-fundo: #1a1e1d;
  --an-superficie: #212625;
  --an-superficie-alta: #2b302f;
  --an-borda: #373d3c;
  --an-borda-forte: #4c5453;
  --an-texto: #dde2e0;
  --an-texto-2: #9aa2a0;
  --an-texto-3: #79817f;
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Helvetica Neue", var(--font-filson, var(--an-fonte-pagina, system-ui)), "Segoe UI", Roboto, sans-serif;
}
[hidden] { display: none !important; }
.arrastando, .arrastando * { cursor: grabbing !important; user-select: none !important; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; background: transparent; }
.mono { font-family: "SF Mono", var(--font-mono, ui-monospace), "JetBrains Mono", Menlo, Consolas, monospace; }
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
  white-space: nowrap; font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace);
}

.an-barra {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 7px 0 6px; line-height: 1;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 999px;
  box-shadow: var(--an-sombra); white-space: nowrap; max-width: calc(100vw - 24px);
}
.an-barra > * { flex: none; }
.an-sep { width: 1px; height: 18px; background: var(--an-borda); margin: 0 3px; }
.an-barra .titulo { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; cursor: grab; user-select: none; }
.an-barra .titulo .url { font-weight: 400; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; }
.an-barra .an-alca { color: var(--an-texto-2); }
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
  background: var(--an-ok); color: var(--an-sobre-cor); font-weight: 700; font-size: 13px;
}
.an-enviar:hover { background: var(--an-ok); }
.an-enviar:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-enviar .n { background: var(--an-ok-fundo); border-radius: 999px; min-width: 18px; height: 18px; padding: 0 6px; display: grid; place-items: center; font-size: 11px; line-height: 1; }
.an-enviar:disabled .n { background: var(--an-borda); }
.an-estado {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 10px; border-radius: 999px;
  background: var(--an-superficie-alta); color: var(--an-texto); font-size: 12px; font-weight: 700; max-width: 300px;
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
  position: fixed; right: 14px; top: 62px; width: min(380px, calc(100vw - 28px)); max-height: calc(100vh - 80px);
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
.an-linha label .sub { color: var(--an-texto-2); font-size: 11px; display: block; background: transparent; border: 0; padding: 0; }
.an-campo {
  display: flex; align-items: center; gap: 6px; background: var(--an-superficie-alta); border: 1px solid var(--an-borda); border-radius: 10px; padding: 0 10px; height: 34px;
}
.an-campo:focus-within { border-color: var(--an-marca-clara); }
/* width: 0 zera a largura intrínseca do input (size=20 ≈ 190px), que senão dita o mínimo da coluna do grid. */
.an-campo input, .an-campo select { flex: 1 1 0; width: 0; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--an-sobre-cor); height: 100%; }
.an-campo select option { background: var(--an-superficie-alta); color: var(--an-sobre-cor); }
.an-campo input.mono, .an-campo select { font-size: 12.5px; }
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
.an-seletor .pts { background: var(--an-superficie-alta); border-radius: 6px; padding: 1px 6px; font-size: 11px; white-space: nowrap; }
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Helvetica Neue", var(--font-filson, var(--an-fonte-pagina, system-ui)), "Segoe UI", Roboto, sans-serif;
  font-size: 13px; font-weight: 700; line-height: 1; box-shadow: var(--an-sombra);
  cursor: grab; user-select: none; touch-action: none;
}
.an-religar:hover { background: var(--an-superficie-alta); border-color: var(--an-borda-forte); }
.an-religar .an-alca { width: 18px; height: 26px; }
.an-religar-ico { width: 26px; height: 26px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); display: grid; place-items: center; flex: none; }
.an-religar-ico svg { width: 15px; height: 15px; }
.an-religar .n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--an-ok); color: var(--an-sobre-cor); font-size: 11px; display: grid; place-items: center; }
.an-religar.aguardando .n { background: var(--an-aviso); color: var(--an-fundo); }

.an-fila {
  position: fixed; width: 440px; max-height: 60vh; pointer-events: auto;
  background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 14px; box-shadow: var(--an-sombra-alta); overflow: auto;
}
.an-fila .item { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--an-superficie-alta); align-items: flex-start; }
.an-fila .item:last-child { border-bottom: 0; }
.an-fila .num { width: 22px; height: 22px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
.an-fila .txt { flex: 1; min-width: 0; }
.an-fila .txt .el { color: var(--an-texto-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-fila .txt .com { color: var(--an-sobre-cor); }
.an-fila .txt .alt { color: var(--an-ok-claro); font-size: 12px; }
.an-fila .vazio { padding: 16px; color: var(--an-texto-2); text-align: center; }
.an-fila .cab-lotes { padding: 8px 12px 4px; color: var(--an-texto-2); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.an-fila .item.lote { cursor: pointer; }
.an-fila .item.lote:hover { background: var(--an-superficie); }
.an-fila .item.lote .perg { color: var(--an-aviso-claro); font-size: 12px; }

.an-conversa {
  position: fixed; left: 14px; bottom: 14px; width: 420px; max-height: min(74vh, 680px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 20px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-conversa .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-superficie-alta); background: var(--an-superficie); }
.an-conversa .cab .marca { width: 28px; height: 28px; border-radius: 9px; background: var(--an-superficie-alta); display: grid; place-items: center; flex: none; }
.an-conversa .cab .marca svg { width: 17px; height: 17px; }
.an-conversa .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-conversa .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-conversa .fluxo { flex: 1; overflow: auto; padding: 14px 13px 6px; display: flex; flex-direction: column; gap: 15px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-conversa .vazio { color: var(--an-texto-2); text-align: center; padding: 22px 10px; font-size: 12.5px; line-height: 1.5; }

/* mensagem do agente: avatar + texto corrido; do usuário: balão à direita (padrão do Nexus UI) */
.an-msg { display: flex; gap: 9px; }
.an-msg.agente { align-self: stretch; }
.an-msg.agente .av { width: 26px; height: 26px; border-radius: 8px; background: var(--an-superficie); display: grid; place-items: center; flex: none; margin-top: 1px; }
.an-msg.agente .av svg { width: 16px; height: 16px; }
.an-msg .corpo { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; }
.an-msg .quem { color: var(--an-texto-2); font-size: 11px; }
.an-msg.agente .balao { color: var(--an-texto); line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg.usuario { align-self: flex-end; max-width: 88%; }
.an-msg.usuario .corpo { align-items: flex-end; }
.an-msg.usuario .balao { background: var(--an-superficie-alta); color: var(--an-sobre-cor); border-radius: 16px 16px 5px 16px; padding: 9px 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg .escolhida { color: var(--an-ok-claro); font-size: 12px; display: flex; align-items: center; gap: 6px; }
.an-msg .escolhida::before { content: "✓"; font-weight: 700; }

/* perguntas com opções */
.an-perguntas { display: flex; flex-direction: column; gap: 6px; padding: 9px; background: var(--an-superficie); border: 1px solid var(--an-superficie-alta); border-radius: 14px; }
.an-perguntas .rot { color: var(--an-texto-2); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 1px 3px 3px; }
.an-opcao {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; padding: 9px 11px; border-radius: 10px;
  background: var(--an-fundo); border: 1px solid var(--an-borda); color: var(--an-texto); font-size: 12.5px; line-height: 1.35;
}
.an-opcao:hover { border-color: var(--an-marca-clara); background: var(--an-marca-fundo); }
.an-opcao .mira { width: 14px; height: 14px; border-radius: 999px; border: 1.6px solid var(--an-borda-forte); flex: none; }
.an-opcao.marcada { border-color: var(--an-marca-clara); background: var(--an-marca-fundo); }
.an-opcao.marcada .mira { border-color: var(--an-marca-clara); box-shadow: inset 0 0 0 3px var(--an-marca-clara); }
.an-opcao.livre { border-style: dashed; color: var(--an-texto-2); }
.an-opcao:disabled { opacity: .5; cursor: default; }

/* entrada: caixa única com a área de texto em cima e as ações embaixo */
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
.an-conversa .entrada .acoes .atalho { color: var(--an-texto-3); font-size: 10.5px; padding-left: 4px; }
.an-conversa .entrada .an-ok { width: 32px; height: 32px; background: var(--an-marca); }
.an-conversa .entrada .an-ok:hover { background: var(--an-marca-forte); }
.an-conversa .entrada .an-ok:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-conversa .dica-resp { padding: 0 15px 6px; color: var(--an-aviso-claro); font-size: 11.5px; }
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
.an-area .n { position: absolute; left: -1.5px; bottom: 100%; margin-bottom: 4px; background: var(--an-fundo); color: var(--an-sobre-cor); font-size: 11px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); }

.an-arvore {
  position: fixed; left: 14px; top: 62px; width: min(360px, calc(100vw - 28px)); max-height: min(70vh, 640px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 18px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-arvore .cab { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--an-superficie-alta); background: var(--an-superficie); cursor: grab; user-select: none; }
.an-arvore .cab .tit { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-arvore .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-arvore .cab .an-ico.ativo { background: var(--an-marca-fundo); color: var(--an-marca-clara); }
.an-btn.mini { padding: 5px 10px; font-size: 12px; flex: none; }
.an-arvore .corpo { position: relative; flex: 1; overflow: auto; padding: 6px 6px 8px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; outline: 0; }
.an-arvore .dica-uso { padding: 6px 12px 8px; border-top: 1px solid var(--an-superficie-alta); color: var(--an-texto-3); font-size: 10.5px; line-height: 1.35; }
.an-no {
  display: flex; align-items: center; gap: 5px; height: 22px; padding-right: 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; white-space: nowrap; color: var(--an-texto); outline: 0; min-width: 0;
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
.an-no .comp { flex: none; color: var(--an-marca-clara); background: var(--an-marca-fundo); border-radius: 4px; padding: 1px 5px; font-size: 10.5px; font-weight: 700; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.an-no .nome { flex: none; font-size: 12px; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.an-no .tag { color: var(--an-texto); }
.an-no .id { color: var(--an-aviso-claro); }
.an-no .cls { color: var(--an-texto-2); }
.an-no .txt { color: var(--an-texto-2); font-style: italic; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.an-no .pin { flex: none; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--an-marca); color: var(--an-sobre-cor); font-size: 10px; font-weight: 700; display: grid; place-items: center; }
.an-no .pin.enviado { background: var(--an-ok); }
.an-no .dim { margin-left: auto; flex: none; color: var(--an-texto-3); font-size: 10.5px; font-family: var(--font-mono, ui-monospace, monospace); padding-left: 6px; }
.an-mais { height: 20px; display: flex; align-items: center; color: var(--an-texto-2); font-size: 11px; cursor: pointer; border-radius: 6px; }
.an-mais:hover { color: var(--an-sobre-cor); background: var(--an-superficie-alta); }

/* ---------- explorador do sistema de design ---------- */
.an-realce { position: fixed; pointer-events: none; border: 1.5px solid var(--an-marca-clara); background: var(--an-marcacao); border-radius: 2px; }
.an-design {
  position: fixed; right: 14px; bottom: 14px; width: 380px; max-height: min(76vh, 700px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda); border-radius: 18px;
  box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-design .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-borda); background: var(--an-superficie); }
.an-design .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; }
.an-design .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-design .abas { display: flex; flex-wrap: wrap; gap: 3px; padding: 8px 9px; border-bottom: 1px solid var(--an-borda); }
.an-design .aba {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; flex: none;
  background: transparent; color: var(--an-texto-2); font-size: 12px; font-weight: 600; white-space: nowrap;
}
.an-design .aba:hover { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-design .aba.ativa { background: var(--an-superficie-alta); color: var(--an-texto); }
.an-design .aba .n { background: var(--an-superficie); border-radius: 999px; padding: 1px 6px; font-size: 10.5px; color: var(--an-texto-2); }
.an-design .aba.ativa .n { background: var(--an-borda); color: var(--an-texto); }
.an-design .aba.alerta { color: var(--an-aviso-claro); }
.an-design .aba.alerta .n { background: var(--an-aviso-fundo); color: var(--an-aviso-claro); }
.an-design .corpo { flex: 1; overflow: auto; padding: 6px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-design .vazio { color: var(--an-texto-2); text-align: center; padding: 22px 10px; font-size: 12.5px; }
.an-valor { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 10px; cursor: pointer; width: 100%; text-align: left; }
.an-valor:hover { background: var(--an-superficie); }
.an-valor .amostra { width: 26px; height: 26px; border-radius: 7px; flex: none; display: grid; place-items: center; }
.an-valor .amostra.cor { border: 1px solid var(--an-borda-forte); }
.an-valor .amostra.medida { background: var(--an-superficie-alta); color: var(--an-texto-2); font-size: 11px; font-weight: 700; font-family: var(--font-mono, ui-monospace, monospace); }
.an-valor .col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.an-valor .titulo { font-size: 12.5px; color: var(--an-texto); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-valor .sub { font-size: 11px; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-valor .usos { flex: none; min-width: 26px; text-align: right; color: var(--an-texto-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.an-valor.fora .titulo { color: var(--an-aviso-claro); }
.an-valor .motivo { flex-basis: 100%; color: var(--an-texto-3); font-size: 11px; }
.an-design .rodape { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--an-borda); color: var(--an-texto-3); font-size: 10.5px; }
.an-design .rodape .dica { flex: 1; }
.an-design .rodape .fonte { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.an-barra .an-ico.ativo { background: var(--an-superficie-alta); color: var(--an-texto); }

/* ---------- avaliação da página ---------- */
.an-avaliacao {
  position: fixed; right: 14px; top: 62px; width: 400px; max-height: min(78vh, 720px); pointer-events: auto;
  display: flex; flex-direction: column; background: var(--an-fundo); border: 1px solid var(--an-borda);
  border-radius: 18px; box-shadow: var(--an-sombra-alta); overflow: hidden;
}
.an-avaliacao .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid var(--an-borda); background: var(--an-superficie); }
.an-avaliacao .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; }
.an-avaliacao .cab .tit .sub { display: block; color: var(--an-texto-2); font-size: 11px; font-weight: 400; }
.an-avaliacao .corpo { flex: 1; overflow: auto; padding: 6px; scrollbar-width: thin; scrollbar-color: var(--an-borda-forte) transparent; }
.an-avaliacao .secao { color: var(--an-texto-3); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 10px 8px 5px; }
.an-avaliacao .vazio { color: var(--an-texto-2); font-size: 12.5px; padding: 10px 8px; }
.an-avaliacao .aguardando { color: var(--an-aviso-claro); font-size: 12.5px; padding: 10px 8px; }
.an-avaliacao .resumo { color: var(--an-texto); font-size: 12.5px; line-height: 1.5; padding: 4px 8px 8px; }
.an-avaliacao .erro { color: var(--an-erro-claro); font-size: 12px; padding: 0 12px 10px; }
.an-achado { display: flex; gap: 9px; padding: 8px 9px; border-radius: 10px; cursor: pointer; align-items: flex-start; }
.an-achado:hover { background: var(--an-superficie); }
.an-achado .sinal { width: 7px; height: 7px; border-radius: 999px; flex: none; margin-top: 5px; background: var(--an-texto-3); }
.an-achado.alta .sinal { background: var(--an-erro); }
.an-achado.media .sinal { background: var(--an-aviso); }
.an-achado .col { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.an-achado .titulo { font-size: 12.5px; font-weight: 600; color: var(--an-texto); display: flex; align-items: center; gap: 7px; }
.an-achado .cat { font-size: 10px; font-weight: 600; color: var(--an-marca-clara); background: var(--an-marca-fundo); border-radius: 999px; padding: 1px 7px; }
.an-achado .an-selo { font-size: 9.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--an-texto-3); border: 1px solid var(--an-borda); border-radius: 999px; padding: 0 6px; flex: none; }
.an-achado .sub { font-size: 11.5px; color: var(--an-texto-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-achado .evid { font-size: 11.5px; color: var(--an-texto-3); line-height: 1.45; }
.an-achado .sugestao { font-size: 11.5px; color: var(--an-ok-claro); line-height: 1.45; }
.an-achado .aplicar { font-size: 11px; color: var(--an-marca-clara); line-height: 1.4; }
.an-achado.parecer { cursor: default; align-items: flex-start; }
.an-btn.mini { padding: 4px 10px; font-size: 11.5px; flex: none; align-self: center; }
.an-btn.primario { background: var(--an-marca); }
.an-btn.primario:hover { background: var(--an-marca-forte); }
.an-btn.primario:disabled { background: var(--an-superficie-alta); color: var(--an-texto-3); cursor: default; }
.an-avaliacao .rodape { display: flex; gap: 7px; padding: 9px 10px; border-top: 1px solid var(--an-borda); }
.an-avaliacao .rodape input {
  flex: 1; min-width: 0; background: var(--an-superficie-alta); border: 1px solid var(--an-borda);
  border-radius: 10px; padding: 7px 11px; color: var(--an-texto); outline: 0; font-size: 12.5px;
}
.an-avaliacao .rodape input:focus { border-color: var(--an-marca-clara); box-shadow: var(--an-foco); }
.an-avaliacao .rodape input::placeholder { color: var(--an-texto-3); }

.an-pergunta { display: flex; flex-direction: column; gap: 7px; margin: 8px 8px 10px; padding: 10px 11px; background: var(--an-aviso-fundo); border-radius: 12px; }
.an-pergunta .txt { color: var(--an-aviso-claro); font-size: 12.5px; line-height: 1.45; }
.an-pergunta .opcoes { display: flex; flex-direction: column; gap: 5px; }
.an-pergunta input {
  background: var(--an-superficie); border: 1px solid var(--an-borda); border-radius: 9px;
  padding: 6px 10px; color: var(--an-texto); outline: 0; font-size: 12px;
}
.an-pergunta input:focus { border-color: var(--an-marca-clara); }
.an-pergunta input::placeholder { color: var(--an-texto-3); }
.an-pergunta .respondida { color: var(--an-ok-claro); font-size: 12px; }
`;
