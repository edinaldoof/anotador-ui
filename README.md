# anotador-ui

Anote a interface do seu app **em desenvolvimento** — selecione um elemento, comente, altere propriedades num painel estilo Figma — e entregue as anotações a um **agente de código** (Claude Code, Codex, Gemini CLI ou qualquer outro) como pedidos de mudança precisos: onde está no código, qual classe governa cada propriedade e o que trocar. O agente responde na própria página: progresso, explicações e perguntas com opções clicáveis.

Nada muda no código do app. Um proxy reverso fica na frente do servidor de desenvolvimento e injeta o overlay respeitando a CSP da página.

## Requisitos

- Node **22.18+** (roda TypeScript direto, sem build). Zero dependências de runtime.
- Um app em modo de desenvolvimento (Next.js, Vite, Nuxt, Angular, SvelteKit, Astro… qualquer coisa que responda HTML).
- Opcional: um Chromium (o do Playwright serve) para os prints de cada anotação; sem ele, tudo funciona menos as capturas.

## Instalar

```bash
npm install -g github:edinaldoof/anotador-ui
```

ou clone e ligue o comando:

```bash
git clone https://github.com/edinaldoof/anotador-ui.git && cd anotador-ui && npm link
```

## Conectar ao app em desenvolvimento

Na pasta do projeto (o anotador varre o código-fonte da pasta atual para localizar cada elemento anotado):

```bash
anotador
```

Abra **http://localhost:3999/__anotador/** — a página de conexão:

1. **App em desenvolvimento** — detecta os servidores rodando nas portas comuns (com framework e título), testa a URL escolhida e conecta. Dá para ajustar o nome do projeto, a pasta do código-fonte e o rótulo do agente.
2. **Agente que aplica as anotações** — mostra quais agentes estão instalados (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity, Cursor), as **sessões do projeto** (as abertas agora e as recentes), quem está **ouvindo** os eventos e a **ponte automática**: sem ninguém ouvindo, o anotador chama o agente escolhido pela linha de comando a cada lote, numa sessão existente ou numa nova.
3. **Qualquer outro agente ou script** — o protocolo neutro (WebSocket + Markdown + REST) pronto para copiar.

As pílulas no topo dizem se a **conexão está ativa**: o app respondendo (HTTP, framework) e quantos agentes estão ouvindo. Depois de conectar, o app abre em `http://localhost:3999/` com a barra do anotador no topo. A conexão fica gravada por pasta: na próxima vez, `anotador` reconecta sozinho.

Também pela linha de comando: `anotador servir --alvo http://localhost:3000`, `anotador conectar <url>`, `anotador desconectar`.

## Anotar

| Ação | Como |
|---|---|
| Selecionar um elemento | clique (o clique não chega ao app); segure `Alt` para pegar o elemento exato em vez do interativo pai |
| Escolher o nível certo | ícone **Estrutura** na barra (`Alt+R`) abre a árvore compacta: ancestrais → elemento → filhos, com componente React, dimensões e pins; irmãos fora do caminho ficam resumidos em "+N". Clique numa linha troca a seleção **sem perder o comentário**; duplo clique abre as propriedades; setas navegam, `Enter` seleciona. Na página, `Alt+↑` sobe ao pai, `Alt+↓` desce ao filho (pelo ponto clicado), `Alt+←/→` vão aos irmãos |
| Ver o que há numa área | em modo Selecionar, **arraste** um retângulo na página: a árvore abre listando só o que cabe inteiro na área, a partir do ancestral comum (o resto aparece como "+N fora da área"); o retângulo fica desenhado até `Esc` |
| Comentar | balão ao lado do pin — `Enter` confirma; microfone dita em pt-BR (exige contexto seguro) |
| Alterar propriedades | ícone de controles no balão abre o painel: texto, cores, fonte, borda, tamanho, preenchimento, margem — aplica ao vivo, com antes/depois registrado |
| Usar a página normalmente | modo **Navegar** (`Alt+A` alterna) |
| Ver/excluir a fila | ícone de lista na barra |
| Enviar ao agente | **Enviar** — a fila vira um lote; a barra acompanha: "aguardando" → "Claude: aplicando em…" → "Claude perguntou" → "Aplicado por Claude ✓" |
| Conversar | painel de conversa por lote: explicações do agente, perguntas com opções clicáveis (mais "Outro…"), recados livres seus |
| Mover a barra, o painel, a árvore ou a conversa | arraste pela alça de pontos (ou pelo cabeçalho); duplo clique na alça recoloca no lugar padrão |
| Ocultar/reabrir | `Alt+Shift+A` |

A fila fica em `localStorage` do navegador até ser enviada: recarregar a página ou o HMR do framework não perde nada, e as prévias são reaplicadas. O overlay usa a tipografia da própria página (`--font-filson` quando declarada, senão a fonte do `body`).

## O que chega ao agente

Cada lote gera em `~/.claude/anotacoes/<projeto>/` (`ANOTADOR_HOME` troca a base):

- `lotes/<id>.md` — legível: página, viewport, e por anotação o comentário, o melhor seletor e alternativas ranqueadas por robustez, classes, texto visível, cadeia de ancestrais, **componentes React** (nomes de dev lidos da fiber), HTML do elemento, **onde está no código** (`arquivo:linha` rastreados por id, classes, texto e definição de componente, com prioridade para os arquivos alcançáveis a partir da rota), tabela de alterações de estilo (antes → depois) com a **classe atual e a utilitária Tailwind sugerida** — cores casadas com os tokens CSS do projeto, inclusive `oklch` —, alteração de texto e recorte do print.
- `lotes/<id>.json`, `lotes/<id>.instantaneo.html` (DOM com as edições e os pins), `lotes/<id>.conversa.jsonl` e `capturas/<id>/*.png`.
- `fila.jsonl` / `processadas.jsonl` — histórico; `agentes/*.log` — saída das execuções da ponte.

E um evento no WebSocket `/__anotador/eventos`.

## Agentes

### Claude Code

Copie (ou linke) a skill para o Claude Code:

```bash
ln -s "$(npm root -g)/anotador-ui/skills/anotar" ~/.claude/skills/anotar
```

Numa sessão do projeto, `/anotar`: ela sobe o anotador se preciso, liga o monitor de eventos identificando a sessão (a página de conexão mostra "ouvindo" ao lado dela) e passa a tratar cada lote como um pedido seu — aplica no código-fonte, publica progresso, pergunta pela interface quando algo é ambíguo e fecha o ciclo. Sem sessão ouvindo, a ponte automática chama `claude -p` (na sessão escolhida ou numa nova).

### Codex CLI, Gemini CLI, OpenCode

Escolha-os na página de conexão como ponte: a cada lote o anotador roda `codex exec` (ou `codex exec resume <sessão>`), `gemini -p` ou `opencode run` com um prompt que traz o id do lote, o caminho do Markdown e os comandos para responder pela interface.

### Antigravity, Cursor e qualquer outro

Não têm linha de comando para agentes; abra a pasta do projeto e peça ao agente para ler `lotes/<id>.md` e usar a API. O protocolo é neutro:

```
ws://127.0.0.1:3999/__anotador/eventos?agente=Nome&sessao=opcional   # {tipo: lote|progresso|processado|mensagem|conexao, ...}
GET  /__anotador/lotes?estado=pendente            GET  /__anotador/lotes/<id>/md
POST /__anotador/lotes/<id>/progresso  {"nota"}   POST /__anotador/lotes/<id>/mensagens {"autor":"agente","agente":"Nome","tipo":"nota|pergunta|escolha","texto","opcoes":[]}
GET  /__anotador/lotes/<id>/conversa              POST /__anotador/lotes/<id>/processado {"nota"}
```

Ou pela CLI, de qualquer terminal: `anotador pendentes | ver <id> | progresso <id> --nota … | nota <id> --texto … | perguntar <id> --texto … --opcoes "A|B" | conversa <id> | processado <id> --nota …`.

## Comandos

```
anotador                        sobe na porta 3999; reconecta ao último app desta pasta ou abre a página de conexão
anotador servir [--alvo URL] [--porta 3999] [--host 0.0.0.0] [--nome slug] [--saida dir] [--fonte dir]
                [--agente Claude] [--publico http://ip:porta] [--sem-csp] [--sem-capturas] [--chrome caminho] [--permitir-externo]
anotador conectar <url> | desconectar | saude | pendentes | ver <id> | conversa <id>
anotador progresso <id> --nota … | nota <id> --texto … | perguntar <id> --texto … [--opcoes "A|B|C"] [--multipla] | processado <id> [--nota …]
```

`--publico` informa a URL pela qual o navegador acessa o anotador quando há outro proxy na frente; `--permitir-externo` aceita alvos fora da máquina/rede local (por padrão só `localhost`, `*.local`, IPs privados e nomes simples).

## Como o proxy se comporta

- Reescreve só HTML de navegação (`Sec-Fetch-Dest: document`), injetando `<script nonce=… src="/__anotador/overlay.js">` com o nonce da própria página; descomprime gzip/br para isso. Assets, RSC, JSON e o WebSocket do HMR passam intactos.
- Reescreve `Host`, `Origin`, `Referer` e `Location` para o app não perceber a porta diferente; cookies valem, pois não distinguem porta.
- Sem app conectado, qualquer navegação vai para a página de conexão; trocar o app não exige reiniciar.

## Segurança e limites

- O anotador é ferramenta de desenvolvimento: escuta em `0.0.0.0` para você anotar de outro aparelho da rede, mas só aceita como alvo endereços da própria máquina ou da rede local, e as rotas que mudam a conexão ou iniciam agentes só respondem à própria página (ou a uma CLI local), nunca a outro site.
- A ponte roda o agente com permissões limitadas por padrão (`claude -p --permission-mode acceptEdits` com `Bash(anotador *)`, `codex exec --full-auto`); os logs ficam em `agentes/`.
- Iframes de outra origem e texto de elementos com filhos não são editáveis; conteúdo de Server Component não traz componente React — a localização vai por classes e texto.

## Desenvolvimento

```bash
npm install          # só typescript e @types/node, para checagem
npm test             # tsc estrito (servidor e overlay) + unitários + integração + E2E no Chromium
node --disable-warning=ExperimentalWarning scripts/validar-real.ts --alvo http://localhost:3001 --rota /entrar --saida ./prints
```

A engine de precisão de seleção (snap para o interativo, candidatos ranqueados, ids dinâmicos, iframes, shadow DOM) foi portada do inspetor da extensão `fluxos-extension` do repositório `delta` da Fundação FADEX.

## Licença

MIT.
