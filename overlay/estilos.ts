const CSS_OVERLAY = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.an-raiz {
  position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font-size: 13px; line-height: 1.4; color: #e7e7e7;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Helvetica Neue", var(--font-filson, var(--an-fonte-pagina, system-ui)), "Segoe UI", Roboto, sans-serif;
}
[hidden] { display: none !important; }
.arrastando, .arrastando * { cursor: grabbing !important; user-select: none !important; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; border: 0; background: transparent; }
.mono { font-family: "SF Mono", var(--font-mono, ui-monospace), "JetBrains Mono", Menlo, Consolas, monospace; }
.an-alca { width: 22px; height: 30px; border-radius: 999px; display: grid; place-items: center; color: #8b918e; cursor: grab; touch-action: none; user-select: none; flex: none; }
.an-alca:hover { color: #fff; background: #2c302f; }
.an-alca svg { width: 16px; height: 16px; }

.an-caixa {
  position: fixed; pointer-events: none; border: 2px solid #2563eb;
  background: rgba(37,99,235,.10); border-radius: 3px; display: none;
}
.an-caixa.selecao { border-color: #1d4ed8; background: transparent; }
.an-dica {
  position: fixed; pointer-events: none; background: #1e293b; color: #fff; padding: 2px 8px;
  border-radius: 4px; display: none; max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace);
}

.an-barra {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 7px 0 6px; line-height: 1;
  background: #1f2221; border: 1px solid #343837; border-radius: 999px;
  box-shadow: 0 8px 30px rgba(0,0,0,.35); white-space: nowrap; max-width: calc(100vw - 24px);
}
.an-barra > * { flex: none; }
.an-sep { width: 1px; height: 18px; background: #363b3a; margin: 0 3px; }
.an-barra .titulo { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; cursor: grab; user-select: none; }
.an-barra .titulo .url { font-weight: 400; color: #a3a8a6; overflow: hidden; text-overflow: ellipsis; }
.an-barra .an-alca { color: #9aa09d; }
.an-ico { width: 30px; height: 30px; border-radius: 999px; display: grid; place-items: center; color: #cfd4d2; flex: none; }
.an-ico:hover { background: #2c302f; color: #fff; }
.an-ico:disabled { opacity: .3; cursor: default; background: transparent; }
.an-ico svg { width: 16px; height: 16px; }
.an-modo { display: flex; align-items: center; height: 30px; padding: 2px; background: #2a2e2d; border-radius: 999px; }
.an-modo button { height: 26px; padding: 0 11px; border-radius: 999px; color: #b9bebc; font-size: 12px; font-weight: 700; line-height: 26px; }
.an-modo button:hover { color: #fff; }
.an-modo button.ativo { background: #3b4240; color: #fff; }
.an-enviar {
  display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px 0 14px; border-radius: 999px;
  background: #2f9e6a; color: #fff; font-weight: 700; font-size: 13px;
}
.an-enviar:hover { background: #35b078; }
.an-enviar:disabled { background: #2a2e2d; color: #7f8a86; cursor: default; }
.an-enviar .n { background: rgba(255,255,255,.22); border-radius: 999px; min-width: 18px; height: 18px; padding: 0 6px; display: grid; place-items: center; font-size: 11px; line-height: 1; }
.an-enviar:disabled .n { background: #363b3a; }
.an-estado {
  display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 10px; border-radius: 999px;
  background: #2a2e2d; color: #c7ccca; font-size: 12px; font-weight: 700; max-width: 300px;
}
.an-estado::before { content: ""; width: 8px; height: 8px; border-radius: 999px; background: currentColor; flex: none; animation: an-pulsar 1.6s ease-in-out infinite; }
.an-estado:hover { filter: brightness(1.12); }
.an-estado:empty { display: none; }
.an-estado.ok { background: #213b30; color: #7ee2b0; }
.an-estado.ok::before { animation: none; }
.an-estado.andamento { background: #3d3218; color: #f2c14e; }
.an-estado.erro { background: #472626; color: #f28b82; }
.an-estado.erro::before { animation: none; }
@keyframes an-pulsar { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

.an-pin {
  position: fixed; pointer-events: auto; width: 24px; height: 24px; border-radius: 999px;
  background: #2563eb; color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35); transform: translate(-50%, -50%);
}
.an-pin.enviado { background: #2f9e6a; }
.an-pin.perdido { background: #9ca3af; }
.an-pin:hover { transform: translate(-50%, -50%) scale(1.08); }
.an-balao {
  position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 4px;
  background: #1f2221; border: 1px solid #343837; border-radius: 999px; padding: 4px 6px;
  box-shadow: 0 8px 30px rgba(0,0,0,.35); min-width: 300px; max-width: min(520px, calc(100vw - 24px));
}
.an-balao input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; padding: 6px 4px; color: #fff; }
.an-balao input::placeholder { color: #8b918e; }
.an-ico.grav { color: #f28b82; }

.an-painel {
  position: fixed; right: 14px; top: 62px; width: min(380px, calc(100vw - 28px)); max-height: calc(100vh - 80px);
  pointer-events: auto; display: flex; flex-direction: column;
  background: #1f2221; border: 1px solid #343837; border-radius: 18px; box-shadow: 0 16px 50px rgba(0,0,0,.45);
  overflow: hidden;
}
.an-painel .cab { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; }
.an-painel .cab .an-ico { background: #2c302f; }
.an-painel .cab textarea {
  flex: 1; resize: none; background: transparent; border: 0; outline: 0; color: #fff; min-height: 24px; max-height: 96px; padding: 4px 2px;
}
.an-painel .cab textarea::placeholder { color: #8b918e; }
.an-painel .sub {
  display: flex; align-items: center; justify-content: space-between; padding: 6px 14px 8px; border-bottom: 1px solid #2c302f;
  background: #242827; cursor: grab; user-select: none;
}
.an-painel .sub .acoes { display: flex; align-items: center; gap: 2px; }
.an-painel .sub .tag { font-weight: 700; }
.an-painel .sub .comp { color: #a3a8a6; font-size: 12px; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; display: inline-block; vertical-align: bottom; }
.an-painel .corpo { overflow: auto; padding: 4px 14px 8px; scrollbar-width: thin; scrollbar-color: #4a5150 transparent; }
.an-secao { padding: 8px 0; border-bottom: 1px solid #2c302f; }
.an-secao:last-child { border-bottom: 0; }
.an-linha { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 176px); align-items: center; gap: 10px; min-height: 40px; }
.an-linha.larga { grid-template-columns: minmax(0, 1fr) minmax(160px, 236px); }
.an-linha > * { min-width: 0; }
@media (max-width: 480px) {
  .an-linha, .an-linha.larga { grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 4px 0; }
}
.an-linha label { color: #d6dad8; }
.an-linha label .sub { color: #8b918e; font-size: 11px; display: block; background: transparent; border: 0; padding: 0; }
.an-campo {
  display: flex; align-items: center; gap: 6px; background: #2a2e2d; border: 1px solid #383d3c; border-radius: 10px; padding: 0 10px; height: 34px;
}
.an-campo:focus-within { border-color: #4b8bf5; }
/* width: 0 zera a largura intrínseca do input (size=20 ≈ 190px), que senão dita o mínimo da coluna do grid. */
.an-campo input, .an-campo select { flex: 1 1 0; width: 0; min-width: 0; background: transparent; border: 0; outline: 0; color: #fff; height: 100%; }
.an-campo select option { background: #2a2e2d; color: #fff; }
.an-campo input.mono, .an-campo select { font-size: 12.5px; }
.an-campo .un { color: #8b918e; font-size: 12px; }
.an-campo .sw { width: 18px; height: 18px; border-radius: 999px; border: 2px solid #4a5150; flex: none; position: relative; overflow: hidden; }
.an-campo .sw input[type=color] { position: absolute; inset: -8px; width: 40px; height: 40px; padding: 0; border: 0; cursor: pointer; opacity: 0; }
.an-campo.alterado { border-color: #2f9e6a; }
.an-quatro { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; min-width: 0; }
.an-quatro .an-campo { padding: 0 6px; min-width: 0; }
.an-quatro .an-campo input { text-align: center; }
.an-titulo-sec { display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: #d6dad8; }
.an-seletor { padding: 8px 0 4px; }
.an-seletor .melhor { display: flex; align-items: center; gap: 6px; color: #a3a8a6; font-size: 12px; }
.an-seletor code { color: #cfe3ff; font-size: 12px; word-break: break-all; }
.an-seletor code.classes { color: #a3a8a6; }
.an-seletor .pts { background: #2c302f; border-radius: 6px; padding: 1px 6px; font-size: 11px; white-space: nowrap; }
.an-rodape { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid #2c302f; }
.an-rodape .esp { flex: 1; }
.an-btn { padding: 8px 14px; border-radius: 999px; background: #2c302f; color: #fff; }
.an-btn:hover { background: #363b3a; }
.an-btn.perigo:hover { background: #5a2a2a; }
.an-ok { width: 38px; height: 38px; border-radius: 999px; background: #2f9e6a; color: #fff; display: grid; place-items: center; }
.an-ok:hover { background: #35b078; }
.an-ok svg { width: 18px; height: 18px; }
.an-religar {
  position: fixed; right: 14px; bottom: 14px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px; background: #1f2221; border: 1px solid #343837; border-radius: 999px; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Helvetica Neue", var(--font-filson, var(--an-fonte-pagina, system-ui)), "Segoe UI", Roboto, sans-serif;
  font-size: 13px; font-weight: 700; line-height: 1; box-shadow: 0 8px 30px rgba(0,0,0,.35);
  cursor: grab; user-select: none; touch-action: none;
}
.an-religar:hover { background: #262a29; border-color: #4a5150; }
.an-religar .an-alca { width: 18px; height: 26px; }
.an-religar-ico { width: 26px; height: 26px; border-radius: 999px; background: #2563eb; color: #fff; display: grid; place-items: center; flex: none; }
.an-religar-ico svg { width: 15px; height: 15px; }
.an-religar .n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: #2f9e6a; color: #fff; font-size: 11px; display: grid; place-items: center; }
.an-religar.aguardando .n { background: #d99a2b; color: #1f2221; }

.an-fila {
  position: fixed; width: 440px; max-height: 60vh; pointer-events: auto;
  background: #1f2221; border: 1px solid #343837; border-radius: 14px; box-shadow: 0 16px 50px rgba(0,0,0,.45); overflow: auto;
}
.an-fila .item { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #2c302f; align-items: flex-start; }
.an-fila .item:last-child { border-bottom: 0; }
.an-fila .num { width: 22px; height: 22px; border-radius: 999px; background: #2563eb; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
.an-fila .txt { flex: 1; min-width: 0; }
.an-fila .txt .el { color: #a3a8a6; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-fila .txt .com { color: #fff; }
.an-fila .txt .alt { color: #7ee2b0; font-size: 12px; }
.an-fila .vazio { padding: 16px; color: #8b918e; text-align: center; }
.an-fila .cab-lotes { padding: 8px 12px 4px; color: #8b918e; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.an-fila .item.lote { cursor: pointer; }
.an-fila .item.lote:hover { background: #242827; }
.an-fila .item.lote .perg { color: #f2c14e; font-size: 12px; }

.an-conversa {
  position: fixed; left: 14px; bottom: 14px; width: 420px; max-height: min(74vh, 680px); pointer-events: auto;
  display: flex; flex-direction: column; background: #1b1e1d; border: 1px solid #343837; border-radius: 20px;
  box-shadow: 0 18px 56px rgba(0,0,0,.5); overflow: hidden;
}
.an-conversa .cab { display: flex; align-items: center; gap: 9px; padding: 10px 10px 10px 12px; border-bottom: 1px solid #2a2f2e; background: #202423; }
.an-conversa .cab .marca { width: 28px; height: 28px; border-radius: 9px; background: #2a2f2e; display: grid; place-items: center; flex: none; }
.an-conversa .cab .marca svg { width: 17px; height: 17px; }
.an-conversa .cab .tit { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-conversa .cab .tit .sub { display: block; color: #8b918e; font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-conversa .fluxo { flex: 1; overflow: auto; padding: 14px 13px 6px; display: flex; flex-direction: column; gap: 15px; scrollbar-width: thin; scrollbar-color: #4a5150 transparent; }
.an-conversa .vazio { color: #8b918e; text-align: center; padding: 22px 10px; font-size: 12.5px; line-height: 1.5; }

/* mensagem do agente: avatar + texto corrido; do usuário: balão à direita (padrão do Nexus UI) */
.an-msg { display: flex; gap: 9px; }
.an-msg.agente { align-self: stretch; }
.an-msg.agente .av { width: 26px; height: 26px; border-radius: 8px; background: #242827; display: grid; place-items: center; flex: none; margin-top: 1px; }
.an-msg.agente .av svg { width: 16px; height: 16px; }
.an-msg .corpo { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; }
.an-msg .quem { color: #8b918e; font-size: 11px; }
.an-msg.agente .balao { color: #e3e6e5; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg.usuario { align-self: flex-end; max-width: 88%; }
.an-msg.usuario .corpo { align-items: flex-end; }
.an-msg.usuario .balao { background: #2f3735; color: #fff; border-radius: 16px 16px 5px 16px; padding: 9px 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.an-msg .escolhida { color: #7ee2b0; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.an-msg .escolhida::before { content: "✓"; font-weight: 700; }

/* perguntas com opções */
.an-perguntas { display: flex; flex-direction: column; gap: 6px; padding: 9px; background: #202423; border: 1px solid #2f3534; border-radius: 14px; }
.an-perguntas .rot { color: #8b918e; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 1px 3px 3px; }
.an-opcao {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; padding: 9px 11px; border-radius: 10px;
  background: #191d1c; border: 1px solid #343837; color: #e7e7e7; font-size: 12.5px; line-height: 1.35;
}
.an-opcao:hover { border-color: #4b8bf5; background: #1e2735; }
.an-opcao .mira { width: 14px; height: 14px; border-radius: 999px; border: 1.6px solid #5a615f; flex: none; }
.an-opcao.marcada { border-color: #4b8bf5; background: #1e2735; }
.an-opcao.marcada .mira { border-color: #4b8bf5; box-shadow: inset 0 0 0 3px #4b8bf5; }
.an-opcao.livre { border-style: dashed; color: #a3a8a6; }
.an-opcao:disabled { opacity: .5; cursor: default; }

/* entrada: caixa única com a área de texto em cima e as ações embaixo */
.an-conversa .entrada {
  margin: 8px 10px 10px; border: 1px solid #383d3c; background: #212625; border-radius: 18px;
  display: flex; flex-direction: column; overflow: hidden; cursor: text;
}
.an-conversa .entrada:focus-within { border-color: #4b8bf5; box-shadow: 0 0 0 3px rgba(75,139,245,.16); }
.an-conversa .entrada textarea {
  border: 0; background: transparent; outline: 0; resize: none; color: #fff;
  min-height: 42px; max-height: 160px; padding: 11px 13px 3px; line-height: 1.45; font-size: 13px;
}
.an-conversa .entrada textarea::placeholder { color: #7f8785; }
.an-conversa .entrada .acoes { display: flex; align-items: center; gap: 6px; padding: 4px 7px 7px; }
.an-conversa .entrada .acoes .esp { flex: 1; }
.an-conversa .entrada .acoes .atalho { color: #6b7270; font-size: 10.5px; padding-left: 4px; }
.an-conversa .entrada .an-ok { width: 32px; height: 32px; background: #2563eb; }
.an-conversa .entrada .an-ok:hover { background: #3b74ee; }
.an-conversa .entrada .an-ok:disabled { background: #2a2e2d; color: #7f8a86; cursor: default; }
.an-conversa .dica-resp { padding: 0 15px 6px; color: #f2c14e; font-size: 11.5px; }
.an-estado.pergunta { background: #3d3218; color: #f2c14e; }
.an-religar.pergunta .n { background: #f2c14e; color: #1f2221; }
.an-fila .item.lote .num { background: #3b4240; }
.an-fila .item.lote.em_andamento .num { background: #d99a2b; color: #1f2221; }
.an-fila .item.lote.processado .num { background: #2f9e6a; }
.an-fila .txt .nota { color: #d6dad8; font-size: 12px; white-space: normal; }

.an-toast {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); pointer-events: none;
  background: #1f2221; border: 1px solid #343837; color: #fff; padding: 8px 14px; border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.35);
  max-width: min(720px, calc(100vw - 24px)); text-align: center;
}

.an-barra .an-ico.ativo { background: #3b4240; color: #fff; }
.an-area {
  position: fixed; pointer-events: none; display: none; border: 1.5px dashed #7ea7f5; background: rgba(126,167,245,.07); border-radius: 3px;
}
.an-area.ativa { border-style: solid; border-color: #2563eb; background: rgba(37,99,235,.12); }
.an-area .n { position: absolute; left: -1.5px; bottom: 100%; margin-bottom: 4px; background: #1e293b; color: #fff; font-size: 11px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); }

.an-arvore {
  position: fixed; left: 14px; top: 62px; width: min(360px, calc(100vw - 28px)); max-height: min(70vh, 640px); pointer-events: auto;
  display: flex; flex-direction: column; background: #1f2221; border: 1px solid #343837; border-radius: 18px;
  box-shadow: 0 16px 50px rgba(0,0,0,.45); overflow: hidden;
}
.an-arvore .cab { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 10px; border-bottom: 1px solid #2c302f; background: #242827; cursor: grab; user-select: none; }
.an-arvore .cab .tit { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-arvore .cab .tit .sub { display: block; color: #8b918e; font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.an-arvore .cab .an-ico.ativo { background: #24303f; color: #7ea7f5; }
.an-btn.mini { padding: 5px 10px; font-size: 12px; flex: none; }
.an-arvore .corpo { position: relative; flex: 1; overflow: auto; padding: 6px 6px 8px; scrollbar-width: thin; scrollbar-color: #4a5150 transparent; outline: 0; }
.an-arvore .dica-uso { padding: 6px 12px 8px; border-top: 1px solid #2c302f; color: #6f7674; font-size: 10.5px; line-height: 1.35; }
.an-no {
  display: flex; align-items: center; gap: 5px; height: 22px; padding-right: 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; white-space: nowrap; color: #cfd4d2; outline: 0; min-width: 0;
}
.an-no:hover { background: #2a2e2d; }
.an-no:focus { box-shadow: inset 0 0 0 1px #4b8bf5; }
.an-no.foco { background: #24303f; color: #fff; }
.an-no.foco .tag { color: #fff; }
.an-no.fora { opacity: .55; }
.an-no.invisivel { opacity: .4; }
.an-no .seta { width: 16px; height: 16px; border-radius: 4px; color: #8b918e; display: grid; place-items: center; flex: none; transition: transform .12s; padding: 0; }
.an-no .seta svg { width: 12px; height: 12px; }
.an-no .seta.aberto { transform: rotate(90deg); }
.an-no .seta:hover { background: #363b3a; color: #fff; }
.an-no .seta.vazia { visibility: hidden; }
.an-no .comp { flex: none; color: #9dbdf7; background: #1e2a3f; border-radius: 4px; padding: 1px 5px; font-size: 10.5px; font-weight: 700; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.an-no .nome { flex: none; font-size: 12px; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.an-no .tag { color: #e7e7e7; }
.an-no .id { color: #f2c14e; }
.an-no .cls { color: #8b918e; }
.an-no .txt { color: #a3a8a6; font-style: italic; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.an-no .pin { flex: none; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #2563eb; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; }
.an-no .pin.enviado { background: #2f9e6a; }
.an-no .dim { margin-left: auto; flex: none; color: #6b7270; font-size: 10.5px; font-family: var(--font-mono, ui-monospace, monospace); padding-left: 6px; }
.an-mais { height: 20px; display: flex; align-items: center; color: #8b918e; font-size: 11px; cursor: pointer; border-radius: 6px; }
.an-mais:hover { color: #fff; background: #2a2e2d; }
`;
