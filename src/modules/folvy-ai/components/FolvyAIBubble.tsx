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

import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw, RefreshCw, ChevronDown } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useFolvyAI } from '../hooks/useFolvyAI';
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
  'Mapea mis ventas pendientes',
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
  const [stickyToBottom, setStickyToBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const {
    messages, isStreaming, currentTool, error,
    send, greet, retry, regenerate, abort, clear,
    confirmAction, cancelAction,
  } = useFolvyAI({ accountId: activeAccountId, module });

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
    if (!open || hasGreeted || messages.length > 0 || !activeAccountId || isStreaming) return;
    setHasGreeted(true);
    greet();
  }, [open, hasGreeted, messages.length, activeAccountId, isStreaming, greet]);

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
    return 'Tu asistente operativo';
  })();

  if (!activeAccountId) return null;

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Acción del agente que está esperando decisión del usuario (pending/executing).
  // Se muestra como MODAL CENTRAL (decisión relevante, no un cartelito lateral).
  const activeActionMsg = messages.find(m =>
    m.role === 'assistant' && m.pendingAction
    && (m.pendingAction.state === 'pending' || m.pendingAction.state === 'executing'),
  );

  return (
    <>
      {/* Botón flotante (launcher). Se esconde con hideLauncher (en móvil lo
          sustituye el héroe de la barra inferior). */}
      {!hideLauncher && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Cerrar Folvy AI' : 'Abrir Folvy AI'}
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
                <div className="font-display text-sm text-text-primary leading-none">Folvy AI</div>
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
              <div className="text-center py-8 px-4">
                <div className="flex justify-center mb-3">
                  <FolvyAIIsotype size={40} />
                </div>
                <p className="text-sm text-text-primary font-medium">Folvy AI</p>
                <p className="text-xs text-text-secondary mt-2 leading-relaxed mb-4">
                  Tu asistente operativo. Pregúntame por tu carta, tus márgenes, tus ventas.
                </p>
                <div className="flex flex-col gap-2 max-w-xs mx-auto">
                  {SUGGESTED_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => send(prompt)}
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
            onSend={send}
            onStop={abort}
            isStreaming={isStreaming}
          />
        </div>
      )}

      {/* Modal central de confirmación de acción (a pantalla completa). Una
          decisión que cambia datos de negocio merece tomar el control de la
          pantalla, no quedar en un recuadro lateral. */}
      {activeActionMsg?.pendingAction && (
        <FolvyAIActionModal
          action={activeActionMsg.pendingAction}
          onConfirm={() => confirmAction(activeActionMsg.id)}
          onCancel={() => cancelAction(activeActionMsg.id)}
        />
      )}
    </>
  );
}
