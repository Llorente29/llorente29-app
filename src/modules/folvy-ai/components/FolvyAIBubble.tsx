// src/modules/folvy-ai/components/FolvyAIBubble.tsx
//
// Componente "todo en uno" del chat flotante. Se monta UNA VEZ en Shell.
//
// Pulido v1++ (estado del arte 2026):
// - Burbuja flotante con isotipo (terracota cerrada, X abierta).
// - Animación de entrada del panel (fade + slide-up).
// - Header con subtítulo dinámico ("Pensando..." / "Mirando tu carta...").
// - Saludo proactivo automático la primera vez que se abre.
// - Chips de sugerencia en empty state.
// - Cursor parpadeante al final del texto que va escribiendo.
// - Botón Stop en el composer durante streaming.
// - Botones Copy/Regenerate/👍/👎 en cada respuesta completa.
// - Scroll inteligente con stickiness + botón "ir al fondo".
// - Botón "Reintentar" cuando hay error retryable.
//
// R1.3b (responsive móvil): el componente pasa a ser CONTROLABLE de forma
// opcional. Si recibe `open`/`onOpenChange` lo gobierna el padre (el Shell, que
// abre el chat desde el héroe IA de la barra inferior); si NO los recibe,
// funciona EXACTAMENTE igual que antes (estado interno, burbuja flotante).
// `hideLauncher` esconde el botón flotante (en móvil lo sustituye el héroe de la
// barra → adiós al solapamiento naranja); en ese modo el panel lleva su propia
// X de cierre en la cabecera.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, RotateCcw, RefreshCw, ChevronDown, Volume2, VolumeX, BarChart3, AlertCircle, Wand2, Mic } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useFolvyAI } from '../hooks/useFolvyAI';
import { useVoice } from '../hooks/useVoice';
import { FolvyAIIsotype } from './FolvyAIIsotype';
import { FolvyAIMessage } from './FolvyAIMessage';
import { FolvyAIComposer } from './FolvyAIComposer';
import { FolvyAIActionCard } from './FolvyAIActionCard';
import { FolvyAIActionModal } from './FolvyAIActionModal';

const TOOL_HUMAN_LABEL: Record<string, string> = {
  catalog_health: 'Mirando tu carta',
  assign_resale_cost: 'Preparando la propuesta',
};

const SUGGESTED_PROMPTS = [
  '¿Cómo está mi carta?',
  '¿Qué plato me deja menos margen?',
  'Asígnale coste a un producto sin escandallo',
];

// Capacidades REALES del copiloto (las que de verdad hace hoy). Honestas: no
// promete lo que no puede. Se amplían a medida que el agente gana herramientas.
const AGENT_CAPABILITIES: Array<{ icon: ReactNode; text: string }> = [
  { icon: <BarChart3 size={14} />, text: 'Veo el estado de tu carta, tus costes y tus márgenes en tiempo real' },
  { icon: <AlertCircle size={14} />, text: 'Detecto los productos que vendes sin coste conocido y su impacto en euros' },
  { icon: <Wand2 size={14} />, text: 'Asigno costes y aplico cambios contigo — siempre con tu confirmación' },
  { icon: <Mic size={14} />, text: 'Puedes hablarme y, si quieres, te respondo en voz alta' },
];

const STICKY_BOTTOM_THRESHOLD = 80;

interface FolvyAIBubbleProps {
  // Control externo opcional del abierto/cerrado. Si se pasan, el padre manda
  // (modo controlado); si no, el componente usa su estado interno (como antes).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Esconde el botón flotante (en móvil lo abre el héroe de la barra inferior).
  hideLauncher?: boolean;
  // Módulo activo (de la ruta). Selecciona el agente del edge (p.ej. 'kitchen').
  module?: string;
}

export function FolvyAIBubble({ open: openProp, onOpenChange, hideLauncher = false, module }: FolvyAIBubbleProps = {}) {
  const { activeAccountId } = useApp();

  // Abierto/cerrado controlable: si llega `open` por prop, manda el padre; si
  // no, estado interno. setOpen acepta valor o updater (compat con setOpen(v=>!v)).
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (!isControlled) setOpenState(value);
    onOpenChange?.(value);
  };

  const [mounted, setMounted] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);

  // Primer encuentro: la primera vez que se abre el chat en esta cuenta, se
  // muestra la CARTA DE PRESENTACIÓN (qué es el copiloto, qué hace) en vez del
  // saludo proactivo. Después, saludo normal. El flag vive por cuenta en
  // localStorage (una vez por dispositivo es un comportamiento aceptable).
  const presentedKey = activeAccountId ? `folvy_copiloto_presentado_${activeAccountId}` : null;
  const [isFirstEncounter, setIsFirstEncounter] = useState(false);
  useEffect(() => {
    if (!presentedKey) return;
    try {
      setIsFirstEncounter(localStorage.getItem(presentedKey) !== '1');
    } catch { setIsFirstEncounter(false); }
  }, [presentedKey]);

  const markPresented = () => {
    if (!presentedKey) return;
    try { localStorage.setItem(presentedKey, '1'); } catch { /* noop */ }
    setIsFirstEncounter(false);
  };
  const [stickyToBottom, setStickyToBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const {
    messages, isStreaming, currentTool, error,
    send, greet, retry, regenerate, abort, clear,
    confirmAction, cancelAction,
  } = useFolvyAI({ accountId: activeAccountId, module });

  // Voz: el dictado se inyecta en el composer; la respuesta se lee si TTS está on.
  const [dictatedText, setDictatedText] = useState<string | null>(null);
  const {
    sttSupported, isListening, startListening, stopListening,
    ttsSupported, ttsEnabled, toggleTts, speak, stopSpeaking,
  } = useVoice({ onTranscript: (t) => setDictatedText(t) });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
    }
  }, [open]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < STICKY_BOTTOM_THRESHOLD;
    setStickyToBottom(atBottom);
    setShowJumpToBottom(!atBottom && messages.length > 0);
  };

  useEffect(() => {
    if (!open || !stickyToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, open, stickyToBottom]);

  useEffect(() => {
    // En el primer encuentro NO saludamos: mostramos la carta de presentación.
    // El saludo proactivo se reserva para las siguientes visitas.
    if (!open || hasGreeted || messages.length > 0 || !activeAccountId || isStreaming || isFirstEncounter) return;
    setHasGreeted(true);
    greet();
  }, [open, hasGreeted, messages.length, activeAccountId, isStreaming, isFirstEncounter, greet]);

  // TTS: cuando el agente TERMINA de responder, lee su última respuesta en voz
  // alta (si el altavoz está activado). Se dispara al pasar isStreaming a false.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && ttsEnabled) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.status !== 'error' && last.content.trim()) {
        speak(last.content);
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, ttsEnabled, messages, speak]);

  // Al cerrar el panel, callar cualquier lectura en curso.
  useEffect(() => {
    if (!open) stopSpeaking();
  }, [open, stopSpeaking]);

  // Al enviar el primer mensaje (o tocar un chip), el primer encuentro queda
  // cerrado: a partir de aquí, saludo proactivo normal en futuras visitas.
  const handleSend = (text: string) => {
    if (isFirstEncounter) markPresented();
    send(text);
  };

  const handleNewConversation = () => {
    clear();
    setHasGreeted(false);
    setStickyToBottom(true);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickyToBottom(true);
    setShowJumpToBottom(false);
  };

  const showRetry = Boolean(error && error.toLowerCase().includes('reintentar')) && !isStreaming;

  const headerSubtitle = (() => {
    if (isStreaming && currentTool) {
      return TOOL_HUMAN_LABEL[currentTool] ?? `Usando ${currentTool}`;
    }
    if (isStreaming) return 'Pensando...';
    return 'Tu copiloto operativo';
  })();

  if (!activeAccountId) return null;

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Acción del agente que el MODAL CENTRAL debe mostrar: pending/executing
  // (decisión) y done (éxito visible un momento antes de cerrarse solo).
  const activeActionMsg = messages.find(m =>
    m.role === 'assistant' && m.pendingAction
    && (m.pendingAction.state === 'pending'
        || m.pendingAction.state === 'executing'
        || m.pendingAction.state === 'done'),
  );

  // Tras un éxito (done), el modal se mantiene ~2,5s mostrando la palomita y
  // luego se oculta solo. Guardamos el id "ya visto" para no reabrirlo.
  const [dismissedDoneIds, setDismissedDoneIds] = useState<string[]>([]);
  useEffect(() => {
    if (activeActionMsg?.pendingAction?.state === 'done'
        && !dismissedDoneIds.includes(activeActionMsg.id)) {
      const id = activeActionMsg.id;
      const t = setTimeout(() => setDismissedDoneIds(prev => [...prev, id]), 2500);
      return () => clearTimeout(t);
    }
  }, [activeActionMsg, dismissedDoneIds]);

  // El modal se muestra salvo que su éxito ya se haya auto-cerrado.
  const showActionModal = activeActionMsg
    && !(activeActionMsg.pendingAction?.state === 'done'
         && dismissedDoneIds.includes(activeActionMsg.id));

  return (
    <>
      {/* Botón flotante (launcher). Se esconde con hideLauncher (en móvil lo
          sustituye el héroe de la barra inferior). */}
      {!hideLauncher && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Cerrar Folvy Copiloto' : 'Abrir Folvy Copiloto'}
          className={
            'fixed bottom-6 right-6 z-40 rounded-full shadow-lg transition-all duration-base ' +
            'min-h-touch min-w-touch flex items-center justify-center ' +
            (open
              ? 'bg-card border border-border-default text-text-primary hover:bg-page'
              : 'bg-terracota hover:bg-terracota-hover')
          }
          style={{ width: 56, height: 56 }}
        >
          {open ? <X size={22} /> : <FolvyAIIsotype size={28} accentBg />}
        </button>
      )}

      {open && (
        <div
          className={
            'fixed bottom-24 right-6 z-30 bg-card border border-border-default rounded-xl shadow-lg flex flex-col overflow-hidden ' +
            'transition-all duration-base ease-out ' +
            (mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2')
          }
          style={{ width: 380, maxWidth: 'calc(100vw - 3rem)', height: 560, maxHeight: 'calc(100vh - 8rem)' }}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-default bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <FolvyAIIsotype size={24} />
              <div className="min-w-0">
                <div className="font-display text-sm text-text-primary leading-none">Folvy Copiloto</div>
                <div
                  className={
                    'text-xs mt-0.5 truncate transition-colors duration-fast ' +
                    (isStreaming ? 'text-terracota italic' : 'text-text-secondary')
                  }
                >
                  {headerSubtitle}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {ttsSupported && (
                <button
                  type="button"
                  onClick={toggleTts}
                  aria-label={ttsEnabled ? 'Desactivar voz' : 'Activar voz'}
                  title={ttsEnabled ? 'Voz activada (pulsa para silenciar)' : 'Activar lectura en voz alta'}
                  className={
                    'rounded-md p-1.5 transition-colors duration-fast ' +
                    (ttsEnabled
                      ? 'text-terracota hover:bg-page'
                      : 'text-text-secondary hover:text-text-primary hover:bg-page')
                  }
                >
                  {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
              )}
              {messages.length > 0 && !isStreaming && (
                <button
                  type="button"
                  onClick={handleNewConversation}
                  aria-label="Nueva conversación"
                  title="Nueva conversación"
                  className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-page transition-colors duration-fast"
                >
                  <RotateCcw size={16} />
                </button>
              )}
              {/* En modo sin launcher (móvil) el panel necesita su propia X. */}
              {hideLauncher && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar Folvy AI"
                  className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-page transition-colors duration-fast"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 py-3 bg-page relative"
          >
            {messages.length === 0 && !isStreaming && (
              <div className="py-6 px-3">
                {/* Identidad de marca */}
                <div className="text-center mb-5">
                  <div className="flex justify-center mb-3">
                    <FolvyAIIsotype size={48} />
                  </div>
                  <p className="font-display text-base text-text-primary">Folvy Copiloto</p>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Tu copiloto operativo. No solo te informa: actúa contigo, siempre con tu confirmación.
                  </p>
                </div>

                {/* Capacidades reales */}
                <div className="rounded-lg border border-border-default bg-card px-3 py-3 mb-4">
                  <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2 font-medium">Esto es lo que puedo hacer</p>
                  <ul className="space-y-1.5">
                    {AGENT_CAPABILITIES.map((cap, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-text-primary">
                        <span className="text-terracota mt-0.5 shrink-0">{cap.icon}</span>
                        <span>{cap.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Sugerencias para empezar */}
                <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2 font-medium px-1">Prueba a pedirme</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTED_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      className="text-left text-xs rounded-md border border-border-default bg-card px-3 py-2 text-text-primary hover:bg-terracota-bg hover:border-terracota transition-colors duration-fast"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => {
              const isLast = idx === messages.length - 1;
              const isLastAssistant = m.role === 'assistant' && idx === lastAssistantIdx;
              const isStreamingThis = isLast && isStreaming && m.role === 'assistant';
              return (
                <div key={m.id} className="relative">
                  <FolvyAIMessage
                    message={m}
                    isStreamingThisMessage={isStreamingThis}
                    onRegenerate={isLastAssistant && !isStreaming ? regenerate : undefined}
                  />
                  {m.role === 'assistant' && m.pendingAction
                    && m.pendingAction.state !== 'pending'
                    && m.pendingAction.state !== 'executing' && (
                    <div className="ml-9 mr-2">
                      <FolvyAIActionCard
                        action={m.pendingAction}
                        onConfirm={() => confirmAction(m.id)}
                        onCancel={() => cancelAction(m.id)}
                      />
                    </div>
                  )}
                  {isStreamingThis && m.content.length > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute inline-block w-[2px] h-3 bg-terracota animate-pulse"
                      style={{
                        bottom: '0.75rem',
                        left: '2.6rem',
                        animationDuration: '900ms',
                      }}
                    />
                  )}
                </div>
              );
            })}

            {isStreaming && currentTool && (
              <div className="flex items-center gap-2 mb-3">
                <FolvyAIIsotype size={24} />
                <div className="bg-terracota-bg rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-text-secondary italic">
                  <span>{TOOL_HUMAN_LABEL[currentTool] ?? `Usando ${currentTool}`}</span>
                  <span className="flex items-center gap-0.5">
                    <span className="w-1 h-1 bg-terracota rounded-full animate-pulse" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
                    <span className="w-1 h-1 bg-terracota rounded-full animate-pulse" style={{ animationDelay: '150ms', animationDuration: '900ms' }} />
                    <span className="w-1 h-1 bg-terracota rounded-full animate-pulse" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
                  </span>
                </div>
              </div>
            )}

            {showRetry && (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={retry}
                  className="flex items-center gap-2 rounded-md bg-card border border-border-default px-3 py-2 text-xs text-text-primary hover:bg-page transition-colors duration-fast"
                >
                  <RefreshCw size={14} />
                  Reintentar
                </button>
              </div>
            )}
          </div>

          {showJumpToBottom && (
            <button
              type="button"
              onClick={jumpToBottom}
              aria-label="Ir al final"
              className="absolute bottom-20 right-4 z-20 rounded-full bg-card border border-border-default shadow-md p-2 text-text-primary hover:bg-page transition-colors duration-fast"
            >
              <ChevronDown size={16} />
            </button>
          )}

          <FolvyAIComposer
            onSend={handleSend}
            onStop={abort}
            isStreaming={isStreaming}
            sttSupported={sttSupported}
            isListening={isListening}
            onStartListening={startListening}
            onStopListening={stopListening}
            dictatedText={dictatedText}
            onDictatedConsumed={() => setDictatedText(null)}
          />
        </div>
      )}

      {/* Modal central de confirmación de acción (a pantalla completa). Una
          decisión que cambia datos de negocio merece tomar el control de la
          pantalla. Tras confirmar, muestra el éxito un momento y se cierra solo. */}
      {showActionModal && activeActionMsg?.pendingAction && (
        <FolvyAIActionModal
          action={activeActionMsg.pendingAction}
          onConfirm={() => confirmAction(activeActionMsg.id)}
          onCancel={() => cancelAction(activeActionMsg.id)}
        />
      )}
    </>
  );
}
