<p align="center">
  <img src="docs/imagens/logo.svg" width="76" alt="">
</p>

<h1 align="center">anotador-ui</h1>

<p align="center">
  Anote a interface do seu app <b>em desenvolvimento</b> — selecione um elemento, comente, ajuste propriedades —<br>
  e entregue tudo a um <b>agente de código</b> como pedidos de mudança precisos, com conversa de mão dupla.
</p>

<p align="center">
  <a href="https://github.com/edinaldoof/anotador-ui/actions/workflows/ci.yml"><img src="https://github.com/edinaldoof/anotador-ui/actions/workflows/ci.yml/badge.svg" alt="testes"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.18-3c873a" alt="Node 22.18+">
  <img src="https://img.shields.io/badge/depend%C3%AAncias-0-2f6df6" alt="zero dependências">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-6e7781" alt="licença MIT">
</p>

<p align="center"><img src="docs/imagens/anotar.png" alt="Overlay do anotador sobre um app Next.js: barra flutuante, elemento selecionado, balão de comentário e painel de propriedades"></p>

Você aponta na tela. O agente recebe **onde aquilo está no código**, **qual classe governa cada propriedade** e **o que trocar** — e responde na própria página: progresso, explicações e perguntas com opções clicáveis.

Nada muda no código do app: um proxy reverso fica na frente do servidor de desenvolvimento e injeta o overlay respeitando a CSP da página.

```bash
npm install -g github:edinaldoof/anotador-ui
cd meu-projeto && anotador
```

Abra `http://localhost:3999/__anotador/`, escolha o app e comece.

---

## Índice

[Como funciona](#como-funciona) · [Instalação](#instalação) · [Conectar](#1-conectar-ao-app-em-desenvolvimento) · [Anotar](#2-anotar) · [Agente](#3-o-agente-aplica-e-responde) · [O que chega ao agente](#o-que-chega-ao-agente) · [Protocolo](#protocolo-para-qualquer-agente) · [Comandos](#comandos) · [Segurança](#segurança-e-limites)

## Como funciona

| | |
|---|---|
| **1. Conectar** | O anotador detecta os servidores em dev na sua máquina e fica na frente do escolhido. |
| **2. Anotar** | Clique num elemento, comente, ajuste propriedades com prévia ao vivo, **Enviar**. |
| **3. Aplicar** | O agente recebe o lote em Markdown, mexe no código e responde na própria página. |

Requisitos: **Node 22.18+** (roda TypeScript direto, sem build), um app em modo de desenvolvimento (Next.js, Vite, Nuxt, Angular, SvelteKit, Astro… qualquer coisa que responda HTML) e, opcionalmente, um Chromium para os prints de cada anotação.

## Instalação

```bash
npm install -g github:edinaldoof/anotador-ui
```

Ou clone e ligue o comando:

```bash
git clone https://github.com/edinaldoof/anotador-ui.git && cd anotador-ui && npm link
```

## 1. Conectar ao app em desenvolvimento

Na pasta do projeto — a varredura do código-fonte usa a pasta atual:

```bash
anotador
```

Abra **http://localhost:3999/__anotador/**. A página detecta os servidores rodando nas portas comuns, mostra framework e título de cada um, testa e conecta:

![Página de conexão: servidores detectados na máquina, com framework e título, e o app conectado](docs/imagens/conexao.png)

A conexão fica gravada por pasta: na próxima vez, `anotador` reconecta sozinho. As pílulas no topo dizem se o app responde e quantos agentes estão ouvindo. Também dá para usar a linha de comando:

```bash
anotador servir --alvo http://localhost:3000    # ou: anotador conectar <url> / desconectar
```

## 2. Anotar

Depois de conectar, o app abre em `http://localhost:3999/` com a barra do anotador no topo.

| Ação | Como |
|---|---|
| **Selecionar** | clique (o clique não chega ao app); `Alt` pega o elemento exato em vez do interativo pai |
| **Escolher o nível certo** | **Estrutura** (`Alt+R`) abre a árvore: ancestrais → elemento → filhos. Clicar numa linha troca a seleção **sem perder o comentário**; `Alt+↑↓←→` andam por pai, filho e irmãos |
| **Ver o que há numa área** | **arraste** um retângulo na página: a árvore lista só o que cabe inteiro nele |
| **Comentar** | balão ao lado do pin (`Enter` confirma; microfone dita em pt-BR) |
| **Alterar propriedades** | painel com texto, cores, fonte, borda, tamanho, preenchimento e margem — prévia ao vivo, antes/depois registrado |
| **Usar a página** | modo **Navegar** (`Alt+A` alterna) |
| **Enviar** | a fila vira um lote; a barra acompanha do "aguardando" ao "Aplicado ✓" |
| **Mover/ocultar** | arraste pela alça de pontos; `Alt+Shift+A` oculta e reabre |

![Árvore de elementos com uma área selecionada na página, listando só o que cabe inteiro dentro dela](docs/imagens/estrutura.png)

A fila fica no `localStorage` até ser enviada: recarregar a página ou o HMR do framework não perde nada, e as prévias são reaplicadas.

## 3. O agente aplica e responde

A barra segue o ciclo em tempo real — *aguardando* → *aplicando em…* → *perguntou* → *aplicado ✓* — e cada lote tem uma conversa própria: o agente explica o que vai fazer, pergunta quando algo é ambíguo (com opções clicáveis) e você responde sem sair da página.

![Painel de conversa: o agente explica que o estilo vem de um componente compartilhado e pergunta qual passo da escala usar, com três opções clicáveis](docs/imagens/conversa.png)

### Claude Code

```bash
ln -s "$(npm root -g)/anotador-ui/skills/anotar" ~/.claude/skills/anotar
```

Numa sessão do projeto, `/anotar`: ela sobe o anotador se preciso, liga o monitor de eventos identificando a sessão e passa a tratar cada lote como um pedido seu.

### Codex CLI, Gemini CLI, OpenCode

Escolha-os como **ponte** na página de conexão: a cada lote o anotador roda `codex exec` (ou `codex exec resume <sessão>`), `gemini -p` ou `opencode run` com um prompt que já traz o id do lote, o caminho do Markdown e os comandos para responder pela interface.

![Cartão de agentes: Claude Code, Codex CLI e Antigravity instalados, sessões abertas do projeto e ponte automática](docs/imagens/agentes.png)

A página lista as **sessões do projeto** — as abertas agora e as recentes — e mostra quem está **ouvindo**. Antigravity, Cursor e afins não têm linha de comando para agentes: abra a pasta do projeto e peça ao agente para ler `lotes/<id>.md` e usar a API.

## O que chega ao agente

Cada lote gera em `~/.claude/anotacoes/<projeto>/` (`ANOTADOR_HOME` troca a base):

- **`lotes/<id>.md`** — por anotação: o comentário, seletores ranqueados por robustez, classes, texto visível, cadeia de ancestrais, componentes React lidos da fiber, HTML do elemento, **onde está no código** (`arquivo:linha` rastreados por id, classes, texto e definição de componente, priorizando o que a rota alcança) e uma tabela de **como aplicar** (classe atual → utilitária sugerida, com cores casadas aos tokens CSS do projeto, inclusive `oklch`).
- `lotes/<id>.json`, `lotes/<id>.instantaneo.html` (DOM com as edições e os pins), `lotes/<id>.conversa.jsonl` e `capturas/<id>/*.png` (página inteira e um recorte por anotação).
- `fila.jsonl` / `processadas.jsonl` (histórico) e `agentes/*.log` (saída das execuções da ponte).

<details>
<summary>Exemplo de trecho do Markdown</summary>

```markdown
## Anotação 1 — Dar mais destaque a este rótulo
- Elemento: `<p>` · componentes React: EscolhaDeAcesso, PaginaEntrar
- Melhor seletor: texto "Acesso institucional" em <p> — texto, único, 72 pts

### Onde está no código
- `components/ui/page.tsx:81` — classes completas (100 pts) · na rota
- `app/entrar/page.tsx:49` — texto (80 pts) · na rota

### Alterações de estilo e como aplicar
| Propriedade | Antes | Depois | Classe atual | Sugestão |
|---|---|---|---|---|
| `font-size` | `12px` | `14px` | `text-xs` | `text-sm` |
```
</details>

## Protocolo, para qualquer agente

Neutro de modelo: WebSocket para eventos, Markdown para o conteúdo, REST para responder.

```
ws://127.0.0.1:3999/__anotador/eventos?agente=Nome&sessao=opcional
   {tipo: lote|progresso|processado|mensagem|conexao, id, caminhoMd, resumo, arquivos}

GET  /__anotador/lotes?estado=pendente          GET /__anotador/lotes/<id>/md
POST /__anotador/lotes/<id>/progresso   {"nota":"aplicando em X"}
POST /__anotador/lotes/<id>/mensagens   {"autor":"agente","tipo":"escolha","texto":"…","opcoes":["A","B"]}
GET  /__anotador/lotes/<id>/conversa    # respostas (autor: usuario, responde: <id da pergunta>)
POST /__anotador/lotes/<id>/processado  {"nota":"o que mudou"}
```

O mesmo pela linha de comando, de qualquer terminal:

```bash
anotador pendentes
anotador ver <id>
anotador progresso <id> --nota "aplicando em components/ui/page.tsx"
anotador perguntar <id> --texto "Em todos os botões ou só neste?" --opcoes "Em todos|Só neste"
anotador processado <id> --nota "borda de 2px em todos os marcadores"
```

## Comandos

```
anotador                        sobe na porta 3999; reconecta ao último app desta pasta ou abre a página de conexão
anotador servir [--alvo URL] [--porta 3999] [--host 0.0.0.0] [--nome slug] [--saida dir] [--fonte dir]
                [--agente Claude] [--publico http://ip:porta] [--sem-csp] [--sem-capturas] [--chrome caminho] [--permitir-externo]
anotador conectar <url> | desconectar | saude | pendentes | ver <id> | conversa <id>
anotador progresso <id> --nota … | nota <id> --texto … | perguntar <id> --texto … [--opcoes "A|B|C"] [--multipla] | processado <id> [--nota …]
```

`--publico` informa a URL pela qual o navegador acessa o anotador quando há outro proxy na frente; `--permitir-externo` aceita alvos fora da máquina e da rede local.

## Como o proxy se comporta

- Reescreve só HTML de navegação (`Sec-Fetch-Dest: document`), injetando `<script nonce=… src="/__anotador/overlay.js">` com o nonce da própria página. Assets, RSC, JSON e o WebSocket do HMR passam intactos.
- Reescreve `Host`, `Origin`, `Referer` e `Location` para o app não perceber a porta diferente; a sessão autenticada vale, pois cookies não distinguem porta.
- Sem app conectado, qualquer navegação vai para a página de conexão; trocar o app não exige reiniciar.

## Segurança e limites

- Ferramenta de desenvolvimento: escuta em `0.0.0.0` para você anotar de outro aparelho da rede, mas **só aceita como alvo** endereços da própria máquina ou da rede local, e as rotas que trocam a conexão ou iniciam agentes só respondem à própria página, nunca a outro site.
- A ponte roda o agente com permissões limitadas (`claude -p --permission-mode acceptEdits`, `codex exec --full-auto`) e guarda os logs em `agentes/`.
- Iframes de outra origem e texto de elementos com filhos não são editáveis; conteúdo de Server Component não traz componente React — a localização vai por classes e texto.

## Desenvolvimento

```bash
npm install     # só typescript e @types/node, para checagem
npm test        # tsc estrito (servidor e overlay) + unitários + integração + E2E no Chromium
node --disable-warning=ExperimentalWarning scripts/validar-real.ts --alvo http://localhost:3001 --rota /entrar --saida ./prints
node --disable-warning=ExperimentalWarning scripts/capturas-doc.ts --alvo http://localhost:3001 --rota /entrar   # imagens deste README
```

| Pasta | O quê |
|---|---|
| `server.ts` | proxy, API REST, WebSocket e linha de comando |
| `overlay/` | o que roda no navegador: engine de seleção, estilos e interface |
| `lib/` | fila em disco, análise do código-fonte, detecção de servidores e agentes, CDP, página de conexão |
| `skills/anotar/` | a skill do Claude Code |
| `tests/` | unitários, integração do proxy e ponta a ponta no Chromium |

A engine de precisão de seleção (snap para o interativo, candidatos ranqueados, ids dinâmicos, iframes, shadow DOM) foi portada do inspetor da extensão `fluxos-extension` do repositório `delta` da Fundação FADEX.

## Licença

MIT © [Edinaldo Filho](mailto:edinaldofilho2021@ufpi.edu.br)
