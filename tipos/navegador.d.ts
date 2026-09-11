// Tipos só do navegador: globais do overlay e a Web Speech API, que o lib.dom
// do TypeScript não declara.

interface ConstrutorReconhecimentoVoz {
  new (): SpeechRecognition;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface DepuracaoAnotador {
  pendentes(): Anotacao[];
  enviadas(): Anotacao[];
  lotes(): Array<{ id: string; enviadoEm: string; estado: EstadoLote; nota?: string; perguntasAbertas?: number }>;
  atual(): Anotacao | null;
  armado(): boolean;
  conversa(): { lote: string; mensagens: Mensagem[] } | null;
  abrirConversa(id: string): boolean;
  arvore(): ResumoArvore;
  abrirArvore(): void;
}

interface Window {
  __ANOTADOR_CFG?: ConfigOverlay;
  __anotadorCarregado?: boolean;
  __anotadorDebug?: DepuracaoAnotador;
  SpeechRecognition?: ConstrutorReconhecimentoVoz;
  webkitSpeechRecognition?: ConstrutorReconhecimentoVoz;
}
