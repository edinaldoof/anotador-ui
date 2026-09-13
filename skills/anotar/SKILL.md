---
name: anotar
description: Liga esta sessão ao anotador visual (proxy que injeta um overlay de inspeção e anotação no app em desenvolvimento) — cada lote que o usuário envia pela interface chega como evento e deve virar mudança no código-fonte, com progresso, explicações e perguntas publicados de volta na página. Use quando o usuário pedir para anotar/inspecionar a interface visualmente, "abrir o anotador", marcar elementos na tela, conectar o anotador a esta sessão, ou quando um evento de lote chegar.
---

# /anotar — anotações visuais que viram mudanças no código

Ferramenta: `anotador` (repositório `anotador-ui`; se o comando global não existir, use `node <raiz do anotador-ui>/bin/anotador.mjs`). Fila em `~/.claude/anotacoes/<nome>/` (ou `$ANOTADOR_HOME/<nome>`).

## 1. Subir e conectar (uma vez por sessão)

1. Veja se já está no ar: `curl -s http://127.0.0.1:3999/__anotador/saude`. Campos que importam: `conectado`/`alvo` (app em dev), `quemOuve` (sessões ouvindo), `pendentes`, `ponte`. Se responder com outro `nome`, use outra porta (`--porta 3998`) para não misturar filas.
2. Se não estiver, inicie em background (Bash com `run_in_background`), **a partir da raiz do projeto** — o servidor varre o código-fonte da pasta atual para localizar cada elemento anotado:
   ```bash
   anotador servir --porta 3999
   ```
   Sem `--alvo`, ele reconecta ao último app usado nesta pasta; se nunca conectou, fica esperando e a página de conexão `http://localhost:3999/__anotador/` detecta os servidores em dev, testa e conecta (também dá para passar `--alvo http://localhost:<porta>` direto, ou `anotador conectar <url>` com o servidor no ar).
3. Diga ao usuário a URL para abrir (a saída imprime `localhost` e os IPs da rede) e o essencial: clicar seleciona, `Alt` pega o elemento exato, **Estrutura** (`Alt+R`) mostra a árvore para escolher o nível certo e arrastar um retângulo lista o que há numa área, balão comenta (`Enter` confirma), ícone de controles abre o painel de propriedades, **Navegar** (`Alt+A`) devolve a página, **Enviar** manda a fila para cá.
4. Ligue o monitor de eventos, persistente, **identificando esta sessão** para a página de conexão mostrar "ouvindo" ao lado dela:
   ```bash
   # id desta sessão: o Claude Code grava ~/.claude/sessions/<pid>.json; o pid é o pai do shell
   SESSAO=$(python3 -c "import json,os,subprocess; pp=subprocess.check_output(['ps','-o','ppid=','-p',str(os.getppid())]).decode().strip(); print(json.load(open(os.path.expanduser(f'~/.claude/sessions/{pp}.json'))).get('sessionId',''))" 2>/dev/null || echo "")
   ```
   `Monitor({ ws: { url: "ws://127.0.0.1:3999/__anotador/eventos?agente=Claude&sessao=<SESSAO>&cwd=<raiz do projeto>&rotulo=Claude%20Code" }, description: "anotações do anotador-ui (<nome>)", persistent: true, timeout_ms: 3600000 })`
   (sem o id, passe só `agente=Claude&cwd=…`).
5. Drene o que ficou de sessões anteriores: `anotador pendentes --porta 3999` e processe cada lote como abaixo.

## 2. Ao chegar um evento `{"tipo":"lote", id, caminhoMd, capturas, resumo, arquivos}`

Trate como uma mensagem do usuário pedindo mudanças.

0. Avise na interface que começou — a barra do overlay mostra "Claude: …" em tempo real:
   ```bash
   anotador progresso <id> --porta 3999 --nota "lendo o lote"
   ```
   Repita em cada marco: `--nota "aplicando em <arquivo>"`, `--nota "verificando lint e testes"`. Frases curtas; é o que aparece na barra.
1. Leia `caminhoMd` (Read). Se `capturas.pagina` / `capturas.anotacoes` existirem, leia os PNGs (caminhos relativos à pasta da fila) — o recorte mostra o elemento com a prévia já aplicada.
2. Vá ao código pelo que o Markdown já rastreou, nesta ordem:
   - **"Onde está no código"**: `arquivo:linha` ranqueados por critério (id/data-testid > classes completas > texto > definição do componente), com prioridade para os arquivos "na rota". Abra o primeiro; confirme pelo trecho e pelo bloco "HTML do elemento na seleção" (estrutura + tag do pai). O evento traz o mesmo em `arquivos`.
   - Se a seção vier vazia: grep pela sequência exata de **classes**, depois pelo **texto visível**, depois pelos **componentes React** (`grep -rn "function <Nome>\|const <Nome>"`). "Sem componente React no cliente" significa Server Component: classes e texto são o caminho.
3. Aplique:
   - **"Alterações de estilo e como aplicar"**: cada linha traz a classe atual que governa a propriedade e a utilitária sugerida (Tailwind do projeto; cores casadas com os tokens CSS do próprio projeto). Use a sugestão, trocando a classe atual; se a observação disser "sem token equivalente", **não** aplique a cor literal: pergunte ou crie o token conforme as convenções do repositório. Confira sempre contra as réguas do projeto antes de gravar.
   - `texto` antes → depois: altere a string na ocorrência apontada (e em i18n, se houver).
   - **Família, não instância**: quando o elemento anotado é uma repetição (item de lista, selo de etapa, célula, card) ou seu estilo vem de um componente compartilhado, aplique no componente/classe-base para que **todas** as instâncias e variantes mudem juntas — nunca só a instância clicada. Se uma variante já tinha o valor pedido, remova a redundância. Diga na nota e no chat que foi aplicado à família.
   - o **comentário** manda: ele pode pedir algo além das propriedades (reposicionar, remover, criar). Se for ambíguo — ou se vier sem comentário com valores fora do padrão do projeto —, **pergunte pela interface**, não só no chat; o usuário está olhando a página, não o terminal:
     ```bash
     anotador perguntar <id> --porta 3999 --texto "Aplicar em todos os botões primários ou só neste?" --opcoes "Em todos|Só neste"
     ```
     Sem `--opcoes` vira pergunta de texto livre; `--multipla` permite marcar várias. A resposta chega como evento `{"tipo":"mensagem", mensagem:{autor:"usuario", opcoes, texto, responde}}` no mesmo monitor — trate como resposta do usuário e continue. Para explicar uma decisão sem pedir nada, `anotador nota <id> --texto "…"`. `anotador conversa <id>` lista tudo. Não marque como processado com pergunta aberta, a não ser que a nota diga o que ficou pendente.
4. Rode a verificação que o projeto usa (typecheck/lint/testes rápidos).
5. Feche o ciclo — o overlay do usuário mostra "Aplicado por Claude ✓":
   ```bash
   anotador processado <id> --porta 3999 --nota "<o que mudou, curto>"
   ```
6. Responda no chat com o que mudou (arquivos e o quê), em poucas linhas.
7. Se o projeto documenta decisões de interface (ex.: `docs/frontend.md`), registre ali a convenção que a anotação estabeleceu — o lote é a origem da decisão, não um ajuste avulso.

Não marque como processado antes de aplicar. Se decidir não aplicar algo, marque mesmo assim com a nota explicando, para o usuário ver o motivo na interface.

## 2b. Ao chegar `{"tipo":"mensagem"}` com `mensagem.autor === "usuario"`

É o usuário respondendo pela interface (a uma pergunta sua, se `responde` estiver preenchido; recado livre, se não). `opcoes` traz o que ele clicou; `texto`, o que escreveu. Continue o lote de onde parou; confirme com `anotador nota <id>` o que vai fazer com a resposta.

## 2c. Ao chegar `{"tipo":"avaliacao", id, caminhoMd, resumo}`

O usuário pediu um **parecer de UI/UX** sobre a página inteira, não uma anotação pontual.

1. Leia o dossiê em `caminhoMd`. Ele traz: o que a régua objetiva já mediu (contraste, alvo de toque, hierarquia de cabeçalho, transbordo, alinhamento, consistência de controles), a estrutura da página, os componentes em cena, o sistema de design do projeto com a intenção de cada token, e o caminho da captura. Achado marcado com origem `norma` veio do `axe-core` do próprio projeto, emprestado quando existe; ele cobre ARIA, semântica e landmarks, que a régua geométrica não alcança.
2. **Leia a captura** (Read no PNG). Sem olhar a tela, o parecer vira palpite.
3. Julgue só o que a régua não alcança: hierarquia visual, clareza da ação principal, consistência entre componentes do mesmo papel, densidade e respiro, elegância. Não repita os achados objetivos.
4. Cada item precisa apontar **um elemento concreto** (seletor), dizer o **problema** para quem usa, e uma **sugestão aplicável na linguagem do projeto** (token ou utilitária, nunca valor solto). Se a tela estiver boa, diga isso em poucas linhas — parecer inflado queima a confiança na ferramenta.
5. **Onde o julgamento depender da intenção, pergunte em vez de afirmar.** O dossiê traz uma seção com o que os autores escreveram nos arquivos da rota — quase todo "por que está assim" está lá. Se não estiver, mande uma `pergunta` com opções no próprio parecer: ela aparece para quem abriu a página e a resposta volta para você em `GET /__anotador/avaliacoes/<id>`. Duas opções lado a lado podem ser dois públicos distintos, não uma escolha mal explicada.
6. Devolva por `POST /__anotador/avaliacoes/<id>/parecer` no formato que o próprio dossiê descreve. O painel do usuário mostra cada item com botão para anotar e mandar você aplicar.

`anotador avaliacoes` lista os pedidos; `anotador avaliacao <id>` imprime o dossiê e o parecer.

`anotador design --tokens` exporta os tokens do projeto no formato do W3C (Design Tokens Format Module), que Figma, Style Dictionary e Tokens Studio leem. Use quando o pedido for levar o sistema de design daqui para a ferramenta de design, e não o contrário.

## 2d. Ao chegar `{"tipo":"conexao"}`

O usuário trocou (ou desligou) o app conectado pela página de conexão: `alvo` é a nova URL (ou `null`). Nada a fazer além de saber para qual app os próximos lotes se referem.

## 3. Ponte automática e outros agentes

- Na página de conexão o usuário pode escolher uma **ponte**: quando ninguém está ouvindo, o anotador chama o agente pela linha de comando a cada lote (`claude -p`, `codex exec`, `gemini -p`…). Se você foi iniciado assim (prompt começa com "Chegou um lote do anotador-ui" ou "Você foi conectado ao anotador-ui"), siga a seção 2 exatamente — o texto já traz id, caminho do Markdown e porta.
- `anotador ver <id>` imprime o Markdown de um lote; `anotador saude` mostra alvo, fila, ouvintes e ponte; `anotador conectar <url>` / `desconectar` trocam o app com o servidor no ar.
- O servidor roda em background até o fim da sessão; a fila em disco e o registro de conexões persistem entre sessões.
- `--sem-csp` se o app bloquear o overlay mesmo com o nonce; `--sem-capturas` para pular os prints; `--permitir-externo` aceita alvos fora da máquina/rede local.
