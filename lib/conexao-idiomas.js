// Traduções apenas do texto da página de conexão; dados do projeto são preservados.
(() => {
  const linhas = [
  [
    "Anotador · conexão",
    "Anotador · connection",
    "Anotador · conexión"
  ],
  [
    "Idioma da interface",
    "Interface language",
    "Idioma de la interfaz"
  ],
  [
    "anotações visuais viram mudanças no código",
    "visual annotations become code changes",
    "las anotaciones visuales se convierten en cambios de código"
  ],
  [
    "App: verificando…",
    "App: checking…",
    "App: comprobando…"
  ],
  [
    "Agente: verificando…",
    "Agent: checking…",
    "Agente: comprobando…"
  ],
  [
    "Acesso deste navegador",
    "Browser access",
    "Acceso de este navegador"
  ],
  [
    "Conectando este navegador…",
    "Connecting this browser…",
    "Conectando este navegador…"
  ],
  [
    "Copiar link de acesso",
    "Copy access link",
    "Copiar enlace de acceso"
  ],
  [
    "Link de acesso para compartilhar",
    "Access link to share",
    "Enlace de acceso para compartir"
  ],
  [
    "App em desenvolvimento",
    "Development app",
    "Aplicación en desarrollo"
  ],
  [
    "O anotador fica na frente do seu servidor de desenvolvimento e injeta o overlay de anotação. Nada muda no código do app.",
    "Anotador sits in front of your development server and adds the annotation overlay. Your app code stays unchanged.",
    "Anotador se sitúa delante de tu servidor de desarrollo y añade la capa de anotaciones. El código de la aplicación no cambia."
  ],
  [
    "Abrir o app com o anotador",
    "Open app with Anotador",
    "Abrir la aplicación con Anotador"
  ],
  [
    "Desconectar",
    "Disconnect",
    "Desconectar"
  ],
  [
    "Servidores nesta máquina",
    "Servers on this machine",
    "Servidores en esta máquina"
  ],
  [
    "Procurar de novo",
    "Scan again",
    "Buscar de nuevo"
  ],
  [
    "Testar",
    "Test",
    "Probar"
  ],
  [
    "Conectar e abrir",
    "Connect and open",
    "Conectar y abrir"
  ],
  [
    "Trocar e abrir",
    "Switch and open",
    "Cambiar y abrir"
  ],
  [
    "Projeto, código-fonte e rótulo do agente",
    "Project, source code and agent label",
    "Proyecto, código fuente y nombre del agente"
  ],
  [
    "Nome do projeto (nomeia a pasta da fila)",
    "Project name (used for the queue folder)",
    "Nombre del proyecto (se usa para la carpeta de la cola)"
  ],
  [
    "Nome do agente mostrado na interface",
    "Agent name shown in the interface",
    "Nombre del agente que aparece en la interfaz"
  ],
  [
    "Pasta do código-fonte (para localizar cada elemento no código)",
    "Source code folder (to locate each element in the code)",
    "Carpeta de código fuente (para localizar cada elemento en el código)"
  ],
  [
    "Agente que aplica as anotações",
    "Agent applying the annotations",
    "Agente que aplica las anotaciones"
  ],
  [
    "Quem recebe cada lote e mexe no código. Uma sessão pode ouvir os eventos ao vivo; sem ninguém ouvindo, a ponte chama o agente pela linha de comando.",
    "The agent receives each batch and edits the code. A session can listen to live events; when no session is listening, the bridge calls the agent through its CLI.",
    "El agente recibe cada lote y edita el código. Una sesión puede escuchar eventos en directo; cuando nadie escucha, el puente llama al agente por su CLI."
  ],
  [
    "Ponte automática",
    "Automatic bridge",
    "Puente automático"
  ],
  [
    "ativa",
    "active",
    "activo"
  ],
  [
    "Sem ninguém ouvindo, cada lote novo chama este agente e modelo pela linha de comando.",
    "When nobody is listening, each new batch calls this agent and model through the CLI.",
    "Cuando nadie está escuchando, cada lote nuevo llama a este agente y modelo por la línea de comandos."
  ],
  [
    "Ouvindo agora",
    "Listening now",
    "Escuchando ahora"
  ],
  [
    "Qualquer outro agente ou script",
    "Any other agent or script",
    "Cualquier otro agente o script"
  ],
  [
    "Protocolo neutro: eventos por WebSocket, lotes em Markdown e uma API REST. Serve para Antigravity, Cursor, um script seu ou qualquer modelo.",
    "A neutral protocol: WebSocket events, Markdown batches and a REST API. Works with Antigravity, Cursor, your scripts or any model.",
    "Protocolo neutro: eventos por WebSocket, lotes en Markdown y una API REST. Compatible con Antigravity, Cursor, tus scripts o cualquier modelo."
  ],
  [
    "Endereços deste anotador",
    "Anotador endpoints",
    "Direcciones de Anotador"
  ],
  [
    "Copiar",
    "Copy",
    "Copiar"
  ],
  [
    "Extrair design de um site · DESIGN.md",
    "Extract website design · DESIGN.md",
    "Extraer el diseño de un sitio · DESIGN.md"
  ],
  [
    "documentação",
    "documentation",
    "documentación"
  ],
  [
    "Copiado.",
    "Copied.",
    "Copiado."
  ],
  [
    "baixo",
    "low",
    "bajo"
  ],
  [
    "médio",
    "medium",
    "medio"
  ],
  [
    "alto",
    "high",
    "alto"
  ],
  [
    "muito alto",
    "very high",
    "muy alto"
  ],
  [
    "máximo",
    "maximum",
    "máximo"
  ],
  [
    "fila: ",
    "queue: ",
    "cola: "
  ],
  [
    "código-fonte: ",
    "source code: ",
    "código fuente: "
  ],
  [
    "App: não conectado",
    "App: disconnected",
    "Aplicación: desconectada"
  ],
  [
    "App: respondendo",
    "App: responding",
    "Aplicación: respondiendo"
  ],
  [
    "App: sem resposta",
    "App: not responding",
    "Aplicación: sin respuesta"
  ],
  [
    "Agente: {quantidade} ouvindo",
    "Agent: {quantidade} listening",
    "Agente: {quantidade} escuchando"
  ],
  [
    "Agente: ponte {nome}",
    "Agent: {nome} bridge",
    "Agente: puente {nome}"
  ],
  [
    "Agente: ninguém ouvindo",
    "Agent: nobody listening",
    "Agente: nadie está escuchando"
  ],
  [
    "{quantidade} lote(s) pendente(s)",
    "{quantidade} pending batch(es)",
    "{quantidade} lote(s) pendiente(s)"
  ],
  [
    "Última conexão nesta pasta: {url} · {hora}",
    "Last connection in this folder: {url} · {hora}",
    "Última conexión en esta carpeta: {url} · {hora}"
  ],
  [
    "tipografia: ",
    "typography: ",
    "tipografía: "
  ],
  [
    " instala a San Francisco",
    " installs San Francisco",
    " instala San Francisco"
  ],
  [
    "Faltam nesta máquina: {fontes}",
    "Missing on this machine: {fontes}",
    "Faltan en esta máquina: {fontes}"
  ],
  [
    "Anotador: sem resposta",
    "Anotador: not responding",
    "Anotador: sin respuesta"
  ],
  [
    "Procurando servidores…",
    "Scanning for servers…",
    "Buscando servidores…"
  ],
  [
    "Nenhum servidor nas portas comuns",
    "No servers on common ports",
    "No hay servidores en los puertos habituales"
  ],
  [
    "Inicie o app em modo de desenvolvimento (npm run dev) e procure de novo — ou digite a URL abaixo.",
    "Start the app in development mode (npm run dev) and scan again, or enter its URL below.",
    "Inicia la aplicación en modo de desarrollo (npm run dev) y vuelve a buscar, o introduce su URL a continuación."
  ],
  [
    "Digite a URL do servidor de desenvolvimento.",
    "Enter the development server URL.",
    "Introduce la URL del servidor de desarrollo."
  ],
  [
    "Testando {url}…",
    "Testing {url}…",
    "Probando {url}…"
  ],
  [
    "não foi possível testar",
    "could not test the server",
    "no se pudo probar el servidor"
  ],
  [
    "Essa URL é o próprio anotador — aponte para o servidor do app.",
    "This URL points to Anotador itself. Use the app server URL.",
    "Esta URL corresponde a Anotador. Usa la URL del servidor de la aplicación."
  ],
  [
    "Sem resposta ({erro}). O servidor de desenvolvimento está rodando?",
    "No response ({erro}). Is the development server running?",
    "Sin respuesta ({erro}). ¿Está en ejecución el servidor de desarrollo?"
  ],
  [
    "desconhecido",
    "unknown",
    "desconocido"
  ],
  [
    "Respondeu HTTP {status}",
    "Received HTTP {status}",
    "Respondió HTTP {status}"
  ],
  [
    ", não é HTML (API?)",
    ", not HTML (API?)",
    ", no es HTML (¿API?)"
  ],
  [
    "Copia o comando para colar nessa sessão",
    "Copy the command to paste into this session",
    "Copiar el comando para pegarlo en esta sesión"
  ],
  [
    "Já ouvindo",
    "Already listening",
    "Ya está escuchando"
  ],
  [
    "Copiar /anotar",
    "Copy /anotar",
    "Copiar /anotar"
  ],
  [
    "Iniciar conversa",
    "Start conversation",
    "Iniciar conversación"
  ],
  [
    "sessão {id}",
    "session {id}",
    "sesión {id}"
  ],
  [
    "aberta",
    "open",
    "abierta"
  ],
  [
    "ouvindo",
    "listening",
    "escuchando"
  ],
  [
    "não encontrado no PATH",
    "not found in PATH",
    "no se encontró en PATH"
  ],
  [
    "não instalado",
    "not installed",
    "no instalado"
  ],
  [
    "Sessões abertas agora",
    "Currently open sessions",
    "Sesiones abiertas ahora"
  ],
  [
    "Sessões recentes deste projeto",
    "Recent project sessions",
    "Sesiones recientes de este proyecto"
  ],
  [
    "Ver mais {quantidade} sessão(ões)",
    "Show {quantidade} more session(s)",
    "Ver {quantidade} sesión(es) más"
  ],
  [
    "Nenhuma sessão de {nome} para esta pasta.",
    "No {nome} sessions for this folder.",
    "No hay sesiones de {nome} para esta carpeta."
  ],
  [
    "Iniciar conversa numa sessão nova",
    "Start conversation in a new session",
    "Iniciar conversación en una sesión nueva"
  ],
  [
    "Roda o agente em segundo plano com os lotes pendentes.",
    "Runs the agent in the background with pending batches.",
    "Ejecuta el agente en segundo plano con los lotes pendientes."
  ],
  [
    "não foi possível iniciar",
    "could not start",
    "no se pudo iniciar"
  ],
  [
    "{nome} iniciado (pid {pid}).",
    "{nome} started (pid {pid}).",
    "{nome} iniciado (pid {pid})."
  ],
  [
    "desligada",
    "off",
    "desactivado"
  ],
  [
    "Desligada",
    "Off",
    "Desactivado"
  ],
  [
    "só as sessões que estiverem ouvindo",
    "only sessions that are listening",
    "solo las sesiones que estén escuchando"
  ],
  [
    "Modelo padrão",
    "Default model",
    "Modelo predeterminado"
  ],
  [
    "o que o {nome} já usa",
    "the model {nome} already uses",
    "el modelo que ya utiliza {nome}"
  ],
  [
    " ·  padrão",
    " · default",
    " · predeterminado"
  ],
  [
    "Raciocínio",
    "Reasoning",
    "Razonamiento"
  ],
  [
    "não foi possível salvar",
    "could not save",
    "no se pudo guardar"
  ],
  [
    "Ponte: {nome}",
    "Bridge: {nome}",
    "Puente: {nome}"
  ],
  [
    "Ponte desligada.",
    "Bridge disabled.",
    "Puente desactivado."
  ],
  [
    "Ninguém ouvindo. Abra uma sessão do agente e conecte (Claude Code: /anotar) ou ligue a ponte automática.",
    "Nobody is listening. Open and connect an agent session (Claude Code: /anotar) or enable the automatic bridge.",
    "Nadie está escuchando. Abre y conecta una sesión del agente (Claude Code: /anotar) o activa el puente automático."
  ],
  [
    "agente",
    "agent",
    "agente"
  ],
  [
    "sem identificação",
    "unidentified",
    "sin identificación"
  ],
  [
    "desde {hora}",
    "since {hora}",
    "desde {hora}"
  ],
  [
    "Execuções da ponte",
    "Bridge runs",
    "Ejecuciones del puente"
  ],
  [
    "rodando",
    "running",
    "en ejecución"
  ],
  [
    "saiu {codigo}",
    "exited {codigo}",
    "terminó {codigo}"
  ],
  [
    " · sessão nova",
    " · new session",
    " · sesión nueva"
  ],
  [
    "(vazio)",
    "(empty)",
    "(vacío)"
  ],
  [
    "Numa sessão aberta, digite /anotar: ela passa a ouvir os eventos. Sem sessão ouvindo, a ponte chama `claude -p` (na sessão escolhida ou numa nova).",
    "In an open session, enter /anotar to listen to events. When no session is listening, the bridge calls `claude -p` in the chosen session or a new one.",
    "En una sesión abierta, escribe /anotar para escuchar eventos. Si ninguna sesión escucha, el puente llama a `claude -p` en la sesión elegida o en una nueva."
  ],
  [
    "A ponte chama `codex exec` (ou `codex exec resume <sessão>`) a cada lote. Numa sessão interativa, peça para ler lotes/<id>.md e usar a API.",
    "The bridge calls `codex exec` (or `codex exec resume <sessão>`) for each batch. In an interactive session, ask it to read lotes/<id>.md and use the API.",
    "El puente llama a `codex exec` (o `codex exec resume <sessão>`) por cada lote. En una sesión interactiva, pide que lea lotes/<id>.md y use la API."
  ],
  [
    "A ponte chama `gemini -p` a cada lote.",
    "The bridge calls `gemini -p` for each batch.",
    "El puente llama a `gemini -p` por cada lote."
  ],
  [
    "A ponte chama `opencode run` a cada lote.",
    "The bridge calls `opencode run` for each batch.",
    "El puente llama a `opencode run` por cada lote."
  ],
  [
    "A ponte entrega cada lote ao Antigravity CLI com `agy -p`, na pasta do projeto. Usa a conta já conectada ao CLI e permite editar os arquivos; comandos de terminal seguem as permissões configuradas no Antigravity.",
    "The bridge sends each batch to Antigravity CLI with `agy -p` in the project folder. It uses the account already connected to the CLI and allows file edits; terminal commands follow Antigravity permissions.",
    "El puente entrega cada lote a Antigravity CLI con `agy -p` en la carpeta del proyecto. Usa la cuenta conectada al CLI y permite editar archivos; los comandos de terminal respetan los permisos de Antigravity."
  ],
  [
    "Abra a pasta do projeto e peça ao agente para ler lotes/<id>.md e usar a API REST.",
    "Open the project folder and ask the agent to read lotes/<id>.md and use the REST API.",
    "Abre la carpeta del proyecto y pide al agente que lea lotes/<id>.md y use la API REST."
  ],
  [
    "O aplicativo Antigravity está instalado, mas o CLI `agy` não foi encontrado. Instale o Antigravity CLI para receber os lotes automaticamente.",
    "The Antigravity app is installed, but the `agy` CLI was not found. Install Antigravity CLI to receive batches automatically.",
    "La aplicación Antigravity está instalada, pero no se encontró el CLI `agy`. Instala Antigravity CLI para recibir lotes automáticamente."
  ]
];
  linhas.push(...[["Verificar acesso","Check access","Verificar acceso"],["Este navegador está conectado. Compartilhe um link para conectar outro navegador; basta abri-lo uma vez.","This browser is connected. Share an access link to connect another browser; it only needs to be opened once.","Este navegador está conectado. Comparte un enlace de acceso para conectar otro navegador; basta con abrirlo una vez."],["Não foi possível verificar o acesso. Recarregue esta página para tentar novamente.","Could not check access. Reload this page to try again.","No se pudo verificar el acceso. Recarga esta página para intentarlo de nuevo."],["Conecte este navegador abrindo uma vez o link de acesso compartilhado por quem iniciou o Anotador.","Connect this browser by opening the access link shared by the person who started Anotador.","Conecta este navegador abriendo el enlace de acceso compartido por quien inició Anotador."],["O navegador não guardou a conexão. Permita os cookies deste site e clique em Verificar acesso.","The browser did not save the connection. Allow cookies for this site and click Check access.","El navegador no guardó la conexión. Permite las cookies de este sitio y pulsa Verificar acceso."],["Não foi possível falar com o Anotador. Verifique a conexão e tente novamente.","Could not reach Anotador. Check the connection and try again.","No se pudo conectar con Anotador. Comprueba la conexión e inténtalo de nuevo."],["Abra o link de acesso compartilhado para conectar este navegador.","Open the shared access link to connect this browser.","Abre el enlace de acceso compartido para conectar este navegador."],["Não foi possível criar o link de acesso.","Could not create the access link.","No se pudo crear el enlace de acceso."],["Link copiado. Compartilhe com a pessoa que vai usar o Anotador; ela só precisa abri-lo uma vez neste navegador.","Link copied. Share it with the person using Anotador; they only need to open it once in their browser.","Enlace copiado. Compártelo con la persona que usará Anotador; solo tiene que abrirlo una vez en su navegador."],["Copie o link abaixo e compartilhe. Ao abri-lo uma vez, o outro navegador fica conectado.","Copy and share the link below. Opening it once connects the other browser.","Copia y comparte el enlace siguiente. Al abrirlo una vez, el otro navegador quedará conectado."],["\n\nConectar mesmo assim? Você pode subir o app depois.","\n\nConnect anyway? You can start the app later.","\n\n¿Conectar de todas formas? Puedes iniciar la aplicación después."],["falha ao conectar","connection failed","error al conectar"],["Conectado. Abrindo o app…","Connected. Opening the app…","Conectado. Abriendo la aplicación…"],["Desconectando o app…","Disconnecting the app…","Desconectando la aplicación…"],["Não foi possível desconectar o app.","Could not disconnect the app.","No se pudo desconectar la aplicación."],["Desconectado. O app continua rodando na porta dele; só o anotador saiu da frente.","Disconnected. The app is still running on its own port; Anotador is no longer in front of it.","Desconectado. La aplicación sigue funcionando en su propio puerto; Anotador ya no está delante."],["Conecte este navegador para abrir o app com todas as funções do Anotador.","Connect this browser to open the app with all Anotador features.","Conecta este navegador para abrir la aplicación con todas las funciones de Anotador."],["Abrindo o app…","Opening the app…","Abriendo la aplicación…"]]);
  window.__anotador_i18n?.registrar({en:Object.fromEntries(linhas.map(([pt,en])=>[pt,en])),es:Object.fromEntries(linhas.map(([pt,,es])=>[pt,es]))});
})();
